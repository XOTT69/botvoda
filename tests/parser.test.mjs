import assert from 'node:assert/strict';
import {
  parsePowerMessage,complement,availability,total,buildEvents,statusAt,
  nextChangeLabel,formatIntervals
} from '../src/lib.js';

const changed=`❗️ Зміни у графіку на сьогодні
Четвер, 08.10.2026

💡 Підгрупа 1.2 відключення:
Було:
❌ з 21:00 до 24:00
Стало:
❌ з 10:30 до 17:30
❌ з 21:00 до 24:00

💡 Підгрупа 2.2 відключення:
Було:
❌ з 00:00 до 04:00
Стало:
❌ з 00:00 до 04:00
❌ з 10:30 до 14:30
❌ з 21:00 до 24:00`;
const p=parsePowerMessage(changed);
assert.equal(p.date,'2026-10-08');
assert.equal(p.kind,'changes');
assert.deepEqual(p.items[0].intervals,[[630,1050],[1260,1440]]);
assert.deepEqual(p.items[1].intervals,[[0,240],[630,870],[1260,1440]]);

const a=availability(complement(p.items[0].intervals),complement(p.items[1].intervals));
assert.equal(total(a.water),1140);
assert.equal(total(a.both),600);
assert.deepEqual(a.best,[240,630]);
assert.equal(formatIntervals(a.both),'04:00–10:30 · 17:30–21:00');

const possible=`💡 Графік відключення світла на завтра.
📆П'ятниця 09.10.2026

💡Підгрупа 1.2 відключення:
❌ з 10:00 до 12:00
🟡 можливе відключення з 16:00 до 18:00
💡Підгрупа 2.2 відключення:
❌ з 13:00 до 15:00
⚠️ можливе з 20:00 до 21:00`;
const pp=parsePowerMessage(possible);
assert.deepEqual(pp.items[0].intervals,[[600,720]]);
assert.deepEqual(pp.items[0].possibleIntervals,[[960,1080]]);
assert.deepEqual(pp.items[1].possibleIntervals,[[1200,1260]]);

const st=statusAt(a,300);
assert.equal(st.current.water,true);
assert.equal(st.current.power,true);
assert.equal(st.current.both,true);
assert.equal(st.next.minute,630);
assert.equal(nextChangeLabel(st.next),'зникнуть вода і світло');

const ev=buildEvents(a,{both_alerts:1,water_alerts:1,end_alerts:1,lead_minutes:30,min_window_minutes:240},'2026-10-08');
assert.ok(ev.some(x=>x.key.includes('both-start-240')));
assert.ok(!ev.some(x=>x.key.includes('both-start-1050')));

const fullTomorrow=`💡Графік відключення світла на завтра.
📆Четвер, 08.10.2026

💡Підгрупа 1.1 відключення:
❌з 10:30 до 14:30
💡Підгрупа 1.2 відключення:
❌з 21:00 до 24:00

💡Підгрупа 2.1 відключення:
❌з 10:30 до 14:30
💡Підгрупа 2.2 відключення:
❌з 00:00 до 04:00
❌з 21:00 до 24:00

💡Підгрупа 3.1 відключення:
❌з 15:00 до 18:00`;
const pf=parsePowerMessage(fullTomorrow);
assert.equal(pf.kind,'full');
assert.deepEqual(pf.items.find(x=>x.group==='1.2').intervals,[[1260,1440]]);
assert.deepEqual(pf.items.find(x=>x.group==='2.2').intervals,[[0,240],[1260,1440]]);

const partialChange=`❗️ Зміни у графіку на сьогодні
Середа, 07.10.2026

💡 Підгрупа 2.2 відключення:
Було:
❌ з 03:00 до 07:00
❌ з 13:30 до 17:30
Стало:
❌ з 06:00 до 07:00
❌ з 13:30 до 17:30

💡 Підгрупа 6.1 відключення:
Було:
❌ з 00:00 до 03:30
Стало:
❌ з 00:00 до 01:30`;
const pc=parsePowerMessage(partialChange);
assert.equal(pc.items.length,1);
assert.equal(pc.items[0].group,'2.2');
assert.deepEqual(pc.items[0].intervals,[[360,420],[810,1050]]);

console.log('parser tests passed');
