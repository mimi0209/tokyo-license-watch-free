import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import worker,{parseLog,parseConfig,nextConfig,classify,midnightWindow,redact} from '../worker/index.js';
const config='workers_dev = false\n[triggers]\ncrons = ["*/5 * * * *"]\n[vars]\nENABLE_MONITOR = "true"\n';
const venues=['250:江東試験場','280:鮫洲試験場','270:府中試験場'];
const report={checkedAt:'2026-11-08T01:46:28.871Z',venues:venues.map(place=>({place,months:['2026-11'],unknown:[],openings:[],checkedDates:0})),unverifiedDates:[]};
const validTopic='koto-'+ 'a'.repeat(32);

test('calendar reports preserve zero candidate dates without calling them selectable slots',()=>{
  const result=parseLog('2026-11-08T01:46:28Z SCAN_REPORT '+JSON.stringify(report));
  assert.equal(result.allVenuesConfirmed,true);
  assert.equal(result.venues[0].candidateDatesChecked,0);
  assert.equal(result.venues[0].status,'no-selectable-dates');
});
test('job success alone never establishes venue coverage or zero errors',()=>{
  const result=parseLog('Process completed with exit code 0');
  assert.equal(result.allVenuesConfirmed,false);
  assert.equal(result.venues.every(v=>v.status==='unconfirmed'),true);
  assert.equal(result.duplicateHistory,'unrecorded');
});
test('partial coverage leaves later venues unconfirmed after finding an opening',()=>{
  const result=parseLog('DASHBOARD_EVENT '+JSON.stringify({event:'venue-progress',place:venues[0],complete:false,openings:[{date:'2026-11-12',slots:['09:00']}],months:['2026-11']}));
  assert.equal(result.venues[0].status,'available');
  assert.equal(result.venues[0].complete,false);
  assert.equal(result.venues[1].status,'unconfirmed');
  assert.equal(result.allVenuesConfirmed,false);
});
test('unknown dates remain visible even when every venue has a report',()=>{
  const input=structuredClone(report);input.venues[1].unknown=['2026-11-09'];input.unverifiedDates=['2026-11-09'];
  const result=parseLog('SCAN_REPORT '+JSON.stringify(input));
  assert.equal(result.allVenuesConfirmed,false);assert.deepEqual(result.unverifiedDates,['2026-11-09']);
});
test('notification receipts and duplicate suppression have separate event types',()=>{
  const result=parseLog(['notification-accepted','notification-duplicate','notification-failed'].map(event=>'DASHBOARD_EVENT '+JSON.stringify({event,kind:'opening',reason:'http',status:429})).join('\n'));
  assert.equal(result.events.length,3);assert.equal(result.duplicateHistory,'recorded');assert.equal(result.errors[0].category,'notification');
});
test('test notification legacy text does not double count an explicit acceptance',()=>{
  const result=parseLog('DASHBOARD_EVENT {"event":"notification-accepted","kind":"test"}\nNotification accepted by ntfy; confirm receipt on your phone.');
  assert.equal(result.events.length,1);
});
test('pause preserves midnight; full stop removes cron; start restores five minutes',()=>{
  const pause=parseConfig(nextConfig(config,'pause'));assert.equal(pause.enabled,false);assert.deepEqual(pause.crons,['*/5 * * * *']);
  const stop=parseConfig(nextConfig(config,'stop-all'));assert.equal(stop.enabled,false);assert.deepEqual(stop.crons,[]);
  const start=parseConfig(nextConfig(nextConfig(config,'stop-all'),'start'));assert.equal(start.enabled,true);assert.deepEqual(start.crons,['*/5 * * * *']);
});
test('unexpected configuration fails closed without rewriting an unrelated file',()=>{
  assert.throws(()=>nextConfig('ENABLE_MONITOR=true','pause'),/形式/);
  assert.throws(()=>nextConfig(config,'delete'),/不正/);
});
test('Japan midnight window crosses the UTC date correctly',()=>{
  assert.equal(midnightWindow(Date.parse('2026-11-08T01:50:00Z')).utc,'2026-11-07T15:00:00.000Z');
  assert.equal(midnightWindow(Date.parse('2026-11-07T14:59:59Z')).japanDate,'2026-11-07');
  assert.equal(midnightWindow(Date.parse('2026-11-07T15:00:00Z')).japanDate,'2026-11-08');
});
test('all requested failure categories have concrete classifiers',()=>{
  const cases=[['HTTP 503','http'],['net::ERR_CONNECTION_RESET','network'],['Page did not load inputCount=0','page'],['NTFY_TOPIC secret is missing.','input'],['Scan time limit reached; some dates remain unchecked.','timeout'],['Some reception times could not be verified.','unchecked'],['Notification delivery failed: HTTP 429','notification']];
  for(const [message,category] of cases)assert.equal(classify(message),category,message);
});
test('known credentials and notification topics are redacted',()=>{
  const out=redact(validTopic+' github_pat_fakecredentials ghp_secret Bearer anothersecret');
  assert.ok(!out.includes(validTopic));assert.ok(!out.includes('fakecredentials'));assert.ok(!out.includes('anothersecret'));
});
test('anonymous API calls cannot read logs or issue controls',async()=>{
  const res=await worker.fetch(new Request('https://example.com/api/status'),{});
  assert.equal(res.status,401);
});
test('cross-origin writes fail before credentials or provider calls',async()=>{
  const res=await worker.fetch(new Request('https://example.com/api/operate',{method:'POST',headers:{'oai-authenticated-user-id':'owner',origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'}),{});
  assert.equal(res.status,403);
});
test('controls require credentials, explicit enable, and durable duplicate protection',async()=>{
  const res=await worker.fetch(new Request('https://example.com/api/operate',{method:'POST',headers:{'oai-authenticated-user-id':'owner',origin:'https://example.com','Content-Type':'application/json'},body:'{}'}),{BOT_GITHUB_TOKEN:'fake',BOT_ALLOW_CONTROL:'true'});
  assert.equal(res.status,503);
});
test('HTML is protected and ships syntactically valid embedded JavaScript',async()=>{
  const res=await worker.fetch(new Request('https://example.com/',{headers:{'oai-authenticated-user-id':'owner'}}),{});
  assert.equal(res.status,200);
  const html=await res.text();
  assert.ok(res.headers.get('Content-Security-Policy').includes("object-src 'none'"));
  assert.ok(!html.includes('__NONCE__'));
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(()=>new vm.Script(script));
  assert.ok(html.includes('id="confirm-action"'));
  assert.ok(!html.includes('github_pat_'));
});
test('duplicate control submission returns the recorded result and never dispatches',async()=>{
  const expected={ok:true,state:'accepted',action:'scan',message:'already accepted'};
  const db={prepare(){return {bind(){return this;},async run(){return {meta:{changes:0}};},async first(){return {owner_id:'owner',action:'scan',state:'done',result:JSON.stringify(expected)};}};}};
  const request=new Request('https://example.com/api/operate',{method:'POST',headers:{'oai-authenticated-user-id':'owner',origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({action:'scan',id:'11111111-1111-1111-1111-111111111111'})});
  const res=await worker.fetch(request,{BOT_GITHUB_TOKEN:'fake',BOT_ALLOW_CONTROL:'true',DB:db});
  assert.equal(res.status,200);assert.equal((await res.json()).replayed,true);
});
test('an uncertain prior control is not retried after a timeout',async()=>{
  const db={prepare(){return {bind(){return this;},async run(){return {meta:{changes:0}};},async first(){return {owner_id:'owner',action:'scan',state:'pending',result:null};}};}};
  const request=new Request('https://example.com/api/operate',{method:'POST',headers:{'oai-authenticated-user-id':'owner',origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({action:'scan',id:'11111111-1111-1111-1111-111111111111'})});
  const res=await worker.fetch(request,{BOT_GITHUB_TOKEN:'fake',BOT_ALLOW_CONTROL:'true',DB:db});
  assert.equal(res.status,409);assert.equal((await res.json()).error.category,'operation-uncertain');
});
