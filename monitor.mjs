import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const ENTRY_URL = 'https://license-renew.tokyo-madoguchi-yoyaku.com/police-pref-tokyo/index_000.html';
const MAIN_URL = 'https://license-test.tokyo-madoguchi-yoyaku.com/police-pref-tokyo/01/html/main.html?lang=ja';
const VERSION = '0.2.0-headed-chromium';
const CALENDAR_PATH = '/police-pref-tokyo/calendar/01/html/main.html';
const PLACES = ['250:江東試験場','280:鮫洲試験場','270:府中試験場'];
const STATE = '.state/last.json';
export function dashboardEvent(event, detail={}) {
  console.log('DASHBOARD_EVENT',JSON.stringify({event,at:new Date().toISOString(),...detail}));
}
export async function notify(message, topic=process.env.NTFY_TOPIC, request=fetch, {kind='opening'}={}) {
  if (!/^koto-[a-f0-9]{32}$/.test(topic || '')) {
    dashboardEvent('notification-failed',{kind,reason:'input',field:'NTFY_TOPIC'});
    throw new Error('NTFY_TOPIC secret is missing or invalid.');
  }
  let response;
  try {
    response = await request('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,title:'東京学科試験・云端监控',message,priority:4,click:ENTRY_URL}),signal:AbortSignal.timeout(10000),redirect:'error'});
  } catch(error) {
    dashboardEvent('notification-failed',{kind,reason:['TimeoutError','AbortError'].includes(error?.name)?'timeout':'network'});
    throw error;
  }
  if (!response.ok) {
    dashboardEvent('notification-failed',{kind,reason:'http',status:response.status});
    throw new Error('Notification delivery failed: HTTP '+response.status);
  }
  let receipt;
  try {receipt=await response.json();} catch {
    dashboardEvent('notification-failed',{kind,reason:'invalid-receipt'});
    throw new Error('Notification receipt invalid.');
  }
  if (receipt.topic !== topic || receipt.event !== 'message' || !receipt.id) {
    dashboardEvent('notification-failed',{kind,reason:'invalid-receipt'});
    throw new Error('Notification receipt invalid.');
  }
  dashboardEvent('notification-accepted',{kind});
}
async function loadState(){try{return JSON.parse(await readFile(STATE,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
async function saveState(s){await mkdir('.state',{recursive:true});await writeFile(STATE,JSON.stringify(s));}
export function safeLocation(raw) {
  try {const u=new globalThis.URL(raw);return u.origin+u.pathname;}catch{return '(invalid URL)';}
}
export async function pageDiagnostics(page,stage,network=[]) {
  let visible;
  try {
    visible=await page.evaluate(()=>{
      const shown=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      return {
        documentReferrer:document.referrer ? new URL(document.referrer).origin+new URL(document.referrer).pathname : '',
        title:document.title,readyState:document.readyState,inputCount:document.querySelectorAll('input').length,
        headings:[...document.querySelectorAll('h1,h2,h3')].filter(shown).map(e=>e.textContent.trim().slice(0,120)),
        pages:[...document.querySelectorAll('[id^="page"]')].map(e=>({id:e.id,visible:shown(e)})),
        choices:[...document.querySelectorAll('input[type="radio"]')].filter(e=>['typeChoice','typeDetailChoice','newLicenseChoice','placeChoice'].includes(e.name)).map(e=>({name:e.name,id:e.id,value:e.value,checked:e.checked,disabled:e.disabled})),
        publicControls:[...document.querySelectorAll('a,button,input[type=button],label')].filter(shown).filter(e=>/学科試験の予約はこちら|空き状況|カレンダー/.test(e.textContent||e.value||'')).map(e=>({tag:e.tagName,text:(e.textContent||e.value||'').trim().slice(0,150)})),
        scripts:[...document.scripts].filter(e=>e.src).map(e=>{const u=new URL(e.src);return u.origin+u.pathname;}),
        styles:[...document.querySelectorAll('link[rel="stylesheet"]')].map(e=>{const u=new URL(e.href);return u.origin+u.pathname;})
      };
    });
  }catch(e){visible={diagnosticError:e.message};}
  const diagnostic={version:VERSION,stage,url:safeLocation(page.url()),...visible,network:network.slice(-30)};
  console.error('DIAGNOSTIC_BEGIN');console.error(JSON.stringify(diagnostic,null,2));console.error('DIAGNOSTIC_END');
  return diagnostic;
}
export async function clickPublicEntry(page,locator) {
  const context=page.context();
  const popup=context.waitForEvent('page',{timeout:4000}).catch(()=>null);
  await locator.click({timeout:15000});
  const next=await popup||page;
  await next.waitForLoadState('domcontentloaded',{timeout:30000});
  return next;
}
export async function openCalendarFromEntry(page) {
  console.log('ENTRY_STEP official entrance');
  const entrance=await page.goto(ENTRY_URL,{waitUntil:'domcontentloaded',timeout:45000});
  if(entrance&&entrance.status()>=400)throw new Error('Official entrance returned HTTP '+entrance.status());
  for(let step=0;step<5;step++){
    const current=new globalThis.URL(page.url());
    if(!/^license-(test|renew)\.tokyo-madoguchi-yoyaku\.com$/.test(current.hostname))throw new Error('Unexpected destination; navigation stopped.');
    if(current.hostname==='license-test.tokyo-madoguchi-yoyaku.com'&&current.pathname===CALENDAR_PATH)return page;
    if(current.hostname==='license-test.tokyo-madoguchi-yoyaku.com'&&current.pathname==='/police-pref-tokyo/index.html'){
      // The official index page was actually visited in this browser session.
      // Use Playwright's navigation option so both the request and document.referrer agree.
      const source=page.url();
      console.log('ENTRY_STEP public written-exam start');
      const response=await page.goto(MAIN_URL,{referer:source,waitUntil:'domcontentloaded',timeout:45000});
      if(response&&response.status()>=400)throw new Error('Written-exam start returned HTTP '+response.status());
      continue;
    }
    await page.waitForFunction(()=>[...document.querySelectorAll('a,button,input[type=button],label')].some(e=>e.getClientRects().length&&/学科試験の予約はこちら|空き状況.*カレンダー/.test(e.textContent||e.value||'')),null,{timeout:30000});
    const calendar=page.getByText(/空き状況.*カレンダー/).filter({visible:true});
    if(await calendar.count()){
      console.log('ENTRY_STEP public availability calendar');
      page=await clickPublicEntry(page,calendar.last());
      continue;
    }
    const exam=page.getByText('学科試験の予約はこちら',{exact:true});
    if(await exam.isVisible()){
      console.log('ENTRY_STEP written-exam entrance');
      page=await clickPublicEntry(page,exam);
      continue;
    }
    throw new Error('Public calendar link not found. No booking or agreement was submitted.');
  }
  throw new Error('Official navigation did not reach the public calendar within five steps.');
}
export async function prepareCalendar(page,restoreCalendar,place) {
  const network=[];
  const relevant=raw=>{try{return /^license-(test|renew)\.tokyo-madoguchi-yoyaku\.com$/.test(new globalThis.URL(raw).hostname);}catch{return false;}};
  const failed=req=>{if(relevant(req.url()))network.push({type:'requestfailed',url:safeLocation(req.url()),error:req.failure()?.errorText});};
  const response=res=>{
    if(!relevant(res.url()))return;
    if(res.status()>=400)network.push({type:'http',url:safeLocation(res.url()),status:res.status()});
    if(res.request().resourceType()==='document')void res.request().allHeaders().then(h=>network.push({type:'navigation',url:safeLocation(res.url()),status:res.status(),referer:h.referer?safeLocation(h.referer):'(missing)',referrerPolicy:res.headers()['referrer-policy']||'(browser default)'})).catch(()=>{});
  };
  const pageError=error=>network.push({type:'pageerror',message:error.message.slice(0,250)});
  const context=page.context();
  context.on('requestfailed',failed);context.on('response',response);
  page.on('pageerror',pageError);
  try {
    page=await openCalendarFromEntry(page);
    await page.waitForFunction(()=>[...document.querySelectorAll('input[type="radio"]')].some(e=>['typeChoice','typeDetailChoice','newLicenseChoice','placeChoice'].includes(e.name))||!!document.querySelector('#datepicker .ui-datepicker-calendar'),null,{timeout:30000});
    await page.evaluate(restoreCalendar,place);
    return page;
  }catch(error){
    // A popup may contain the actual failing page; diagnostics include its DOM, never cookies.
    const pages=context.pages();
    const diagnosticPage=pages.at(-1)||page;
    const diagnostic=await pageDiagnostics(diagnosticPage,'entry-navigation',network);
    if(diagnostic.inputCount===0)throw new Error('官网入口链中的页面未加载（inputCount=0）。请查看 ENTRY_STEP 和 DIAGNOSTIC 日志；尚未检查空位。');
    throw error;
  }finally {context.off('requestfailed',failed);context.off('response',response);for(const p of context.pages())p.off('pageerror',pageError);}
}

export async function scanVenue(page, functions, place, deadline, {stopOnOpening=true}={}) {
  const {restoreCalendar,readCalendar,turnCalendarMonth,checkReceptionSlots} = functions;
  const budget=()=>{if(Date.now()>deadline)throw new Error('Scan time limit reached; some dates remain unchecked.');};
  page=await prepareCalendar(page,restoreCalendar,place);
  for(let count=0;;count++){
    budget();if(count>=120)throw new Error('Previous-month navigation exceeded limit.');
    if(!(await page.evaluate(turnCalendarMonth,-1)).moved)break;
  }
  const months=[],unknown=[],openings=[];
  let checkedDates=0,fullDates=0;
  const coverage=()=>({place,months,unknown,openings,checkedDates,fullDates});
  for(;;){
    budget();const result=await page.evaluate(readCalendar);
    if(result.place!==place)throw new Error('Venue mismatch.');
    const month=result.year+'-'+String(result.month).padStart(2,'0');
    if(months.includes(month)||months.length>=120)throw new Error('Month navigation loop or unsupported range.');
    months.push(month);
    console.log('SCAN_MONTH',JSON.stringify({place,month,candidateDates:result.dates.length}));
    for(const date of result.dates){
      budget();
      const detail=await page.evaluate(({code,date,place})=>(0,eval)('('+code+')')(date,place),{code:checkReceptionSlots.toString(),date,place});
      if(detail.date!==date||!['full','unknown','available'].includes(detail.status))throw new Error('Time-slot response invalid.');
      checkedDates++;
      if(detail.status==='available'){
        if(!Array.isArray(detail.slots)||!detail.slots.length)throw new Error('Available time is missing its selectable slot.');
        const found={place,date,slots:detail.slots};
        openings.push(found);
        if(stopOnOpening)return {...coverage(),found};
      } else if(detail.status==='unknown')unknown.push(place.split(':')[1]+' '+date);
      else fullDates++;
    }
    if(!(await page.evaluate(turnCalendarMonth,1)).moved){
      console.log('SCAN_VENUE_COMPLETE',JSON.stringify(coverage()));
      return coverage();
    }
  }
}
export function openingMessage(opening){return `${opening.place.split(':')[1]} ${opening.date}\n${opening.slots.join('\n')}\n发现可选时段，请尽快在官网确认并预约。`}
export async function runWithVirtualDisplay(start=spawn) {
  console.log('BROWSER_MODE headed Chromium with a virtual display');
  const exitCode=await new Promise((resolve,reject)=>{
    const child=start('xvfb-run',['-a',process.execPath,fileURLToPath(import.meta.url)],{stdio:'inherit',env:process.env});
    child.once('error',error=>reject(new Error('Virtual display could not start: '+error.message)));
    child.once('exit',(code,signal)=>resolve(Number.isInteger(code)?code:1));
  });
  if(exitCode!==0)process.exitCode=exitCode;
}
export async function main(){
  const mode=process.env.MODE||'scan';
  if(mode==='test-notification'){await notify('云端通知测试：不是空位通知。',process.env.NTFY_TOPIC,fetch,{kind:'test'});console.log('Notification accepted by ntfy; confirm receipt on your phone.');return;}
  if(!['scan','verify'].includes(mode))throw new Error('Unknown mode.');
  const verification=mode==='verify';
  if(!verification&&!/^koto-[a-f0-9]{32}$/.test(process.env.NTFY_TOPIC||''))throw new Error('Set the NTFY_TOPIC repository secret first.');
  // Standard headed Chromium is the browser mode verified against the real site.
  // xvfb-run supplies its display on GitHub's Linux runner; no browser identity is modified.
  if(process.platform==='linux'&&!process.env.DISPLAY){await runWithVirtualDisplay();return;}
  console.log('MONITOR_VERSION',VERSION,'MODE',mode);
  const context=vm.createContext({});
  vm.runInContext(await readFile(new globalThis.URL('./calendar.js',import.meta.url),'utf8'),context);
  const previous=verification?{}:await loadState();
  const browser=await chromium.launch({headless:false});
  try {
    const page=await browser.newPage({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
    const results=[],deadline=Date.now()+6*60*1000;
    for(const place of PLACES){
      const result=await scanVenue(page,context,place,deadline,{stopOnOpening:!verification});
      results.push(result);
      dashboardEvent('venue-progress',{place:result.place,months:result.months,unknown:result.unknown,openings:result.openings,checkedDates:result.checkedDates,complete:!result.found});
      if(!verification&&result.found){
        const key=createHash('sha256').update(JSON.stringify(result.found)).digest('hex');
        dashboardEvent('opening-detected',{place:result.found.place,date:result.found.date,slots:result.found.slots});
        if(previous.opening!==key)await notify(openingMessage(result.found));
        else dashboardEvent('notification-duplicate',{place:result.found.place,date:result.found.date});
        await saveState({opening:key,checkedAt:new Date().toISOString()});
        console.log('Confirmed available reception time:',result.found.place,result.found.date);return;
      }
    }
    const unknown=results.flatMap(r=>r.unknown);
    console.log('SCAN_REPORT',JSON.stringify({version:VERSION,mode,checkedAt:new Date().toISOString(),venues:results,unverifiedDates:unknown}));
    if(unknown.length)throw new Error('Some reception times could not be verified. Scheduled monitoring will retry.');
    if(verification){
      console.log('VERIFIED: all three venues and accessible months checked; no notification sent and no state changed.');
    } else {
      await saveState({checkedAt:new Date().toISOString()});
      console.log('All venues and accessible months checked; no available reception time.');
    }
  } finally {await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('Monitor failed:',e.message);process.exitCode=1;});
