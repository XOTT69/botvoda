import {formatIntervals,duration,total,statusAt,nextChangeLabel,countdown,inIntervals,fmt,humanDate} from './lib.js';

export function fmtUpdated(ts,tz='Europe/Kyiv'){
  if(!ts)return null;const d=new Date(String(ts).replace(' ','T')+'Z');if(Number.isNaN(d.getTime()))return null;
  return new Intl.DateTimeFormat('uk-UA',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
}

export function nowBlock(a,minute){
  if(!a)return '⏳ Актуальний графік ще не завантажено.';
  const s=statusAt(a,minute);
  const poss12=inIntervals(a.possible12||[],minute),poss22=inIntervals(a.possible22||[],minute);
  let out=`📍 <b>ЗАРАЗ</b>\n💧 Вода: <b>${s.current.water?'✅ є':'❌ немає'}</b>\n⚡ Світло 2.2: <b>${s.current.power?'✅ є':'❌ немає'}</b>\n⚡💧 Разом: <b>${s.current.both?'✅ є':'❌ немає'}</b>`;
  if(poss12||poss22){const x=[];if(poss12)x.push('1.2');if(poss22)x.push('2.2');out+=`\n🟡 Зараз діє зона можливого відключення: <b>${x.join(', ')}</b>`;}
  if(s.next){out+=`\n\n⏭ О <b>${fmt(s.next.minute)}</b> ${nextChangeLabel(s.next)}\nПриблизно через <b>${countdown(s.next.minute-minute)}</b>.`;}
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

export function publicText(today,tomorrow,todayData,tomorrowData,minute,todayUpdated,tomorrowUpdated){
  let s=`📍 <b>Чабани • вода та світло</b>\n\n${nowBlock(todayData,minute)}\n\nℹ️ Вода залежить від електропостачання групи <b>1.2</b>. Якщо у 1.2 немає світла — діє резервний графік води.\n\n${dayBlock('СЬОГОДНІ',today,todayData,todayUpdated,true)}`;
  if(tomorrowData)s+=`\n\n━━━━━━━━━━━━━━\n\n${dayBlock('ЗАВТРА',tomorrow,tomorrowData,tomorrowUpdated,true)}`;
  s+=`\n\n🔔 <b>Персональні нагадування та деталі — у боті.</b>`;
  return s;
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
