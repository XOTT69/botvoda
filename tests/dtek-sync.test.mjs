import assert from 'node:assert/strict';
import {
  decodeDtekSnapshot,syncDtekSchedules,DTEK_STATE_URL
} from '../src/dtek-sync.js';

const GROUPS=Array.from({length:6},(_,i)=>[(i+1)+'.1',(i+1)+'.2']).flat();
const DATE='2026-10-16', TOMORROW='2026-10-17';
const now=new Date('2026-10-16T12:00:00Z');
function groups(one=[[360,540]],two=[[600,720]]) {
  return Object.fromEntries(GROUPS.map(g=>[
    g,g==='1.2'?one:g==='2.2'?two:[]
  ]));
}
function snapshot(today=groups(),tomorrow=groups([[0,60]],[[1080,1320]])) {
  return {scheduleSnapshots:{[DATE]:today,[TOMORROW]:tomorrow}};
}
const server=data=>async(url,options)=>{
  assert.match(url,/raw\.githubusercontent\.com\/XOTT69\/dtek\/main\/state\/publications\.json/);
  assert.match(url,/_ts=/);
  assert.equal(options.cache,'no-store');
  return {ok:true,text:async()=>JSON.stringify(data)};
};
class FakeD1 {
  constructor() {
    this.settings=new Map();
    this.schedules=new Map();
    this.possible=new Map();
    this.history=[];
    this.changes=[];
    this.batches=0;
  }
  prepare(sql) {
    const db=this;
    return {
      bind(...args) {
        const v=args;
        return {
          async first(){
            if(sql.includes('SELECT value FROM app_settings'))
              return db.settings.has(v[0])?{value:db.settings.get(v[0])}:null;
            if(sql.includes('FROM water_rule_versions'))return {
              effective_date:'2026-10-15',
              intervals_json:JSON.stringify([[360,540],[720,840],[1080,1320]]),
              source_text:'test',updated_at:'2026-10-15 00:00:00'
            };
            if(sql.includes('FROM water_rules'))return null;
            throw new Error('Unexpected first SQL '+sql);
          },
          async all(){
            if(sql.includes('FROM schedules')){
              return {results:['1.2','2.2'].filter(g=>
                db.schedules.has(v[1]+':'+g)
              ).map(g=>({
                group_name:g,
                intervals_json:db.schedules.get(v[1]+':'+g),
                created_at:'2026-10-16 12:00:00'
              }))};
            }
            if(sql.includes('FROM schedule_possible'))return {results:[]};
            throw new Error('Unexpected all SQL '+sql);
          },
          async run(){
            if(sql.includes('INSERT INTO schedule_history')) {
              db.history.push({date:v[0],snapshot:JSON.parse(v[1]),action:v[2]});
              return {meta:{changes:1}};
            }
            if(sql.includes('INSERT INTO change_log')){
              db.changes.push({date:v[0],summary:v[1]});
              return {meta:{changes:1}};
            }
            if(sql.includes('INSERT INTO app_settings')){
              db.settings.set(v[0],v[1]);
              return {meta:{changes:1}};
            }
            throw new Error('Unexpected run SQL '+sql);
          },
          __sql:sql,__args:v
        };
      }
    };
  }
  async batch(statements) {
    assert.equal(statements.length,5);
    this.batches++;
    for(const {__sql:sql,__args:v} of statements) {
      if(sql.includes('INSERT INTO schedules'))
        this.schedules.set(v[1]+':'+v[2],v[4]);
      else if(sql.includes('INSERT INTO schedule_possible'))
        this.possible.set(v[0]+':'+v[1],v[2]);
      else if(sql.includes('INSERT INTO app_settings'))
        this.settings.set(v[0],v[1]);
      else throw new Error('Unexpected batch SQL '+sql);
    }
  }
}
const makeEnv=()=>({DB:new FakeD1()});
const silent={log(){},warn(){}};
const run=(env,data)=>syncDtekSchedules(env,{now,fetcher:server(data),logger:silent});

assert.equal(DTEK_STATE_URL,
  'https://raw.githubusercontent.com/XOTT69/dtek/main/state/publications.json');
assert.deepEqual(decodeDtekSnapshot(snapshot(),DATE),{
  '1.2':[[360,540]],'2.2':[[600,720]]
});
assert.equal(decodeDtekSnapshot({scheduleSnapshots:{[DATE]:{'1.2':[[0,60]],'2.2':[]}}},DATE),null);
assert.equal(decodeDtekSnapshot(snapshot(groups([[720,600]])),DATE),null);
assert.equal(decodeDtekSnapshot(snapshot(groups([[15,60]])),DATE),null);
assert.equal(decodeDtekSnapshot(snapshot(groups([[-30,60]])),DATE),null);
assert.equal(decodeDtekSnapshot(snapshot(groups([[0,60],[30,90]])),DATE),null);

{
  const env=makeEnv();
  const first=await run(env,snapshot());
  assert.deepEqual(first.updated,[DATE,TOMORROW]);
  assert.deepEqual(first.missing,[]);
  assert.equal(env.DB.batches,2);
  assert.equal(env.DB.history.length,2);
  assert.equal(env.DB.settings.get('dtek_auto_last_success'),now.toISOString());
  assert.deepEqual(JSON.parse(env.DB.settings.get('dtek_auto_last_result')),{
    updated:[DATE,TOMORROW],unchanged:[],missing:[]
  });
  assert.equal(env.DB.changes.length,2);
  assert.equal(env.DB.schedules.get(DATE+':1.2'),'[[360,540]]');
  assert.equal(env.DB.schedules.get(DATE+':2.2'),'[[600,720]]');
  assert.equal(env.DB.schedules.get(TOMORROW+':1.2'),'[[0,60]]');
  assert.equal(env.DB.possible.get(DATE+':1.2'),'[]');

  const second=await run(env,snapshot());
  assert.deepEqual(second.updated,[]);
  assert.deepEqual(second.unchanged,[DATE,TOMORROW]);
  assert.equal(env.DB.batches,2,'repeat cron must not rewrite schedules');
  assert.deepEqual(JSON.parse(env.DB.settings.get('dtek_auto_last_result')),{
    updated:[],unchanged:[DATE,TOMORROW],missing:[]
  });
  assert.equal(env.DB.history.length,2,'repeat cron must not duplicate history');

  const revised=await run(env,snapshot(groups([[360,600]],[[660,780]])));
  assert.deepEqual(revised.updated,[DATE]);
  assert.equal(env.DB.batches,3);
  assert.equal(env.DB.schedules.get(DATE+':1.2'),'[[360,600]]');
  assert.equal(env.DB.history.length,3);
}
{
  const env=makeEnv();
  const result=await run(env,snapshot(groups(),null));
  assert.deepEqual(result.updated,[DATE]);
  assert.deepEqual(result.missing,[TOMORROW]);
  assert.equal(env.DB.batches,1);
  // Confirmed tomorrow only becomes public when its complete snapshot appears.
  const then=await run(env,snapshot());
  assert.deepEqual(then.updated,[TOMORROW]);
}
{
  const env=makeEnv();
  env.DTEK_AUTO_SYNC='off';
  let fetched=0;
  const result=await syncDtekSchedules(env,{now,fetcher:async()=>{fetched++}});
  assert.equal(result.status,'disabled');
  assert.equal(fetched,0);
}
{
  const env=makeEnv();
  await assert.rejects(syncDtekSchedules(env,{now,
    fetcher:async()=>({ok:false,status:503}),logger:silent
  }),/HTTP 503/);
  assert.equal(env.DB.batches,0);
}
{
  const env=makeEnv();
  const invalid=snapshot();
  delete invalid.scheduleSnapshots[DATE]['6.2'];
  const r=await run(env,invalid);
  assert.deepEqual(r.updated,[TOMORROW]);
  assert.deepEqual(r.missing,[DATE]);
}
{
  // Manual forwarded data must not permanently override a confirmed DTEK
  // snapshot just because its hash was already cached in app_settings.
  const env=makeEnv();
  await run(env,snapshot());
  env.DB.schedules.set(DATE+':1.2','[[60,120]]');
  const repaired=await run(env,snapshot());
  assert.deepEqual(repaired.updated,[DATE]);
  assert.deepEqual(repaired.unchanged,[TOMORROW]);
  assert.equal(env.DB.schedules.get(DATE+':1.2'),'[[360,540]]');
  assert.equal(env.DB.batches,3);
}
console.log('DTEK sync tests passed');
