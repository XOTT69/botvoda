import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {waterPublicText,publicText} from '../src/render.js';
import {availability,complement,addDays,localNow} from '../src/lib.js';
import {ensureSchema} from '../src/db.js';
import {refreshOnePublication} from '../src/publications.js';

const day=(water,p22)=>({...availability(water,p22,[]),water,p22});
const a=day([[0,840],[960,1350]],[[0,720],[1170,1440]]);
const b=day([[0,540],[720,1320]],[[0,720],[990,1170],[1260,1440]]);
const render=(today=a,tomorrow=b,water=null,power=null)=>waterPublicText('2026-11-01','2026-11-02',today,tomorrow,1200,null,null,water,power);

test('water companion shows daily windows and totals while keeping fact and schedule distinct',()=>{
  const text=render(a,b,null,{state:'on',source:'channel',eventDate:'2026-11-01',eventMinute:1190});
  assert.match(text,/Вода <b>є<\/b> — за графіком/);
  assert.match(text,/Світло <b>є<\/b> — підтверджено о 19:50/);
  assert.match(text,/Сьогодні, 1 листопада/);
  assert.match(text,/00:00–14:00\n16:00–22:30\nРазом: <b>20 год 30 хв/);
  assert.match(text,/Завтра, 2 листопада/);
  assert.match(text,/00:00–09:00\n12:00–22:00\nРазом: <b>19 год/);
  assert.doesNotMatch(text,/За словами мешканців|Найкраще|⚡💧|1\.2|00:00–12:00/);
  const old=publicText('2026-11-01','2026-11-02',a,b,1200,null,null);
  assert.match(old,/Світло 2\.2/);
  assert.match(old,/Найкраще/);
});

test('missing and empty schedules are distinct and actual observations survive missing schedule data',()=>{
  const noData=render(null,null);
  assert.match(noData,/Вода — <b>немає даних/);
  assert.match(noData,/Світло — <b>немає даних/);
  assert.match(noData,/Графік ще не опублікований/);
  assert.doesNotMatch(noData,/Завтра|Разом:/);
  const noWater=render(day([],[[0,1440]]),null);
  assert.match(noWater,/За графіком води немає/);
  assert.match(noWater,/Разом: <b>0 хв/);
  const actual=render(null,null,{state:'off',updatedLabel:'20:10'},
    {state:'on',source:'channel',eventDate:'2026-10-31',eventMinute:1190});
  assert.match(actual,/Вода <b>немає<\/b> — вручну о 20:10/);
  assert.match(actual,/Світло <b>є<\/b> — підтверджено 31\.10\.2026 о 19:50/);
  const manual=render(a,null,null,{state:'off',source:'manual',updatedLabel:'20:15'});
  assert.match(manual,/Світло <b>немає<\/b> — вручну о 20:15/);
});

test('day rollover uses new dates and only shows tomorrow when its data exists',()=>{
  const next=waterPublicText('2026-11-02','2026-11-03',b,null,0,null,null);
  assert.match(next,/Сьогодні, 2 листопада/);
  assert.doesNotMatch(next,/1 листопада|Завтра|3 листопада/);
  const uncertain=render({...a,possible12:[[1200,1230]]},null);
  assert.match(uncertain,/Можливі зміни подачі води/);
});

test('automatic refresh edits the stored text message, skips unchanged content and picks up schedule and power changes',async t=>{
  const sqlite=new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  for(const file of ['0001_init.sql','0002_notifications.sql','0003_publications.sql'])
    sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const env={TELEGRAM_BOT_TOKEN:'test-only',SCHEDULE_CARD_ENABLED:'off',DB:{prepare(sql){
    let args=[];
    return {bind(...values){args=values;return this;},
      async all(){return {results:sqlite.prepare(sql).all(...args)};},
      async first(){return sqlite.prepare(sql).get(...args)||null;},
      async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};
  }}};
  await ensureSchema(env);
  const today=localNow().date,tomorrow=addDays(today,1);
  const insert=sqlite.prepare("INSERT INTO schedules(chat_id,schedule_date,group_name,mode,intervals_json) VALUES('__GLOBAL__',?,?,'off',?)");
  for(const [date,off12,off22] of [[today,[[840,960],[1350,1440]],[[720,1170]]],
    [tomorrow,[[540,720],[1320,1440]],[[720,990],[1170,1260]]]]){
    insert.run(date,'1.2',JSON.stringify(off12));insert.run(date,'2.2',JSON.stringify(off22));
  }
  sqlite.prepare("INSERT INTO publications(group_chat_id,message_id,bot_username,last_text,photo_message_id) VALUES('-1001',111,'test_bot','previous long layout',1237)").run();
  sqlite.prepare("INSERT INTO publications(group_chat_id,message_id,bot_username,last_text) VALUES('-1002',222,'test_bot','previous long layout')").run();
  sqlite.prepare("INSERT INTO power_events(state,event_date,event_minute,source) VALUES('on',?,1190,'channel')").run(today);
  const requests=[];
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.telegram.org/bottest-only/editMessageText');
    requests.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:111}});
  };
  t.after(()=>{globalThis.fetch=realFetch;});
  assert.equal((await refreshOnePublication(env,'-1001')).ok,true);
  assert.match(requests[0].text,/Коли є вода за графіком/);
  assert.equal(requests[0].message_id,111);
  assert.equal(requests[0].reply_markup.inline_keyboard.length,2);
  assert.equal((await refreshOnePublication(env,'-1001')).unchanged,true);
  assert.equal(requests.length,1);
  sqlite.prepare("UPDATE schedules SET intervals_json='[]' WHERE schedule_date=? AND group_name='1.2'").run(today);
  await refreshOnePublication(env,'-1001');
  assert.match(requests.at(-1).text,/00:00–24:00\nРазом: <b>24 год/);
  sqlite.prepare("UPDATE power_events SET state='off' WHERE event_date=?").run(today);
  await refreshOnePublication(env,'-1001');
  assert.match(requests.at(-1).text,/Світло <b>немає<\/b> — підтверджено/);
  assert.ok(requests.every(r=>r.message_id===111));
  assert.equal(sqlite.prepare("SELECT photo_message_id FROM publications WHERE group_chat_id='-1001'").get().photo_message_id,1237);
  await refreshOnePublication(env,'-1002');
  assert.equal(requests.at(-1).message_id,222);
  assert.match(requests.at(-1).text,/Світло 2\.2/);
  assert.doesNotMatch(requests.at(-1).text,/на закріпленій картинці/);
});
