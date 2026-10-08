import assert from 'node:assert/strict';
import {parsePowerMessage,complement,availability,total,buildEvents} from '../src/lib.js';
const t=`❗️ Зміни у графіку на сьогодні\nЧетвер, 08.10.2026\n\n💡 Підгрупа 1.2 відключення:\nБуло:\n❌ з 21:00 до 24:00\nСтало:\n❌ з 10:30 до 17:30\n❌ з 21:00 до 24:00\n\n💡 Підгрупа 2.2 відключення:\nБуло:\n❌ з 00:00 до 04:00\nСтало:\n❌ з 00:00 до 04:00\n❌ з 10:30 до 14:30\n❌ з 21:00 до 24:00`;
const p=parsePowerMessage(t);assert.equal(p.date,'2026-10-08');assert.deepEqual(p.items[0].intervals,[[630,1050],[1260,1440]]);assert.deepEqual(p.items[1].intervals,[[0,240],[630,870],[1260,1440]]);
const a=availability(complement(p.items[0].intervals),complement(p.items[1].intervals));assert.equal(total(a.water),1140);assert.equal(total(a.both),600);assert.deepEqual(a.best,[240,630]);
const ev=buildEvents(a,{both_alerts:1,water_alerts:1,end_alerts:1,lead_minutes:30},'2026-10-08');assert.ok(ev.some(x=>x.key.includes('both-start-240')));console.log('tests passed');
