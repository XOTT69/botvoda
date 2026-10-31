import {getRawDay} from './db.js';
import {localNow,addDays} from './lib.js';
import {cardPayload,cardFingerprint} from './schedule-card-model.js';

export function photoStore(env,chat){
  const db=env.DB;
  return {
    get:()=>db.prepare('SELECT * FROM publications WHERE group_chat_id=?').bind(chat).first(),
    async claim(attempt,now){
      const r=await db.prepare(`UPDATE publications SET photo_state='working',photo_attempt=?,photo_attempt_at=?
        WHERE group_chat_id=? AND COALESCE(photo_state,'idle') NOT IN ('sending','uncertain')
        AND (COALESCE(photo_state,'idle')<>'working' OR COALESCE(photo_attempt_at,0)<?)`)
        .bind(attempt,now,chat,now-120000).run();
      return r.meta?.changes===1;
    },
    async set(attempt,fields){
      const allowed=new Set(['photo_state','photo_message_id','photo_fingerprint','photo_pinned','photo_error']);
      const entries=Object.entries(fields);
      if(entries.some(([key])=>!allowed.has(key)))throw new Error('Invalid photo state field');
      const result=await db.prepare('UPDATE publications SET '+entries.map(([key])=>key+'=?').join(',')+
        ',updated_at=CURRENT_TIMESTAMP WHERE group_chat_id=? AND photo_attempt=?')
        .bind(...entries.map(([,value])=>value),chat,attempt).run();
      if(result.meta?.changes!==1)throw new Error('Photo update ownership lost');
    }
  };
}

export function cardTelegram(env,chat,fetchFn=fetch){
  return async(method,{messageId,image}={})=>{
    if(!env.TELEGRAM_BOT_TOKEN)throw new Error('Missing existing bot token');
    const form=new FormData();form.set('chat_id',String(chat));
    if(messageId)form.set('message_id',String(messageId));
    if(method==='pinChatMessage')form.set('disable_notification','true');
    else {
      form.set('reply_markup',JSON.stringify({inline_keyboard:[]}));
      if(method==='sendPhoto'){
        form.set('disable_notification','true');
        form.set('photo',new Blob([image],{type:'image/png'}),'schedule-2-2.png');
      }else{
        form.set('media',JSON.stringify({type:'photo',media:'attach://graphic'}));
        form.set('graphic',new Blob([image],{type:'image/png'}),'schedule-2-2.png');
      }
    }
    const response=await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
      method:'POST',body:form,signal:AbortSignal.timeout(20000)});
    let body;
    try{body=await response.json();}catch{throw new Error('Telegram result unknown');}
    if(!response.ok||!body?.ok){
      const error=new Error(String(body?.description||'Telegram request failed').slice(0,180));
      error.definitelyRejected=response.status>=400&&response.status<500&&response.status!==408;
      error.missing=method==='editMessageMedia'&&response.status===400&&/message to edit not found/i.test(error.message);
      throw error;
    }
    return body.result;
  };
}

export async function runCardPublication({store,payload,render,telegram,now=Date.now()}){
  const hash=await cardFingerprint(payload);
  let row=await store.get();
  if(!row)return {ok:false,error:'Publication is not configured'};
  if(['sending','uncertain'].includes(row.photo_state))return {ok:true,pending:true};
  if(row.photo_message_id&&row.photo_fingerprint===hash&&row.photo_pinned)
    return {ok:true,unchanged:true};
  const attempt=crypto.randomUUID();
  if(!await store.claim(attempt,now))return {ok:true,busy:true};
  row=await store.get();
  let phase='working';
  try{
    let messageId=Number(row.photo_message_id)||null;
    const same=messageId&&row.photo_fingerprint===hash;
    if(!same){
      const image=await render(payload);
      // A rendering lease can expire after a crashed invocation. Verify
      // ownership again before any Telegram request from this invocation.
      await store.set(attempt,{photo_state:'working'});
      if(messageId){
        try{await telegram('editMessageMedia',{messageId,image});}
        catch(error){
          if(!error.missing)throw error;
          messageId=null;
          await store.set(attempt,{photo_message_id:null,photo_pinned:0});
        }
      }
      if(!messageId){
        // Persist BEFORE sending. An unknown send outcome blocks automatic
        // retries, even if Telegram accepted the photo but D1 write failed.
        await store.set(attempt,{photo_state:'sending'});phase='sending';
        const sent=await telegram('sendPhoto',{image});
        if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<1)throw new Error('Photo delivery unknown');
        messageId=sent.message_id;
        await store.set(attempt,{photo_message_id:messageId,photo_fingerprint:hash,photo_pinned:0,photo_state:'working'});
        phase='working';
      }else await store.set(attempt,{photo_fingerprint:hash});
    }
    // Save message ID before pinning; a rights failure cannot create a duplicate.
    if(!row.photo_pinned||messageId!==Number(row.photo_message_id)){
      await telegram('pinChatMessage',{messageId});
    }
    await store.set(attempt,{photo_state:'idle',photo_error:null,photo_pinned:1});
    return {ok:true,messageId,updated:!same};
  }catch(error){
    const pending=phase==='sending'&&!error.definitelyRejected;
    try{await store.set(attempt,{photo_state:pending?'uncertain':'idle',photo_error:String(error?.message||error).slice(0,180)});}catch{}
    console.warn('Pinned schedule card:',String(error?.message||error));
    return {ok:false,pending,error:pending?'Результат відправки невідомий. Повтор заблоковано.':String(error?.message||error)};
  }
}

export function selectCardTarget(rows,configuredId){
  if(configuredId){
    const matches=rows.filter(row=>String(row.group_chat_id)===String(configuredId));
    if(matches.length!==1)throw new Error('Configured schedule card channel is not uniquely linked');
    return String(matches[0].group_chat_id);
  }
  const matches=rows.filter(row=>{
    const title=String(row.group_title||'').normalize('NFKC').toLocaleLowerCase('uk-UA');
    return /покровськ/u.test(title)&&/(?:^|[^\d])30\s*[-–—]?\s*[бb](?=$|[^\p{L}\p{N}])/u.test(title);
  });
  if(matches.length!==1)throw new Error('Expected exactly one linked Pokrovska 30B channel; refusing photo publication');
  return String(matches[0].group_chat_id);
}

export async function publishScheduleCard(env,row){
  const linked=await env.DB.prepare('SELECT group_chat_id,group_title FROM publications').all();
  const target=selectCardTarget(linked.results||[],env.SCHEDULE_CARD_CHAT_ID);
  if(String(row.group_chat_id)!==target)return {ok:true,skipped:true,otherChat:true};
  const now=new Date(),today=localNow(now,'Europe/Kyiv').date;
  // Use confirmed 2.2 directly: the water subgroup 1.2 must not decide
  // whether a valid power timetable can appear in this card.
  const [a,b]=await Promise.all([getRawDay(env,today),getRawDay(env,addDays(today,1))]);
  const payload=cardPayload(a.rows['2.2']?.intervals??null,b.rows['2.2']?.intervals??null,now);
  if(!env.SCHEDULE_CARD_RENDERER)throw new Error('Missing PNG renderer binding');
  const renderer=env.SCHEDULE_CARD_RENDERER.get(env.SCHEDULE_CARD_RENDERER.idFromName('schedule-2.2'));
  return runCardPublication({store:photoStore(env,String(row.group_chat_id)),payload,
    telegram:cardTelegram(env,row.group_chat_id),render:async value=>{
      const result=await renderer.fetch('https://renderer.internal/',{method:'POST',body:JSON.stringify(value)});
      if(!result.ok||!result.headers.get('content-type')?.startsWith('image/png'))throw new Error('Schedule PNG rendering failed');
      const bytes=new Uint8Array(await result.arrayBuffer());
      if(bytes.length<1000||bytes.length>10*1024*1024||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))
        throw new Error('Invalid schedule PNG');
      return bytes;
    }});
}
