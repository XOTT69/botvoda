export const DAY=1440;
export const DEFAULT_WATER=[[360,600],[720,840],[1080,1440]];

export function normalize(xs=[]){
  const a=xs.map(([s,e])=>[Math.max(0,+s),Math.min(DAY,+e)]).filter(([s,e])=>Number.isFinite(s)&&Number.isFinite(e)&&s<e).sort((x,y)=>x[0]-y[0]);
  const out=[];
  for(const x of a){
    const p=out.at(-1);
    if(p&&x[0]<=p[1])p[1]=Math.max(p[1],x[1]);
    else out.push([...x]);
  }
  return out;
}
export function complement(xs=[]){
  const a=normalize(xs),out=[];let p=0;
  for(const [s,e] of a){if(p<s)out.push([p,s]);p=Math.max(p,e)}
  if(p<DAY)out.push([p,DAY]);
  return out;
}
export function union(...sets){return normalize(sets.flat())}
export function intersect(a=[],b=[]){
  a=normalize(a);b=normalize(b);const out=[];let i=0,j=0;
  while(i<a.length&&j<b.length){
    const s=Math.max(a[i][0],b[j][0]),e=Math.min(a[i][1],b[j][1]);
    if(s<e)out.push([s,e]);
    if(a[i][1]<b[j][1])i++;else j++;
  }
  return out;
}
export const total=xs=>normalize(xs).reduce((n,[s,e])=>n+e-s,0);
export const fmt=m=>m===1440?'24:00':`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
export const formatIntervals=xs=>xs?.length?normalize(xs).map(([s,e])=>`${fmt(s)}–${fmt(e)}`).join(' · '):'—';
export function duration(m){m=Math.max(0,Math.round(m));const h=Math.floor(m/60),r=m%60;return h?(r?`${h} год ${r} хв`:`${h} год`):`${r} хв`;}
export function countdown(m){return m<=0?'зараз':duration(m)}
export function inIntervals(xs=[],minute=0){return normalize(xs).some(([s,e])=>minute>=s&&minute<e)}

export function extractIntervals(text=''){
  const out=[];
  const re=/(?:з\s*)?(\d{1,2})[:.](\d{2})\s*(?:до|[-–—])\s*(\d{1,2})[:.](\d{2})/giu;
  let m;
  while((m=re.exec(text))){
    let s=+m[1]*60 + +m[2],e=+m[3]*60 + +m[4];
    if(+m[3]===24)e=1440;
    if(s<e&&s<=1440&&e<=1440)out.push([s,e]);
  }
  return normalize(out);
}
function dateFromText(text=''){
  const m=text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/);
  return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;
}
function sections(text=''){
  const re=/підгрупа\s+(\d\.\d)[^\n]*:[\s\S]*?(?=(?:\n\s*💡?\s*підгрупа\s+\d\.\d)|$)/giu;
  const out=[];let m;
  while((m=re.exec(text)))out.push({group:m[1],body:m[0]});
  return out;
}
function classifyIntervals(body=''){
  const confirmed=[],possible=[];
  let classified=0;
  for(const line of body.split(/\r?\n/)){
    const xs=extractIntervals(line);
    if(!xs.length)continue;
    const maybe=/🟡|⚠️|можлив|ймовір|імовір|може\s+бути/iu.test(line);
    const definite=/❌|відключ/i.test(line)||!maybe;
    if(maybe){possible.push(...xs);classified+=xs.length}
    else if(definite){confirmed.push(...xs);classified+=xs.length}
  }
  if(!classified)return {intervals:extractIntervals(body),possibleIntervals:[]};
  return {intervals:normalize(confirmed),possibleIntervals:normalize(possible)};
}
export function parsePowerMessage(text=''){
  const date=dateFromText(text);if(!date)return null;
  const kind=/зміни\s+у\s+графіку/iu.test(text)?'changes':'full';
  const items=[];
  for(const s of sections(text)){
    if(s.group!=='1.2'&&s.group!=='2.2')continue;
    let body=s.body;
    if(kind==='changes'){
      const i=body.search(/стало\s*:/iu);
      if(i<0)continue;
      body=body.slice(i).replace(/^[\s\S]*?стало\s*:/iu,'');
    }
    const {intervals,possibleIntervals}=classifyIntervals(body);
    items.push({group:s.group,intervals,possibleIntervals});
  }
  return items.length?{date,mode:'off',kind,items}:null;
}

export function availability(power12,power22,fallback=DEFAULT_WATER){
  const water=union(power12,fallback);
  const both=intersect(water,power22);
  let best=null;
  for(const x of both)if(!best||x[1]-x[0]>best[1]-best[0])best=x;
  return {water,both,best,power12:normalize(power12),power22:normalize(power22)};
}

export function statusAt(a,minute){
  const state={
    water:inIntervals(a.water,minute),
    power:inIntervals(a.p22||a.power22||[],minute),
  };
  state.both=state.water&&state.power;
  const boundaries=[...new Set([
    ...normalize(a.water).flat(),
    ...normalize(a.p22||a.power22||[]).flat(),
    DAY
  ].filter(x=>x>minute&&x<=DAY))].sort((x,y)=>x-y);
  let next=null;
  for(const b of boundaries){
    const before={water:inIntervals(a.water,Math.max(0,b-1)),power:inIntervals(a.p22||a.power22||[],Math.max(0,b-1))};
    before.both=before.water&&before.power;
    const after={water:b<DAY&&inIntervals(a.water,b),power:b<DAY&&inIntervals(a.p22||a.power22||[],b)};
    after.both=after.water&&after.power;
    if(before.water!==after.water||before.power!==after.power||before.both!==after.both){
      next={minute:b,before,after};break;
    }
  }
  return {current:state,next};
}

export function nextChangeLabel(next){
  if(!next)return 'До кінця доби змін не очікується';
  const {before,after}=next;
  if(!before.both&&after.both)return 'будуть одночасно вода і світло';
  if(before.both&&!after.both){
    if(before.water&&!after.water&&before.power&&!after.power)return 'зникнуть вода і світло';
    if(before.water&&!after.water)return 'зникне вода';
    if(before.power&&!after.power)return 'зникне світло';
  }
  if(!before.water&&after.water)return 'з’явиться вода';
  if(before.water&&!after.water)return 'зникне вода';
  if(!before.power&&after.power)return 'з’явиться світло';
  if(before.power&&!after.power)return 'зникне світло';
  return 'зміниться графік';
}

export function buildEvents(a,settings,date,nextDay=null){
  const ev=[];
  const add=(key,minute,text)=>{if(minute>=0&&minute<=DAY)ev.push({key:`${date}:${key}`,minute,text})};
  const lead=Number(settings.lead_minutes||30);
  const minWindow=Number(settings.min_window_minutes||0);

  const continuation=(kind,e)=>{
    if(e!==DAY||!nextDay)return null;
    const xs=normalize(nextDay[kind]||[]);
    const first=xs.find(([s])=>s===0);
    return first?first[1]:null;
  };
  const spanText=(s,e,nextEnd)=>{
    if(nextEnd!=null)return `${fmt(s)}–${fmt(nextEnd)} наступного дня`;
    return `${fmt(s)}–${fmt(e)}`;
  };
  const spanDuration=(s,e,nextEnd)=>nextEnd!=null?(DAY-s)+nextEnd:e-s;

  if(settings.both_alerts){
    for(const [s,e] of a.both){
      const nextEnd=continuation('both',e);
      const len=spanDuration(s,e,nextEnd);
      if(len<minWindow)continue;
      add(`both-start-${s}`,s-lead,`⚡💧 Через ${lead} хв почнеться період вода + світло\n${spanText(s,e,nextEnd)} · ${duration(len)}`);
      if(settings.end_alerts&&!nextEnd)add(`both-end-${e}`,e-lead,`⚠️ Через ${lead} хв завершиться період вода + світло (${fmt(e)})`);
    }
  }

  if(settings.water_alerts){
    for(const [s,e] of a.water){
      const nextEnd=continuation('water',e);
      const len=spanDuration(s,e,nextEnd);
      if(len<minWindow)continue;
      if(!a.both.some(([bs])=>bs===s))add(`water-start-${s}`,s-lead,`💧 Через ${lead} хв буде вода\n${spanText(s,e,nextEnd)} · ${duration(len)}`);
    }
  }
  return ev;
}

export function diffMinutes(before,after){return total(after)-total(before)}
export function addDays(iso,n){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function localNow(date=new Date(),tz='Europe/Kyiv'){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,minute:+p.hour*60 + +p.minute};
}
export const humanDate=iso=>{const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`};
