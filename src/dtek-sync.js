import {
  GLOBAL_SCOPE,getRawDay,getSetting,setSetting,saveHistory,logChange
} from './db.js';
import {addDays,localNow} from './lib.js';

export const DTEK_STATE_URL =
  'https://raw.githubusercontent.com/XOTT69/dtek/main/state/publications.json';
const GROUPS = Array.from({length:6},(_,i)=>[
  (i+1)+'.1',(i+1)+'.2'
]).flat();
const TARGET_GROUPS = ['1.2','2.2'];
const MAX_BYTES = 300_000;

function validIntervals(value) {
  if (!Array.isArray(value) || value.length > 48) return null;
  const result=[];
  let last=0;
  for(const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [start,end]=pair;
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < last || start < 0 || end > 1440 || end <= start ||
      start%30!==0 || end%30!==0) return null;
    result.push([start,end]);
    last=end;
  }
  return result;
}

export function decodeDtekSnapshot(state, date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))return null;
  const source=state?.scheduleSnapshots?.[date];
  if(!source || typeof source!=='object' || Array.isArray(source))return null;
  // DTEK writes complete snapshots only when all 12 groups have
  // confirmed fact data. Reject partial/corrupted content altogether.
  if(!GROUPS.every(g=>Object.hasOwn(source,g)))return null;
  const verified={};
  for(const group of GROUPS) {
    const xs=validIntervals(source[group]);
    if(xs===null)return null;
    if(TARGET_GROUPS.includes(group))verified[group]=xs;
  }
  return verified;
}

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/**
 * Poll the public DTEK repository rather than parsing Telegram posts.
 * Import 1.2 for the WATER rule and 2.2 for household power.
 * Do not change the separate water fallback rule or actual power events.
 */
export async function syncDtekSchedules(env,{
  now=new Date(), fetcher=fetch, logger=console, endpoint=DTEK_STATE_URL
}={}) {
  if(env.DTEK_AUTO_SYNC==='off')return {status:'disabled',updated:[],unchanged:[],missing:[]};
  const today=localNow(now).date;
  const dates=[today,addDays(today,1)];
  const url=new URL(endpoint);
  url.searchParams.set('_ts',String(now.getTime())); // bypass stale CDN cache
  let response;
  try {
    response=await fetcher(url.toString(),{
      headers:{'Accept':'application/json'},
      cache:'no-store',
      signal:AbortSignal.timeout(12000)
    });
  } catch(error) {
    throw new Error('DTEK snapshot unavailable: '+String(error?.message||error));
  }
  if(!response?.ok)throw new Error('DTEK snapshot HTTP '+response?.status);
  const body=await response.text();
  if(body.length>MAX_BYTES)throw new Error('DTEK snapshot exceeds size limit');
  let data;
  try{data=JSON.parse(body)}catch{throw new Error('DTEK snapshot is not valid JSON')}
  if(!data || typeof data!=='object'||!data.scheduleSnapshots)
    throw new Error('DTEK scheduleSnapshots are missing');

  const updated=[],unchanged=[],missing=[];
  for(const date of dates) {
    const groups=decodeDtekSnapshot(data,date);
    if(!groups){missing.push(date);continue}
    const fingerprint=JSON.stringify(groups);
    const setting='dtek_auto_snapshot:'+date;
    const previousFingerprint=await getSetting(env,setting);
    const local=await getRawDay(env,date);
    const current=Object.fromEntries(TARGET_GROUPS.map(g=>[
      g,local.rows[g]?.intervals??null
    ]));
    // Always compare the actual D1 rows, not only the cached fingerprint:
    // a manual edit or a partial DB recovery must be corrected automatically.
    if(TARGET_GROUPS.every(g=>same(current[g],groups[g]))) {
      if(previousFingerprint!==fingerprint)await setSetting(env,setting,fingerprint);
      unchanged.push(date);
      continue;
    }

    // Preserve rollback history. Atomic D1 batch commits both groups and
    // the fingerprint together, or none of them.
    await saveHistory(env,date,'dtek_auto_sync','Перед автоматичною синхронізацією ДТЕК');
    const source='ДТЕК: XOTT69/dtek confirmed fact '+date;
    const statements=[];
    for(const g of TARGET_GROUPS) {
      statements.push(env.DB.prepare(
        'INSERT INTO schedules(chat_id,schedule_date,group_name,mode,intervals_json,source_text) '+
        'VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,schedule_date,group_name) DO UPDATE SET '+
        'mode=excluded.mode,intervals_json=excluded.intervals_json, '+
        'source_text=excluded.source_text,created_at=CURRENT_TIMESTAMP'
      ).bind(GLOBAL_SCOPE,date,g,'off',JSON.stringify(groups[g]),source));
      statements.push(env.DB.prepare(
        'INSERT INTO schedule_possible(schedule_date,group_name,intervals_json) '+
        'VALUES(?,?,?) ON CONFLICT(schedule_date,group_name) DO UPDATE SET '+
        'intervals_json=excluded.intervals_json,updated_at=CURRENT_TIMESTAMP'
      ).bind(date,g,'[]'));
    }
    statements.push(env.DB.prepare(
      'INSERT INTO app_settings(key,value) VALUES(?,?) '+
      'ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP'
    ).bind(setting,fingerprint));
    await env.DB.batch(statements);
    updated.push(date);
    logger.log('Synced DTEK confirmed schedules for '+date+
      ': groups 1.2, 2.2');
    await logChange(env,date,'🤖 Автооновлення ДТЕК: групи 1.2 та 2.2');
  }
  return {status:'ok',updated,unchanged,missing};
}
