import {validateCard,validatedPeriods} from './schedule-card-model.js';

const W=1200;
const xml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const week=['нд','пн','вт','ср','чт','пт','сб'];
const clock=m=>m===1440?'24:00':String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
export function cardDuration(minutes){
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return [hours?hours+' год':'',rest?rest+' хв':''].filter(Boolean).join(' ')||'0 хв';
}
export function daySchedule(periods){
  if(periods===null)return {rows:[{unknown:true}],on:null,off:null};
  const normalized=validatedPeriods(periods);
  if(normalized===null)throw new Error('Invalid schedule intervals');
  const rows=[];let cursor=0,off=0;
  for(const [start,end] of normalized){
    if(cursor<start)rows.push({start:cursor,end:start,on:true});
    rows.push({start,end,on:false});off+=end-start;cursor=end;
  }
  if(cursor<1440)rows.push({start:cursor,end:1440,on:true});
  return {rows,on:1440-off,off};
}
function dateParts(date){
  const dt=new Date(date+'T12:00:00Z');
  const parts=new Intl.DateTimeFormat('uk-UA',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).formatToParts(dt);
  const get=key=>parts.find(p=>p.type===key)?.value||'';
  return {day:get('day'),month:get('month'),year:get('year'),week:week[dt.getUTCDay()]};
}
function dateRange(today,tomorrow){
  const a=dateParts(today);
  if(tomorrow===null)return `${a.day} ${a.month} (${a.week})`;
  const b=dateParts(tomorrow);
  if(a.year!==b.year)return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year} (${a.week} – ${b.week})`;
  if(a.month!==b.month)return `${a.day} ${a.month} – ${b.day} ${b.month} (${a.week} – ${b.week})`;
  return `${a.day}–${b.day} ${a.month} (${a.week} – ${b.week})`;
}
function panel(x,y,w,h,r=34,fill='url(#panel)'){
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`+
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="#22b7ff" stroke-width="8" opacity=".22"/>`+
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="#78d8ff" stroke-width="2.5"/>`;
}
function bulb(x=0,y=0,scale=1){
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#ffdf42" stroke-linecap="round" stroke-linejoin="round" filter="url(#goldGlow)">`+
    '<path d="M160 33v25M108 52l17 18m87-18-17 18M88 111h28m106 0h28" stroke-width="9"/>'+
    '<path d="M160 63c-35 0-58 25-58 58 0 22 12 36 27 54 7 8 10 16 10 28h42c0-12 3-20 10-28 15-18 27-32 27-54 0-33-23-58-58-58Z" stroke-width="10"/>'+
    '<path d="M137 204h46m-41 15h36m-28 15h20M143 122v40m34-40v40m-34-12h34" stroke-width="8"/></g>';
}
function calendar(x,y){
  return `<g transform="translate(${x} ${y})" fill="none" stroke="#f4f8ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">`+
    '<rect x="0" y="8" width="58" height="54" rx="8"/><path d="M14 0v18M44 0v18M0 26h58"/>'+
    '<path d="M13 38h3m13 0h3m13 0h3M13 51h3m13 0h3m13 0h3" stroke-width="7"/></g>';
}
function bolt(x,y,scale=1){
  return `<path transform="translate(${x} ${y}) scale(${scale})" d="M5-24-14 3H0l-8 24L19-7H5l9-17Z" fill="#fff8f1"/>`;
}
function tick(x,y){
  return `<circle cx="${x}" cy="${y}" r="18" fill="#8bffad"/><path d="m${x-9} ${y} 6 6 13-14" fill="none" stroke="#07562b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function skyline(top,opacity=1){
  const blocks=[[0,118,125],[92,103,177],[184,112,146],[280,104,114],[350,112,169],
    [704,117,152],[798,103,184],[889,100,135],[970,104,123],[1044,116,204],[1145,110,151]];
  return `<g opacity="${opacity}">`+blocks.map(([x,w,h],index)=>{
    const y=top+210-h;
    let windows='';
    for(let row=0;row<Math.floor((h-18)/21);row++)for(let col=0;col<Math.floor((w-20)/21);col++){
      const lit=(row*7+col*3+index)%5!==0;
      windows+=`<rect x="${x+11+col*21}" y="${y+15+row*21}" width="8" height="10" fill="${lit?'#ffdc46':'#143762'}" opacity="${lit?'.86':'.7'}"/>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#04152f" stroke="#185084" stroke-width="1.5"/>`+windows;
  }).join('')+`<rect y="${top+150}" width="1200" height="70" fill="url(#skyFade)"/></g>`;
}
function rowsSvg(rows,top){
  return rows.map((row,index)=>{
    const y=top+index*56;
    if(row.unknown)return `<rect x="284" y="${y}" width="860" height="48" rx="24" fill="#112d50" stroke="#79a7ce" stroke-width="2" stroke-dasharray="9 6"/>`+
      `<text x="714" y="${y+33}" class="unknown" text-anchor="middle">Графік ще не опублікований</text>`;
    const kind=row.on?'on':'off';
    return `<g data-state="${kind}"><rect x="284" y="${y}" width="860" height="48" rx="24" fill="url(#${kind})" stroke="${row.on?'#58f784':'#ff6476'}" stroke-width="2.4"/>`+
      `<path d="M314 ${y+3}H1110" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>`+
      (row.on?tick(326,y+24):bolt(326,y+24,.8))+
      `<text x="378" y="${y+34}" class="hours">${clock(row.start)} — ${clock(row.end)}</text>`+
      `<path d="M688 ${y+11}v26" stroke="#e1f1ff" stroke-opacity=".68" stroke-width="2"/>`+
      `<text x="717" y="${y+33}" class="state">${row.on?'Є світло':'Немає світла'}</text>`+
      `<text x="1120" y="${y+32}" class="duration" text-anchor="end">(${cardDuration(row.end-row.start)})</text></g>`;
  }).join('');
}
function totalsBox(x,y,width,on,value){
  const kind=on?'on':'off',iconX=x+43;
  return `<g data-total-${kind}="${value===null?'unknown':value}"><rect x="${x}" y="${y}" width="${width}" height="84" rx="25" fill="url(#${kind}Total)" stroke="${on?'#7cf3b0':'#ff8c9e'}" stroke-width="2"/>`+
    `<circle cx="${iconX}" cy="${y+42}" r="29" fill="url(#${kind})" stroke="${on?'#49cf78':'#ef5a70'}" stroke-width="1.5"/>`+
    (on?bulb(iconX-34,y+9,.215):bolt(iconX,y+42,.9))+
    `<path d="M${x+83} ${y+16}v52" stroke="#f7fbff" stroke-opacity=".75" stroke-width="2"/>`+
    `<text x="${x+105}" y="${y+29}" class="totalLabel">${on?'Світло сумарно':'Без світла сумарно'}</text>`+
    `<text x="${x+105}" y="${y+67}" class="totalValue">${value===null?'Немає даних':cardDuration(value)}</text></g>`;
}
function dayCard(label,date,periods,top){
  const schedule=daySchedule(periods),parts=dateParts(date);
  const contentHeight=schedule.rows.length*56-8+14+84;
  const height=Math.max(260,contentHeight+32),bodyTop=top+(height-contentHeight)/2;
  const tileTop=top+(height-202)/2;
  const totalsTop=bodyTop+schedule.rows.length*56-8+14;
  return {height,svg:`<g aria-label="${label}" data-day="${label==='Сьогодні'?'today':'tomorrow'}">`+
    `<title>${label}, ${parts.day} ${parts.month}</title>`+panel(30,top,1140,height,36)+
    `<rect x="56" y="${tileTop}" width="184" height="202" rx="30" fill="url(#dateTile)" stroke="#65bbff" stroke-width="2"/>`+
    `<text x="148" y="${tileTop+48}" class="weekday" text-anchor="middle">${parts.week[0].toUpperCase()+parts.week.slice(1)}</text>`+
    `<text x="148" y="${tileTop+129}" class="dayNumber" text-anchor="middle">${parts.day}</text>`+
    `<text x="148" y="${tileTop+174}" class="month" text-anchor="middle">${xml(parts.month)}</text>`+
    `<path d="M260 ${top+24}v${height-48}" stroke="#d3e9ff" stroke-opacity=".8" stroke-width="2"/>`+
    rowsSvg(schedule.rows,bodyTop)+totalsBox(286,totalsTop,410,true,schedule.on)+totalsBox(716,totalsTop,428,false,schedule.off)+'</g>'};
}
function updatedLabel(timestamp){
  const parts=new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp));
  const p=key=>parts.find(x=>x.type===key)?.value||'';
  return `${p('day')}.${p('month')}.${p('year')} о ${p('hour')}:${p('minute')}`;
}
export function scheduleCardSvg(payload){
  validateCard(payload);
  const {today,todayPeriods,tomorrow,tomorrowPeriods,updatedAt,demo=false}=payload;
  const first=dayCard('Сьогодні',today,todayPeriods,400);
  const second=tomorrow===null?null:dayCard('Завтра',tomorrow,tomorrowPeriods,400+first.height+16);
  const end=400+first.height+(second?16+second.height:0);
  const height=Math.max(second?1200:900,end+170),updateY=height-135;
  const stars=Array.from({length:64},(_,i)=>`<circle cx="${(i*181+47)%1190+5}" cy="${(i*103+29)%(height-16)+8}" r="${i%11===0?2:1.2}" fill="#dceeff" opacity=".72"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">`+
    '<defs><linearGradient id="bg" x2="0%" y2="100%"><stop stop-color="#04162f"/><stop offset=".4" stop-color="#073367"/><stop offset="1" stop-color="#03162f"/></linearGradient>'+
    '<radialGradient id="headerShade"><stop stop-color="#04162f" stop-opacity=".9"/><stop offset=".7" stop-color="#04162f" stop-opacity=".6"/><stop offset="1" stop-color="#04162f" stop-opacity="0"/></radialGradient><radialGradient id="halo"><stop stop-color="#126bc4" stop-opacity=".68"/><stop offset="1" stop-color="#072952" stop-opacity="0"/></radialGradient>'+
    '<linearGradient id="panel" x2="100%" y2="100%"><stop stop-color="#0c3462"/><stop offset=".65" stop-color="#041a38"/><stop offset="1" stop-color="#092c57"/></linearGradient>'+
    '<linearGradient id="dateTile" x2="100%" y2="100%"><stop stop-color="#2475c9"/><stop offset=".45" stop-color="#103e73"/><stop offset="1" stop-color="#082a54"/></linearGradient>'+
    '<linearGradient id="on" x2="0%" y2="100%"><stop stop-color="#18943e"/><stop offset=".48" stop-color="#086322"/><stop offset="1" stop-color="#044b1a"/></linearGradient>'+
    '<linearGradient id="off" x2="0%" y2="100%"><stop stop-color="#e72c45"/><stop offset=".5" stop-color="#ac1029"/><stop offset="1" stop-color="#86091e"/></linearGradient>'+
    '<linearGradient id="onTotal" x2="100%" y2="100%"><stop stop-color="#087b49"/><stop offset="1" stop-color="#013929"/></linearGradient>'+
    '<linearGradient id="offTotal" x2="100%" y2="100%"><stop stop-color="#9c304c"/><stop offset="1" stop-color="#441322"/></linearGradient>'+
    '<linearGradient id="gold" x2="0%" y2="100%"><stop stop-color="#fff688"/><stop offset=".4" stop-color="#ffe431"/><stop offset="1" stop-color="#ffc916"/></linearGradient>'+
    '<linearGradient id="skyFade" x2="0%" y2="100%"><stop stop-color="#04254d" stop-opacity="0"/><stop offset="1" stop-color="#041a35"/></linearGradient>'+
    '<filter id="goldGlow" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'+
    '<style>text{font-family:"Noto Sans",sans-serif;fill:#f6f9ff}.brand{font-size:72px;font-weight:700;letter-spacing:-1px}.tag{font-size:48px;font-weight:700;fill:#07142a}.banner{font-size:43px;font-weight:700}.range{font-size:27px;fill:#e1eaff}.weekday{font-size:42px;font-weight:700}.dayNumber{font-size:86px;font-weight:700}.month{font-size:27px;font-weight:600}.hours{font-size:34px;font-weight:700}.state{font-size:29px}.duration{font-size:24px}.totalLabel{font-size:24px;font-weight:700}.totalValue{font-size:35px;font-weight:700;fill:#fff3b5}.unknown{font-size:28px;fill:#dceaff}.updated{font-size:28px;fill:#e2edff}.motto{font-size:46px;font-weight:700}.note{font-size:18px;fill:#d0def3}</style></defs>'+
    `<rect width="1200" height="${height}" fill="url(#bg)"/><ellipse cx="600" cy="190" rx="670" ry="340" fill="url(#halo)"/><ellipse cx="600" cy="${height-65}" rx="690" ry="210" fill="url(#halo)"/>`+stars+skyline(55,.78)+skyline(height-210,.32)+'<ellipse cx="680" cy="133" rx="390" ry="160" fill="url(#headerShade)"/>'+bulb(44,7,1)+
    '<path d="M366 32v222" stroke="#c5e4ff" stroke-width="2.5"/>'+
    '<text x="422" y="110" class="brand">Світло</text><text x="422" y="180" class="brand">Покровська</text>'+
    '<rect x="422" y="204" width="350" height="70" rx="35" fill="url(#gold)" stroke="#fff69a" stroke-width="2" filter="url(#goldGlow)"/><text x="597" y="254" text-anchor="middle" class="tag">Графік 2.2</text>'+
    panel(30,292,1140,92,36)+calendar(320,308)+'<path d="M414 307v60" stroke="#d9ecff" stroke-width="2"/>'+
    `<text x="751" y="333" text-anchor="middle" class="banner">${second?'Графік на 2 дні':'Графік на сьогодні'}</text>`+
    `<text x="751" y="369" text-anchor="middle" class="range">${xml(dateRange(today,tomorrow))}</text>`+
    first.svg+(second?.svg||'')+
    (demo?'<rect x="0" y="276" width="1200" height="20" fill="#ffdf42"/><text x="600" y="291" font-size="14" text-anchor="middle" style="fill:#08152b;font-weight:700">ДЕМОНСТРАЦІЯ · години вигадані</text>':'')+
    `<path d="M110 ${updateY-7}H320m560 0h210" stroke="#57bfff" stroke-width="2"/><text x="600" y="${updateY}" text-anchor="middle" class="updated">Оновлено: ${xml(updatedLabel(updatedAt))}</text>`+
    `<text x="556" y="${height-64}" class="motto" text-anchor="middle">Світло переможе!</text>`+
    `<path transform="translate(826 ${height-88}) scale(.8)" d="M0 20C-42-5-30-40-9-24-4-21 0-15 0-15 10-36 42-32 36-7 33 4 18 15 0 30Z" fill="url(#gold)" stroke="#fff38a" stroke-width="2"/>`+
    `<text x="600" y="${height-20}" class="note" text-anchor="middle">Плановий графік · під час екстрених відключень може не діяти</text></svg>`;
}
