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

function timelineSegments(day){
  if(!day)return [];
  const on=Array.isArray(day.p22)?day.p22:[];
  const out=[];let cursor=0;
  for(const [start,end] of on){
    const a=Math.max(0,Math.min(1440,Number(start))),b=Math.max(a,Math.min(1440,Number(end)));
    if(a>cursor)out.push({start:cursor,end:a,on:false});
    if(b>a)out.push({start:a,end:b,on:true});
    cursor=Math.max(cursor,b);
  }
  if(cursor<1440)out.push({start:cursor,end:1440,on:false});
  return out;
}
function hhmm(minutes){
  const m=Math.max(0,Math.min(1440,Number(minutes)||0));
  return m===1440?'24:00':String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
}
function chartUrl(days,dates,minuteNow){
  const day=days[0];
  const segments=timelineSegments(day);
  const half=Math.ceil(segments.length/2);
  const left=segments.slice(0,half),right=segments.slice(half);
  const escHtml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const dateLabel=dates[0].split('-').reverse().join('.');
  const updated=new Intl.DateTimeFormat('uk-UA',{timeZone:TZ,day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  const scheduleColumn=items=>'<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="5" BGCOLOR="#07172B">'+items.map(seg=>{
    const bg=seg.on?'#0D302D':'#301D2B';
    const border=seg.on?'#1D9B70':'#C94D61';
    const dot=seg.on?'#49E68D':'#FF6878';
    const label=seg.on?'Світло є':'Вимкнення';
    return '<TR><TD ALIGN="LEFT" WIDTH="155" CELLPADDING="10"><FONT FACE="Arial" COLOR="#F4F7FF" POINT-SIZE="16">'+hhmm(seg.start)+' – '+hhmm(seg.end)+'</FONT></TD><TD BGCOLOR="'+bg+'" COLOR="'+border+'" BORDER="1" CELLPADDING="10"><FONT FACE="Arial" COLOR="'+dot+'" POINT-SIZE="17">●</FONT><FONT FACE="Arial" COLOR="'+(seg.on?'#65E99D':'#FF7C89')+'" POINT-SIZE="16">  '+label+'</FONT></TD></TR>';
  }).join('')+'</TABLE>';
  const html='<TABLE BORDER="1" COLOR="#173653" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" BGCOLOR="#061529">'+
    '<TR><TD COLSPAN="2" ALIGN="LEFT" CELLPADDING="22"><TABLE BORDER="0" CELLBORDER="0" CELLSPACING="12" CELLPADDING="0" BGCOLOR="#061529"><TR>'+
    '<TD VALIGN="TOP"><FONT FACE="Arial" COLOR="#FFD52A" POINT-SIZE="42">⚡</FONT></TD>'+
    '<TD ALIGN="LEFT" VALIGN="MIDDLE"><FONT FACE="Arial" COLOR="#F7F9FF" POINT-SIZE="30"><B>Графік відключень світла</B></FONT><BR/><FONT FACE="Arial" COLOR="#FFD52A" POINT-SIZE="23"><B>📍 Покровська 30Б</B></FONT><BR/><FONT FACE="Arial" COLOR="#B7CBE5" POINT-SIZE="16">Актуальний графік для вашої адреси</FONT></TD>'+
    '<TD ALIGN="LEFT" VALIGN="MIDDLE" BGCOLOR="#0B2038" COLOR="#294966" BORDER="1" CELLPADDING="12"><FONT FACE="Arial" COLOR="#49E68D" POINT-SIZE="15">● Оновлено</FONT><BR/><FONT FACE="Arial" COLOR="#F4F7FF" POINT-SIZE="13">'+escHtml(updated)+'</FONT></TD>'+
    '</TR></TABLE></TD></TR>'+
    '<TR><TD COLSPAN="2" ALIGN="LEFT" BGCOLOR="#0A1B30" CELLPADDING="18"><FONT FACE="Arial" COLOR="#FFD52A" POINT-SIZE="25">▦</FONT>  <FONT FACE="Arial" COLOR="#F7F9FF" POINT-SIZE="23"><B>Сьогодні</B></FONT><BR/><FONT FACE="Arial" COLOR="#C5D5EA" POINT-SIZE="17">'+escHtml(dateLabel)+'</FONT></TD></TR>'+
    '<TR><TD COLSPAN="2" CELLPADDING="12"><TABLE BORDER="0" CELLBORDER="0" CELLSPACING="14" CELLPADDING="0" BGCOLOR="#061529"><TR><TD VALIGN="TOP">'+scheduleColumn(left)+'</TD><TD WIDTH="1" BGCOLOR="#24415E"></TD><TD VALIGN="TOP">'+scheduleColumn(right)+'</TD></TR></TABLE></TD></TR>'+
    '<TR><TD COLSPAN="2" ALIGN="LEFT" BGCOLOR="#041124" CELLPADDING="12"><FONT FACE="Arial" COLOR="#9DB4D0" POINT-SIZE="12">Графік може змінюватися у разі аварійних ситуацій</FONT></TD></TR>'+
    '</TABLE>';
  const dot='digraph G { graph [bgcolor="#041124", pad="0.08", margin="0", nodesep="0", ranksep="0"]; node [shape=plain, margin="0"]; schedule [label=<'+html+'>]; }';
  return 'https://quickchart.io/graphviz?format=png&width=1400&height=1400&graph='+encodeURIComponent(dot);
}
async function chartDays(env){
  const n=localNow();
  const todayData=await loadDay(env,n.date);
  const days=[todayData],dates=[n.date];
  return {days,dates,url:chartUrl(days,dates,n.minute)};
}
async function publishOrUpdateChart(env,row){
  const {days,dates,url}=await chartDays(env);
  if(!days[0])return {ok:true,skipped:true};
  // Photo is intentionally image-only: no Telegram caption beneath it.
  if(row.photo_message_id){
    const edited=await safeJson(await tg(env,'editMessageMedia',{
      chat_id:row.group_chat_id,message_id:Number(row.photo_message_id),
      media:{type:'photo',media:url}
    }));
    if(edited?.ok||String(edited?.description||'').toLowerCase().includes('message is not modified')){
      await tg(env,'pinChatMessage',{chat_id:row.group_chat_id,message_id:Number(row.photo_message_id),disable_notification:true});
      return {ok:true,updated:true};
    }
    if(!String(edited?.description||'').toLowerCase().includes('message to edit not found')){
      console.warn('schedule chart edit failed:',edited?.description||'unknown Telegram error');
      return {ok:false,error:edited?.description||'Не вдалося оновити картинку'};
    }
  }
  const sent=await safeJson(await tg(env,'sendPhoto',{chat_id:row.group_chat_id,photo:url}));
  if(!sent?.ok)return {ok:false,error:sent?.description||'Не вдалося опублікувати картинку'};
  const messageId=Number(sent.result.message_id);
  await tg(env,'pinChatMessage',{chat_id:row.group_chat_id,message_id:messageId,disable_notification:true});
  await env.DB.prepare('UPDATE publications SET photo_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE group_chat_id=?').bind(messageId,row.group_chat_id).run();
  return {ok:true,created:true};
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
  return send(env,chat,chart.created?'✅ Текстове табло й графік світла закріплені. Надалі оновлюватимуться на місці.':'✅ Текстове табло й закріплений графік світла перевірені.');
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
export async function checkGroupRights(m,env){const chat=String(m.chat.id),me=await safeJson(await tg(env,'getMe',{}));if(!me?.ok)return;const x=await getBotChatRights(env,chat,me.result.id),row=await env.DB.prepare('SELECT message_id,photo_message_id FROM publications WHERE group_chat_id=?').bind(chat).first();return send(env,chat,`🔎 <b>Перевірка</b>\nСтатус: <b>${esc(x?.status||'—')}</b>\nПублікувати: ${x?.can_post_messages===false?'❌':'✅'}\nРедагувати: ${x?.can_edit_messages===false?'❌':'✅'}\n📌 Текст message_id: <code>${row?.message_id||'немає'}</code>\n🖼 Картинка message_id: <code>${row?.photo_message_id||'немає'}</code>`);}
