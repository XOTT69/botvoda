import {formatIntervals,duration,total,statusAt,nextChangeLabel,inIntervals,fmt,humanDate} from './lib.js';

export function fmtUpdated(ts,tz='Europe/Kyiv'){
  if(!ts)return null;const d=new Date(String(ts).replace(' ','T')+'Z');if(Number.isNaN(d.getTime()))return null;
  return new Intl.DateTimeFormat('uk-UA',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
}

export function nowBlock(a,minute,manualWater=null,powerStatus=null,currentDate=null,communityLine=null){
  if(!a)return '⏳ Актуальний графік ще не завантажено.';
  const s=statusAt(a,minute);

  const manualW=manualWater&&['on','off'].includes(manualWater.state)?manualWater:null;
  const actualWater=manualW?manualW.state==='on':s.current.water;

  const powerFact=powerStatus&&['on','off'].includes(powerStatus.state)?powerStatus:null;
  const actualPower=powerFact?powerFact.state==='on':s.current.power;
  const actualBoth=actualWater&&actualPower;

  const poss12=inIntervals(a.possible12||[],minute),poss22=inIntervals(a.possible22||[],minute);

  let waterLine;
  if(manualW){
    const t=manualW.updatedLabel?` о ${manualW.updatedLabel}`:'';
    waterLine=`💧 Вода: <b>${actualWater?'✅ є':'❌ немає'}</b> <i>(вручну${t})</i>\n🤖 За графіком вода: <b>${s.current.water?'✅ є':'❌ немає'}</b>`;
  }else{
    waterLine=`💧 Вода: <b>${s.current.water?'✅ є':'❌ немає'}</b> <i>(за графіком)</i>`;
  }

  let powerLine;
  if(powerFact){
    let source='фактично';
    let stamp='';
    if(powerFact.source==='manual'){
      source='вручну';
      stamp=powerFact.updatedLabel?`, ${powerFact.updatedLabel}`:'';
    }else if(powerFact.source==='channel'){
      const hm=Number.isFinite(powerFact.eventMinute)?fmt(powerFact.eventMinute):'';
      const datePart=powerFact.eventDate&&currentDate&&powerFact.eventDate!==currentDate?`${humanDate(powerFact.eventDate).slice(0,5)} `:'';
      stamp=hm?`, ${datePart}${hm}`:'';
    }
    powerLine=`⚡ Світло 2.2: <b>${actualPower?'✅ є':'❌ немає'}</b> <i>(${source}${stamp})</i>`;
    if(actualPower!==s.current.power)powerLine+=`\n🤖 За графіком світло: <b>${s.current.power?'✅ є':'❌ немає'}</b>`;
  }else{
    powerLine=`⚡ Світло 2.2: <b>${s.current.power?'✅ є':'❌ немає'}</b> <i>(за графіком)</i>`;
  }

  let out=`📍 <b>ЗАРАЗ</b>\n${waterLine}\n${powerLine}`;
  if(poss12||poss22){const x=[];if(poss12)x.push('1.2');if(poss22)x.push('2.2');out+=`\n🟡 Зараз діє зона можливого відключення: <b>${x.join(', ')}</b>`;}
  if(communityLine)out+='\n'+communityLine;
  return out;
}

export function dayBlock(label,date,a,updated=null,compact=false){
  if(!a)return `📅 <b>${label} • ${humanDate(date)}</b>\n⏳ Графік ще не завантажено.`;
  let s=`📅 <b>${label} • ${humanDate(date)}</b>`;
  if(updated)s+=`\n🕒 Оновлено: <b>${updated}</b>`;
  s+=`\n\n💧 <b>Вода — ${duration(total(a.water))}</b>\n${formatIntervals(a.water)}`;
  s+=`\n\n⚡ <b>Світло 2.2 — ${duration(total(a.p22))}</b>\n${formatIntervals(a.p22)}`;
  s+=`\n\n⚡💧 <b>Вода + світло — ${duration(total(a.both))}</b>\n${formatIntervals(a.both)}`;
  if(a.best)s+=`\n\n⭐ <b>Найкраще вікно</b>\n${formatIntervals([a.best])} — <b>${duration(a.best[1]-a.best[0])}</b>`;
  const uncertainty=[];
  if(a.possible12?.length)uncertainty.push(`1.2: ${formatIntervals(a.possible12)}`);
  if(a.possible22?.length)uncertainty.push(`2.2: ${formatIntervals(a.possible22)}`);
  if(uncertainty.length)s+=`\n\n🟡 <b>Можливі відключення</b>\n${uncertainty.join('\n')}`;
  return s;
}

export function publicText(today,tomorrow,todayData,tomorrowData,minute,todayUpdated,tomorrowUpdated,manualWater=null,powerStatus=null,communityLine=null){
  const compactDay=(label,date,a,updated)=>{
    if(!a)return `📅 <b>${label} • ${humanDate(date)}</b> · ⏳ графік очікується`;
    let x=`📅 <b>${label} • ${humanDate(date)}</b>`;
    if(updated)x+=` · 🕒 ${updated}`;
    x+=`\n💧 ${duration(total(a.water))}: ${formatIntervals(a.water)}`;
    x+=`\n⚡ ${duration(total(a.p22))}: ${formatIntervals(a.p22)}`;
    x+=`\n⚡💧 Разом ${duration(total(a.both))}: ${formatIntervals(a.both)}`;
    if(a.best)x+=`\n⭐ Найкраще: ${formatIntervals([a.best])} (${duration(a.best[1]-a.best[0])})`;
    return x;
  };
  let s=`📍 <b>Чабани • вода та світло</b>\n\n${nowBlock(todayData,minute,manualWater,powerStatus,today,communityLine)}\nℹ️ Вода залежить від світла групи <b>1.2</b>; якщо його немає — діє резервний графік.\n\n${compactDay('СЬОГОДНІ',today,todayData,todayUpdated)}`;
  if(tomorrowData)s+=`\n\n${compactDay('ЗАВТРА',tomorrow,tomorrowData,tomorrowUpdated)}`;
  s+=`\n\n🔔 <b>Деталі й нагадування — у боті.</b>`;
  return s;
}

// The photo already carries the daily electricity schedule. Keep its companion
// text focused on current status and planned water availability.
export function waterPublicText(today,tomorrow,todayData,tomorrowData,minute,todayUpdated,tomorrowUpdated,manualWater=null,powerStatus=null){
  const scheduled=todayData?statusAt(todayData,minute).current:null;
  const known=status=>status&&['on','off'].includes(status.state);
  const stateLabel=on=>`<b>${on?'є':'немає'}</b>`;
  let water='💧 Вода — <b>немає даних</b>';
  if(known(manualWater)){
    const stamp=manualWater.updatedLabel?` о ${manualWater.updatedLabel}`:'';
    water=`💧 Вода ${stateLabel(manualWater.state==='on')} — вручну${stamp}`;
  }else if(scheduled)water=`💧 Вода ${stateLabel(scheduled.water)} — за графіком`;

  let power='💡 Світло — <b>немає даних</b>';
  if(known(powerStatus)){
    let source='фактично';
    if(powerStatus.source==='manual')source='вручну'+(powerStatus.updatedLabel?` о ${powerStatus.updatedLabel}`:'');
    else if(powerStatus.source==='channel'&&Number.isFinite(powerStatus.eventMinute)){
      const date=powerStatus.eventDate&&powerStatus.eventDate!==today?`${humanDate(powerStatus.eventDate)} `:'';
      source=`підтверджено ${date}о ${fmt(powerStatus.eventMinute)}`;
    }
    power=`💡 Світло ${stateLabel(powerStatus.state==='on')} — ${source}`;
  }else if(scheduled)power=`💡 Світло ${stateLabel(scheduled.power)} — за графіком`;

  const dateLabel=date=>new Intl.DateTimeFormat('uk-UA',{timeZone:'UTC',day:'numeric',month:'long'}).format(new Date(date+'T12:00:00Z'));
  const waterDay=(label,date,data)=>{
    const heading=`📅 <b>${label}, ${dateLabel(date)}</b>`;
    if(!data)return heading+'\n⏳ Графік ще не опублікований.';
    const windows=data.water.length?data.water.map(([start,end])=>`${fmt(start)}–${fmt(end)}`).join('\n'):'За графіком води немає.';
    return `${heading}\n${windows}\nРазом: <b>${duration(total(data.water))}</b>`;
  };
  let text=`📍 <b>Чабани • вода та світло</b>\n\n<b>Зараз</b>\n${water}\n${power}`;
  if(todayData&&inIntervals(todayData.possible12||[],minute))text+='\n🟡 Можливі зміни подачі води через відключення світла.';
  text+=`\n\n<b>💧 Коли є вода за графіком</b>\n\n${waterDay('Сьогодні',today,todayData)}`;
  if(tomorrowData)text+=`\n\n${waterDay('Завтра',tomorrow,tomorrowData)}`;
  return text+'\n\nℹ️ Фактична наявність води може відрізнятися від графіка.\n\n🔔 <b>Деталі й нагадування — у боті.</b>\n⚡ <b>Графік світла — на закріпленій картинці.</b>';
}

export function summaryText(label,date,a){
  if(!a)return `📅 <b>${label} • ${humanDate(date)}</b>\nГрафік ще не завантажено.`;
  let s=`📅 <b>${label} • ${humanDate(date)}</b>\n💧 Вода: <b>${duration(total(a.water))}</b>\n⚡ Світло 2.2: <b>${duration(total(a.p22))}</b>\n⚡💧 Разом: <b>${duration(total(a.both))}</b>`;
  if(a.best)s+=`\n⭐ Найкраще: <b>${formatIntervals([a.best])}</b>`;
  return s;
}

export function diffText(before,after,date){
  const lines=[`🔎 <b>Що зміниться • ${humanDate(date)}</b>`];
  if(!before&&after){lines.push('Новий графік на цю дату.');}
  else if(before&&after){
    const fields=[['💧 Вода',before.water,after.water],['⚡ Світло 2.2',before.p22,after.p22],['⚡💧 Разом',before.both,after.both]];
    for(const [name,b,a] of fields){const d=total(a)-total(b);lines.push(`${name}: ${duration(total(b))} → <b>${duration(total(a))}</b>${d===0?'':` (${d>0?'+':'−'}${duration(Math.abs(d))})`}`);}
    if(JSON.stringify(before.off12)!==JSON.stringify(after.off12))lines.push(`1.2 відключення: ${formatIntervals(before.off12)} → <b>${formatIntervals(after.off12)}</b>`);
    if(JSON.stringify(before.off22)!==JSON.stringify(after.off22))lines.push(`2.2 відключення: ${formatIntervals(before.off22)} → <b>${formatIntervals(after.off22)}</b>`);
    if(JSON.stringify(before.possible12||[])!==JSON.stringify(after.possible12||[]))lines.push(`🟡 1.2 можливі: ${formatIntervals(before.possible12||[])} → <b>${formatIntervals(after.possible12||[])}</b>`);
    if(JSON.stringify(before.possible22||[])!==JSON.stringify(after.possible22||[]))lines.push(`🟡 2.2 можливі: ${formatIntervals(before.possible22||[])} → <b>${formatIntervals(after.possible22||[])}</b>`);
  }
  return lines.join('\n');
}
