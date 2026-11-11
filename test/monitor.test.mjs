import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {scanVenue,notifyObservation,retainObservedDates,calendarFullMessage,notify} from '../monitor.mjs';

const place='250:江東試験場';
const full={kind:'calendar-full',place,date:'2099-12-01'};
const available={kind:'available',place,date:full.date,slots:['午前試験（受付時間 8:00）従来の免許証 残り 1名']};
function delivery(){
  const sent=[],saved=[];
  return {sent,saved,options:{send:async message=>sent.push(message),persist:async state=>saved.push(structuredClone(state))}};
}

test('yellow/zero-seats message explicitly says every time is zero and monitoring continues',()=>{
  const message=calendarFullMessage(full);
  assert.match(message,/江東試験場 2099-12-01/);
  assert.match(message,/カレンダーは黄色/);
  assert.match(message,/すべて0人/);
  assert.match(message,/監視を継続/);
  assert.doesNotMatch(message,/未確認|空き枠を発見|请尽快/);
});
test('same yellow/zero-seats date is notified once across repeated scans and state reloads',async()=>{
  const d=delivery();const state={};
  assert.equal(await notifyObservation(full,state,d.options),true);
  assert.equal(await notifyObservation(full,structuredClone(d.saved.at(-1)),d.options),false);
  assert.equal(d.sent.length,1);
});
test('real opening after yellow/zero seats still notifies, and zero again has its own message',async()=>{
  const d=delivery();const state={};
  for(const item of [full,available,available,full,full])await notifyObservation(item,state,d.options);
  assert.equal(d.sent.length,3);
  assert.match(d.sent[0],/すべて0人/);
  assert.match(d.sent[1],/发现可选时段/);
  assert.match(d.sent[2],/すべて0人/);
});
test('different dates and venues have independent deduplication',async()=>{
  const d=delivery();const state={};
  for(const item of [full,{...full,date:'2099-12-02'},{...full,place:'280:鮫洲試験場'},full])await notifyObservation(item,state,d.options);
  assert.equal(d.sent.length,3);
});
test('a disappeared yellow date can notify again when it reappears',async()=>{
  const d=delivery();const state={};
  await notifyObservation(full,state,d.options);
  retainObservedDates(state,[{openings:[],calendarFullDates:[]}]);
  assert.equal(Object.keys(state.observations).length,0);
  await notifyObservation(full,state,d.options);
  assert.equal(d.sent.length,2);
});
test('notification failure is not marked delivered and is retried',async()=>{
  const state={};const d=delivery();
  await assert.rejects(()=>notifyObservation(full,state,{...d.options,send:async()=>{throw new Error('HTTP 500');}}),/500/);
  assert.equal(d.saved.length,0);
  assert.equal(Object.keys(state.observations).length,0);
  await notifyObservation(full,state,d.options);
  assert.equal(d.sent.length,1);
});
test('accepted notice is persisted even if a later date check fails',async()=>{
  const d=delivery();const state={};
  await notifyObservation(full,state,d.options);
  const reloaded=structuredClone(d.saved[0]);
  await notifyObservation(full,reloaded,d.options);
  assert.equal(d.sent.length,1);
});
test('legacy confirmed-opening dedup migrates without resending the same opening',async()=>{
  const d=delivery();const opening={place,date:available.date,slots:available.slots};
  const state={opening:createHash('sha256').update(JSON.stringify(opening)).digest('hex')};
  assert.equal(await notifyObservation(available,state,d.options),false);
  retainObservedDates(state,[{openings:[opening],calendarFullDates:[]}]);
  assert.equal(state.opening,undefined);
  assert.equal(d.sent.length,0);
});

const functions={restoreCalendar(){},readCalendar(){},turnCalendarMonth(){},checkReceptionSlots(){}};
async function fixtureScan(details,onDateChecked=async()=>{}){
  let index=0;const checked=[];
  const months=[[2099,11],[2099,12],[2100,1]];
  const p={url:()=> 'https://license-test.tokyo-madoguchi-yoyaku.com/police-pref-tokyo/calendar/01/html/main.html',
    context:()=>({on(){},off(){},pages:()=>[p]}),on(){},off(){},async goto(){},async waitForFunction(){},
    async evaluate(fn,args){
      if(fn===functions.restoreCalendar)return;
      if(fn===functions.turnCalendarMonth){if(index+args<0||index+args>=months.length)return {moved:false};index+=args;return {moved:true};}
      if(fn===functions.readCalendar)return {place,year:months[index][0],month:months[index][1],dates:index===1?Object.keys(details):[]};
      checked.push(args.date);return {date:args.date,slots:[],...details[args.date]};
    }};
  const result=await scanVenue(p,functions,place,Date.now()+10000,{stopOnOpening:false,onDateChecked});
  return {result,checked};
}
test('zero seats sends an observation, then keeps checking later dates and all months',async()=>{
  const observed=[];
  const r=await fixtureScan({'2099-12-01':{status:'full',calendarSelectable:true},'2099-12-02':{status:'available',slots:available.slots}},async x=>observed.push(x));
  assert.deepEqual(observed.map(x=>x.kind),['calendar-full','available']);
  assert.deepEqual(r.checked,['2099-12-01','2099-12-02']);
  assert.deepEqual(r.result.months,['2099-11','2099-12','2100-01']);
  assert.equal(r.result.calendarFullDates.length,1);
  assert.equal(r.result.openings.length,1);
});
test('disappeared date and uncertain slot display never become a zero-seats notice',async()=>{
  const observed=[];
  const r=await fixtureScan({'2099-12-01':{status:'full',calendarSelectable:false},'2099-12-02':{status:'unknown'}},async x=>observed.push(x));
  assert.deepEqual(observed,[]);
  assert.equal(r.result.unknown.length,1);
  assert.equal(r.result.calendarFullDates.length,0);
});
test('verification traverses yellow and available dates without sending any notifications',async()=>{
  const r=await fixtureScan({'2099-12-01':{status:'full',calendarSelectable:true},'2099-12-02':{status:'available',slots:available.slots}});
  assert.equal(r.result.months.length,3);
  assert.equal(r.result.calendarFullDates.length,1);
  assert.equal(r.result.openings.length,1);
});
test('ntfy acceptance is validated without real credentials or network requests',async()=>{
  const topic='koto-'+'a'.repeat(32);
  await notify(calendarFullMessage(full),topic,async(url,options)=>{
    assert.equal(url,'https://ntfy.sh/');assert.match(JSON.parse(options.body).message,/すべて0人/);
    return {ok:true,json:async()=>({topic,event:'message',id:'fake-receipt'})};
  });
  await assert.rejects(()=>notify('test',topic,async()=>({ok:false,status:500})),/HTTP 500/);
});
