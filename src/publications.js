import {addDays,localNow} from './lib.js';
import {loadDay,getManualWaterStatus,getEffectivePowerStatus} from './db.js';
import {fmtUpdated,publicText} from './render.js';
import {tg,safeJson,send} from './telegram.js';
import {getCommunityWaterReports,communityWaterLine} from './water-reports.js';

const TZ='Europe/Kyiv';
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function publicKeyboard(username){return {inline_keyboard:[[{text:'🔔 Нагадування та актуальний графік',url:`https://t.me/${username}?start=chabany`}],[{text:'💧 Повідомити про воду',url:`https://t.me/${username}?start=water-report`}]]};}
async function getBotChatRights(env,chatId,botId){const x=await safeJson(await tg(env,'getChatMember',{chat_id:chatId,user_id:botId}));return x?.ok?x.result:null;}
export async function buildPublicText(env){const n=localNow(),today=n.date,tomorrow=addDays(today,1),[a,b,manual,power,community]=await Promise.all([loadDay(env,today),loadDay(env,tomorrow),getManualWaterStatus(env),getEffectivePowerStatus(env),getCommunityWaterReports(env)]);const manualView={...manual,updatedLabel:fmtUpdated(manual?.updatedAt,TZ)};const powerView={...power,updatedLabel:fmtUpdated(power?.updatedAt,TZ)};return publicText(today,tomorrow,a,b,n.minute,fmtUpdated(a?.updatedAt,TZ),fmtUpdated(b?.updatedAt,TZ),manualView,powerView,communityWaterLine(community));}

async function publishOrUpdateChart(env,row){
  if(env.SCHEDULE_CARD_ENABLED!=='on')return {ok:true,skipped:true,disabled:true};
  if(env.SCHEDULE_CARD_CHAT_ID&&String(env.SCHEDULE_CARD_CHAT_ID)!==String(row.group_chat_id))
    return {ok:true,skipped:true,otherChat:true};
  try {
    const {publishScheduleCard}=await import('./schedule-card-publisher.js');
    return await publishScheduleCard(env,row);
  } catch(error) {
    console.warn('schedule card failed:',String(error?.message||error));
    return {ok:false,error:'Не вдалося оновити картку. Дивись журнал Worker.'};
  }
}
export async function setupGroupPublication(m,env){
  const chat=String(m.chat.id),me=await safeJson(await tg(env,'getMe',{}));if(!me?.ok)return send(env,chat,'❌ Не вдалося отримати дані бота.');const rights=await getBotChatRights(env,chat,me.result.id);
  if(m.chat.type==='channel'&&(!rights?.can_post_messages||!rights?.can_edit_messages))return send(env,chat,'⛔️ Дай боту права <b>Публікувати повідомлення</b> і <b>Редагувати повідомлення</b>.');
  const username=me.result.username,text=await buildPublicText(env),existing=await env.DB.prepare('SELECT * FROM publications WHERE group_chat_id=?').bind(chat).first();
  let row=existing;
  if(existing?.message_id){
    const r=await safeJson(await tg(env,'editMessageText',{chat_id:chat,message_id:existing.message_id,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:publicKeyboard(username)}));
    const desc=String(r?.description||'');
    if(r?.ok||desc.toLowerCase().includes('message is not modified')){await tg(env,'pinChatMessage',{chat_id:chat,message_id:existing.message_id,disable_notification:true});await env.DB.prepare('UPDATE publications SET bot_username=?,last_text=?,updated_at=CURRENT_TIMESTAMP WHERE group_chat_id=?').bind(username,text,chat).run();}
    else if(desc.toLowerCase().includes('message to edit not found'))row=null;
    else return send(env,chat,`❌ Не вдалося відредагувати існуюче табло.\n<code>${esc(desc||'невідома помилка')}</code>`);
  }
  if(!row?.message_id){
    const sent=await safeJson(await tg(env,'sendMessage',{chat_id:chat,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:publicKeyboard(username)}));if(!sent?.ok)return send(env,chat,'❌ Не вдалося створити табло.');
    await tg(env,'pinChatMessage',{chat_id:chat,message_id:sent.result.message_id,disable_notification:true});
    await env.DB.prepare('INSERT INTO publications(group_chat_id,message_id,bot_username,group_title,last_text) VALUES(?,?,?,?,?) ON CONFLICT(group_chat_id) DO UPDATE SET message_id=excluded.message_id,bot_username=excluded.bot_username,group_title=excluded.group_title,last_text=excluded.last_text,updated_at=CURRENT_TIMESTAMP').bind(chat,sent.result.message_id,username,m.chat.title||'',text).run();
    row=await env.DB.prepare('SELECT * FROM publications WHERE group_chat_id=?').bind(chat).first();
  }
  const chart=await publishOrUpdateChart(env,row);
  if(!chart.ok)return send(env,chat,`⚠️ Текстове табло закріплене, але картинку не вдалося оновити.\\n<code>${esc(chart.error||'невідома помилка')}</code>`);
  return send(env,chat,chart.disabled?'✅ Текстове табло закріплене. Картку графіка вимкнено.':chart.pending?'✅ Текстове табло закріплене. Відправка картинки потребує перевірки адміністратором.':'✅ Текстове табло й картку графіка перевірено.');
}
export async function refreshPublications(env,force=false){const r=await env.DB.prepare('SELECT * FROM publications').all();for(const row of r.results||[])try{await refreshPublicationRow(env,row,force)}catch(e){console.log('publication',e)}}
export async function refreshOnePublication(env,chat,force=false){const row=await env.DB.prepare('SELECT * FROM publications WHERE group_chat_id=?').bind(chat).first();if(!row)return {ok:false,error:'Табло не підключене'};return refreshPublicationRow(env,row,force);}
async function refreshPublicationRow(env,row,force){
  const text=await buildPublicText(env);
  let textChanged=false;
  if(row.last_text!==text||force){
    const r=await safeJson(await tg(env,'editMessageText',{chat_id:row.group_chat_id,message_id:row.message_id,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:publicKeyboard(row.bot_username)}));
    if(r?.ok||String(r?.description||'').toLowerCase().includes('message is not modified')){
      await env.DB.prepare('UPDATE publications SET last_text=?,updated_at=CURRENT_TIMESTAMP WHERE group_chat_id=?').bind(text,row.group_chat_id).run();
      textChanged=true;
    }else return {ok:false,error:r?.description||'Не вдалося оновити текстове табло'};
  }
  const chart=await publishOrUpdateChart(env,row);
  return {ok:true,unchanged:!textChanged,chart};
}
export async function checkGroupRights(m,env){const chat=String(m.chat.id),me=await safeJson(await tg(env,'getMe',{}));if(!me?.ok)return;const x=await getBotChatRights(env,chat,me.result.id),row=await env.DB.prepare('SELECT message_id,photo_message_id,photo_state,photo_error FROM publications WHERE group_chat_id=?').bind(chat).first();return send(env,chat,`🔎 <b>Перевірка</b>\nСтатус: <b>${esc(x?.status||'—')}</b>\nПублікувати: ${x?.can_post_messages===false?'❌':'✅'}\nРедагувати: ${x?.can_edit_messages===false?'❌':'✅'}\n📌 Текст message_id: <code>${row?.message_id||'немає'}</code>\n🖼 Картинка message_id: <code>${row?.photo_message_id||'немає'}</code>\nСтан картинки: <code>${esc(row?.photo_state||'не створено')}</code>${row?.photo_error?'\n⚠️ '+esc(row.photo_error):''}`);}
