import assert from 'node:assert/strict';
import {parsePowerMessage,complement,availability,statusAt,nextChangeLabel,buildEvents} from '../src/lib.js';
const t=`💡Графік відключення світла на завтра.
📆П'ятниця 09.10.2026
💡Підгрупа 1.2 відключення:
❌з 08:00 до 10:00
🟡 можливе відключення з 14:00 до 16:00
💡Підгрупа 2.2 відключення:
❌з 12:00 до 14:00`;
const p=parsePowerMessage(t);assert.equal(p.date,'2026-10-09');assert.deepEqual(p.items[0].intervals,[[480,600]]);assert.deepEqual(p.items[0].possibleIntervals,[[840,960]]);
const a=availability(complement([[480,600]]),complement([[720,840]]));a.p22=complement([[720,840]]);const s=statusAt(a,700);assert.equal(s.current.power,true);assert.equal(s.next.minute,720);assert.equal(nextChangeLabel(s.next),'зникне світло');
const ev=buildEvents(a,{both_alerts:1,water_alerts:1,end_alerts:1,lead_minutes:30,min_window_minutes:120},'2026-10-09');assert.ok(ev.length>0);console.log('feature tests passed');
