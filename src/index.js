import {DEFAULT_WATER,parsePowerMessage,extractIntervals,complement,availability,total,formatIntervals,duration,buildEvents,addDays,localNow,humanDate} from './lib.js';
const TZ='Europe/Kyiv';
const KB={keyboard:[[{text:'📅 Сьогодні'},{text:'🌅 Завтра'}],[{text:'📋 Графік'},{text:'🔔 Сповіщення'}],[{text:'ℹ️ Допомога'}]],resize_keyboard:true,is_persistent:true};

export default {
 async fetch(req,env){
  const u=new URL(req.url);
  if(req.method==='GET'&&u.pathname==='/')return new Response('Chabany Water Bot: OK');
  if(req.method==='GET'&&u.pathname==='/setup-webhook')return setupWebhook(u,env);
  if(req.method==='GET'&&u.pathname==='/webhook-info')return webhookInfo(env);
  if(req.method==='POST'&&u.pathname==='/telegram'){
    if(env.TELEGRAM_WEBHOOK_SECRET&&req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return new Response('Forbidden',{status:403});
    await handle(await req.json(),env);
    return new Response('OK');
  }
  return new Response('Not found',{status:404});
 },
 async scheduled(c,env,ctx){ctx.waitUntil(notifyAll(new Date(c.scheduledTime),env))}
};

async function handle(up,env){
 if(up.callback_query)return callback(up.callback_query,env); const m=up.message;if(!m?.chat?.id)return;const chat=String(m.chat.id),text=(m.text||m.caption||'').trim();await init(env,chat);
 if(!text)return send(env,chat,'Перешли текстове повідомлення з графіком.',{reply_markup:KB});
 if(text==='/start')return send(env,chat,'💧⚡ <b>Чабани: вода + світло</b>\n\nСвітло вдома: <b>2.2</b>\nНасосна: <b>1.2</b>\nРезерв води: <b>06:00–10:00 · 12:00–14:00 · 18:00–24:00</b>\n\nПросто пересилай повідомлення єСвітло.',{reply_markup:KB});
 if(text==='📅 Сьогодні'||text==='/today')return show(env,chat,localNow().date);
 if(text==='🌅 Завтра'||text==='/tomorrow')return show(env,chat,addDays(localNow().date,1));
 if(text==='📋 Графік'||text==='/schedule')return raw(env,chat,localNow().date);
 if(text==='🔔 Сповіщення'||text==='/notifications')return notifyMenu(env,chat);
 if(text==='ℹ️ Допомога'||text==='/help')return send(env,chat,'Перешли повний графік або повідомлення <b>«Зміни у графіку»</b>. У змінах я беру тільки блок <b>Стало</b>.',{reply_markup:KB});
 if(/водопостачан|графік\s+води|вода/i.test(text)&&!/\b1\.2\b|\b2\.2\b/.test(text)){const xs=extractIntervals(text);if(xs.length){await env.DB.prepare('INSERT INTO water_rules(chat_id,fallback_intervals_json,source_text) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET fallback_intervals_json=excluded.fallback_intervals_json,source_text=excluded.source_text,updated_at=CURRENT_TIMESTAMP').bind(chat,JSON.stringify(xs),text).run();return send(env,chat,`💧 Резервний графік води оновлено:\n<b>${formatIntervals(xs)}</b>`,{reply_markup:KB})}}
 const p=parsePowerMessage(text); if(!p)return send(env,chat,'Не знайшов графік 1.2 / 2.2 або дату. Перешли повідомлення єСвітло без змін.',{reply_markup:KB});
 for(const i of p.items)await save(env,chat,p.date,i.group,i.intervals,text); await send(env,chat,`✅ Графік на <b>${humanDate(p.date)}</b> оновлено.`,{reply_markup:KB}); return show(env,chat,p.date);
}
async function init(env,c){await env.DB.prepare("INSERT OR IGNORE INTO chats(chat_id) VALUES(?)").bind(c).run();await env.DB.prepare('INSERT OR IGNORE INTO water_rules(chat_id,fallback_intervals_json) VALUES(?,?)').bind(c,JSON.stringify(DEFAULT_WATER)).run();await env.DB.prepare('INSERT OR IGNORE INTO notification_settings(chat_id) VALUES(?)').bind(c).run()}
async function save(env,c,d,g,x,src){await env.DB.prepare("INSERT INTO schedules(chat_id,schedule_date,group_name,mode,intervals_json,source_text) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,schedule_date,group_name) DO UPDATE SET mode=excluded.mode,intervals_json=excluded.intervals_json,source_text=excluded.source_text,created_at=CURRENT_TIMESTAMP").bind(c,d,g,'off',JSON.stringify(x),src).run()}
async function load(env,c,d){const r=await env.DB.prepare('SELECT group_name,intervals_json FROM schedules WHERE chat_id=? AND schedule_date=? AND group_name IN (?,?)').bind(c,d,'1.2','2.2').all();const m=Object.fromEntries(r.results.map(x=>[x.group_name,JSON.parse(x.intervals_json)]));if(!m['1.2']||!m['2.2'])return null;const w=await env.DB.prepare('SELECT fallback_intervals_json FROM water_rules WHERE chat_id=?').bind(c).first();const p12=complement(m['1.2']),p22=complement(m['2.2']),a=availability(p12,p22,JSON.parse(w.fallback_intervals_json));return {...a,p12,p22}}
async function show(env,c,d){const a=await load(env,c,d);if(!a)return send(env,c,`📅 <b>${humanDate(d)}</b>\nНемає повного графіка 1.2 + 2.2. Перешли актуальний графік.`);let s=`📅 <b>${humanDate(d)}</b>\n\n💧 <b>Вода — ${duration(total(a.water))}</b>\n${formatIntervals(a.water)}\n\n⚡ <b>Світло 2.2 — ${duration(total(a.p22))}</b>\n${formatIntervals(a.p22)}\n\n⚡💧 <b>Разом — ${duration(total(a.both))}</b>\n${formatIntervals(a.both)}`;if(a.best)s+=`\n\n⭐ <b>Найкраще вікно: ${formatIntervals([a.best])} — ${duration(a.best[1]-a.best[0])}</b>`;return send(env,c,s,{reply_markup:KB})}
async function raw(env,c,d){const r=await env.DB.prepare('SELECT group_name,intervals_json FROM schedules WHERE chat_id=? AND schedule_date=? ORDER BY group_name').bind(c,d).all();if(!r.results.length)return send(env,c,'Графік ще не завантажений.');return send(env,c,`📋 <b>${humanDate(d)}</b>\n`+r.results.map(x=>`Група ${x.group_name}, відключення: ${formatIntervals(JSON.parse(x.intervals_json))}`).join('\n'))}

async function callback(q,env){const c=String(q.message?.chat?.id||'');if(!c)return;await init(env,c);const d=q.data||'';if(d.startsWith('n:lead:'))await env.DB.prepare('UPDATE notification_settings SET lead_minutes=?,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(+d.split(':')[2],c).run();else if(d.startsWith('n:toggle:')){const col={both:'both_alerts',water:'water_alerts',end:'end_alerts'}[d.split(':')[2]];if(col)await env.DB.prepare(`UPDATE notification_settings SET ${col}=CASE ${col} WHEN 1 THEN 0 ELSE 1 END,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?`).bind(c).run()}await answer(env,q.id);return notifyMenu(env,c,q.message.message_id)}
async function settings(env,c){return env.DB.prepare('SELECT * FROM notification_settings WHERE chat_id=?').bind(c).first()}
function ntext(s){return `🔔 <b>Сповіщення</b>\n\n⚡💧 Вода + світло: ${s.both_alerts?'✅':'❌'}\n💧 Вода: ${s.water_alerts?'✅':'❌'}\n⚠️ Перед завершенням: ${s.end_alerts?'✅':'❌'}\n⏱ Попереджати за: <b>${s.lead_minutes} хв</b>`}
function nkb(s){return {inline_keyboard:[[{text:`⚡💧 ${s.both_alerts?'✅':'❌'}`,callback_data:'n:toggle:both'},{text:`💧 ${s.water_alerts?'✅':'❌'}`,callback_data:'n:toggle:water'}],[{text:`⚠️ ${s.end_alerts?'✅':'❌'}`,callback_data:'n:toggle:end'}],[15,30,60].map(x=>({text:`${s.lead_minutes===x?'✅ ':''}${x} хв`,callback_data:`n:lead:${x}`}))]}}
async function notifyMenu(env,c,msg){const s=await settings(env,c);if(msg)return tg(env,'editMessageText',{chat_id:c,message_id:msg,text:ntext(s),parse_mode:'HTML',reply_markup:nkb(s)});return send(env,c,ntext(s),{reply_markup:nkb(s)})}
async function notifyAll(now,env){const {results}=await env.DB.prepare('SELECT * FROM notification_settings').all();for(const s of results)try{await notifyOne(env,s,now)}catch(e){console.log('notify',e)}}
async function notifyOne(env,s,now){const n=localNow(now,TZ),a=await load(env,s.chat_id,n.date);if(!a)return;for(const e of buildEvents(a,s,n.date)){if(e.minute<n.minute-2||e.minute>n.minute+2)continue;const r=await env.DB.prepare('INSERT OR IGNORE INTO notification_log(chat_id,event_key,event_at) VALUES(?,?,?)').bind(s.chat_id,e.key,`${n.date} ${e.minute}`).run();if(r.meta.changes)await send(env,s.chat_id,e.text)}}

async function setupWebhook(u,env){
  if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:'TELEGRAM_BOT_TOKEN is missing'},500);
  if(!env.TELEGRAM_WEBHOOK_SECRET)return json({ok:false,error:'TELEGRAM_WEBHOOK_SECRET is missing'},500);
  if(!/^[A-Za-z0-9_-]{1,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET))return json({ok:false,error:'TELEGRAM_WEBHOOK_SECRET must contain only A-Z, a-z, 0-9, _ or -'},500);
  const webhookUrl=`${u.origin}/telegram`;
  const r=await tg(env,'setWebhook',{url:webhookUrl,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query'],drop_pending_updates:false});
  let body; try{body=await r.json()}catch{body={ok:false,error:'Invalid Telegram response'}};
  return json({ok:r.ok&&body.ok,webhook_url:webhookUrl,telegram:body},r.ok&&body.ok?200:502);
}
async function webhookInfo(env){
  if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:'TELEGRAM_BOT_TOKEN is missing'},500);
  const r=await tg(env,'getWebhookInfo',{});
  let body; try{body=await r.json()}catch{body={ok:false,error:'Invalid Telegram response'}};
  if(body?.result?.url)body.result.url=body.result.url.replace(/\/telegram$/,'/telegram');
  return json(body,r.ok?200:502);
}
const json=(value,status=200)=>new Response(JSON.stringify(value,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function tg(env,method,payload){const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)console.log(method,await r.text());return r}
const send=(env,c,text,opt={})=>tg(env,'sendMessage',{chat_id:c,text,parse_mode:'HTML',disable_web_page_preview:true,...opt});
const answer=(env,id)=>tg(env,'answerCallbackQuery',{callback_query_id:id});
