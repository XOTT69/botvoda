import test from 'node:test';
import assert from 'node:assert/strict';
import {cardPayload,cardFingerprint,validateCard} from '../src/schedule-card-model.js';
import {scheduleCardSvg} from '../src/schedule-card.js';
import {runCardPublication,cardTelegram} from '../src/schedule-card-publisher.js';

const now=new Date('2026-10-31T16:00:00Z');
const payload=cardPayload([[480,660],[960,1140]],[[480,660]],now);
function fixture(){
  let row={group_chat_id:'-1001',message_id:9};const calls=[];let renders=0;
  const store={get:async()=>({...row}),claim:async(attempt,stamp)=>{
    if(['sending','uncertain'].includes(row.photo_state)||row.photo_state==='working'&&row.photo_attempt_at>=stamp-120000)return false;
    row={...row,photo_state:'working',photo_attempt:attempt,photo_attempt_at:stamp};return true;
  },set:async(attempt,fields)=>{assert.equal(row.photo_attempt,attempt);row={...row,...fields};}};
  const args={store,payload,now:now.getTime(),render:async()=>{renders++;return new Uint8Array(2000);},
    telegram:async(method,body)=>{calls.push({method,...body});return {message_id:777};}};
  return {args,calls,get row(){return row},set row(v){row=v},get renders(){return renders}};
}

test('only today without confirmed tomorrow; explicit empty outages mean all-day planned light',()=>{
  const a=cardPayload([],null,now);assert.equal(a.tomorrow,null);
  const svg=scheduleCardSvg(a);assert.doesNotMatch(svg,/Завтра/);assert.match(svg,/00:00 — 24:00/);
  const b=cardPayload(null,[],now);assert.equal(b.tomorrow,'2026-11-01');
  assert.match(scheduleCardSvg(b),/Графік ще не опублікований/);
  assert.match(scheduleCardSvg(b),/Завтра/);
});

test('Kyiv midnight drops yesterday and selects the new day',()=>{
  const a=cardPayload([],null,new Date('2026-10-31T21:59:00Z'));
  const b=cardPayload([],null,new Date('2026-10-31T22:00:00Z'));
  assert.equal(a.today,'2026-10-31');assert.equal(b.today,'2026-11-01');assert.equal(b.tomorrow,null);
});

test('content fingerprint ignores refresh timestamp and rejects invalid schedules',async()=>{
  assert.equal(await cardFingerprint(payload),await cardFingerprint({...payload,updatedAt:'2026-10-31T17:00:00Z'}));
  assert.notEqual(await cardFingerprint(payload),await cardFingerprint(cardPayload([[600,660]],null,now)));
  assert.throws(()=>cardPayload([[900,600]],null,now));
  assert.throws(()=>validateCard({...payload,today:'2026-02-31'}));
  assert.throws(()=>validateCard({...payload,tomorrow:'2026-11-02'}));
});

test('create once, persist ID before pin, then edit the same photo on real schedule changes',async()=>{
  const f=fixture();const original=f.args.telegram;
  f.args.telegram=async(method,body)=>{if(method==='pinChatMessage')assert.equal(f.row.photo_message_id,777);return original(method,body);};
  assert.equal((await runCardPublication(f.args)).messageId,777);
  assert.equal((await runCardPublication(f.args)).unchanged,true);
  await runCardPublication({...f.args,payload:cardPayload([[600,660]],null,now)});
  assert.deepEqual(f.calls.map(c=>c.method),['sendPhoto','pinChatMessage','editMessageMedia']);
  assert.equal(f.calls[2].messageId,777);assert.equal(f.renders,2);assert.equal(f.row.message_id,9);
});

test('parallel invocations do not create duplicates',async()=>{
  const f=fixture();await Promise.all([runCardPublication(f.args),runCardPublication(f.args),runCardPublication(f.args)]);
  assert.equal(f.calls.filter(c=>c.method==='sendPhoto').length,1);
});

test('a missing old photo is replaced once; a permission failure does not create a replacement',async()=>{
  const f=fixture();f.row={...f.row,photo_message_id:123,photo_pinned:1};
  const original=f.args.telegram;
  f.args.telegram=async(method,body)=>{if(method==='editMessageMedia'){f.calls.push({method});throw Object.assign(new Error('message to edit not found'),{missing:true,definitelyRejected:true});}return original(method,body);};
  await runCardPublication(f.args);
  assert.deepEqual(f.calls.map(c=>c.method),['editMessageMedia','sendPhoto','pinChatMessage']);
  const g=fixture();g.row={...g.row,photo_message_id:123};
  g.args.telegram=async()=>{throw Object.assign(new Error('Forbidden'),{definitelyRejected:true});};
  assert.equal((await runCardPublication(g.args)).ok,false);assert.equal(g.row.photo_message_id,123);
});

test('uncertain send or failed D1 write after delivery blocks automatic resend',async()=>{
  for(const failStore of [false,true]){
    const f=fixture();
    if(failStore){const set=f.args.store.set;f.args.store.set=async(attempt,fields)=>{
      if(fields.photo_message_id===777)throw new Error('D1 unavailable');return set(attempt,fields);
    };}else f.args.telegram=async(method)=>{f.calls.push({method});throw new Error('network timeout');};
    assert.equal((await runCardPublication(f.args)).pending,true);
    assert.equal((await runCardPublication(f.args)).pending,true);
    assert.equal(f.calls.filter(c=>c.method==='sendPhoto').length,1);
  }
});

test('pin failure retries pin only, with saved ID and no extra rendering',async()=>{
  const f=fixture();const original=f.args.telegram;let fail=true;
  f.args.telegram=async(method,body)=>{
    if(method==='pinChatMessage'&&fail){f.calls.push({method});throw Object.assign(new Error('No pin rights'),{definitelyRejected:true});}
    return original(method,body);
  };
  await runCardPublication(f.args);fail=false;await runCardPublication(f.args);
  assert.deepEqual(f.calls.map(c=>c.method),['sendPhoto','pinChatMessage','pinChatMessage']);assert.equal(f.renders,1);
});

test('definite send rejection and render failure can be retried later',async()=>{
  const f=fixture();const original=f.args.telegram;
  f.args.telegram=async()=>{throw Object.assign(new Error('Forbidden'),{definitelyRejected:true});};
  await runCardPublication(f.args);assert.equal(f.row.photo_state,'idle');
  f.args.telegram=original;assert.equal((await runCardPublication(f.args)).ok,true);
  const g=fixture();g.args.render=async()=>{throw new Error('renderer failed');};
  await runCardPublication(g.args);assert.equal(g.row.photo_state,'idle');assert.equal(g.calls.length,0);
});

test('Telegram uploads PNG with the existing token/channel and removes the inline keyboard',async()=>{
  let url,options;
  const telegram=cardTelegram({TELEGRAM_BOT_TOKEN:'123:existing'},'-10042',async(u,o)=>{url=u;options=o;return Response.json({ok:true,result:{message_id:777}});});
  await telegram('sendPhoto',{image:new Uint8Array([137,80,78,71])});
  assert.equal(url,'https://api.telegram.org/bot123:existing/sendPhoto');
  assert.equal(options.body.get('chat_id'),'-10042');assert.equal(options.body.get('disable_notification'),'true');
  assert.ok(options.body.get('photo') instanceof Blob);assert.deepEqual(JSON.parse(options.body.get('reply_markup')),{inline_keyboard:[]});
  assert.equal(options.body.get('caption'),null);
});

test('D1 SQL claim excludes active and uncertain sends and fences an expired renderer',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const {photoStore}=await import('../src/schedule-card-publisher.js');
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE publications(group_chat_id TEXT PRIMARY KEY,message_id INTEGER,
    photo_state TEXT,photo_message_id INTEGER,photo_attempt TEXT,photo_attempt_at INTEGER,
    photo_fingerprint TEXT,photo_pinned INTEGER,photo_error TEXT,updated_at TEXT);
    INSERT INTO publications(group_chat_id,message_id) VALUES('-1001',9);`);
  const env={DB:{prepare(sql){return {bind(...args){return {
    first:async()=>db.prepare(sql).get(...args),
    run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})
  };}};}}};
  try{
    const store=photoStore(env,'-1001');
    assert.equal(await store.claim('first',1000000),true);
    assert.equal(await store.claim('other',1000001),false);
    assert.equal(await store.claim('recovered',1120001),true);
    await assert.rejects(store.set('first',{photo_state:'sending'}),/ownership lost/);
    await store.set('recovered',{photo_state:'sending'});
    assert.equal(await store.claim('never',9999999),false);
    await store.set('recovered',{photo_state:'uncertain'});
    assert.equal(await store.claim('still-never',9999999),false);
    assert.equal((await store.get()).message_id,9);
  }finally{db.close();}
});

test('Preview denies bot endpoints and cron before touching production bindings',async()=>{
  const {default:worker}=await import('../src/index.js');
  const touched=[];
  const env=new Proxy({PREVIEW_MODE:'on'}, {get(target,key){
    if(key==='PREVIEW_MODE')return target[key];
    touched.push(key);throw new Error('Production binding must not be accessed');
  }});
  for(const [method,path] of [['POST','/telegram'],['GET','/setup-webhook'],['GET','/webhook-info']]){
    const response=await worker.fetch(new Request('https://preview.example'+path,{method}),env);
    assert.ok([404,405].includes(response.status));
  }
  await worker.scheduled({},env,{waitUntil(){throw new Error('Cron must not run');}});
  assert.deepEqual(touched,[]);
  const health=await worker.fetch(new Request('https://preview.example/'),env);
  assert.match(await health.text(),/демонстрація/);
  assert.match(scheduleCardSvg({...payload,demo:true}),/ДЕМОНСТРАЦІЯ/);
  assert.doesNotMatch(scheduleCardSvg(payload),/ДЕМОНСТРАЦІЯ/);
});

test('runtime target selection accepts only one Pokrovska 30B publication',async()=>{
  const {selectCardTarget}=await import('../src/schedule-card-publisher.js');
  const rows=[{group_chat_id:'-1',group_title:'💧 Вода Чабани'},
    {group_chat_id:'-2',group_title:'Світло Покровська 30Б'},
    {group_chat_id:'-3',group_title:'Світло Покровська 30В'}];
  assert.equal(selectCardTarget(rows),'-2');
  assert.equal(selectCardTarget([{group_chat_id:'-2',group_title:'СВІТЛО ПОКРОВСЬКА 30-Б'}]),'-2');
  assert.throws(()=>selectCardTarget(rows.filter(r=>r.group_chat_id!=='-2')),/exactly one/);
  assert.throws(()=>selectCardTarget([...rows,{group_chat_id:'-4',group_title:'Покровська 30б'}]),/exactly one/);
  assert.equal(selectCardTarget(rows,'-2'),'-2');
  assert.throws(()=>selectCardTarget(rows,'-999'),/not uniquely linked/);
});
