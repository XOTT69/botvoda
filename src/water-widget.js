import {tg,safeJson,send,webhookSecret} from './telegram.js';
import {getSetting,setSetting,ensureUser,trackUserProfile,markNotificationsTouched} from './db.js';
import {notifyMenu} from './notifications.js';
import {refreshPublications} from './publications.js';
import {saveCommunityWaterReport} from './water-reports.js';
import {loadWaterWidgetState,serializeWaterState,unpackIntervals} from './water-widget-model.js';
import {WATER_WIDGET_HTML} from './water-widget-html.js';
import {formatIntervals,humanDate} from './lib.js';

export const WATER_WIDGET_UPDATES=['message','channel_post','callback_query','widget_query'];

// Existing webhooks opt into specific update types. Add widget_query without
// changing their URL, pending updates, connections, or existing subscriptions.
export async function ensureWaterWidgetWebhook(env){
  if(await getSetting(env,'water_widget_webhook_v1')==='ready')return true;
  const info=await safeJson(await tg(env,'getWebhookInfo',{}));
  if(!info?.ok||!info.result?.url)return false;
  const current=info.result;
  if(!current.allowed_updates?.includes('widget_query')){
    const r=await safeJson(await tg(env,'setWebhook',{
      url:current.url,
      ...(env.TELEGRAM_WEBHOOK_SECRET?{secret_token:await webhookSecret(env)}:{}),
      ...(current.max_connections?{max_connections:current.max_connections}:{}),
      allowed_updates:[...new Set([...(current.allowed_updates?.length?current.allowed_updates:WATER_WIDGET_UPDATES),'widget_query'])],
      drop_pending_updates:false
    }));
    if(!r?.ok)return false;
  }
  await setSetting(env,'water_widget_webhook_v1','ready');
  return true;
}

function fallback(state){
  const status=state.c===null?'немає підтверджених даних':state.c?(state.o==='manual'?'вода є':'вода має бути'):'води немає';
  const hours=state.w===null?'Підтверджений графік ще очікується.':formatIntervals(unpackIntervals(state.w));
  return `💧 <b>Чабани · вода</b>\n\nЗараз: <b>${status}</b> (${state.o==='manual'?'стан від адміністратора':'за графіком'}).\n\n📅 <b>${humanDate(state.d)}</b>\n${hours}\n\nГрафік — прогноз. Фактичний стан може відрізнятися.\n\nІнтерактивна картка поки недоступна. /dashboard — спробувати ще раз.`;
}

const FALLBACK_ACTIONS={inline_keyboard:[[{text:'💧 Вода є',callback_data:'wr:on'},{text:'🚱 Води немає',callback_data:'wr:off'}],[{text:'Стан за повідомленнями мешканців',callback_data:'wr:view'}]]};

export async function sendWaterWidget(env,chat,selected=0,keyboard){
  const state=await loadWaterWidgetState(env,selected);
  if(env.WATER_WIDGET_ENABLED==='off')return send(env,chat,fallback(state),{reply_markup:FALLBACK_ACTIONS});
  try{
    if(!await ensureWaterWidgetWebhook(env))throw new Error('Widget updates unavailable');
    const r=await safeJson(await tg(env,'sendWidget',{
      chat_id:String(chat),html:WATER_WIDGET_HTML,chat_data:serializeWaterState(state),allow_queries:true,
      caption:'💧 Чабани · вода. Якщо картка не відображається, оновіть Telegram. Текстовий графік: /today.',
      ...(keyboard?{reply_markup:keyboard}:{})
    }));
    if(r?.ok)return r;
    console.warn('water widget: Telegram declined sendWidget');
  }catch{
    console.warn('water widget: could not send interactive card');
  }
  return send(env,chat,fallback(state),{reply_markup:FALLBACK_ACTIONS});
}

const actions=/^w:(today|tomorrow|(?:refresh|on|off|notify):[01])$/;
export async function handleWaterWidgetQuery(query,env){
  const reply=message=>tg(env,'answerWidgetQuery',{widget_query_id:query.id,data:JSON.stringify({message})});
  // Only the authenticated Telegram sender may report their own status.
  if(query.chat?.type!=='private'||String(query.chat.id)!==String(query.from?.id)||
    !Number.isInteger(query.message_id)||query.type?.type!=='data'||!actions.test(query.data||'')){
    return reply('Ця дія недоступна. Відкрийте /dashboard у приватному чаті.');
  }
  if(env.WATER_WIDGET_ENABLED==='off')return reply('Картка тимчасово вимкнена. Скористайтеся /today.');
  const chat=String(query.chat.id),[,action,arg]=query.data.split(':'),selected=action==='tomorrow'?1:action==='today'?0:Number(arg);
  let message='Оновлено',saved=false,answered=false;
  try{
    if(action==='on'||action==='off'){
      saved=await saveCommunityWaterReport(env,query.from.id,action);
      message=saved?'Дякуємо! Ваше повідомлення враховано.':'Ви вже повідомляли нещодавно. Спробуйте пізніше.';
    }
    const state=await loadWaterWidgetState(env,selected);
    const result=await safeJson(await tg(env,'editMessageWidgetData',{
      chat_id:chat,message_id:query.message_id,chat_data:serializeWaterState(state)
    }));
    if(!result?.ok&&!/message is not modified/i.test(result?.description||'')){
      message=saved?'Повідомлення враховано. Для оновлення картки натисніть ↻.':'Не вдалося оновити картку. Спробуйте ще раз.';
    }
    // Answer before channel refreshes or notification menus: Telegram allows 15s.
    await reply(action==='notify'?'Налаштування сповіщень — нижче в чаті.':message);
    answered=true;
    if(action==='notify'){
      await ensureUser(env,chat);await markNotificationsTouched(env,chat);
      await notifyMenu(env,chat);
    }
    // Passive background refreshes are not user activity.
    if(action!=='refresh')await trackUserProfile(env,query.from,null);
    if(saved)await refreshPublications(env);
  }catch(error){
    console.warn('water widget query failed:',error?.name||'Error');
    if(answered)return;
    return reply(saved?'Повідомлення враховано. Оновіть картку пізніше.':'Не вдалося оновити. Спробуйте ще раз.');
  }
}
