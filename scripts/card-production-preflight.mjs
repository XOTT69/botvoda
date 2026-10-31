// Read-only inspection. Never prints a token, bot secret, subscribers or messages.
import {writeFile} from 'node:fs/promises';
import {readFile} from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw new Error('Missing existing Cloudflare deployment credentials');
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
async function api(path,body){
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+path,{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok||data.success===false)throw new Error('Cloudflare inspection failed: HTTP '+response.status+' '+JSON.stringify(data.errors||[]));
  return data.result;
}
const settings=await api('/workers/scripts/botvoda/settings');
const db=settings.bindings?.find(x=>x.name==='DB'&&x.type==='d1');
if(db?.id!==config.d1_databases[0].database_id)throw new Error('Production D1 binding differs from repository; refusing deployment');
const result=await api('/d1/database/'+encodeURIComponent(db.id)+'/query',{
  sql:"SELECT group_chat_id,group_title,message_id,photo_message_id FROM publications WHERE group_title LIKE ? OR group_title LIKE ?",params:['%Покров%','%покров%']});
const targets=result[0]?.results||[];
if(targets.length!==1)throw new Error('Expected exactly one linked Pokrovska publication; found '+targets.length);
const deployments=await api('/workers/scripts/botvoda/deployments');
const summary={worker:'botvoda',databaseMatches:true,target:targets[0],
  previousDeployment:deployments.deployments?.[0]?.id||null,
  cardEnabled:settings.bindings?.find(x=>x.name==='SCHEDULE_CARD_ENABLED'&&x.type==='plain_text')?.text||'off'};
console.log(JSON.stringify(summary,null,2));
if(process.env.CARD_PREFLIGHT_OUTPUT)await writeFile(process.env.CARD_PREFLIGHT_OUTPUT,JSON.stringify(summary));
