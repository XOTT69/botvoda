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
  const groups=days.map((day,i)=>({date:dates[i],title:i===0?'СЬОГОДНІ':'ЗАВТРА',items:timelineSegments(day)}));
  const current=(groups[0]?.items||[]).find(s=>minuteNow>=s.start&&minuteNow<s.end);
  const nowOn=Boolean(current?.on);
  const updated=new Intl.DateTimeFormat('uk-UA',{timeZone:TZ,day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  const rows=[];
  for(const g of groups)for(const seg of g.items)rows.push({date:g.date,day:g.title,start:hhmm(seg.start),end:hhmm(seg.end),on:seg.on});
  const half=Math.ceil(rows.length/2),left=rows.slice(0,half),right=rows.slice(half);
  const pairCount=Math.max(left.length,right.length);
  const labels=[],leftData=[],rightData=[],leftColors=[],rightColors=[];
  for(let i=0;i<pairCount;i++){
    const l=left[i],r=right[i];
    labels.push(l?l.start+' – '+l.end:'');
    leftData.push(l?1:0);rightData.push(r?1:0);
    leftColors.push(l?(l.on?'rgba(40,223,145,.22)':'rgba(255,92,112,.22)'):'rgba(0,0,0,0)');
    rightColors.push(r?(r.on?'rgba(40,223,145,.22)':'rgba(255,92,112,.22)'):'rgba(0,0,0,0)');
  }
  const config={
    type:'horizontalBar',
    data:{labels,datasets:[
      {label:'Ліва колонка',data:leftData,backgroundColor:leftColors,borderColor:left.map(x=>x?(x.on?'#28df91':'#ff5c70'):'rgba(0,0,0,0)'),borderWidth:2,barPercentage:.84,categoryPercentage:.9},
      {label:'Права колонка',data:rightData,backgroundColor:rightColors,borderColor:right.map(x=>x?(x.on?'#28df91':'#ff5c70'):'rgba(0,0,0,0)'),borderWidth:2,barPercentage:.84,categoryPercentage:.9}
    ]},
    options:{
      responsive:false,maintainAspectRatio:false,
      layout:{padding:{left:30,right:30,top:22,bottom:22}},
      title:{display:true,text:['⚡  ГРАФІК ВІДКЛЮЧЕНЬ СВІТЛА','📍 ПОКРОВСЬКА 30Б  •  ГРУПА 2.2',nowOn?'●  ЗАРАЗ СВІТЛО Є':'●  ЗАРАЗ СВІТЛА НЕМАЄ','ОНОВЛЕНО  •  '+updated],fontColor:'#f4f7ff,fontSize:25,fontStyle:'bold',padding:18},
      legend:{display:false},tooltips:{enabled:false},
      scales:{
        xAxes:[{stacked:false,display:false,gridLines:{display:false},ticks:{display:false,min:0,max:1}}],
        yAxes:[{stacked:false,gridLines:{display:false},ticks:{fontColor:'#f4f7ff',fontSize:17,fontStyle:'bold',autoSkip:false,padding:12}}]
      }
    }
  };
  const height=Math.max(700,Math.min(1600,320+pairCount*54));
  return 'https://quickchart.io/chart?version=2.9.4&width=1400&height='+height+'&devicePixelRatio=2&format=png&backgroundColor=%23041124&c='+encodeURIComponent(JSON.stringify(config));
}
async function chartDays(env){
  const n=localNow(),tomorrow=addDays(n.date,1);
  const [todayData,tomorrowData]=await Promise.all([loadDay(env,n.date),loadDay(env,tomorrow)]);
  const days=[todayData],dates=[n.date];
  if(tomorrowData){days.push(tomorrowData);dates.push(tomorrow);}
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
  return send(env,chat,chart.ok?'✅ Текстове табло та картинка графіка закріплені.':'⚠️ Текстове табло закріплено, але картинку не вдалося оновити: <code>'+esc(chart.error||'невідома помилка')+'</code>');
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
