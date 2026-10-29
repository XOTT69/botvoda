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
    if(a>cursor)out.push({minutes:a-cursor,on:false});
    if(b>a)out.push({minutes:b-a,on:true});
    cursor=Math.max(cursor,b);
  }
  if(cursor<1440)out.push({minutes:1440-cursor,on:false});
  return out;
}
function chartUrl(days,dates){
  const segments=days.map(timelineSegments),count=Math.max(1,...segments.map(x=>x.length));
  const datasets=Array.from({length:count},(_,i)=>({
    label:'Проміжок '+(i+1),
    // Use hours (not minutes) so QuickChart's axis is legible without JS callbacks.
    data:segments.map(x=>(x[i]?.minutes||0)/60),
    backgroundColor:segments.map(x=>x[i]?.on?'#20d69a':'#ff5263'),
    borderWidth:0,
    barPercentage:0.72,
    categoryPercentage:0.8
  }));
  const config={
    type:'horizontalBar',
    data:{labels:dates.map((d,i)=>(i===0?'СЬОГОДНІ • ':'ЗАВТРА • ')+d.split('-').reverse().join('.')),datasets},
    options:{
      responsive:false,maintainAspectRatio:false,
      layout:{padding:{left:18,right:24,top:18,bottom:12}},
      title:{display:true,text:'ПОКРОВСЬКА 30Б • СВІТЛО 2.2',fontColor:'#f4f7ff',fontSize:22,fontStyle:'bold',padding:18},
      legend:{display:false},
      tooltips:{enabled:false},
      scales:{
        xAxes:[{stacked:true,scaleLabel:{display:true,labelString:'ГОДИНИ ДОБИ',fontColor:'#d7deef'},gridLines:{color:'rgba(255,255,255,.12)'},ticks:{min:0,max:24,stepSize:3,fontColor:'#d7deef'}}],
        yAxes:[{stacked:true,gridLines:{display:false},ticks:{fontColor:'#f4f7ff',fontSize:14,fontStyle:'bold'}}]
      }
    },
    plugins:[]
  };
  const base='https://quickchart.io/chart';
  return base+'?version=2.9.4&width=1000&height='+((days.length>1)?440:330)+'&devicePixelRatio=2&format=png&backgroundColor=%23101520&c='+encodeURIComponent(JSON.stringify(config));
}
async function chartDays(env){
  const n=localNow(),tomorrow=addDays(n.date,1);
  const [todayData,tomorrowData]=await Promise.all([loadDay(env,n.date),loadDay(env,tomorrow)]);
  const days=[todayData],dates=[n.date];
  if(tomorrowData){days.push(tomorrowData);dates.push(tomorrow);}
  return {days,dates,url:chartUrl(days,dates),updated:fmtUpdated(todayData?.updatedAt,TZ)};
}
async function publishOrUpdateChart(env,row){
  const {days,dates,url,updated}=await chartDays(env);
  if(!days[0])return {ok:true,skipped:true};
  const dateLabel=dates.map((d,i)=>(i===0?'Сьогодні':'Завтра')+' • '+d.split('-').reverse().join('.')).join('  |  ');
  const caption='⚡ <b>Графік світла 2.2</b>\n📍 Покровська 30Б\n📅 '+esc(dateLabel)+(updated?'\n🕒 Дані графіка оновлено: '+esc(updated):'')+'\n\n🟢 Світло є  ·  🔴 Відключення';
  if(row.photo_message_id){
    const edited=await safeJson(await tg(env,'editMessageMedia',{
      chat_id:row.group_chat_id,message_id:Number(row.photo_message_id),
      media:{type:'photo',media:url,caption,parse_mode:'HTML'}
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
  const sent=await safeJson(await tg(env,'sendPhoto',{chat_id:row.group_chat_id,photo:url,caption,parse_mode:'HTML'}));
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
  return send(env,chat,chart.ok?'✅ Текстове табло та окрема картинка графіка закріплені.':'⚠️ Текстове табло закріплено, але картинку не вдалося оновити: <code>'+esc(chart.error||'невідома помилка')+'</code>');
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
  // Keep the image synchronized even when only the pinned text changed (or a new day began).
  const chart=await publishOrUpdateChart(env,row);
  if(!chart.ok)return {ok:false,error:chart.error||'Не вдалося оновити картинку графіка'};
  return {ok:true,unchanged:!textChanged,chart};
}
export async function checkGroupRights(m,env){const chat=String(m.chat.id),me=await safeJson(await tg(env,'getMe',{}));if(!me?.ok)return;const x=await getBotChatRights(env,chat,me.result.id),row=await env.DB.prepare('SELECT message_id,photo_message_id FROM publications WHERE group_chat_id=?').bind(chat).first();return send(env,chat,`🔎 <b>Перевірка</b>\nСтатус: <b>${esc(x?.status||'—')}</b>\nПублікувати: ${x?.can_post_messages===false?'❌':'✅'}\nРедагувати: ${x?.can_edit_messages===false?'❌':'✅'}\n📌 Текст message_id: <code>${row?.message_id||'немає'}</code>\n🖼 Картинка message_id: <code>${row?.photo_message_id||'немає'}</code>`);}
