import {DEFAULT_WATER,complement,availability,localNow} from './lib.js';

export const GLOBAL_SCOPE='__GLOBAL__';

export async function ensureSchema(env){
  const q=[
    `CREATE TABLE IF NOT EXISTS schedule_possible (schedule_date TEXT NOT NULL, group_name TEXT NOT NULL, intervals_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(schedule_date,group_name))`,
    `CREATE TABLE IF NOT EXISTS pending_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_chat_id TEXT NOT NULL, update_type TEXT NOT NULL DEFAULT 'power', schedule_date TEXT, payload_json TEXT NOT NULL, warnings_json TEXT NOT NULL DEFAULT '[]', preview_text TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS schedule_history (id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_date TEXT, snapshot_json TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'update', summary_text TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_date TEXT, summary_text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS power_events (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_chat_id TEXT, message_id INTEGER, state TEXT NOT NULL CHECK(state IN ('on','off')), event_date TEXT NOT NULL, event_minute INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'channel', source_text TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(channel_chat_id,message_id))`,
    `CREATE TABLE IF NOT EXISTS user_profiles (
      chat_id TEXT PRIMARY KEY,
      telegram_id TEXT,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      source TEXT NOT NULL DEFAULT 'unknown',
      first_seen_date TEXT,
      last_seen_date TEXT,
      last_seen_minute INTEGER,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      interactions INTEGER NOT NULL DEFAULT 0,
      notifications_touched INTEGER NOT NULL DEFAULT 0
    )`,
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
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_profiles_last_seen ON user_profiles(last_seen_date,last_seen_at)').run();
  await env.DB.prepare(`INSERT OR IGNORE INTO user_profiles(chat_id,telegram_id,source,first_seen_date,last_seen_date,first_seen_at,last_seen_at)
    SELECT chat_id,chat_id,'legacy',substr(created_at,1,10),substr(COALESCE(updated_at,created_at),1,10),created_at,COALESCE(updated_at,created_at)
    FROM chats WHERE CAST(chat_id AS TEXT) NOT LIKE '-%'`).run();

}

export async function ensureUser(env,chatId){
  await ensureSchema(env);
  await env.DB.prepare('INSERT OR IGNORE INTO chats(chat_id) VALUES(?)').bind(String(chatId)).run();
  await env.DB.prepare('INSERT OR IGNORE INTO notification_settings(chat_id) VALUES(?)').bind(String(chatId)).run();
}

export async function trackUserProfile(env,user,startSource=null){
  if(!user?.id)return;
  const n=localNow();
  const chatId=String(user.id);
  const source=startSource||'unknown';
  await env.DB.prepare(`INSERT INTO user_profiles(
      chat_id,telegram_id,first_name,last_name,username,source,first_seen_date,last_seen_date,last_seen_minute,interactions
    ) VALUES(?,?,?,?,?,?,?,?,?,1)
    ON CONFLICT(chat_id) DO UPDATE SET
      telegram_id=excluded.telegram_id,
      first_name=COALESCE(excluded.first_name,user_profiles.first_name),
      last_name=COALESCE(excluded.last_name,user_profiles.last_name),
      username=COALESCE(excluded.username,user_profiles.username),
      source=CASE
        WHEN excluded.source NOT IN ('unknown','legacy') AND user_profiles.source IN ('unknown','legacy') THEN excluded.source
        ELSE user_profiles.source
      END,
      last_seen_date=excluded.last_seen_date,
      last_seen_minute=excluded.last_seen_minute,
      last_seen_at=CURRENT_TIMESTAMP,
      interactions=user_profiles.interactions+1`)
    .bind(chatId,chatId,user.first_name||null,user.last_name||null,user.username||null,source,n.date,n.date,n.minute).run();
}

export async function markNotificationsTouched(env,chatId){
  await env.DB.prepare('UPDATE user_profiles SET notifications_touched=1,last_seen_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(String(chatId)).run();
}

export async function analyticsOverview(env,adminId,today,start7,start30){
  const admin=String(adminId||'');
  const profile=await env.DB.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN first_seen_date=? THEN 1 ELSE 0 END) new_today,
      SUM(CASE WHEN first_seen_date>=? THEN 1 ELSE 0 END) new_7,
      SUM(CASE WHEN first_seen_date>=? THEN 1 ELSE 0 END) new_30,
      SUM(CASE WHEN last_seen_date=? THEN 1 ELSE 0 END) active_today,
      SUM(CASE WHEN last_seen_date>=? THEN 1 ELSE 0 END) active_7,
      SUM(CASE WHEN last_seen_date>=? THEN 1 ELSE 0 END) active_30,
      SUM(CASE WHEN source='chabany' THEN 1 ELSE 0 END) from_channel,
      SUM(CASE WHEN source='direct' THEN 1 ELSE 0 END) direct,
      SUM(CASE WHEN source IN ('legacy','unknown') OR source IS NULL THEN 1 ELSE 0 END) unknown_source,
      SUM(CASE WHEN notifications_touched=1 THEN 1 ELSE 0 END) touched_notifications
    FROM user_profiles WHERE chat_id<>?`)
    .bind(today,start7,start30,today,start7,start30,admin).first();

  const reminders=await env.DB.prepare(`SELECT
      COUNT(*) users_with_settings,
      SUM(CASE WHEN COALESCE(s.both_alerts,0)=1 OR COALESCE(s.water_alerts,0)=1 OR COALESCE(s.morning_summary,0)=1 OR COALESCE(s.evening_summary,0)=1 THEN 1 ELSE 0 END) active_any,
      SUM(CASE WHEN COALESCE(s.both_alerts,0)=1 THEN 1 ELSE 0 END) both_on,
      SUM(CASE WHEN COALESCE(s.water_alerts,0)=1 THEN 1 ELSE 0 END) water_on,
      SUM(CASE WHEN COALESCE(s.end_alerts,0)=1 THEN 1 ELSE 0 END) end_on,
      SUM(CASE WHEN COALESCE(s.morning_summary,0)=1 THEN 1 ELSE 0 END) morning_on,
      SUM(CASE WHEN COALESCE(s.evening_summary,0)=1 THEN 1 ELSE 0 END) evening_on,
      SUM(CASE WHEN s.lead_minutes=15 THEN 1 ELSE 0 END) lead15,
      SUM(CASE WHEN s.lead_minutes=30 THEN 1 ELSE 0 END) lead30,
      SUM(CASE WHEN s.lead_minutes=60 THEN 1 ELSE 0 END) lead60
    FROM user_profiles p LEFT JOIN notification_settings s ON s.chat_id=p.chat_id
    WHERE p.chat_id<>?`).bind(admin).first();

  const sent=await env.DB.prepare(`SELECT
      COUNT(*) total_sent,
      SUM(CASE WHEN substr(created_at,1,10)=? THEN 1 ELSE 0 END) sent_today,
      SUM(CASE WHEN substr(created_at,1,10)>=? THEN 1 ELSE 0 END) sent_7
    FROM notification_log WHERE chat_id<>?`).bind(today,start7,admin).first();

  return {profile:profile||{},reminders:reminders||{},sent:sent||{}};
}

export async function analyticsUsers(env,adminId,limit=10,offset=0){
  const admin=String(adminId||'');
  const rows=await env.DB.prepare(`SELECT p.*,s.both_alerts,s.water_alerts,s.end_alerts,s.lead_minutes,s.min_window_minutes,s.morning_summary,s.evening_summary
    FROM user_profiles p LEFT JOIN notification_settings s ON s.chat_id=p.chat_id
    WHERE p.chat_id<>?
    ORDER BY p.last_seen_at DESC
    LIMIT ? OFFSET ?`).bind(admin,Number(limit),Number(offset)).all();
  const count=await env.DB.prepare('SELECT COUNT(*) c FROM user_profiles WHERE chat_id<>?').bind(admin).first();
  return {users:rows.results||[],total:Number(count?.c||0)};
}

export async function analyticsActivity(env,adminId,startDate){
  const admin=String(adminId||'');
  const news=await env.DB.prepare(`SELECT first_seen_date day,COUNT(*) c FROM user_profiles
    WHERE chat_id<>? AND first_seen_date>=? GROUP BY first_seen_date ORDER BY first_seen_date`).bind(admin,startDate).all();
  const active=await env.DB.prepare(`SELECT last_seen_date day,COUNT(*) c FROM user_profiles
    WHERE chat_id<>? AND last_seen_date>=? GROUP BY last_seen_date ORDER BY last_seen_date`).bind(admin,startDate).all();
  return {newByDay:news.results||[],activeByDay:active.results||[]};
}

export async function getSetting(env,key,def=null){const r=await env.DB.prepare('SELECT value FROM app_settings WHERE key=?').bind(key).first();return r?.value??def;}
export async function setSetting(env,key,value){await env.DB.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP').bind(key,String(value)).run();}

export async function getManualWaterStatus(env){
  const r=await env.DB.prepare("SELECT value,updated_at FROM app_settings WHERE key='manual_water_state'").first();
  if(!r)return {state:'auto',updatedAt:null};
  let state=String(r.value||'auto');
  if(!['auto','on','off'].includes(state))state='auto';
  if(state!=='auto'&&r.updated_at){
    const changed=new Date(String(r.updated_at).replace(' ','T')+'Z');
    if(!Number.isNaN(changed.getTime())&&localNow(changed).date!==localNow().date)state='auto';
  }
  return {state,updatedAt:state==='auto'?null:(r.updated_at||null)};
}
export async function setManualWaterStatus(env,state){
  if(!['auto','on','off'].includes(state))throw new Error('Invalid manual water state');
  await setSetting(env,'manual_water_state',state);
  return getManualWaterStatus(env);
}

export async function getManualPowerStatus(env){
  const r=await env.DB.prepare("SELECT value,updated_at FROM app_settings WHERE key='manual_power_state'").first();
  if(!r)return {state:'auto',updatedAt:null};
  let state=String(r.value||'auto');
  if(!['auto','on','off'].includes(state))state='auto';
  return {state,updatedAt:state==='auto'?null:(r.updated_at||null)};
}

export async function setManualPowerStatus(env,state){
  if(!['auto','on','off'].includes(state))throw new Error('Invalid manual power state');
  await setSetting(env,'manual_power_state',state);
  if(state!=='auto'){
    const n=localNow();
    await env.DB.prepare("INSERT INTO power_events(channel_chat_id,message_id,state,event_date,event_minute,source,source_text) VALUES(NULL,NULL,?,?,?,?,?)")
      .bind(state,n.date,n.minute,'manual','manual override').run();
  }
  return getEffectivePowerStatus(env);
}

export async function recordChannelPowerEvent(env,{chatId,messageId,state,eventDate,eventMinute,sourceText=''}) {
  if(!['on','off'].includes(state))return false;
  await env.DB.prepare(`INSERT INTO power_events(channel_chat_id,message_id,state,event_date,event_minute,source,source_text)
    VALUES(?,?,?,?,?,'channel',?)
    ON CONFLICT(channel_chat_id,message_id) DO UPDATE SET
      state=excluded.state,event_date=excluded.event_date,event_minute=excluded.event_minute,source_text=excluded.source_text`)
    .bind(String(chatId),Number(messageId),state,eventDate,Number(eventMinute),sourceText).run();
  await setSetting(env,'manual_power_state','auto');
  return true;
}

export async function getLatestChannelPowerEvent(env){
  return env.DB.prepare("SELECT * FROM power_events WHERE source='channel' ORDER BY event_date DESC,event_minute DESC,id DESC LIMIT 1").first();
}

export async function getEffectivePowerStatus(env){
  const manual=await getManualPowerStatus(env);
  if(manual.state==='on'||manual.state==='off')return {state:manual.state,source:'manual',updatedAt:manual.updatedAt};
  const e=await getLatestChannelPowerEvent(env);
  if(e)return {state:e.state,source:'channel',eventDate:e.event_date,eventMinute:Number(e.event_minute),channelChatId:e.channel_chat_id,messageId:e.message_id,updatedAt:e.created_at};
  return {state:null,source:'schedule',updatedAt:null};
}

export async function getPowerEvents(env,date,limit=30){
  const r=await env.DB.prepare("SELECT id,state,event_date,event_minute,source,source_text,created_at FROM power_events WHERE event_date=? ORDER BY event_minute DESC,id DESC LIMIT ?").bind(date,limit).all();
  return r.results||[];
}

export async function powerDayStats(env,date,untilMinute=1440){
  const events=await getPowerEvents(env,date,200);
  if(!events.length)return {known:false,onMinutes:0,offMinutes:0,events:[]};
  const ordered=[...events].sort((a,b)=>a.event_minute-b.event_minute||a.id-b.id);
  let state=ordered[0].state==='on'?'off':'on';
  let cursor=0,onMinutes=0,offMinutes=0;
  for(const e of ordered){
    const m=Math.max(cursor,Math.min(Number(e.event_minute),untilMinute));
    if(state==='on')onMinutes+=m-cursor;else offMinutes+=m-cursor;
    cursor=m;state=e.state;
    if(cursor>=untilMinute)break;
  }
  if(cursor<untilMinute){if(state==='on')onMinutes+=untilMinute-cursor;else offMinutes+=untilMinute-cursor;}
  return {known:true,onMinutes,offMinutes,events:ordered,currentState:state};
}

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
  const waterRow=await env.DB.prepare('SELECT fallback_intervals_json,updated_at FROM water_rules WHERE chat_id=?').bind(GLOBAL_SCOPE).first();
  const fallback=waterRow?JSON.parse(waterRow.fallback_intervals_json):DEFAULT_WATER;
  const p12=complement(rows['1.2'].intervals),p22=complement(rows['2.2'].intervals);
  const a=availability(p12,p22,fallback);
  return {...a,p12,p22,off12:rows['1.2'].intervals,off22:rows['2.2'].intervals,possible12:possible['1.2']||[],possible22:possible['2.2']||[],updatedAt:[rows['1.2'].created_at,rows['2.2'].created_at,waterRow?.updated_at].filter(Boolean).sort().at(-1)||null};
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
  const waterOnly=row.action==='water_update'||row.action==='before_water_rollback';

  if(waterOnly){
    await saveHistory(env,date,'before_water_rollback','Стан води перед відкатом');
    if(snap.water)await setWaterIntervals(env,snap.water,'rollback');
  }else{
    await saveHistory(env,date,'before_schedule_rollback','Стан графіка перед відкатом');
    for(const g of ['1.2','2.2']){
      if(snap.groups[g])await saveScheduleGroup(env,date,g,snap.groups[g],snap.possible?.[g]||[],'rollback');
      else {await env.DB.prepare('DELETE FROM schedules WHERE chat_id=? AND schedule_date=? AND group_name=?').bind(GLOBAL_SCOPE,date,g).run();await env.DB.prepare('DELETE FROM schedule_possible WHERE schedule_date=? AND group_name=?').bind(date,g).run();}
    }
  }

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
