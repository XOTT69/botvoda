import {TRIDENT_CENTER,TRIDENT_SIDE} from './trident.js';
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
function panel(x,y,w,h,r=36,fill='url(#panel)'){
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`+
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="#009bff" stroke-width="5" filter="url(#blueGlow)"/>`+
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="#c4f6ff" stroke-width="2"/>`;
}
function brandBulb(){
  return '<g aria-label="Лампочка з тризубом">'+
    '<path d="M145 220C184 151 285 178 313 112c5-12 3-24-1-32 38 37 7 72-39 91-49 21-89 20-128 49Z" fill="url(#ribbonBlue)"/>'+
    '<path d="M145 230c36-52 117-43 161-91 12-13 16-26 16-36 13 39-32 66-71 78-46 14-78 21-106 49Z" fill="url(#ribbonGold)"/>'+
    '<path d="M145 220c38-55 137-46 167-106" fill="none" stroke="#46dcff" stroke-width="2" opacity=".8"/>'+
    '<path d="M238 22c-40 0-68 25-68 63 0 28 17 46 29 64 5 7 6 14 6 21h66c0-7 1-14 6-21 12-18 29-36 29-64 0-38-28-63-68-63Z" fill="url(#bulbGlass)" stroke="#ffce27" stroke-width="7" filter="url(#goldGlow)"/>'+
    '<path d="M238 24c-39 0-66 25-66 61 0 26 17 45 29 63 5 7 7 14 7 20h60c0-6 2-13 7-20 12-18 29-37 29-63 0-36-27-61-66-61Z" fill="none" stroke="#fff6be" stroke-width="2"/>'+
    '<path d="M181 71c5-22 21-37 42-40l-9 11 9 9c-20 0-29 10-33 25Z" fill="#fffbc9" opacity=".86"/>'+
    '<path d="M182 82c0-13 4-23 10-31" fill="none" stroke="#fffef0" stroke-width="3" opacity=".8"/>'+
    `<g transform="translate(238 61) scale(.43)" fill="#fff4a5"><path d="${TRIDENT_CENTER}"/><path d="${TRIDENT_SIDE}"/><path d="${TRIDENT_SIDE}" transform="scale(-1 1)"/></g>`+
    '<rect x="205" y="167" width="66" height="15" rx="5" fill="url(#steel)" stroke="#b9e7ff" stroke-width="1.5"/>'+
    '<rect x="210" y="180" width="56" height="13" rx="5" fill="url(#steel)" stroke="#b9e7ff" stroke-width="1.5"/>'+
    '<rect x="216" y="191" width="44" height="12" rx="5" fill="url(#steel)" stroke="#b9e7ff" stroke-width="1.5"/>'+
    '<path d="M224 202h28c-2 11-26 11-28 0Z" fill="url(#steel)" stroke="#86ccff" stroke-width="1.5"/></g>';
}
function bottomRibbons(height){
  return `<g transform="translate(0 ${height-130})" aria-label="Синьо-жовті стрічки">`+
    '<path d="M0 27c101-44 132 26 252 23C144 40 105 92 0 117Z" fill="url(#ribbonBlue)"/>'+
    '<path d="M0 68c105-48 153 34 283 33C161 69 107 96 0 154Z" fill="url(#ribbonGold)"/>'+
    '<path d="M0 27c101-44 132 26 252 23" fill="none" stroke="#21baff" stroke-width="2"/>'+
    '<path d="M1200 0c-124 47-165 5-339 123 148-72 217-31 339-53Z" fill="url(#ribbonBlue)"/>'+
    '<path d="M1200 45c-127 45-197 56-364 79 162 21 264-27 364-4Z" fill="url(#ribbonGold)"/>'+
    '<path d="M1200 0c-124 47-165 5-339 123" fill="none" stroke="#238dff" stroke-width="2"/></g>';
}
function bulb(x=0,y=0,scale=1){
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#ffdf42" stroke-linecap="round" stroke-linejoin="round" filter="url(#goldGlow)">`+
    '<path d="M160 33v25M108 52l17 18m87-18-17 18M88 111h28m106 0h28" stroke-width="9"/>'+
    '<path d="M160 63c-35 0-58 25-58 58 0 22 12 36 27 54 7 8 10 16 10 28h42c0-12 3-20 10-28 15-18 27-32 27-54 0-33-23-58-58-58Z" stroke-width="10"/>'+
    '<path d="M137 204h46m-41 15h36m-28 15h20M143 122v40m34-40v40m-34-12h34" stroke-width="8"/></g>';
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
    const y=top+index*64;
    if(row.unknown)return `<rect x="253" y="${y}" width="884" height="56" rx="28" fill="#112d50" stroke="#79a7ce" stroke-width="2" stroke-dasharray="9 6"/>`+
      `<text x="714" y="${y+38}" class="unknown" text-anchor="middle">Графік ще не опублікований</text>`;
    const kind=row.on?'on':'off';
    return `<g data-state="${kind}"><rect x="253" y="${y}" width="884" height="56" rx="28" fill="url(#${kind})" stroke="${row.on?'#58f784':'#ff6476'}" stroke-width="2.4"/>`+
      `<path d="M287 ${y+3}H1104" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>`+
      (row.on?tick(313,y+28):bolt(313,y+28,.8))+
      `<text x="365" y="${y+39}" class="hours">${clock(row.start)} — ${clock(row.end)}</text>`+
      `<path d="M660 ${y+12}v32" stroke="#e1f1ff" stroke-opacity=".68" stroke-width="2"/>`+
      `<text x="706" y="${y+38}" class="state">${row.on?'Є світло':'Немає світла'}</text>`+
      `<text x="1113" y="${y+37}" class="duration" text-anchor="end">(${cardDuration(row.end-row.start)})</text></g>`;
  }).join('');
}
function totalsBox(x,y,width,on,value){
  const kind=on?'on':'off',iconX=x+46;
  return `<g data-total-${kind}="${value===null?'unknown':value}"><rect x="${x}" y="${y}" width="${width}" height="66" rx="23" fill="url(#${kind}Total)" stroke="${on?'#7cf3b0':'#ff8c9e'}" stroke-width="2"/>`+
    (on?bulb(iconX-34,y+7,.215):`<circle cx="${iconX}" cy="${y+33}" r="26" fill="url(#off)" stroke="#f76981"/>`+bolt(iconX,y+33,.84))+
    `<text x="${x+105}" y="${y+43}" class="totalLabel">${on?'Зі світлом:':'Без світла:'} <tspan class="totalValue"${value===null?' style="font-size:28px"':''}>${value===null?'Немає даних':cardDuration(value)}</tspan></text></g>`;
}
function dayCard(label,date,periods,top){
  const schedule=daySchedule(periods),parts=dateParts(date);
  const rowsHeight=schedule.rows.length*64-8,tableHeight=Math.max(212,rowsHeight);
  const tableTop=top+28,bodyTop=tableTop+(tableHeight-rowsHeight)/2;
  const tileTop=tableTop+(tableHeight-212)/2;
  const separator=tableTop+tableHeight+10,totalsTop=separator+20;
  const height=totalsTop-top+66+28;
  const weekday=parts.week[0].toUpperCase()+parts.week.slice(1);
  return {height,svg:`<g aria-label="${label}" data-day="${label==='Сьогодні'?'today':'tomorrow'}">`+
    `<title>${label}, ${parts.day} ${parts.month}</title>`+panel(35,top,1130,height,40)+
    `<rect x="66" y="${tileTop}" width="168" height="212" rx="29" fill="url(#dateTile)" stroke="#20c4ff" stroke-width="2" filter="url(#tileGlow)"/>`+
    `<g transform="translate(105 ${tileTop+13})" fill="none" stroke="#f5f9ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><rect y="12" width="89" height="72" rx="10"/><path d="M19 0v22M70 0v22M0 35h89"/></g>`+
    `<text x="150" y="${tileTop+84}" class="weekday" text-anchor="middle">${weekday}</text>`+
    `<text x="150" y="${tileTop+166}" class="dayNumber" text-anchor="middle">${parts.day}</text>`+
    `<text x="150" y="${tileTop+192}" class="month" text-anchor="middle">${xml(parts.month)}</text>`+
    rowsSvg(schedule.rows,bodyTop)+`<path d="M263 ${separator}H1119" stroke="#78c8ff" stroke-width="2"/>`+
    totalsBox(82,totalsTop,518,true,schedule.on)+totalsBox(624,totalsTop,500,false,schedule.off)+'</g>'};
}
function updatedLabel(timestamp){
  const parts=new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp));
  const p=key=>parts.find(x=>x.type===key)?.value||'';
  return `${p('day')}.${p('month')}.${p('year')} о ${p('hour')}:${p('minute')}`;
}
export function scheduleCardSvg(payload){
  validateCard(payload);
  const {today,todayPeriods,tomorrow,tomorrowPeriods,updatedAt,demo=false}=payload;
  const first=dayCard('Сьогодні',today,todayPeriods,235);
  const second=tomorrow===null?null:dayCard('Завтра',tomorrow,tomorrowPeriods,235+first.height+16);
  const end=235+first.height+(second?16+second.height:0);
  const height=Math.max(second?1200:850,end+210),updateY=height-180;
  const stars=Array.from({length:64},(_,i)=>`<circle cx="${(i*181+47)%1190+5}" cy="${(i*103+29)%(height-16)+8}" r="${i%11===0?2:1.2}" fill="#dceeff" opacity=".72"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" data-layout="final-v4"><title>${second?'Графік на 2 дні':'Графік на сьогодні'}</title><desc>${xml(dateRange(today,tomorrow))}</desc>`+
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
    '<radialGradient id="bulbGlass" cx="33%" cy="28%" r="75%"><stop stop-color="#fff78a"/><stop offset=".22" stop-color="#ffd126"/><stop offset=".63" stop-color="#c38c00"/><stop offset="1" stop-color="#f9bb03"/></radialGradient>'+
    '<linearGradient id="steel" x2="100%" y2="0%"><stop stop-color="#1265b7"/><stop offset=".23" stop-color="#e1f8ff"/><stop offset=".5" stop-color="#72c5ff"/><stop offset=".72" stop-color="#083978"/><stop offset="1" stop-color="#4ea3ed"/></linearGradient>'+
    '<linearGradient id="ribbonBlue" x2="20%" y2="100%"><stop stop-color="#0066e9"/><stop offset=".3" stop-color="#12c3ff"/><stop offset=".6" stop-color="#0050b7"/><stop offset="1" stop-color="#021a4b"/></linearGradient>'+
    '<linearGradient id="ribbonGold" x2="20%" y2="100%"><stop stop-color="#fff46b"/><stop offset=".36" stop-color="#ffd500"/><stop offset=".7" stop-color="#bf9200"/><stop offset="1" stop-color="#073253"/></linearGradient>'+
    '<filter id="blueGlow" x="-10%" y="-25%" width="120%" height="150%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'+
    '<filter id="tileGlow" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'+
    '<style>text{font-family:"Noto Sans",sans-serif;fill:#f6f9ff}.brand{font-size:66px;font-weight:700;letter-spacing:-1px}.tag{font-size:46px;font-weight:700;fill:#07142a}.weekday{font-size:31px;font-weight:700}.dayNumber{font-size:76px;font-weight:700}.month{font-size:25px;font-weight:600}.hours{font-size:36px;font-weight:700}.state{font-size:32px}.duration{font-size:27px}.totalLabel{font-size:30px;font-weight:700}.totalValue{font-size:32px;font-weight:700;fill:#fff3b5}.unknown{font-size:28px;fill:#dceaff}.updated{font-size:28px;fill:#e2edff}.note{font-size:18px;fill:#d0def3}</style></defs>'+
    `<rect width="1200" height="${height}" fill="url(#bg)"/><ellipse cx="600" cy="190" rx="670" ry="340" fill="url(#halo)"/><ellipse cx="600" cy="${height-65}" rx="690" ry="210" fill="url(#halo)"/>`+stars+skyline(0,.9)+'<ellipse cx="650" cy="95" rx="330" ry="150" fill="url(#headerShade)"/>'+brandBulb()+
    '<path d="M376 26v176" stroke="#a9e3ff" stroke-width="3" stroke-linecap="round"/>'+
    '<text x="424" y="72" class="brand">Світло</text><text x="424" y="129" class="brand">Покровська</text>'+
    '<rect x="422" y="148" width="340" height="64" rx="32" fill="url(#gold)" stroke="#fff69a" stroke-width="2" filter="url(#goldGlow)"/><text x="592" y="194" text-anchor="middle" class="tag">Графік 2.2</text>'+
    first.svg+(second?.svg||'')+
    (demo?'<text x="1170" y="225" font-size="12" text-anchor="end" style="fill:#ffd949">ДЕМОНСТРАЦІЯ · години вигадані</text>':'')+
    bottomRibbons(height)+
    `<path d="M80 ${updateY-8}H337m526 0h257" stroke="#84ccff" stroke-width="2"/>`+
    `<g transform="translate(395 ${updateY-14})" fill="none" stroke="#a5dcff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M17-5a18 18 0 0 0-32-6M-17 5a18 18 0 0 0 32 6M17-17v12H5M-17 17V5h12"/></g>`+
    `<text x="435" y="${updateY}" class="updated">Оновлено: ${xml(updatedLabel(updatedAt))}</text>`+
    `<path transform="translate(600 ${height-125}) scale(.8)" d="M0 20C-42-5-30-40-9-24-4-21 0-15 0-15 10-36 42-32 36-7 33 4 18 15 0 30Z" fill="url(#gold)" stroke="#fff38a" stroke-width="2" filter="url(#goldGlow)"/>`+
    `<text x="600" y="${height-62}" class="note" text-anchor="middle">Плановий графік · під час екстрених відключень може не діяти</text></svg>`;
}
