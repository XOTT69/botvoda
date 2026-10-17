import assert from 'node:assert/strict';
import {classifyWaterReports,communityWaterLine,reportTimeKyiv,saveCommunityWaterReport} from '../src/water-reports.js';

assert.equal(classifyWaterReports(0,0),'empty');
assert.equal(classifyWaterReports(1,0),'limited');
assert.equal(classifyWaterReports(0,1),'limited');
assert.equal(classifyWaterReports(2,0),'on');
assert.equal(classifyWaterReports(0,2),'off');
assert.equal(classifyWaterReports(2,1),'mixed');
assert.equal(classifyWaterReports(1,2),'mixed');
assert.equal(classifyWaterReports(3,1),'on');
assert.equal(classifyWaterReports(1,3),'off');

assert.match(communityWaterLine({on:2,off:0}),/переважно повідомляють, що є/);
assert.match(communityWaterLine({on:2,off:1}),/суперечливі/);
assert.match(communityWaterLine({on:0,off:0}),/немає свіжих повідомлень/);
assert.ok(communityWaterLine({on:0,off:2}).includes('за 45 хв'));
assert.ok(reportTimeKyiv('2026-10-17 12:10:00').includes('15:10'));
assert.equal(reportTimeKyiv(null),null);
await assert.rejects(saveCommunityWaterReport({},'fake','on'),/Invalid reporter/);
await assert.rejects(saveCommunityWaterReport({},'12345','maybe'),/Invalid water report/);

// DB calls are atomic and update just one row per user, never a counter directly.
const queries=[];
const fakeDb={DB:{prepare(sql){queries.push(sql);return {bind(...args){queries.push(args);return {run:async()=>({meta:{changes:1}})};}};}}};
assert.equal(await saveCommunityWaterReport(fakeDb,'12345','on'),true);
assert.ok(queries[0].includes('ON CONFLICT(telegram_user_id)'));
assert.deepEqual(queries[1],['12345','on']);
console.log('community water reports tests passed');
