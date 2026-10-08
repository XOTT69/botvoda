import {DEFAULT_WATER,parsePowerMessage,extractIntervals,complement,availability,total,formatIntervals,duration,buildEvents,addDays,localNow,humanDate} from './lib.js';

const TZ='Europe/Kyiv';
const GLOBAL_SCOPE='__GLOBAL__';
const KB={keyboard:[[{text:'📅 Сьогодні'},{text:'🌅 Завтра'}],[{text:'📋 Графік'},{text:'🔔 Сповіщення'}],[{text:'ℹ️ Допомога'}]],resize_keyboard:true,is_persistent:true};

export default {
  async fetch(req,env){
    const u=new URL(req.url);
    if(req.method==='GET'&&u.pathname==='/')return new Response('Chabany Water Bot: OK');
    if(req.method==='GET'&&u.pathname==='/setup-webhook')return setupWebhook(u,env);
    if(req.method==='GET'&&u.pathname==='/webhook-info')return webhookInfo(env);
    if(req.method==='POST'&&u.pathname==='/telegram'){
      if(env.TELEGRAM_WEBHOOK_SECRET){
        const expected=await webhookSecret(env);
        if(req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==expected)return new Response('Forbidden',{status:403});
      }
      await handle(await req.json(),env);
      return new Response('OK');
    }
    return new Response('Not found',{status:404});
  },
  async scheduled(c,env,ctx){
    ctx.waitUntil(Promise.all([
      notifyAll(new Date(c.scheduledTime),env),
      refreshPublications(env)
    ]));
  }
};

async function handle(up,env){
  if(up.callback_query)return callback(up.callback_query,env);
  const m=up.message||up.channel_post;
  if(!m?.chat?.id)return;
  const chat=String(m.chat.id);
  const text=(m.text||m.caption||'').trim();
  const privateChat=m.chat.type==='private';
  const admin=isAdminUser(m.from?.id,env);

  if(text==='/id'||text.startsWith('/id@')){
    return send(env,chat,`🆔 Ваш Telegram ID: <code>${m.from?.id||'невідомо'}</code>`);
  }

  if(!privateChat){
    if(/^\/setupgroup(?:@\w+)?$/i.test(text)){
      if(m.chat.type!=='channel'&&!admin)return send(env,chat,'⛔️ Підключити групу може лише власник бота.');
      return setupGroupPublication(m,env);
    }
    if(/^\/refreshgroup(?:@\w+)?$/i.test(text)){
      if(m.chat.type!=='channel'&&!admin)return send(env,chat,'⛔️ Оновити закріплене повідомлення може лише власник бота.');
      const r=await refreshOnePublication(env,chat,true);
      if(r?.ok)return send(env,chat,'✅ Закріплене повідомлення відредаговано.');
      return send(env,chat,`❌ Не вдалося відредагувати закріплене повідомлення.\n\nTelegram: <code>${escapeHtml(r?.error||'невідома помилка')}</code>\n\nДля каналу перевір у правах бота: <b>Публікувати повідомлення</b> + <b>Редагувати повідомлення</b>.`);
    }
    if(/^\/checkgroup(?:@\w+)?$/i.test(text)){
      return checkGroupRights(m,env);
    }
    return;
  }

  await initUser(env,chat);
  if(admin)await migrateLegacyAdminData(env,chat);

  if(!text)return send(env,chat,'Перешли текстове повідомлення з графіком.',{reply_markup:KB});
  if(text.startsWith('/start')){
    const adminLine=admin?'\n\n👑 Ви адміністратор: можете оновлювати графік пересланими повідомленнями.':'';
    return send(env,chat,'💧⚡ <b>Чабани: вода + світло</b>\n\nСвітло вдома: <b>2.2</b>\nВода залежить від групи: <b>1.2</b>\nРезерв води: <b>06:00–10:00 · 12:00–14:00 · 18:00–24:00</b>\n\nТут завжди актуальний графік і персональні нагадування.'+adminLine,{reply_markup:KB});
  }
  if(text==='📅 Сьогодні'||text==='/today')return show(env,chat,localNow().date);
  if(text==='🌅 Завтра'||text==='/tomorrow')return show(env,chat,addDays(localNow().date,1));
  if(text==='📋 Графік'||text==='/schedule')return raw(env,chat,localNow().date);
  if(text==='🔔 Сповіщення'||text==='/notifications')return notifyMenu(env,chat);
  if(text==='ℹ️ Допомога'||text==='/help'){
    const base='Переглядати графік і налаштовувати нагадування може кожен. Оновлювати сам графік може тільки адміністратор.';
    return send(env,chat,base+(admin?'\n\nДля оновлення просто перешли повний графік або повідомлення <b>«Зміни у графіку»</b>. У змінах беру тільки блок <b>Стало</b>.':''),{reply_markup:KB});
  }

  const waterMessage=/водопостачан|графік\s+води|вода/i.test(text)&&!/\b1\.2\b|\b2\.2\b/.test(text);
  if(waterMessage){
    if(!admin)return readOnlyNotice(env,chat);
    const xs=extractIntervals(text);
    if(xs.length){
      await env.DB.prepare('INSERT INTO water_rules(chat_id,fallback_intervals_json,source_text) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET fallback_intervals_json=excluded.fallback_intervals_json,source_text=excluded.source_text,updated_at=CURRENT_TIMESTAMP').bind(GLOBAL_SCOPE,JSON.stringify(xs),text).run();
      await refreshPublications(env,true);
      return send(env,chat,`💧 Резервний графік води оновлено:\n<b>${formatIntervals(xs)}</b>`,{reply_markup:KB});
    }
  }

  const p=parsePowerMessage(text);
  if(!p){
    if(!admin)return readOnlyNotice(env,chat);
    return send(env,chat,'Не знайшов графік 1.2 / 2.2 або дату. Перешли повідомлення єСвітло без змін.',{reply_markup:KB});
  }
  if(!admin)return readOnlyNotice(env,chat);

  for(const i of p.items)await saveGlobalSchedule(env,p.date,i.group,i.intervals,text);
  await refreshPublications(env,true);
  await send(env,chat,`✅ Графік на <b>${humanDate(p.date)}</b> оновлено.\n📌 Закріплене повідомлення в підключених групах теж синхронізовано.`,{reply_markup:KB});
  return show(env,chat,p.date);
}

function isAdminUser(userId,env){
  return Boolean(env.ADMIN_TELEGRAM_ID)&&String(userId||'')===String(env.ADMIN_TELEGRAM_ID);
}

async function readOnlyNotice(env,chat){
  return send(env,chat,'ℹ️ Графік може оновлювати тільки адміністратор. Для вас доступні актуальний графік і персональні нагадування.',{reply_markup:KB});
}

async function initUser(env,c){
  await env.DB.prepare("INSERT OR IGNORE INTO chats(chat_id) VALUES(?)").bind(c).run();
  await env.DB.prepare('INSERT OR IGNORE INTO notification_settings(chat_id) VALUES(?)').bind(c).run();
  await ensureGlobalWater(env);
}

async function ensureGlobalWater(env){
  await env.DB.prepare('INSERT OR IGNORE INTO water_rules(chat_id,fallback_intervals_json) VALUES(?,?)').bind(GLOBAL_SCOPE,JSON.stringify(DEFAULT_WATER)).run();
}

async function migrateLegacyAdminData(env,chat){
  await ensureGlobalWater(env);
  const legacyWater=await env.DB.prepare('SELECT fallback_intervals_json,source_text FROM water_rules WHERE chat_id=?').bind(chat).first();
  const globalWater=await env.DB.prepare('SELECT source_text FROM water_rules WHERE chat_id=?').bind(GLOBAL_SCOPE).first();
  if(legacyWater?.source_text&&!globalWater?.source_text){
    await env.DB.prepare('UPDATE water_rules SET fallback_intervals_json=?,source_text=?,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(legacyWater.fallback_intervals_json,legacyWater.source_text,GLOBAL_SCOPE).run();
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO schedules(chat_id,schedule_date,group_name,mode,intervals_json,source_text,created_at)
    SELECT ?,schedule_date,group_name,mode,intervals_json,source_text,created_at FROM schedules WHERE chat_id=? AND group_name IN ('1.2','2.2')`).bind(GLOBAL_SCOPE,chat).run();
}

async function saveGlobalSchedule(env,d,g,x,src){
  await env.DB.prepare("INSERT INTO schedules(chat_id,schedule_date,group_name,mode,intervals_json,source_text) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,schedule_date,group_name) DO UPDATE SET mode=excluded.mode,intervals_json=excluded.intervals_json,source_text=excluded.source_text,created_at=CURRENT_TIMESTAMP").bind(GLOBAL_SCOPE,d,g,'off',JSON.stringify(x),src).run();
}

async function load(env,d){
  await ensureGlobalWater(env);
  const r=await env.DB.prepare('SELECT group_name,intervals_json FROM schedules WHERE chat_id=? AND schedule_date=? AND group_name IN (?,?)').bind(GLOBAL_SCOPE,d,'1.2','2.2').all();
  const m=Object.fromEntries(r.results.map(x=>[x.group_name,JSON.parse(x.intervals_json)]));
  if(!m['1.2']||!m['2.2'])return null;
  const w=await env.DB.prepare('SELECT fallback_intervals_json FROM water_rules WHERE chat_id=?').bind(GLOBAL_SCOPE).first();
  const p12=complement(m['1.2']),p22=complement(m['2.2']),a=availability(p12,p22,JSON.parse(w.fallback_intervals_json));
  return {...a,p12,p22};
}

async function show(env,c,d){
  const a=await load(env,d);
  if(!a)return send(env,c,`📅 <b>${humanDate(d)}</b>\nНемає повного графіка 1.2 + 2.2. Адміністратор ще не завантажив актуальний графік.`,{reply_markup:KB});
  let s=`📅 <b>${humanDate(d)}</b>\n\n💧 <b>Вода — ${duration(total(a.water))}</b>\n${formatIntervals(a.water)}\n\n⚡ <b>Світло 2.2 — ${duration(total(a.p22))}</b>\n${formatIntervals(a.p22)}\n\n⚡💧 <b>Разом — ${duration(total(a.both))}</b>\n${formatIntervals(a.both)}`;
  if(a.best)s+=`\n\n⭐ <b>Найкраще вікно: ${formatIntervals([a.best])} — ${duration(a.best[1]-a.best[0])}</b>`;
  return send(env,c,s,{reply_markup:KB});
}

async function raw(env,c,d){
  const r=await env.DB.prepare('SELECT group_name,intervals_json FROM schedules WHERE chat_id=? AND schedule_date=? AND group_name IN (?,?) ORDER BY group_name').bind(GLOBAL_SCOPE,d,'1.2','2.2').all();
  if(!r.results.length)return send(env,c,'Графік ще не завантажений.',{reply_markup:KB});
  return send(env,c,`📋 <b>${humanDate(d)}</b>\n`+r.results.map(x=>`Група ${x.group_name}, відключення: ${formatIntervals(JSON.parse(x.intervals_json))}`).join('\n'),{reply_markup:KB});
}

async function ensurePublications(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS publications (
    group_chat_id TEXT PRIMARY KEY,
    message_id INTEGER NOT NULL,
    bot_username TEXT NOT NULL,
    group_title TEXT,
    last_text TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function setupGroupPublication(m,env){
  await ensurePublications(env);
  await ensureGlobalWater(env);
  const chat=String(m.chat.id);

  const meResp=await tg(env,'getMe',{});
  const me=await safeJson(meResp);
  if(!me?.ok||!me.result?.username)return send(env,chat,'❌ Не зміг отримати username бота. Спробуй ще раз.');
  const username=me.result.username;

  const rights=await getBotChatRights(env,chat,me.result.id);
  if(m.chat.type==='channel'){
    const missing=[];
    if(!rights?.can_post_messages)missing.push('Публікувати повідомлення');
    if(!rights?.can_edit_messages)missing.push('Редагувати повідомлення');
    if(missing.length)return send(env,chat,`⛔️ Боту бракує прав у каналі:\n• ${missing.join('\n• ')}\n\nВідкрий <b>Канал → Адміністратори → бот</b> і увімкни ці права, потім повтори /setupgroup.`);
  }

  const text=await publicText(env,localNow().date);
  const existing=await env.DB.prepare('SELECT * FROM publications WHERE group_chat_id=?').bind(chat).first();

  if(existing?.message_id){
    const editResp=await tg(env,'editMessageText',{
      chat_id:chat,
      message_id:existing.message_id,
      text,
      parse_mode:'HTML',
      disable_web_page_preview:true,
      reply_markup:publicKeyboard(username)
    });
    const edit=await safeJson(editResp);
    const description=String(edit?.description||'');

    if(edit?.ok||description.toLowerCase().includes('message is not modified')){
      const pinResp=await tg(env,'pinChatMessage',{chat_id:chat,message_id:existing.message_id,disable_notification:true});
      const pin=await safeJson(pinResp);
      await env.DB.prepare('UPDATE publications SET bot_username=?,group_title=?,last_text=?,updated_at=CURRENT_TIMESTAMP WHERE group_chat_id=?').bind(username,m.chat.title||'',text,chat).run();
      if(!pin?.ok)return send(env,chat,'⚠️ Актуальне повідомлення знайдено й оновлено, але Telegram не дав його закріпити. Перевір право закріплювати повідомлення.');
      return send(env,chat,'✅ Підключення вже було. Використовую те саме закріплене повідомлення — нове не створював.');
    }

    if(!description.toLowerCase().includes('message to edit not found')){
      return send(env,chat,`❌ Старе повідомлення знайдено в базі, але Telegram не дозволив його редагувати:\n<code>${escapeHtml(description||'невідома помилка')}</code>`);
    }
  }

  const sentResp=await tg(env,'sendMessage',{
    chat_id:chat,
    text,
    parse_mode:'HTML',
    disable_web_page_preview:true,
    reply_markup:publicKeyboard(username)
  });
  const sent=await safeJson(sentResp);
  if(!sent?.ok)return send(env,chat,`❌ Не зміг створити нове табло. Telegram: <code>${escapeHtml(sent?.description||'невідома помилка')}</code>`);

  const messageId=sent.result.message_id;
  const pinResp=await tg(env,'pinChatMessage',{chat_id:chat,message_id:messageId,disable_notification:true});
  const pin=await safeJson(pinResp);

  await env.DB.prepare('INSERT INTO publications(group_chat_id,message_id,bot_username,group_title,last_text) VALUES(?,?,?,?,?) ON CONFLICT(group_chat_id) DO UPDATE SET message_id=excluded.message_id,bot_username=excluded.bot_username,group_title=excluded.group_title,last_text=excluded.last_text,updated_at=CURRENT_TIMESTAMP').bind(chat,messageId,username,m.chat.title||'',text).run();

  if(!pin?.ok)return send(env,chat,'⚠️ Нове табло створено й збережено, але не вдалося закріпити. Перевір право бота закріплювати повідомлення.');
  return send(env,chat,'✅ Старий message_id був недійсний. Створив одне нове табло, закріпив його і прив’язав у базі. Далі оновлення будуть лише редагувати цей пост.');
}
function publicKeyboard(username){
  return {inline_keyboard:[[{text:'🔔 Нагадування та актуальний графік',url:`https://t.me/${username}?start=chabany`}]]};
}

async function lastScheduleUpdate(env,date){
  const row=await env.DB.prepare(`
    SELECT MAX(ts) AS ts FROM (
      SELECT MAX(created_at) AS ts
      FROM schedules
      WHERE chat_id=? AND schedule_date=? AND group_name IN ('1.2','2.2')
      UNION ALL
      SELECT updated_at AS ts
      FROM water_rules
      WHERE chat_id=?
    )
  `).bind(GLOBAL_SCOPE,date,GLOBAL_SCOPE).first();

  if(!row?.ts)return null;
  const d=new Date(String(row.ts).replace(' ','T')+'Z');
  if(Number.isNaN(d.getTime()))return null;
  return new Intl.DateTimeFormat('uk-UA',{
    timeZone:TZ,
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23'
  }).format(d);
}

async function publicText(env,date){
  const a=await load(env,date);
  const updated=await lastScheduleUpdate(env,date);
  const updatedLine=updated?`\n🕒 Оновлено: <b>${updated}</b>`:'';

  const tomorrow=addDays(date,1);
  const tomorrowCount=await env.DB.prepare('SELECT COUNT(*) AS c FROM schedules WHERE chat_id=? AND schedule_date=? AND group_name IN (?,?)')
    .bind(GLOBAL_SCOPE,tomorrow,'1.2','2.2').first();

  if(!a){
    return `📍 <b>Чабани • ${humanDate(date)}</b>${updatedLine}\n\n⏳ Актуальний графік ще не завантажено.\n\n🔔 Персональні нагадування та деталі — у боті.`;
  }

  let s=`📍 <b>Чабани • ${humanDate(date)}</b>${updatedLine}

ℹ️ <b>Як читати цей графік</b>
Вода залежить від електропостачання групи <b>1.2</b>.
Якщо у групи <b>1.2</b> немає світла — вода подається за резервним графіком.
Нижче вже пораховано, коли буде <b>вода</b>, <b>світло у групи 2.2</b> та коли вони будуть <b>одночасно</b>.

💧 <b>Коли буде вода — ${duration(total(a.water))} за добу</b>
${formatIntervals(a.water)}

⚡ <b>Коли буде світло у групи 2.2 — ${duration(total(a.p22))}</b>
${formatIntervals(a.p22)}

⚡💧 <b>Коли одночасно буде і вода, і світло — ${duration(total(a.both))}</b>
${formatIntervals(a.both)}`;

  if(a.best){
    s+=`\n\n⭐ <b>Найзручніше безперервне вікно</b>\n${formatIntervals([a.best])} — <b>${duration(a.best[1]-a.best[0])}</b>\nУ цей час одночасно будуть <b>і вода, і світло</b>.`;
  }

  if(Number(tomorrowCount?.c||0)>=2){
    s+='\n\n🌅 <b>Графік на завтра вже завантажено</b> — дивіться в боті.';
  }

  s+='\n\n🔔 <b>Хочете персональне нагадування?</b>\nУ боті можна увімкнути сповіщення перед появою води або перед початком періоду <b>вода + світло</b>.';
  return s;
}

async function refreshPublications(env,force=false){
  await ensurePublications(env);
  const {results}=await env.DB.prepare('SELECT * FROM publications').all();
  for(const row of results){
    try{await refreshPublicationRow(env,row,force)}catch(e){console.log('publication',row.group_chat_id,e)}
  }
}

async function refreshOnePublication(env,groupChatId,force=false){
  await ensurePublications(env);
  const row=await env.DB.prepare('SELECT * FROM publications WHERE group_chat_id=?').bind(groupChatId).first();
  if(!row)return {ok:false,error:'Група/канал ще не підключені через /setupgroup'};
  return refreshPublicationRow(env,row,force);
}

async function refreshPublicationRow(env,row,force){
  const text=await publicText(env,localNow().date);
  if(row.last_text===text&&!force)return {ok:true,unchanged:true};
  const payload={chat_id:row.group_chat_id,message_id:row.message_id,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:publicKeyboard(row.bot_username)};
  const editResp=await tg(env,'editMessageText',payload);
  const edit=await safeJson(editResp);

  if(edit?.ok){
    await env.DB.prepare('UPDATE publications SET last_text=?,updated_at=CURRENT_TIMESTAMP WHERE group_chat_id=?').bind(text,row.group_chat_id).run();
    return {ok:true};
  }

  const description=String(edit?.description||'Unknown Telegram edit error');
  if(description.toLowerCase().includes('message is not modified')){
    await env.DB.prepare('UPDATE publications SET last_text=?,updated_at=CURRENT_TIMESTAMP WHERE group_chat_id=?').bind(text,row.group_chat_id).run();
    return {ok:true,unchanged:true};
  }

  console.log('Pinned dashboard edit failed', {
    group_chat_id: row.group_chat_id,
    message_id: row.message_id,
    error: description
  });
  return {ok:false,error:description};
}

async function getBotChatRights(env,chatId,botId){
  const r=await tg(env,'getChatMember',{chat_id:chatId,user_id:botId});
  const body=await safeJson(r);
  return body?.ok?body.result:null;
}

async function checkGroupRights(m,env){
  const chat=String(m.chat.id);
  const meResp=await tg(env,'getMe',{});
  const me=await safeJson(meResp);
  if(!me?.ok)return send(env,chat,'❌ Не вдалося отримати інформацію про бота.');
  const rights=await getBotChatRights(env,chat,me.result.id);
  if(!rights)return send(env,chat,'❌ Telegram не повернув права бота.');
  const row=await env.DB.prepare('SELECT message_id FROM publications WHERE group_chat_id=?').bind(chat).first();
  const yes=x=>x?'✅':'❌';
  let s=`🔎 <b>Перевірка бота</b>\n\nТип: <b>${m.chat.type}</b>\nСтатус: <b>${rights.status||'—'}</b>\n`;
  if(m.chat.type==='channel'){
    s+=`\n${yes(rights.can_post_messages)} Публікувати повідомлення\n${yes(rights.can_edit_messages)} Редагувати повідомлення\n${yes(rights.can_delete_messages)} Видаляти повідомлення`;
  }else{
    s+=`\n${yes(rights.can_pin_messages!==false)} Закріплювати повідомлення`;
  }
  s+=`\n\n📌 Збережений message_id: <code>${row?.message_id||'немає'}</code>`;
  if(m.chat.type==='channel'&&!rights.can_edit_messages)s+='\n\n⚠️ Для автооновлення каналу увімкни боту <b>Редагувати повідомлення</b>.';
  return send(env,chat,s);
}

function escapeHtml(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function callback(q,env){
  const c=String(q.message?.chat?.id||'');
  if(!c)return;
  if(q.message?.chat?.type!=='private')return answer(env,q.id);
  await initUser(env,c);
  const d=q.data||'';
  if(d.startsWith('n:lead:'))await env.DB.prepare('UPDATE notification_settings SET lead_minutes=?,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?').bind(+d.split(':')[2],c).run();
  else if(d.startsWith('n:toggle:')){
    const col={both:'both_alerts',water:'water_alerts',end:'end_alerts'}[d.split(':')[2]];
    if(col)await env.DB.prepare(`UPDATE notification_settings SET ${col}=CASE ${col} WHEN 1 THEN 0 ELSE 1 END,updated_at=CURRENT_TIMESTAMP WHERE chat_id=?`).bind(c).run();
  }
  await answer(env,q.id);
  return notifyMenu(env,c,q.message.message_id);
}

async function settings(env,c){return env.DB.prepare('SELECT * FROM notification_settings WHERE chat_id=?').bind(c).first()}
function ntext(s){return `🔔 <b>Сповіщення</b>\n\n⚡💧 Вода + світло: ${s.both_alerts?'✅':'❌'}\n💧 Вода: ${s.water_alerts?'✅':'❌'}\n⚠️ Перед завершенням: ${s.end_alerts?'✅':'❌'}\n⏱ Попереджати за: <b>${s.lead_minutes} хв</b>`}
function nkb(s){return {inline_keyboard:[[{text:`⚡💧 ${s.both_alerts?'✅':'❌'}`,callback_data:'n:toggle:both'},{text:`💧 ${s.water_alerts?'✅':'❌'}`,callback_data:'n:toggle:water'}],[{text:`⚠️ ${s.end_alerts?'✅':'❌'}`,callback_data:'n:toggle:end'}],[15,30,60].map(x=>({text:`${s.lead_minutes===x?'✅ ':''}${x} хв`,callback_data:`n:lead:${x}`}))]}}
async function notifyMenu(env,c,msg){const s=await settings(env,c);if(msg)return tg(env,'editMessageText',{chat_id:c,message_id:msg,text:ntext(s),parse_mode:'HTML',reply_markup:nkb(s)});return send(env,c,ntext(s),{reply_markup:nkb(s)})}

async function notifyAll(now,env){
  const {results}=await env.DB.prepare('SELECT * FROM notification_settings').all();
  for(const s of results)try{await notifyOne(env,s,now)}catch(e){console.log('notify',e)}
}

async function notifyOne(env,s,now){
  const n=localNow(now,TZ),a=await load(env,n.date);
  if(!a)return;
  for(const e of buildEvents(a,s,n.date)){
    if(e.minute<n.minute-2||e.minute>n.minute+2)continue;
    const r=await env.DB.prepare('INSERT OR IGNORE INTO notification_log(chat_id,event_key,event_at) VALUES(?,?,?)').bind(s.chat_id,e.key,`${n.date} ${e.minute}`).run();
    if(r.meta.changes)await send(env,s.chat_id,e.text);
  }
}

async function setupWebhook(u,env){
  if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:'TELEGRAM_BOT_TOKEN is missing'},500);
  if(!env.TELEGRAM_WEBHOOK_SECRET)return json({ok:false,error:'TELEGRAM_WEBHOOK_SECRET is missing'},500);
  const secretToken=await webhookSecret(env);
  const webhookUrl=`${u.origin}/telegram`;
  const r=await tg(env,'setWebhook',{url:webhookUrl,secret_token:secretToken,allowed_updates:['message','channel_post','callback_query'],drop_pending_updates:false});
  let body; try{body=await r.json()}catch{body={ok:false,error:'Invalid Telegram response'}};
  return json({ok:r.ok&&body.ok,webhook_url:webhookUrl,telegram:body},r.ok&&body.ok?200:502);
}

async function webhookSecret(env){
  const data=new TextEncoder().encode(env.TELEGRAM_WEBHOOK_SECRET||'');
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function webhookInfo(env){
  if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:'TELEGRAM_BOT_TOKEN is missing'},500);
  const r=await tg(env,'getWebhookInfo',{});
  let body; try{body=await r.json()}catch{body={ok:false,error:'Invalid Telegram response'}};
  return json(body,r.ok?200:502);
}

const json=(value,status=200)=>new Response(JSON.stringify(value,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function tg(env,method,payload){const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)console.log(method,await r.clone().text());return r}
async function safeJson(r){try{return await r.json()}catch{return null}}
const send=(env,c,text,opt={})=>tg(env,'sendMessage',{chat_id:c,text,parse_mode:'HTML',disable_web_page_preview:true,...opt});
const answer=(env,id)=>tg(env,'answerCallbackQuery',{callback_query_id:id});
