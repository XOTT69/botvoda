import {parsePowerMessage,extractIntervals,normalize,complement,availability,total,formatIntervals,addDays,localNow,humanDate} from './lib.js';
import {ensureSchema,ensureUser,getSetting,setSetting,getWaterIntervals,setWaterIntervals,getRawDay,loadDay,saveHistory,restoreHistory,saveScheduleGroup,createPending,getPending,deletePending,logChange,recentChanges,recentHistory} from './db.js';
import {fmtUpdated,nowBlock,dayBlock,diffText} from './render.js';
import {send,edit,answer,setupWebhook,webhookInfo,webhookSecret} from './telegram.js';
import {setupGroupPublication,refreshPublications,refreshOnePublication,checkGroupRights} from './publications.js';
import {notifyMenu,notificationCallback,notifyAll} from './notifications.js';

const KB={keyboard:[[{text:'📅 Сьогодні'},{text:'🌅 Завтра'}],[{text:'📋 Графік'},{text:'🔔 Сповіщення'}],[{text:'ℹ️ Допомога'}]],resize_keyboard:true,is_persistent:true};
const TZ='Europe/Kyiv';
const escapeHtml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const isAdminUser=(id,env)=>Boolean(env.ADMIN_TELEGRAM_ID)&&String(id||'')===String(env.ADMIN_TELEGRAM_ID);

export default {
  async fetch(req,env){
    const u=new URL(req.url);
    if(req.method==='GET'&&u.pathname==='/')return new Response('Chabany Water Bot: OK');
    if(req.method==='GET'&&u.pathname==='/setup-webhook')return setupWebhook(u,env);
    if(req.method==='GET'&&u.pathname==='/webhook-info')return webhookInfo(env);
    if(req.method==='POST'&&u.pathname==='/telegram'){
      if(env.TELEGRAM_WEBHOOK_SECRET){const expected=await webhookSecret(env);if(req.headers.get('X-Telegram-Bot-Api-Secret-Token')!==expected)return new Response('Forbidden',{status:403});}
      await ensureSchema(env);await handle(await req.json(),env);return new Response('OK');
    }
    return new Response('Not found',{status:404});
  },
  async scheduled(c,env,ctx){ctx.waitUntil((async()=>{await ensureSchema(env);await Promise.all([notifyAll(new Date(c.scheduledTime),env),refreshPublications(env)]);})());}
};

async function handle(up,env){
  if(up.callback_query)return callback(up.callback_query,env);
  const m=up.message||up.channel_post;if(!m?.chat?.id)return;
  const chat=String(m.chat.id),text=(m.text||m.caption||'').trim(),privateChat=m.chat.type==='private',admin=isAdminUser(m.from?.id,env);
  if(/^\/id(?:@\w+)?$/i.test(text))return send(env,chat,`🆔 Ваш Telegram ID: <code>${m.from?.id||'невідомо'}</code>`);

  if(!privateChat){
    if(/^\/setupgroup(?:@\w+)?$/i.test(text)){if(m.chat.type!=='channel'&&!admin)return send(env,chat,'⛔️ Підключити групу може лише власник бота.');return setupGroupPublication(m,env);}
    if(/^\/refreshgroup(?:@\w+)?$/i.test(text)){if(m.chat.type!=='channel'&&!admin)return send(env,chat,'⛔️ Оновити табло може лише власник бота.');const r=await refreshOnePublication(env,chat,true);return send(env,chat,r?.ok?'✅ Закріплене табло відредаговано.':`❌ Не вдалося відредагувати табло.\n<code>${escapeHtml(r?.error||'невідома помилка')}</code>`);}
    if(/^\/checkgroup(?:@\w+)?$/i.test(text))return checkGroupRights(m,env);
    return;
  }

  await ensureUser(env,chat);
  if(text.startsWith('/start')){const x=admin?'\n\n👑 Для керування: /admin':'';return send(env,chat,'💧⚡ <b>Чабани: вода + світло</b>\n\nВода залежить від групи <b>1.2</b>. Ваше світло — група <b>2.2</b>.\nТут можна дивитися актуальний графік і налаштовувати персональні нагадування.'+x,{reply_markup:KB});}
  if(text==='📅 Сьогодні'||text==='/today')return showDay(env,chat,localNow().date,true);
  if(text==='🌅 Завтра'||text==='/tomorrow')return showDay(env,chat,addDays(localNow().date,1),false);
  if(text==='📋 Графік'||text==='/schedule')return showRaw(env,chat,localNow().date);
  if(text==='🔔 Сповіщення'||text==='/notifications')return notifyMenu(env,chat);
  if(text==='ℹ️ Допомога'||text==='/help')return send(env,chat,'📌 У каналі — короткий актуальний статус.\n🔔 Тут — персональні нагадування, сьогодні/завтра та деталі.\n\nОновлювати графік може тільки адміністратор.',{reply_markup:KB});
  if(/^\/admin$/i.test(text)&&admin)return adminMenu(env,chat);

  const waterMessage=/водопостачан|графік\s+води|вода/iu.test(text)&&!/\b1\.2\b|\b2\.2\b/.test(text);
  if(waterMessage){if(!admin)return readOnly(env,chat);const xs=extractIntervals(text);if(xs.length)return previewWater(env,chat,xs,text);}
  const p=parsePowerMessage(text);
  if(p){if(!admin)return readOnly(env,chat);return previewPower(env,chat,p,text);}
  if(admin&&text.length>20)return send(env,chat,'⚠️ Не вдалося розпізнати графік. Перевір дату та наявність блоків груп 1.2 / 2.2.',{reply_markup:KB});
}

async function readOnly(env,chat){return send(env,chat,'ℹ️ Оновлювати графік може тільки адміністратор. Вам доступні перегляд і персональні нагадування.',{reply_markup:KB});}

async function projectedDay(env,p){
  const raw=await getRawDay(env,p.date),groups={'1.2':raw.rows['1.2']?.intervals??null,'2.2':raw.rows['2.2']?.intervals??null},possible={'1.2':raw.possible['1.2']||[],'2.2':raw.possible['2.2']||[]};
  for(const item of p.items){groups[item.group]=normalize(item.intervals);possible[item.group]=normalize(item.possibleIntervals||[]);}
  if(!groups['1.2']||!groups['2.2'])return null;
  const fallback=await getWaterIntervals(env),p12=complement(groups['1.2']),p22=complement(groups['2.2']),a=availability(p12,p22,fallback);
  return {...a,p12,p22,off12:groups['1.2'],off22:groups['2.2'],possible12:possible['1.2'],possible22:possible['2.2']};
}
function validatePower(p,projected,today){
  const warnings=[];
  if(p.date<today)warnings.push('Дата графіка вже минула.');
  if(p.kind==='full'&&p.items.length<2)warnings.push('У повному графіку знайдено не обидві потрібні групи.');
  if(!projected)warnings.push('Немає повної пари 1.2 + 2.2 для розрахунку.');
  for(const item of p.items)if(total(item.intervals)>=1380)warnings.push(`Група ${item.group}: відключення майже на всю добу — перевір дані.`);
  return warnings;
}
async function previewPower(env,chat,p,sourceText){
  const before=await loadDay(env,p.date),after=await projectedDay(env,p),warnings=validatePower(p,after,localNow().date),auto=await getSetting(env,'auto_publish','0'),payload={type:'power',date:p.date,kind:p.kind,items:p.items,sourceText};
  let preview=after?diffText(before,after,p.date):`⚠️ <b>Не можу повністю порахувати ${humanDate(p.date)}</b>`;
  if(after)preview+=`\n\n${dayBlock('ПІСЛЯ ОНОВЛЕННЯ',p.date,after,null,true)}`;
  if(warnings.length)preview+=`\n\n⚠️ <b>Перевір перед публікацією</b>\n• ${warnings.map(escapeHtml).join('\n• ')}`;
  const id=await createPending(env,chat,payload,warnings,preview);
  if(!after)return send(env,chat,preview,{reply_markup:{inline_keyboard:[[{text:'❌ Скасувати',callback_data:`cancel:${id}`}],[{text:'⚙️ Адмін-панель',callback_data:'adm:home'}]]}});
  if(auto==='1'&&!warnings.length)return publishPending(env,chat,id,true);
  return send(env,chat,preview,{reply_markup:{inline_keyboard:[[{text:'✅ Опублікувати',callback_data:`pub:${id}`},{text:'❌ Скасувати',callback_data:`cancel:${id}`}],[{text:'⚙️ Адмін-панель',callback_data:'adm:home'}]]}});
}
async function previewWater(env,chat,xs,sourceText){
  const old=await getWaterIntervals(env),payload={type:'water',date:localNow().date,intervals:xs,sourceText},preview=`💧 <b>Новий резервний графік води</b>\n\nБуло: ${formatIntervals(old)}\nСтане: <b>${formatIntervals(xs)}</b>`,id=await createPending(env,chat,payload,[],preview);
  return send(env,chat,preview,{reply_markup:{inline_keyboard:[[{text:'✅ Опублікувати',callback_data:`pub:${id}`},{text:'❌ Скасувати',callback_data:`cancel:${id}`}]]}});
}
async function publishPending(env,chat,id,auto=false){
  const row=await getPending(env,id,chat);if(!row)return send(env,chat,'⚠️ Цей попередній перегляд уже неактуальний.');
  const payload=JSON.parse(row.payload_json);
  if(payload.type==='water'){
    await saveHistory(env,localNow().date,'water_update','Оновлення резервного графіка води');await setWaterIntervals(env,payload.intervals,payload.sourceText||'');const summary=`💧 Резервний графік води: ${formatIntervals(payload.intervals)}`;await logChange(env,null,summary);await deletePending(env,id);await refreshPublications(env,true);return send(env,chat,`✅ Опубліковано.\n${summary}`,{reply_markup:KB});
  }
  const before=await loadDay(env,payload.date);await saveHistory(env,payload.date,'schedule_update','Перед оновленням графіка');for(const item of payload.items)await saveScheduleGroup(env,payload.date,item.group,item.intervals,item.possibleIntervals||[],payload.sourceText||'');const after=await loadDay(env,payload.date),summary=diffText(before,after,payload.date);await logChange(env,payload.date,summary.replace(/<[^>]+>/g,''));await deletePending(env,id);await refreshPublications(env,true);return send(env,chat,`✅ <b>Опубліковано</b>${auto?' автоматично':''}.\n📌 Закріплене табло синхронізовано.\n\n${summary}`,{reply_markup:KB});
}

async function showDay(env,chat,date,withNow){const a=await loadDay(env,date);if(!a)return send(env,chat,`📅 <b>${humanDate(date)}</b>\nГрафік ще не завантажено.`,{reply_markup:KB});const now=localNow();let s=withNow&&date===now.date?`${nowBlock(a,now.minute)}\n\n`:'';s+=dayBlock(date===now.date?'СЬОГОДНІ':'ЗАВТРА',date,a,fmtUpdated(a.updatedAt,TZ));return send(env,chat,s,{reply_markup:KB});}
async function showRaw(env,chat,date){const a=await loadDay(env,date);if(!a)return send(env,chat,'Графік ще не завантажено.',{reply_markup:KB});let s=`📋 <b>${humanDate(date)}</b>\n1.2 відключення: ${formatIntervals(a.off12)}\n2.2 відключення: ${formatIntervals(a.off22)}`;if(a.possible12.length||a.possible22.length)s+=`\n\n🟡 Можливі:\n1.2: ${formatIntervals(a.possible12)}\n2.2: ${formatIntervals(a.possible22)}`;return send(env,chat,s,{reply_markup:KB});}

async function adminMenu(env,chat,msgId=null){const auto=await getSetting(env,'auto_publish','0'),text=`👑 <b>Адмін-панель</b>\n\nПублікація: <b>${auto==='1'?'автоматична':'через попередній перегляд'}</b>\n\nПерешли сюди новий графік — я покажу зміни перед публікацією.`,kb={inline_keyboard:[[{text:'➕ Оновити графік',callback_data:'adm:update'}],[{text:'📅 Сьогодні',callback_data:'adm:today'},{text:'🌅 Завтра',callback_data:'adm:tomorrow'}],[{text:'🧾 Останні зміни',callback_data:'adm:changes'},{text:'↩️ Відкотити',callback_data:'adm:rollback'}],[{text:'📌 Оновити канал',callback_data:'adm:refresh'},{text:'🩺 Статус системи',callback_data:'adm:status'}],[{text:`${auto==='1'?'✅':'☑️'} Автопублікація`,callback_data:'adm:auto'}]]};return msgId?edit(env,chat,msgId,text,kb):send(env,chat,text,{reply_markup:kb});}
async function systemStatus(env,chat,msgId){const pubs=await env.DB.prepare('SELECT COUNT(*) AS c FROM publications').first(),users=await env.DB.prepare('SELECT COUNT(*) AS c FROM notification_settings').first(),a=await loadDay(env,localNow().date),text=`🩺 <b>Статус системи</b>\n\nБаза D1: ✅\nГрафік сьогодні: ${a?'✅':'❌'}\nПідключених каналів/груп: <b>${pubs?.c||0}</b>\nКористувачів сповіщень: <b>${users?.c||0}</b>\nCron: кожні 5 хв`;return edit(env,chat,msgId,text,{inline_keyboard:[[{text:'⬅️ Назад',callback_data:'adm:home'}]]});}
async function changesMenu(env,chat,msgId){const rows=await recentChanges(env,5);let s='🧾 <b>Останні зміни</b>\n';if(!rows.length)s+='\nПоки немає.';else for(const r of rows)s+=`\n\n${r.schedule_date?humanDate(r.schedule_date):'Вода'}\n${escapeHtml(r.summary_text).slice(0,700)}`;return edit(env,chat,msgId,s,{inline_keyboard:[[{text:'⬅️ Назад',callback_data:'adm:home'}]]});}
async function rollbackMenu(env,chat,msgId){const rows=await recentHistory(env,5),kb=rows.map(r=>[{text:`↩️ #${r.id} ${r.schedule_date?humanDate(r.schedule_date):''}`,callback_data:`rb:${r.id}`}]);kb.push([{text:'⬅️ Назад',callback_data:'adm:home'}]);return edit(env,chat,msgId,'↩️ <b>Відкат</b>\nОберіть попередню версію:',{inline_keyboard:kb});}
async function replaceWithDay(env,chat,msgId,date){const a=await loadDay(env,date),text=a?dayBlock(date===localNow().date?'СЬОГОДНІ':'ЗАВТРА',date,a,fmtUpdated(a.updatedAt,TZ)):`📅 ${humanDate(date)}\nГрафік ще не завантажено.`;return edit(env,chat,msgId,text,{inline_keyboard:[[{text:'⬅️ Назад',callback_data:'adm:home'}]]});}

async function callback(q,env){
  const chat=String(q.message?.chat?.id||'');if(!chat)return;const admin=isAdminUser(q.from?.id,env);if(q.message?.chat?.type!=='private')return answer(env,q.id);await ensureUser(env,chat);const d=q.data||'';
  if(d.startsWith('pub:')){await answer(env,q.id);if(!admin)return;return publishPending(env,chat,d.split(':')[1]);}
  if(d.startsWith('cancel:')){if(!admin)return answer(env,q.id,'Недоступно');await deletePending(env,d.split(':')[1]);await answer(env,q.id,'Скасовано');return edit(env,chat,q.message.message_id,'❌ Публікацію скасовано.',null);}
  if(d.startsWith('adm:')){if(!admin){await answer(env,q.id,'Недоступно');return;}await answer(env,q.id);const a=d.split(':')[1];if(a==='home')return adminMenu(env,chat,q.message.message_id);if(a==='update')return edit(env,chat,q.message.message_id,'➕ <b>Оновлення графіка</b>\n\nПросто перешли сюди нове повідомлення з графіком або змінами. Я спочатку покажу попередній перегляд і різницю.',{inline_keyboard:[[{text:'⬅️ Назад',callback_data:'adm:home'}]]});if(a==='today')return replaceWithDay(env,chat,q.message.message_id,localNow().date);if(a==='tomorrow')return replaceWithDay(env,chat,q.message.message_id,addDays(localNow().date,1));if(a==='changes')return changesMenu(env,chat,q.message.message_id);if(a==='rollback')return rollbackMenu(env,chat,q.message.message_id);if(a==='refresh'){await refreshPublications(env,true);return edit(env,chat,q.message.message_id,'✅ Закріплене табло оновлено.',{inline_keyboard:[[{text:'⬅️ Назад',callback_data:'adm:home'}]]});}if(a==='status')return systemStatus(env,chat,q.message.message_id);if(a==='auto'){const cur=await getSetting(env,'auto_publish','0');await setSetting(env,'auto_publish',cur==='1'?'0':'1');return adminMenu(env,chat,q.message.message_id);}}
  if(d.startsWith('rb:')){if(!admin)return answer(env,q.id,'Недоступно');await answer(env,q.id);const id=d.split(':')[1];return edit(env,chat,q.message.message_id,`⚠️ Відкотити графік до версії <b>#${id}</b>?`,{inline_keyboard:[[{text:'✅ Так, відкотити',callback_data:`rbc:${id}`},{text:'❌ Ні',callback_data:'adm:rollback'}]]});}
  if(d.startsWith('rbc:')){if(!admin)return;await answer(env,q.id);const id=d.split(':')[1],snap=await restoreHistory(env,id);if(!snap)return edit(env,chat,q.message.message_id,'❌ Версію не знайдено.',null);await refreshPublications(env,true);return edit(env,chat,q.message.message_id,`✅ Відкат виконано для ${humanDate(snap.date)}.`,{inline_keyboard:[[{text:'⬅️ Адмін-панель',callback_data:'adm:home'}]]});}
  if(d.startsWith('n:')){await answer(env,q.id);return notificationCallback(env,chat,q.message.message_id,d);}
}
