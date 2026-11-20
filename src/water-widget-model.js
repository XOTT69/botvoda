import {addDays,complement,inIntervals,localNow,normalize,total,union} from './lib.js';
import {getManualWaterStatus,getRawDay,getWaterRule} from './db.js';
import {getCommunityWaterReports} from './water-reports.js';

// Base 36 keeps even a fragmented half-hour schedule inside Telegram's 1 KB state.
export const packIntervals=xs=>normalize(xs).map(x=>x.map(n=>n.toString(36)).join('-')).join('.');
export const unpackIntervals=s=>s?s.split('.').map(x=>x.split('-').map(n=>parseInt(n,36))):[];

export function waterDay(raw,rule,date){
  const row=raw.rows?.['1.2'];
  const water=row?union(complement(row.intervals),rule.intervals):null;
  return {date,water,fallback:normalize(rule.intervals),possible:normalize(raw.possible?.['1.2']||[]),
    updatedAt:[row?.created_at,rule.updatedAt].filter(Boolean).sort().at(-1)||null};
}

// Only genuine water transitions count. Midnight is not a shutoff if water
// continues into a confirmed tomorrow; an unknown tomorrow stays unknown.
export function nextWaterChange(today,tomorrow,minute){
  if(today.water===null)return null;
  const current=inIntervals(today.water,minute);
  const candidates=normalize(today.water).flat().filter(x=>x>minute&&x<1440);
  if(tomorrow.water!==null){
    candidates.push(1440,...normalize(tomorrow.water).flat().filter(x=>x<1440).map(x=>x+1440));
  }
  for(const boundary of [...new Set(candidates)].sort((a,b)=>a-b)){
    const on=inIntervals(boundary<1440?today.water:tomorrow.water,boundary%1440);
    if(on!==current)return [boundary,on?1:0];
  }
  return null;
}

export function waterWidgetState({today,tomorrow,manual,community,now=new Date(),selected=0}){
  const local=localNow(now),day=selected?tomorrow:today;
  const override=['on','off'].includes(manual?.state);
  return {v:1,t:Math.floor(now.getTime()/1000),k:selected?1:0,d:day.date,m:local.minute,
    w:day.water===null?null:packIntervals(day.water),f:packIntervals(day.fallback),p:packIntervals(day.possible),
    h:day.water===null?null:total(day.water),
    c:override?(manual.state==='on'?1:0):today.water===null?null:inIntervals(today.water,local.minute)?1:0,
    o:override?'manual':'schedule',x:nextWaterChange(today,tomorrow,local.minute),
    a:[community?.on||0,community?.off||0]};
}

export async function loadWaterWidgetState(env,selected=0,now=new Date()){
  const local=localNow(now),dates=[local.date,addDays(local.date,1)];
  const [today,tomorrow,manual,community]=await Promise.all([
    ...dates.map(async date=>{
      const [raw,rule]=await Promise.all([getRawDay(env,date),getWaterRule(env,date)]);
      return waterDay(raw,rule,date);
    }),getManualWaterStatus(env),getCommunityWaterReports(env)
  ]);
  return waterWidgetState({today,tomorrow,manual,community,now,selected});
}

export function serializeWaterState(state){
  const data=JSON.stringify(state);
  if(new TextEncoder().encode(data).byteLength>1024)throw new Error('Water widget state exceeds 1024 bytes');
  return data;
}

export function demoWaterState(selected=0,kind='on'){
  const today={date:'2026-11-20',water:[[360,840],[1080,1440]],fallback:[[360,540],[720,840],[1080,1320]],possible:[],updatedAt:'2026-11-20 10:15:00'};
  const tomorrow={...today,date:'2026-11-21',water:[[0,120],[360,600],[720,1440]]};
  if(kind==='unknown'){today.water=null;tomorrow.water=null;}
  if(kind==='off')today.water=[[360,540],[720,840],[1080,1320]];
  return waterWidgetState({today,tomorrow,manual:{state:'auto'},community:{on:7,off:1,latestAt:'2026-11-20 10:12:00'},
    now:new Date(kind==='off'?'2026-11-20T13:15:00Z':'2026-11-20T10:15:00Z'),selected});
}
