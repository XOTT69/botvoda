import {validateCard} from './schedule-card-model.js';
// The namespace is called only by this Worker's internal binding, never by a public route.
// Rendering runs under the Durable Object CPU budget instead of the Worker cron CPU budget.
export class ScheduleCardRenderer {
  async fetch(request){
    if(request.method!=='POST')return new Response('Not found',{status:404});
    let payload;
    try{payload=validateCard(await request.json());}
    catch{return new Response('Invalid schedule card',{status:400});}
    try{
      const {renderScheduleCardPng}=await import('./schedule-card-renderer.js');
      const png=await renderScheduleCardPng(payload);
      return new Response(png,{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}});
    }catch(error){
      console.error('Schedule card renderer failed:',String(error?.message||error));
      return new Response('PNG rendering failed',{status:500});
    }
  }
}
