// Selectors are grounded in the user's saved read-only calendar HTML.
function readCalendar() {
  const visible = e => !!e && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  if (location.hostname !== 'license-test.tokyo-madoguchi-yoyaku.com' ||
      location.pathname !== '/police-pref-tokyo/calendar/01/html/main.html')
    throw new Error('公式の空き状況カレンダーで開始してください。予約申込画面は対象外です。');
  const page = document.querySelector('#page04');
  if (!visible(page)) throw new Error('日付カレンダーが表示されていません。手動で日付画面まで進んでください。');
  const place = document.querySelector('#strChoiceDetail')?.value;
  const license = document.querySelector('input[name="newLicenseChoice"]:checked')?.value;
  const kind = document.querySelector('input[name="typeDetailChoice"]:checked')?.value;
  if (!['250:江東試験場','280:鮫洲試験場','270:府中試験場'].includes(place) || license !== '1' || kind !== '11')
    throw new Error('教習所卒業等・免許証のみ・江東／鮫洲／府中を選び直してください。');
  const root = page.querySelector('#datepicker');
  const year = Number(root?.querySelector('.ui-datepicker-year')?.textContent);
  const month = Number(root?.querySelector('.ui-datepicker-month')?.textContent.replace(/\D/g,''));
  if (!Number.isInteger(year) || year < 1970 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('カレンダーの年月を読み取れません。');
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [...root.querySelectorAll('.ui-datepicker-calendar tbody td')];
  const numbers = cells.map(td => Number(td.textContent.trim())).filter(n => n >= 1 && n <= dayCount);
  if (new Set(numbers).size !== dayCount) throw new Error('日付の読み込みを確認できませんでした。');
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const days = cells.filter(td => !td.matches('.ui-state-disabled, .ui-datepicker-unselectable, .ui-datepicker-other-month') &&
    td.getAttribute('aria-disabled') !== 'true' && !!td.querySelector('a.ui-state-default'))
    .map(td => Number(td.querySelector('a.ui-state-default').textContent.trim()))
    .filter(d => d >= 1 && d <= dayCount && `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}` >= today);
  const dates = [...new Set(days)].sort((a,b)=>a-b).map(d => `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
  return {dates, days:[...new Set(days)].sort((a,b)=>a-b), place, license, kind, year, month};
}

// Only use the public calendar's selection controls; never submit a booking or agree to terms.
async function restoreCalendar(targetPlace) {
  const visible = e => !!e && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const choose = selector => {
    const e = document.querySelector(selector);
    if (!e) throw new Error('選択項目が見つかりません。画面が変更された可能性があります。');
    if (!e.checked) (e.closest('label') || e).click();
  };
  if (!['250:江東試験場','280:鮫洲試験場','270:府中試験場'].includes(targetPlace)) throw new Error('監視対象外の会場です。');
  const clicked = new Set();
  const deadline = Date.now() + 24000;
  while (Date.now() < deadline) {
    if (location.hostname !== 'license-test.tokyo-madoguchi-yoyaku.com' ||
        location.pathname !== '/police-pref-tokyo/calendar/01/html/main.html')
      throw new Error('カレンダー以外の画面に移動したため停止しました。');
    if (visible(document.querySelector('#page04')) && document.querySelector('#datepicker .ui-datepicker-calendar')) return;
    if (visible(document.querySelector('#page02')) && !clicked.has('page02')) {
      choose('input[name="typeDetailChoice"][value="11"]');
      choose('input[name="newLicenseChoice"][value="1"]');
      const next = document.querySelector('#nextPageBtn02');
      if (visible(next) && !next.disabled) {clicked.add('page02'); next.click();}
    } else if (visible(document.querySelector('#page03')) && visible(document.querySelector('#placeChoiceArea')) && !clicked.has('page03')) {
      choose('input[name="placeChoice"][value="'+targetPlace+'"]');
      const next = document.querySelector('#nextPageBtn03');
      if (visible(next) && !next.disabled) {clicked.add('page03'); next.click();}
    } else if (visible(document.querySelector('#page01')) && !clicked.has('page01')) {
      clicked.add('page01'); choose('input[name="typeChoice"][value="1"]');
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('更新後にカレンダーへ戻れませんでした。手動で開き直して再開してください。');
}

// Runs in MAIN world so jQuery's active-request counter can be checked when available.
async function turnCalendarMonth(direction) {
  if (![1,-1].includes(direction)) throw new Error('月の移動方向が不正です。');
  const root = () => document.querySelector('#page04 #datepicker');
  const heading = () => {
    const r = root();
    return [Number(r?.querySelector('.ui-datepicker-year')?.textContent), Number(r?.querySelector('.ui-datepicker-month')?.textContent.replace(/\D/g,''))];
  };
  const before = heading();
  if (!before[0] || before[1]<1 || before[1]>12) throw new Error('移動前の年月が不明です。');
  const nav = root()?.querySelector(direction === 1 ? '.ui-datepicker-next' : '.ui-datepicker-prev');
  if (!nav) throw new Error('月移動ボタンが見つかりません。');
  if (nav.matches('.ui-state-disabled') || nav.getAttribute('aria-disabled') === 'true') return {moved:false};
  const expected = new Date(Date.UTC(before[0],before[1]-1+direction,1));
  nav.click();
  const until = Date.now()+15000;
  let last = '', stableSince = Date.now();
  while (Date.now()<until) {
    await new Promise(resolve=>setTimeout(resolve,200));
    const current = heading();
    const r = root();
    const signature = r?.innerHTML || '';
    if (signature !== last) {last=signature;stableSince=Date.now();}
    const pending = window.jQuery && typeof window.jQuery.active === 'number' ? window.jQuery.active : 0;
    if (current[0] === expected.getUTCFullYear() && current[1] === expected.getUTCMonth()+1 &&
        r?.querySelector('.ui-datepicker-calendar tbody td') && pending === 0 && Date.now()-stableSince>=1000)
      return {moved:true,year:current[0],month:current[1]};
  }
  throw new Error('月切替の完了を確認できませんでした。');
}

// Inspect public reception times only; never select a time or submit a reservation.
async function checkReceptionSlots(date, expectedPlace) {
  const visible = e => !!e && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  if (location.hostname !== 'license-test.tokyo-madoguchi-yoyaku.com' || location.pathname !== '/police-pref-tokyo/calendar/01/html/main.html') throw new Error('公式カレンダーから移動しました。');
  if (document.querySelector('#strChoiceDetail')?.value !== expectedPlace || document.querySelector('input[name="newLicenseChoice"]:checked')?.value !== '1' || document.querySelector('input[name="typeDetailChoice"]:checked')?.value !== '11') throw new Error('受付時間の確認条件が変わりました。');
  const root = document.querySelector('#page04 #datepicker');
  const [year,month,day] = date.split('-').map(Number);
  if (Number(root?.querySelector('.ui-datepicker-year')?.textContent) !== year || Number(root?.querySelector('.ui-datepicker-month')?.textContent.replace(/\D/g,'')) !== month) throw new Error('受付時間を確認する月が変わりました。');
  const cell = [...root.querySelectorAll('.ui-datepicker-calendar tbody td')].find(td => !td.matches('.ui-datepicker-other-month,.ui-state-disabled,.ui-datepicker-unselectable') && Number(td.querySelector('a.ui-state-default')?.textContent.trim()) === day);
  const link = cell?.querySelector('a.ui-state-default');
  if (!link) return {status:'full',date,slots:[]}; // The candidate disappeared since the month scan.
  const list = document.querySelector('#visitTimeChoiceList');
  if (!list) throw new Error('受付時間の表示欄が見つかりません。');
  let changed = false, signature = '', stableSince = Date.now();
  const observer = new MutationObserver(()=>{changed=true;stableSince=Date.now();});
  observer.observe(list,{childList:true,subtree:true,characterData:true,attributes:true});
  const until = Date.now()+15000;
  try {
    link.click();
    while (Date.now()<until) {
      await new Promise(resolve=>setTimeout(resolve,200));
      if (document.querySelector('#strChoiceDetail')?.value !== expectedPlace) throw new Error('会場が変わりました。');
      const selected = document.querySelector('#visitDate')?.value?.replace(/\D/g,'');
      const expected = date.replace(/-/g,'');
      const text = list.textContent.normalize('NFKC').replace(/\s+/g,' ').trim();
      const current = list.innerHTML;
      if (current !== signature) {signature=current;stableSince=Date.now();}
      const pending = window.jQuery && typeof window.jQuery.active === 'number' ? window.jQuery.active : 0;
      if (!changed || selected !== expected || !visible(list) || visible(document.querySelector('#waitVisitTimeList')) || pending || Date.now()-stableSince<800) continue;
      const counts = [...text.matchAll(/残り\s*([\d,]+)\s*名/g)].map(m=>Number(m[1].replace(/,/g,'')));
      if (!counts.length) continue;
      const slots = [];
      for (const input of list.querySelectorAll('input[type="radio"]')) {
        const row = input.closest('label') || input.parentElement;
        const label = row?.textContent.normalize('NFKC').replace(/\s+/g,' ').trim() || '';
        const count = label.match(/残り\s*([\d,]+)\s*名/);
        if (count && Number(count[1].replace(/,/g,''))>0 && visible(row) && !input.disabled && !input.matches(':disabled') && input.getAttribute('aria-disabled') !== 'true' && !row.matches('.disabled,.ui-state-disabled,[aria-disabled="true"]')) slots.push(label);
      }
      if (slots.length) return {status:'available',date,slots};
      if (counts.every(n=>n===0)) return {status:'full',date,slots:[]};
      // Positive counts without an enabled time control are not a confirmed opening.
      return {status:'unknown',date,slots:[],reason:'残席表示はありますが選択可能な受付時間を確認できません'};
    }
    return {status:'unknown',date,slots:[],reason:'受付時間の最新表示を確認できません'};
  } finally {observer.disconnect();}
}
