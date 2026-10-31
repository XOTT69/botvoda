import {cardPayload} from './schedule-card-model.js';
// A review-only Preview: no D1 binding, Telegram calls, webhooks or cron work.
export async function previewResponse(request,env){
  const url=new URL(request.url);
  if(request.method!=='GET')return new Response('Preview is read-only',{status:405});
  if(url.pathname==='/')return new Response(
    'Botvoda preview — лише демонстрація дизайну.\n'+
    'Години вигадані, це не актуальний графік.\n\n'+
    '/preview-card.png?days=1 — сьогодні\n'+
    '/preview-card.png?days=2 — сьогодні та завтра\n\n'+
    'Telegram, cron і production D1 тут не підключені.\n',
    {headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  if(url.pathname!=='/preview-card.png')return new Response('Not found',{status:404});
  if(!env.SCHEDULE_CARD_RENDERER)return new Response('Preview renderer unavailable',{status:503});
  const twoDays=url.searchParams.get('days')!=='1';
  const payload={...cardPayload([[720,1170]],twoDays?[[360,810]]:null,
    new Date('2026-10-31T22:20:00Z')),demo:true};
  const stub=env.SCHEDULE_CARD_RENDERER.get(env.SCHEDULE_CARD_RENDERER.idFromName('preview-card'));
  return stub.fetch('https://renderer.internal/',{method:'POST',body:JSON.stringify(payload)});
}
