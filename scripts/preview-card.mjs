// Local-only PNG preview. No Telegram token, D1 production DB or network publisher.
import {unstable_dev} from 'wrangler';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=new URL('../outputs/',import.meta.url);
await mkdir(out,{recursive:true});
await writeFile(new URL('preview-wrangler.json',out),JSON.stringify({
  name:'botvoda-local-preview',main:'../src/index.js',compatibility_date:'2026-10-08',
  vars:{PREVIEW_MODE:'on',SCHEDULE_CARD_ENABLED:'off',DTEK_AUTO_SYNC:'off'},
  durable_objects:{bindings:[{name:'SCHEDULE_CARD_RENDERER',class_name:'ScheduleCardRenderer'}]},
  migrations:[{tag:'preview-v1',new_sqlite_classes:['ScheduleCardRenderer']}]
}));
const worker=await unstable_dev(root+'src/index.js',{
  config:root+'outputs/preview-wrangler.json',local:true,port:0,inspectorPort:0,
  experimental:{disableExperimentalWarning:true}});
try{
  const cases=[['today-and-tomorrow','2'],['today-only','1']];
  for(const [name,days] of cases){
    const response=await worker.fetch('/preview-card.png?days='+days);
    if(!response.ok)throw new Error('Preview failed: '+response.status+' '+await response.text());
    const image=new Uint8Array(await response.arrayBuffer());
    if(![137,80,78,71,13,10,26,10].every((v,i)=>image[i]===v))throw new Error('Not PNG');
    await writeFile(new URL('schedule-'+name+'.png',out),image);
    console.log(name+': '+image.length+' bytes');
  }
}finally{await worker.stop();}
