import test from 'node:test';
import assert from 'node:assert/strict';
import {notify} from '../../monitor.mjs';
const topic='koto-'+'b'.repeat(32);
async function capture(fn) {
  const entries=[],original=console.log;
  console.log=(...args)=>entries.push(args.join(' '));
  try {await fn();} finally {console.log=original;}
  return entries.filter(x=>x.startsWith('DASHBOARD_EVENT ')).map(x=>JSON.parse(x.slice('DASHBOARD_EVENT '.length)));
}
test('ntfy acceptance telemetry excludes topic, body, and receipt id',async()=>{
  const events=await capture(()=>notify('test message',topic,async()=>new Response(JSON.stringify({topic,event:'message',id:'private-receipt'})),{kind:'test'}));
  assert.equal(events[0].event,'notification-accepted');assert.equal(events[0].kind,'test');
  assert.ok(!JSON.stringify(events).includes(topic));assert.ok(!JSON.stringify(events).includes('private-receipt'));
});
test('ntfy HTTP failure is recorded without logging secret values',async()=>{
  const events=await capture(async()=>{await assert.rejects(notify('msg',topic,async()=>new Response('',{status:429})),/HTTP 429/);});
  assert.equal(events[0].event,'notification-failed');assert.equal(events[0].status,429);assert.ok(!JSON.stringify(events).includes(topic));
});
test('invalid notification receipt never logs acceptance',async()=>{
  const events=await capture(async()=>{await assert.rejects(notify('msg',topic,async()=>new Response('{}')),/receipt invalid/);});
  assert.equal(events.length,1);assert.equal(events[0].reason,'invalid-receipt');
});
test('missing notification configuration records the field name only',async()=>{
  const events=await capture(async()=>{await assert.rejects(notify('msg','invalid',()=>{throw new Error('must not fetch');}),/missing or invalid/);});
  assert.equal(events[0].reason,'input');assert.equal(events[0].field,'NTFY_TOPIC');assert.ok(!JSON.stringify(events).includes('invalid'));
});
