// Local-only PNG preview. No Telegram token, D1 production DB or network publisher.
import {unstable_dev} from 'wrangler';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=new URL('../outputs/',import.meta.url);
await mkdir(out,{recursive:true});
await writeFile(new URL('preview-worker.js',out),`
export {ScheduleCardRenderer} from '../src/schedule-card-object.js';
export default {fetch(request,env){return env.RENDERER.get(env.RENDERER.idFromName('preview')).fetch(request);}};
`);
await writeFile(new URL('preview-wrangler.json',out),JSON.stringify({
  name:'botvoda-local-preview',main:'preview-worker.js',compatibility_date:'2026-10-08',
  durable_objects:{bindings:[{name:'RENDERER',class_name:'ScheduleCardRenderer'}]},
  migrations:[{tag:'preview-v1',new_sqlite_classes:['ScheduleCardRenderer']}]
}));
const worker=await unstable_dev(root+'outputs/preview-worker.js',{
  config:root+'outputs/preview-wrangler.json',local:true,port:0,inspectorPort:0,
  experimental:{disableExperimentalWarning:true}});
try{
  const cases=[
    ['today-and-tomorrow',{today:'2026-10-31',todayPeriods:[[480,660],[960,1140]],tomorrow:'2026-11-01',tomorrowPeriods:[[480,660]],updatedAt:'2026-10-31T14:00:00Z'}],
    ['today-only',{today:'2026-10-31',todayPeriods:[[480,660],[960,1140]],tomorrow:null,tomorrowPeriods:null,updatedAt:'2026-10-31T14:00:00Z'}]
  ];
  for(const [name,payload] of cases){
    const response=await worker.fetch('/',{method:'POST',body:JSON.stringify(payload)});
    if(!response.ok)throw new Error('Preview failed: '+response.status+' '+await response.text());
    const image=new Uint8Array(await response.arrayBuffer());
    if(![137,80,78,71,13,10,26,10].every((v,i)=>image[i]===v))throw new Error('Not PNG');
    await writeFile(new URL('schedule-'+name+'.png',out),image);
    console.log(name+': '+image.length+' bytes');
  }
}finally{await worker.stop();}
