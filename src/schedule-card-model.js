import {addDays,localNow} from './lib.js';
export const CARD_VERSION=6;
export const nextDate=date=>addDays(date,1);
export function validDate(date){
  return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&
    Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
}
export function validatedPeriods(rows){
  if(!Array.isArray(rows))return null;
  const result=[];let previous=0;
  for(const row of rows){
    if(!Array.isArray(row)||row.length!==2)return null;
    const [start,end]=row;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<previous||start<0||end>1440||start>=end||start%30||end%30)return null;
    // Adjacent outages are one continuous period.
    if(result.length&&result.at(-1)[1]===start)result.at(-1)[1]=end;
    else result.push([start,end]);
    previous=end;
  }
  return result;
}
export function humanDate(date){
  return new Intl.DateTimeFormat('uk-UA',{timeZone:'UTC',weekday:'long'}).format(new Date(date+'T12:00:00Z'));
}
export function validateCard(payload){
  if(!payload||!validDate(payload.today)||
    (payload.tomorrow!==null&&(!validDate(payload.tomorrow)||nextDate(payload.today)!==payload.tomorrow))||
    (payload.todayPeriods!==null&&validatedPeriods(payload.todayPeriods)===null)||
    (payload.tomorrow===null?payload.tomorrowPeriods!==null:validatedPeriods(payload.tomorrowPeriods)===null)||
    typeof payload.updatedAt!=='string'||!Number.isFinite(Date.parse(payload.updatedAt)))throw new Error('Invalid schedule card');
  return payload;
}
export function cardPayload(todayOff,tomorrowOff,now=new Date()){
  const today=localNow(now,'Europe/Kyiv').date;
  const todayPeriods=todayOff===null?null:validatedPeriods(todayOff);
  const tomorrowPeriods=tomorrowOff===null?null:validatedPeriods(tomorrowOff);
  if(todayOff!==null&&todayPeriods===null)throw new Error('Invalid confirmed schedule today');
  if(tomorrowOff!==null&&tomorrowPeriods===null)throw new Error('Invalid confirmed schedule tomorrow');
  return validateCard({today,todayPeriods,tomorrow:tomorrowPeriods===null?null:nextDate(today),
    tomorrowPeriods,updatedAt:now.toISOString()});
}
export async function cardFingerprint(payload){
  validateCard(payload);
  const data=JSON.stringify({version:CARD_VERSION,today:payload.today,todayPeriods:payload.todayPeriods,
    tomorrow:payload.tomorrow,tomorrowPeriods:payload.tomorrowPeriods});
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
