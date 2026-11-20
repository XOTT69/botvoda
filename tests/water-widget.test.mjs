import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deflateSync} from 'node:zlib';
import {WATER_WIDGET_HTML} from '../src/water-widget-html.js';
import {waterDay,nextWaterChange,waterWidgetState,serializeWaterState,packIntervals,unpackIntervals,demoWaterState} from '../src/water-widget-model.js';
import {sendWaterWidget,handleWaterWidgetQuery,ensureWaterWidgetWebhook} from '../src/water-widget.js';

const rule={intervals:[[360,540],[720,840],[1080,1320]],updatedAt:null};
const day=water=>({date:'2026-11-20',water,fallback:rule.intervals,possible:[],updatedAt:null});

test('water uses 1.2 alone, combines pump power and dated reserve hours',()=>{
  const raw={rows:{'1.2':{intervals:[[0,720],[840,1080]]}},possible:{'1.2':[[900,960]]}};
  assert.deepEqual(waterDay(raw,rule,'2026-11-20').water,[[360,540],[720,840],[1080,1440]]);
  assert.deepEqual(waterDay(raw,rule,'2026-11-20').possible,[[900,960]]);
  assert.deepEqual(waterDay({rows:{'1.2':{intervals:[]}}},rule,'x').water,[[0,1440]]);
  assert.equal(waterDay({rows:{}},rule,'x').water,null);
});

test('next change ignores home electricity and respects midnight / missing tomorrow',()=>{
  assert.deepEqual(nextWaterChange(day([[360,840],[1080,1440]]),day(null),750),[840,0]);
  assert.deepEqual(nextWaterChange(day([[1080,1440]]),day([[0,120],[360,600]]),1300),[1560,0]);
  assert.deepEqual(nextWaterChange(day([[1080,1440]]),day([[360,600]]),1300),[1440,0]);
  assert.equal(nextWaterChange(day([[1080,1440]]),day(null),1300),null);
  assert.equal(nextWaterChange(day(null),day([[0,1440]]),1300),null);
});

test('manual water affects only the current status; tomorrow remains a forecast',()=>{
  const state=waterWidgetState({today:day([]),tomorrow:day([[360,540]]),manual:{state:'on'},community:{on:0,off:3},now:new Date('2026-11-20T10:00:00Z'),selected:1});
  assert.equal(state.c,1);assert.equal(state.o,'manual');assert.deepEqual(unpackIntervals(state.w),[[360,540]]);
  assert.deepEqual(state.a,[0,3]);assert.equal(state.m,720);
  assert.equal(demoWaterState(0,'unknown').w,null);
  assert.equal(demoWaterState(0,'unknown').c,null);
});

test('HTML and heavily fragmented state fit Telegram byte budgets',()=>{
  assert.ok(Buffer.byteLength(WATER_WIDGET_HTML)<=32768);
  assert.ok(deflateSync(WATER_WIDGET_HTML,{level:9}).length<=4096,'Telegram permits at most 4096 compressed bytes');
  const fragments=Array.from({length:48},(_,i)=>[i*30,i*30+15]);
  assert.deepEqual(unpackIntervals(packIntervals(fragments)),fragments);
  const state=demoWaterState();state.w=packIntervals(fragments);state.f=packIntervals(fragments);state.p=packIntervals(fragments);
  assert.ok(Buffer.byteLength(serializeWaterState(state))<=1024);
  assert.throws(()=>serializeWaterState({text:'я'.repeat(600)}),/1024/);
  assert.doesNotMatch(WATER_WIDGET_HTML,/fetch\(|XMLHttpRequest|<iframe|<input|https:\/\//);
});

function fixture(ready=true){
  const calls=[],sqlCalls=[];
  const env={TELEGRAM_BOT_TOKEN:'test',TELEGRAM_WEBHOOK_SECRET:'test',DB:{prepare(sql){
    const stmt={bind(...args){this.args=args;return this},async first(){
      sqlCalls.push(sql);
      if(sql.includes('SELECT value FROM app_settings'))return ready?{value:'ready'}:null;
      if(sql.includes('FROM water_rule_versions'))return {effective_date:'2026-10-15',intervals_json:JSON.stringify(rule.intervals)};
      if(sql.includes('on_count'))return {on_count:2,off_count:0};
      return null;
    },async all(){
      if(sql.includes('FROM schedules WHERE'))return {results:[{group_name:'1.2',intervals_json:'[[0,360],[840,1080]]',created_at:'2026-11-20 10:00:00'}]};
      return {results:[]};
    },async run(){sqlCalls.push({sql,args:this.args});return {meta:{changes:1}}}};
    return stmt;
  }}};
  const fetchFn=async(url,options)=>{
    const method=url.split('/').at(-1),payload=JSON.parse(options.body);calls.push({method,payload});
    return Response.json({ok:true,result:method==='getWebhookInfo'?{url:'https://water.example/telegram',allowed_updates:['message','callback_query','edited_message'],max_connections:12}:true});
  };
  return {env,calls,sqlCalls,fetchFn};
}

test('existing webhook gains widget queries and preserves URL, custom updates and pending delivery',async()=>{
  const f=fixture(false),old=globalThis.fetch;globalThis.fetch=f.fetchFn;
  try{
    assert.equal(await ensureWaterWidgetWebhook(f.env),true);
    const set=f.calls.find(x=>x.method==='setWebhook').payload;
    assert.equal(set.url,'https://water.example/telegram');assert.equal(set.max_connections,12);
    assert.equal(set.drop_pending_updates,false);assert.ok(set.allowed_updates.includes('edited_message'));
    assert.ok(set.allowed_updates.includes('widget_query'));assert.ok(set.secret_token);
  }finally{globalThis.fetch=old}
});

test('sendWidget carries real schedule state and query permission; declined API falls back to text',async()=>{
  const f=fixture(),old=globalThis.fetch;globalThis.fetch=f.fetchFn;
  try{
    await sendWaterWidget(f.env,'123',1);
    const sent=f.calls.find(x=>x.method==='sendWidget').payload;
    assert.equal(sent.allow_queries,true);assert.equal(JSON.parse(sent.chat_data).k,1);
    assert.equal(sent.html,WATER_WIDGET_HTML);
    globalThis.fetch=async(url,options)=>url.endsWith('/sendWidget')?Response.json({ok:false,description:'Unavailable'},{status:400}):f.fetchFn(url,options);
    await sendWaterWidget(f.env,'123');
    assert.ok(f.calls.some(x=>x.method==='sendMessage'));
  }finally{globalThis.fetch=old}
});

const query={id:'q',from:{id:123,first_name:'Test'},chat:{id:123,type:'private'},message_id:4,type:{type:'data'},data:'w:on:0'};
test('reports use sender identity, update same widget and answer the query without sending a new widget',async()=>{
  const f=fixture(),old=globalThis.fetch;globalThis.fetch=f.fetchFn;
  try{
    await handleWaterWidgetQuery(query,f.env);
    const report=f.sqlCalls.find(x=>x.sql?.startsWith('INSERT INTO water_reports'));
    assert.deepEqual(report.args,['123','on']);
    assert.equal(f.calls.find(x=>x.method==='editMessageWidgetData').payload.message_id,4);
    assert.equal(f.calls.filter(x=>x.method==='answerWidgetQuery').length,1);
    assert.ok(!f.calls.some(x=>x.method==='sendWidget'));
  }finally{globalThis.fetch=old}
});

test('cross-user, group, malformed and non-data widget queries cannot write reports',async()=>{
  for(const change of [{chat:{id:456,type:'private'}},{chat:{id:123,type:'group'}},{data:'w:on:999'},{type:{type:'sign_data'}},{message_id:null}]){
    const f=fixture(),old=globalThis.fetch;globalThis.fetch=f.fetchFn;
    try{
      await handleWaterWidgetQuery({...query,...change},f.env);
      assert.equal(f.sqlCalls.length,0);assert.deepEqual(f.calls.map(x=>x.method),['answerWidgetQuery']);
    }finally{globalThis.fetch=old}
  }
});

test('background refresh does not record activity or submit a water report',async()=>{
  const f=fixture(),old=globalThis.fetch;globalThis.fetch=f.fetchFn;
  try{
    await handleWaterWidgetQuery({...query,data:'w:refresh:1'},f.env);
    assert.ok(!f.sqlCalls.some(x=>x.sql?.startsWith('INSERT')));
    assert.equal(JSON.parse(f.calls.find(x=>x.method==='editMessageWidgetData').payload.chat_data).k,1);
  }finally{globalThis.fetch=old}
});
