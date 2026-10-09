import assert from 'node:assert/strict';
import {parsePowerMessage,complement,availability,total} from '../src/lib.js';
const t=`❗️ Зміни у графіку на сьогодні
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
const p=parsePowerMessage(t);assert.equal(p.date,'2026-10-08');assert.deepEqual(p.items[0].intervals,[[630,1050],[1260,1440]]);assert.deepEqual(p.items[1].intervals,[[0,240],[630,870],[1260,1440]]);
const a=availability(complement(p.items[0].intervals),complement(p.items[1].intervals));assert.equal(total(a.water),1140);assert.equal(total(a.both),600);console.log('parser tests passed');
