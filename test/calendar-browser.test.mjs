import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

let browser;
const source=await readFile(new URL('../calendar.js',import.meta.url),'utf8');
const url='https://license-test.tokyo-madoguchi-yoyaku.com/police-pref-tokyo/calendar/01/html/main.html?lang=ja';
before(async()=>{browser=await chromium.launch({headless:false});});
after(async()=>{await browser?.close();});
async function fixture({positive=false,disabled=true,unchanged=false}={}){
  const page=await browser.newPage({timezoneId:'Asia/Tokyo'});
  const cells=Array.from({length:31},(_,i)=>i===0?'<td><a class="ui-state-default" style="background:#ffff80" href="#">1</a></td>':`<td class="ui-state-disabled ui-datepicker-unselectable"><span class="ui-state-default">${i+1}</span></td>`).join('');
  const html=`<!doctype html><input id="strChoiceDetail" value="250:江東試験場"><input type="radio" name="newLicenseChoice" value="1" checked><input type="radio" name="typeDetailChoice" value="11" checked><div id="page04"><div id="datepicker"><span class="ui-datepicker-year">2099</span><span class="ui-datepicker-month">12月</span><table class="ui-datepicker-calendar"><tbody><tr>${cells}</tr></tbody></table></div></div><input id="visitDate"><div id="waitVisitTimeList" style="display:none"></div><div id="visitTimeChoiceList"><label>前回表示 残り 0名</label></div><script>
  document.querySelector('a').onclick=e=>{e.preventDefault();document.querySelector('#visitDate').value='2099/12/01';
  ${unchanged?'':`document.querySelector('#visitTimeChoiceList').innerHTML='<label><input type="radio" ${disabled?'disabled':''}>午前試験 残り ${positive?1:0}名</label><label><input type="radio" disabled>午後試験 残り 0名</label>';`}};
  document.addEventListener('change',()=>{document.body.dataset.timeSelected='true';});</script>`;
  // Every request is intercepted. The official host only supplies location context; no live site or notification is called.
  await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  await page.goto(url);
  await page.addScriptTag({content:source});
  return page;
}
async function check(page){return page.evaluate(()=>checkReceptionSlots('2099-12-01','250:江東試験場'));}
test('only the selectable yellow date is a candidate; disabled gray dates are excluded',async()=>{
  const p=await fixture();try{const r=await p.evaluate(()=>readCalendar());assert.deepEqual(r.dates,['2099-12-01']);}finally{await p.close();}
});
test('yellow date with zero seats in every time is confirmed full',async()=>{
  const p=await fixture();try{const r=await check(p);assert.equal(r.status,'full');assert.equal(r.calendarSelectable,true);assert.deepEqual(r.slots,[]);}finally{await p.close();}
});
test('a positive enabled time is available, and no time or booking is selected',async()=>{
  const p=await fixture({positive:true,disabled:false});try{const r=await check(p);assert.equal(r.status,'available');assert.equal(r.slots.length,1);assert.equal(await p.locator('#visitTimeChoiceList input:checked').count(),0);assert.equal(await p.locator('body').getAttribute('data-time-selected'),null);}finally{await p.close();}
});
test('a positive count with a disabled time is uncertain, never all-zero',async()=>{
  const p=await fixture({positive:true});try{const r=await check(p);assert.equal(r.status,'unknown');assert.notEqual(r.calendarSelectable,true);}finally{await p.close();}
});
test('a date that disappears before inspection never produces a yellow/zero-seats signal',async()=>{
  const p=await fixture();try{await p.locator('a').evaluate(e=>e.remove());const r=await check(p);assert.equal(r.calendarSelectable,false);}finally{await p.close();}
});
test('stale zero-seat contents that never refresh are unknown, not a zero-seats notification',async()=>{
  const p=await fixture({unchanged:true});try{const r=await check(p);assert.equal(r.status,'unknown');assert.notEqual(r.calendarSelectable,true);}finally{await p.close();}
});
