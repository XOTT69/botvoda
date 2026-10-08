export const DAY=1440;
export const DEFAULT_WATER=[[360,600],[720,840],[1080,1440]];

export function normalize(xs=[]){
  const a=xs.map(([s,e])=>[Math.max(0,+s),Math.min(DAY,+e)]).filter(([s,e])=>s<e).sort((x,y)=>x[0]-y[0]);
  const out=[]; for(const x of a){ const p=out.at(-1); if(p&&x[0]<=p[1]) p[1]=Math.max(p[1],x[1]); else out.push([...x]); } return out;
}
export function complement(xs=[]){ const a=normalize(xs),out=[]; let p=0; for(const [s,e] of a){if(p<s)out.push([p,s]);p=Math.max(p,e)} if(p<DAY)out.push([p,DAY]); return out; }
export function union(...sets){ return normalize(sets.flat()); }
export function intersect(a=[],b=[]){ a=normalize(a);b=normalize(b);const out=[];let i=0,j=0;while(i<a.length&&j<b.length){const s=Math.max(a[i][0],b[j][0]),e=Math.min(a[i][1],b[j][1]);if(s<e)out.push([s,e]);if(a[i][1]<b[j][1])i++;else j++;}return out; }
export const total=xs=>normalize(xs).reduce((n,[s,e])=>n+e-s,0);
export const fmt=m=>m===1440?'24:00':`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
export const formatIntervals=xs=>xs?.length?normalize(xs).map(([s,e])=>`${fmt(s)}–${fmt(e)}`).join(' · '):'—';
export function duration(m){const h=Math.floor(m/60),r=m%60;return h?(r?`${h} год ${r} хв`:`${h} год`):`${r} хв`;}

export function extractIntervals(text=''){
  const out=[]; const re=/(?:з\s*)?(\d{1,2})[:.](\d{2})\s*(?:до|[-–—])\s*(\d{1,2})[:.](\d{2})/giu; let m;
  while((m=re.exec(text))){let s=+m[1]*60 + +m[2], e=+m[3]*60 + +m[4]; if(+m[3]===24)e=1440; if(s<e&&s<=1440&&e<=1440)out.push([s,e]);}
  return normalize(out);
}
function dateFromText(text=''){
  const m=text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b/); return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;
}
function sections(text=''){
  const re=/підгрупа\s+(\d\.\d)[^\n]*:[\s\S]*?(?=(?:\n\s*💡?\s*підгрупа\s+\d\.\d)|$)/giu; const out=[];let m;
  while((m=re.exec(text)))out.push({group:m[1],body:m[0]}); return out;
}
export function parsePowerMessage(text=''){
  const date=dateFromText(text); if(!date)return null;
  const kind=/зміни\s+у\s+графіку/i.test(text)?'changes':'full'; const items=[];
  for(const s of sections(text)){
    if(s.group!=='1.2'&&s.group!=='2.2')continue;
    let body=s.body;
    if(kind==='changes') { const i=body.search(/стало\s*:/iu); if(i<0)continue; body=body.slice(i).replace(/^[\s\S]*?стало\s*:/iu,''); }
    const intervals=extractIntervals(body); items.push({group:s.group,intervals});
  }
  return items.length?{date,mode:'off',kind,items}:null;
}
export function availability(power12,power22,fallback=DEFAULT_WATER){
  const water=union(power12,fallback); const both=intersect(water,power22); let best=null; for(const x of both)if(!best||x[1]-x[0]>best[1]-best[0])best=x;
  return {water,both,best};
}
export function buildEvents(a,settings,date){
  const ev=[]; const add=(key,minute,text)=>{if(minute>=0&&minute<=1440)ev.push({key:`${date}:${key}`,minute,text});};
  const lead=Number(settings.lead_minutes||30);
  if(settings.both_alerts) for(const [s,e] of a.both){add(`both-start-${s}`,s-lead,`⚡💧 Через ${lead} хв почнеться вода + світло\n${fmt(s)}–${fmt(e)} · ${duration(e-s)}`);if(settings.end_alerts)add(`both-end-${e}`,e-lead,`⚠️ Через ${lead} хв завершиться вікно вода + світло (${fmt(e)})`);}
  if(settings.water_alerts) for(const [s,e] of a.water){ if(!a.both.some(([bs])=>bs===s)) add(`water-start-${s}`,s-lead,`💧 Через ${lead} хв буде вода\n${fmt(s)}–${fmt(e)} · ${duration(e-s)}`); }
  return ev;
}
export function addDays(iso,n){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function localNow(date=new Date(),tz='Europe/Kyiv'){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,minute:+p.hour*60 + +p.minute};
}
export const humanDate=iso=>{const [y,m,d]=iso.split('-');return `${d}.${m}.${y}`};
