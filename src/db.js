import {DEFAULT_WATER,complement,availability} from './lib.js';

export const GLOBAL_SCOPE='__GLOBAL__';

export async function ensureSchema(env){
  const q=[
    `CREATE TABLE IF NOT EXISTS schedule_possible (schedule_date TEXT NOT NULL, group_name TEXT NOT NULL, intervals_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(schedule_date,group_name))`,
    `CREATE TABLE IF NOT EXISTS pending_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_chat_id TEXT NOT NULL, update_type TEXT NOT NULL DEFAULT 'power', schedule_date TEXT, payload_json TEXT NOT NULL, warnings_json TEXT NOT NULL DEFAULT '[]', preview_text TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS schedule_history (id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_date TEXT, snapshot_json TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'update', summary_text TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_date TEXT, summary_text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS publications (group_chat_id TEXT PRIMARY KEY,message_id INTEGER NOT NULL,bot_username TEXT NOT NULL,group_title TEXT,last_text TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
  ];
  for(const sql of q)await env.DB.prepare(sql).run();
  const cols=await env.DB.prepare(`PRAGMA table_info(notification_settings)`).all();
  const have=new Set((cols.results||[]).map(x=>x.name));
  const add={
    min_window_minutes:`ALTER TABLE notification_settings ADD COLUMN min_window_minutes INTEGER NOT NULL DEFAULT 0`,
    morning_summary:`ALTER TABLE notification_settings ADD COLUMN morning_summary INTEGER NOT NULL DEFAULT 0`,
    evening_summary:`ALTER TABLE notification_settings ADD COLUMN evening_summary INTEGER NOT NULL DEFAULT 0`
  };
  for(const [name,sql] of Object.entries(add))if(!have.has(name)){try{await env.DB.prepare(sql).run();}catch(e){if(!String(e).toLowerCase().includes('duplicate column'))throw e;}}
  await env.DB.prepare('INSERT OR IGNORE INTO water_rules(chat_id,fallback_intervals_json) VALUES(?,?)').bind(GLOBAL_SCOPE,JSON.stringify(DEFAULT_WATER)).run();
}

export async function ensureUser(env,chatId){
  await ensureSchema(env);
  await env.DB.prepare('INSERT OR IGNORE INTO chats(chat_id) VALUES(?)').bind(String(chatId)).run();
  await env.DB.prepare('INSERT OR IGNORE INTO notification_settings(chat_id) VALUES(?)').bind(String(chatId)).run();
}

export async function getSetting(env,key,def=null){const r=await env.DB.prepare('SELECT value FROM app_settings WHERE key=?').bind(key).first();return r?.value??def;}
export async function setSetting(env,key,value){await env.DB.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP').bind(key,String(value)).run();}

export async function getWaterIntervals(env){const w=await env.DB.prepare('SELECT fallback_intervals_json FROM water_rules WHERE chat_id=?').bind(GLOBAL_SCOPE).first();return w?JSON.parse(w.fallback_intervals_json):DEFAULT_WATER;}
export async function setWaterIntervals(env,intervals,sourceText=''){await env.DB.prepare('INSERT INTO water_rules(chat_id,fallback_intervals_json,source_text) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET fallback_intervals_json=excluded.fallback_intervals_json,source_text=excluded.source_text,updated_at=CURRENT_TIMESTAMP').bind(GLOBAL_SCOPE,JSON.stringify(intervals),sourceText).run();}

export async function getRawDay(env,date){
  const r=await env.DB.prepare(`SELECT group_name,intervals_json,created_at FROM schedules WHERE chat_id=? AND schedule_date=? AND group_name IN ('1.2','2.2')`).bind(GLOBAL_SCOPE,date).all();
  const rows=Object.fromEntries((r.results||[]).map(x=>[x.group_name,{intervals:JSON.parse(x.intervals_json),created_at:x.created_at}]));
  const p=await env.DB.prepare(`SELECT group_name,intervals_json,updated_at FROM schedule_possible WHERE schedule_date=? AND group_name IN ('1.2','2.2')`).bind(date).all();
  const possible=Object.fromEntries((p.results||[]).map(x=>[x.group_name,JSON.parse(x.intervals_json)]));
  return {rows,possible};
}

export async function loadDay(env,date){
  await ensureSchema(env);
  const {rows,possible}=await getRawDay(env,date);
  if(!rows['1.2']||!rows['2.2'])return null;
  const fallback=await getWaterIntervals(env);
  const p12=complement(rows['1.2'].intervals),p22=complement(rows['2.2'].intervals);
  const a=availability(p12,p22,fallback);
  return {...a,p12,p22,off12:rows['1.2'].intervals,off22:rows['2.2'].intervals,possible12:possible['1.2']||[],possible22:possible['2.2']||[],updatedAt:[rows['1.2'].created_at,rows['2.2'].created_at].filter(Boolean).sort().at(-1)||null};
}

export async function snapshotDate(env,date){
  const raw=await getRawDay(env,date);const water=await getWaterIntervals(env);
  return {date,groups:{'1.2':raw.rows['1.2']?.intervals??null,'2.2':raw.rows['2.2']?.intervals??null},possible:{'1.2':raw.possible['1.2']||[],'2.2':raw.possible['2.2']||[]},water};
}

export async function saveHistory(env,date,action,summary=''){
  const snap=await snapshotDate(env,date);
  const r=await env.DB.prepare('INSERT INTO schedule_history(schedule_date,snapshot_json,action,summary_text) VALUES(?,?,?,?)').bind(date,JSON.stringify(snap),action,summary).run();
  return r.meta?.last_row_id;
}

export async function restoreHistory(env,id){
  const row=await env.DB.prepare('SELECT * FROM schedule_history WHERE id=?').bind(id).first();if(!row)return null;
  const snap=JSON.parse(row.snapshot_json);const date=snap.date;
  await saveHistory(env,date,'before_rollback','Стан перед відкатом');
  for(const g of ['1.2','2.2']){
    if(snap.groups[g])await saveScheduleGroup(env,date,g,snap.groups[g],snap.possible?.[g]||[],'rollback');
    else {await env.DB.prepare('DELETE FROM schedules WHERE chat_id=? AND schedule_date=? AND group_name=?').bind(GLOBAL_SCOPE,date,g).run();await env.DB.prepare('DELETE FROM schedule_possible WHERE schedule_date=? AND group_name=?').bind(date,g).run();}
  }
  if(snap.water)await setWaterIntervals(env,snap.water,'rollback');
  await env.DB.prepare('INSERT INTO change_log(schedule_date,summary_text) VALUES(?,?)').bind(date,`↩️ Виконано відкат до версії #${id}`).run();
  return snap;
}

export async function saveScheduleGroup(env,date,group,intervals,possible=[],sourceText=''){
  await env.DB.prepare(`INSERT INTO schedules(chat_id,schedule_date,group_name,mode,intervals_json,source_text) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,schedule_date,group_name) DO UPDATE SET mode=excluded.mode,intervals_json=excluded.intervals_json,source_text=excluded.source_text,created_at=CURRENT_TIMESTAMP`).bind(GLOBAL_SCOPE,date,group,'off',JSON.stringify(intervals),sourceText).run();
  await env.DB.prepare(`INSERT INTO schedule_possible(schedule_date,group_name,intervals_json) VALUES(?,?,?) ON CONFLICT(schedule_date,group_name) DO UPDATE SET intervals_json=excluded.intervals_json,updated_at=CURRENT_TIMESTAMP`).bind(date,group,JSON.stringify(possible||[])).run();
}

export async function createPending(env,chatId,payload,warnings=[],preview=''){
  await env.DB.prepare('DELETE FROM pending_updates WHERE admin_chat_id=?').bind(String(chatId)).run();
  const r=await env.DB.prepare('INSERT INTO pending_updates(admin_chat_id,update_type,schedule_date,payload_json,warnings_json,preview_text) VALUES(?,?,?,?,?,?)').bind(String(chatId),payload.type||'power',payload.date||null,JSON.stringify(payload),JSON.stringify(warnings),preview).run();
  return Number(r.meta?.last_row_id);
}
export async function getPending(env,id,chatId){return env.DB.prepare('SELECT * FROM pending_updates WHERE id=? AND admin_chat_id=?').bind(Number(id),String(chatId)).first();}
export async function deletePending(env,id){await env.DB.prepare('DELETE FROM pending_updates WHERE id=?').bind(Number(id)).run();}

export async function logChange(env,date,summary){await env.DB.prepare('INSERT INTO change_log(schedule_date,summary_text) VALUES(?,?)').bind(date||null,summary).run();}
export async function recentChanges(env,limit=5){const r=await env.DB.prepare('SELECT id,schedule_date,summary_text,created_at FROM change_log ORDER BY id DESC LIMIT ?').bind(limit).all();return r.results||[];}
export async function recentHistory(env,limit=5){const r=await env.DB.prepare('SELECT id,schedule_date,action,summary_text,created_at FROM schedule_history ORDER BY id DESC LIMIT ?').bind(limit).all();return r.results||[];}

export async function notificationSettings(env,chatId){return env.DB.prepare('SELECT * FROM notification_settings WHERE chat_id=?').bind(String(chatId)).first();}
