'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = n => n == null || n === '' ? '' : Math.round(n).toLocaleString('en-US');
const mil = n => (Math.abs(n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 });
const KIND = { official: 'رسمی', unofficial: 'غیر رسمی' };
let B = null; // bootstrap
const main = $('#main');

async function api(path, opt = {}) {
  const o = { method: opt.method || 'GET', headers: {} };
  if (opt.json !== undefined) { o.method = opt.method || 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.json); }
  if (opt.raw) { o.method = 'POST'; o.body = opt.raw; if (opt.filename) o.headers['X-Filename'] = encodeURIComponent(opt.filename); }
  const r = await fetch('/api/' + path, o); const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'خطا در ارتباط با برنامه');
  return d;
}
let tt; function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => t.className = '', err ? 6000 : 2800); }
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const catName = id => B.categories.find(c => c.id == id)?.name || '';
const catOptions = sel => B.categories.filter(c => c.active).map(c => `<option value="${c.id}" ${c.id == sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const balCls = n => n < 0 ? 'neg' : '';
const money = n => `<span class="num ${balCls(n)}">${fmt(n)}</span>`;

/* ---------- تاریخ و مبلغ ---------- */
const toLatin = s => String(s ?? '').replace(/[۰-۹]/g, c => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, c => c.charCodeAt(0) - 1632);
function normDate(v) {
  v = toLatin(v).trim(); if (!v) return '';
  const today = B.today.split('/').map(Number);
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/); if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})$/); if (m) return `${today[0]}/${String(m[2]).padStart(2, '0')}/${String(m[1]).padStart(2, '0')}`;
  m = v.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (m) return `${m[1]}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`;
  return v;
}
function bindMoney(inp) { inp.addEventListener('input', () => { const d = toLatin(inp.value).replace(/[^\d]/g, ''); inp.value = d ? Number(d).toLocaleString('en-US') : ''; }); }
const dateIn = (id, val) => `<input id="${id}" class="num" inputmode="numeric" placeholder="1405/08/13" value="${esc(val || '')}" size="11" onblur="this.value=normDate(this.value)">`;

/* ---------- نمودارهای SVG ---------- */
function stepChart(rows) {
  if (!rows.length) return '<div class="empty">هنوز واریز یا تنخواهی ثبت نشده است.</div>';
  const W = 760, H = 200, P = { l: 8, r: 8, t: 14, b: 22 };
  const days = s => { const [y, m, d] = s.split('/').map(Number); return y * 372 + (m - 1) * 31 + d; };
  const pts = rows.map(r => ({ x: days(r.date), y: r.balance, r })); const x0 = pts[0].x, x1 = Math.max(pts.at(-1).x, x0 + 1);
  const ys = pts.map(p => p.y).concat(0); let lo = Math.min(...ys), hi = Math.max(...ys); if (hi === lo) hi = lo + 1; const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  const X = x => W - P.r - (x - x0) / (x1 - x0) * (W - P.l - P.r), Y = y => P.t + (hi - y) / (hi - lo) * (H - P.t - P.b);
  let d = `M${X(pts[0].x).toFixed(1)},${Y(pts[0].y).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].x).toFixed(1)} V${Y(pts[i].y).toFixed(1)}`;
  const zy = Y(0), negArea = lo < 0 ? `<rect x="0" y="${zy}" width="${W}" height="${H - P.b - zy}" fill="#b3261e" opacity=".07"/>` : '';
  const dots = pts.filter(p => p.r.kind === 'deposit').map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="#2b6a4b"><title>${p.r.date} واریز ${fmt(p.r.deposit)}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="نمودار مانده تنخواه در طول سال">${negArea}<line x1="0" x2="${W}" y1="${zy}" y2="${zy}" stroke="#b3261e" stroke-dasharray="4 4" opacity=".6"/>
  <text x="${W - 4}" y="${zy - 4}" font-size="11" fill="#b3261e" text-anchor="start" transform="translate(-24 0)">صفر</text>
  <path d="${d}" fill="none" stroke="#1d4a34" stroke-width="1.8"/>${dots}
  <text x="${W - P.r}" y="${H - 4}" font-size="11" fill="#4a5c50" text-anchor="start" direction="ltr" transform="translate(-48 0)">${rows[0].date}</text><text x="${P.l}" y="${H - 4}" font-size="11" fill="#4a5c50" text-anchor="start" direction="ltr">${rows.at(-1).date}</text></svg>`;
}
function monthBars(ms) {
  const W = 520, H = 170, max = Math.max(...ms.map(m => m.value), 1), bw = W / 12;
  return `<svg viewBox="0 0 ${W} ${H + 30}" role="img" aria-label="هزینه ماهانه">${ms.map((m, i) => { const h = m.value / max * (H - 16), x = W - (i + 1) * bw + 6;
    return `<g><rect x="${x}" y="${H - h}" width="${bw - 12}" height="${Math.max(h, m.value ? 1.5 : 0)}" fill="#2b6a4b" rx="2"><title>${m.label}: ${fmt(m.value)} ریال</title></rect>${m.value ? `<text x="${x + (bw - 12) / 2}" y="${H - h - 4}" font-size="10" text-anchor="middle" fill="#4a5c50">${mil(m.value)}</text>` : ''}<text x="${x + (bw - 12) / 2}" y="${H + 14}" font-size="10" text-anchor="middle" fill="#4a5c50">${m.label}</text></g>`; }).join('')}</svg>`;
}
function hbars(items) {
  const max = Math.max(...items.map(i => i.value), 1);
  return items.map(i => `<div class="hbar"><span title="${esc(i.label)}">${esc(i.label)}</span><span><i style="width:${(i.value / max * 100).toFixed(1)}%"></i></span><span class="num mut">${fmt(i.value)}</span></div>`).join('');
}

/* ---------- مسیریابی ---------- */
const routes = {
  '': home, more, expenses, settlements, settlement: settlementPage, bank, ledger, reports, report: reportPage, settings,
};
function setNav(r) { const sec = ['ledger', 'reports', 'settings', 'more'].includes(r); $$('#rail a').forEach(a => a.classList.toggle('on', a.dataset.r === r || (a.dataset.r === 'more' && sec))); }
async function route() {
  const [r, ...args] = (location.hash.replace(/^#\/?/, '').split('?')[0]).split('/'); const key = r || '';
  const nav = key === 'settlement' ? 'settlements' : key === 'report' ? 'reports' : key || 'home'; setNav(nav);
  main.innerHTML = '<p class="mut">در حال بارگذاری…</p>';
  try { await (routes[key] || home)(...args.map(decodeURIComponent)); } catch (e) { main.innerHTML = `<div class="empty">خطا: ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
async function boot() { B = await api('bootstrap'); $('#companyName').textContent = B.settings.company; route(); }

/* ---------- منوی «بیشتر» (گوشی) ---------- */
async function more() {
  main.innerHTML = `<div class="head"><h1>بیشتر</h1></div><div class="reportlist">
    <a href="#/ledger"><b>دفتر گردش</b><span>واریزها، تنخواه‌ها و مانده</span></a>
    <a href="#/reports"><b>گزارش‌ها</b><span>گزارش‌های دفتر، Excel و PDF</span></a>
    <a href="#/settings"><b>تنظیمات</b><span>شرکت، رمز، دسته‌ها، ورود اکسل، به‌روزرسانی</span></a></div>`;
}
/* جدول‌ها روی گوشی کارت می‌شوند؛ برچسب هر خانه از سرستون ستون گرفته می‌شود */
function labelTables() {
  $$('table.tbl').forEach(t => {
    if (t.dataset.l) return; const hs = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
    t.querySelectorAll('tr').forEach(tr => { let i = 0; [...tr.children].forEach(td => { if (td.tagName === 'TD' && !td.hasAttribute('colspan') && hs[i]) td.dataset.label = hs[i]; i += td.colSpan || 1; }); });
    t.dataset.l = 1;
  });
}
new MutationObserver(labelTables).observe(main, { childList: true, subtree: true });

/* ---------- داشبورد ---------- */
async function home() {
  const D = await api('dashboard'); const yr = +D.today.slice(0, 4);
  const L = await api('report/ledger?year=' + D.refYear);
  const f = D.forecast; const nextO = B.nextNumbers.official, nextU = B.nextNumbers.unofficial;
  const bo = D.openByKind.find(x => x.kind === 'official'), bu = D.openByKind.find(x => x.kind === 'unofficial');
  const todo = [];
  if (bo) todo.push(['', `${bo.n} هزینهٔ رسمی به مبلغ ${fmt(bo.s)} ریال آمادهٔ تسویه است`, 'ساخت تنخواه رسمی', '#/settlements?new=official']);
  if (bu) todo.push(['', `${bu.n} هزینهٔ غیر رسمی به مبلغ ${fmt(bu.s)} ریال آمادهٔ تسویه است`, 'ساخت تنخواه غیر رسمی', '#/settlements?new=unofficial']);
  if (D.drafts) todo.push(['a', `${D.drafts} تنخواه پیش‌نویس هنوز نهایی نشده`, 'مشاهده', '#/settlements']);
  if (D.unmatchedBank) todo.push(['a', `${D.unmatchedBank} برداشت بانکی بدون هزینهٔ ثبت‌شده`, 'تطبیق', '#/bank?state=unmatched']);
  if (D.trueBalance < 0) todo.push(['r', `مانده واقعی تنخواه منفی است (${fmt(D.trueBalance)} ریال) — شارژ لازم است`, 'گزارش پیش‌بینی', '#/report/forecast']);
  else if (f.need > 0) todo.push(['a', `با روند فعلی، شارژ بعدی حدود ${fmt(f.need)} ریال پیشنهاد می‌شود (پوشش ${f.cover} روز)`, 'جزئیات', '#/report/forecast']);
  if (D.issues) todo.push(['a', `${D.issues} مورد نقص یا مشکوک در هزینه‌ها (بدون فاکتور، تکراری، مبلغ غیرعادی…)`, 'بررسی', '#/report/quality']);
  main.innerHTML = `
  <div class="head"><div><h1>داشبورد</h1><p class="lead" style="margin:0">امروز ${D.today}</p></div>
    <div class="tools"><a class="btn" href="#/expenses">ثبت هزینه</a><a class="btn ghost" href="#/bank">ورود صورت‌حساب بلو</a></div></div>
  <section class="hero">
    <div>
      <div class="bal-label">مانده واقعی تنخواه (ریال)</div>
      <div class="bal num ${balCls(D.trueBalance)}">${fmt(D.trueBalance)}</div>
      <div class="bal-sub">${mil(D.trueBalance)} میلیون ریال${D.trueBalance < 0 ? ' — هزینه‌ها بیشتر از واریزهاست' : ''}</div>
      <div class="facts">
        <div>مانده دفتر<b class="num ${balCls(D.ledgerBalance)}">${fmt(D.ledgerBalance)}</b></div>
        <div>هزینهٔ تسویه‌نشده<b class="num">${fmt(D.pending.s)}</b></div>
        <div>آخرین واریز<b class="num">${D.lastDeposit ? `${D.lastDeposit.date}` : '—'}</b></div>
        <div>مانده کافی برای<b>${f.daysLeft != null ? (f.daysLeft < 0 ? 'کسری دارد' : f.daysLeft + ' روز') : '—'}</b></div>
      </div>
    </div>
    <div class="chartbox"><div class="bal-label">روند مانده دفتر در سال ${D.refYear} <span class="mut sm">(ناحیهٔ قرمز یعنی هزینه قبل از شارژ انجام شده)</span></div>${stepChart(L.sections[0].rows)}</div>
  </section>
  <h2>کارهای پیشنهادی</h2>
  ${todo.length ? `<div class="todo">${todo.map(t => `<a class="it" href="${t[3]}"><span><i class="dot ${t[0]}"></i>${t[1]}</span><span class="tag g">${t[2]}</span></a>`).join('')}</div>` : '<div class="empty">همه‌چیز مرتب است. موردی برای پیگیری نیست.</div>'}
  <div class="cols">
    <div><h2>هزینهٔ ماهانه ${D.refYear} (میلیون ریال)</h2><div class="sheet chartbox">${monthBars(D.months)}</div></div>
    <div><h2>بیشترین دسته‌ها در ${D.refYear}</h2><div class="sheet">${hbars(D.cats)}</div></div>
  </div>`;
}

/* ---------- هزینه‌ها ---------- */
let EX = { status: 'all', q: '', cat: '' };
async function expenses() {
  main.innerHTML = `
  <div class="head"><div><h1>هزینه‌ها</h1><p class="lead" style="margin:0">هزینه را همین‌جا ثبت کنید؛ دسته، رسمی/غیررسمی، شمارهٔ بارنامه و خودرو را برنامه خودش حدس می‌زند.</p></div></div>
  <form class="entry" id="addForm" autocomplete="off">
    <div class="row">
      <label class="f">تاریخ${dateIn('e_date', B.today)}</label>
      <label class="f descf" style="flex:1;min-width:260px">شرح هزینه<input id="e_desc" placeholder="مثلاً سوخت خودرو" role="combobox" aria-expanded="false"><div id="sugg" class="sugg" hidden></div></label>
      <label class="f">مبلغ (ریال)<input id="e_amount" class="num" inputmode="numeric" size="14" placeholder="0"></label>
      <label class="f">شماره فاکتور<input id="e_inv" class="num" size="10"></label>
    </div>
    <div class="row" style="margin-top:10px">
      <label class="f">دسته<select id="e_cat">${catOptions()}</select></label>
      <div class="f">نوع تنخواه<div class="seg"><label><input type="radio" name="e_kind" value="official" checked><span>رسمی</span></label><label><input type="radio" name="e_kind" value="unofficial"><span>غیر رسمی</span></label></div></div>
      <label class="f">خودرو<input id="e_veh" size="9"></label>
      <label class="f">شمارهٔ بارنامه<input id="e_wb" class="num" size="10"></label>
      <label class="f">مشتری (مرجوعی)<input id="e_party" size="16"></label>
      <button type="submit">ثبت هزینه</button>
    </div>
    <div class="hint" id="hint"></div>
  </form>
  <div class="row noprint" style="margin-bottom:10px">
    <label class="f">وضعیت<select id="f_status"><option value="all">همه</option><option value="open">تسویه‌نشده</option><option value="settled">تسویه‌شده</option></select></label>
    <label class="f">دسته<select id="f_cat"><option value="">همه</option>${catOptions()}</select></label>
    <label class="f">جستجو<input id="f_q" placeholder="شرح، فاکتور، بارنامه…"></label>
  </div>
  <div id="exList"></div>`;
  $('#f_status').value = EX.status; $('#f_cat').value = EX.cat; $('#f_q').value = EX.q;
  bindMoney($('#e_amount'));
  let manualCat = false, tm; $('#e_cat').onchange = () => manualCat = true;
  const suggest = guard(async () => {
    const d = $('#e_desc').value.trim(); if (d.length < 2) { $('#hint').innerHTML = ''; return; }
    const s = await api('suggest', { json: { description: d } });
    if (!manualCat && s.category_id) { $('#e_cat').value = s.category_id; $$('[name=e_kind]').forEach(r => r.checked = r.value === s.kind); }
    if (s.waybill && !$('#e_wb').value) $('#e_wb').value = s.waybill; if (s.vehicle && !$('#e_veh').value) $('#e_veh').value = s.vehicle; if (s.party && !$('#e_party').value) $('#e_party').value = s.party;
    const how = { history: 'از روی سابقهٔ خودتان', keyword: 'از روی کلیدواژه', similar: 'شبیه موارد قبلی', none: 'نامشخص — دستی انتخاب کنید' }[s.how];
    $('#hint').innerHTML = `<span>دسته: <b>${esc(catName(s.category_id))}</b> (${how})</span>` + (s.typical ? `<span class="chip" id="useTyp">مبلغ معمول: ${fmt(s.typical.median)} (از ${s.typical.n} بار)</span>` : '');
    const ut = $('#useTyp'); if (ut) ut.onclick = () => { $('#e_amount').value = fmt(s.typical.median); $('#e_amount').focus(); };
  });
  $('#e_desc').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(suggest, 300); manualCat = false; });
  $('#e_desc').addEventListener('change', suggest);

  // --- پیشنهاد هوشمند شرح: با تایپ چند حرف، موارد قبلی خود کاربر پیشنهاد می‌شود ---
  let sg = [], sgi = -1, sgt, sgSeq = 0;
  const sgBox = $('#sugg');
  const sgHide = () => { sgBox.hidden = true; sgi = -1; };
  const sgPaint = () => {
    if (!sg.length) return sgHide();
    sgBox.hidden = false;
    sgBox.innerHTML = sg.map((x, i) => `<div class="sg${i === sgi ? ' on' : ''}" data-i="${i}"><div class="sgt"><b>${esc(x.text)}</b><span class="mut sm">${esc(catName(x.category_id))} · ${x.kind === 'unofficial' ? 'غیررسمی' : 'رسمی'} · ${fmt(x.n)} بار</span></div>${x.amount ? `<button type="button" class="sgq" data-q="${i}" title="با تاریخ و مبلغ بالا همین الان ثبت شود">ثبت فوری ${fmt(x.amount)}</button>` : ''}</div>`).join('');
  };
  const sgFetch = async () => { const my = ++sgSeq; try { const r = await api('complete?q=' + encodeURIComponent($('#e_desc').value)); if (my === sgSeq) { sg = r; sgi = -1; sgPaint(); } } catch (e) { sgHide(); } };
  const sgPick = i => {
    const x = sg[i]; if (!x) return; sgHide(); manualCat = true;
    $('#e_desc').value = x.text; if (x.amount) $('#e_amount').value = fmt(x.amount);
    if (x.category_id) $('#e_cat').value = x.category_id; $$('[name=e_kind]').forEach(r => r.checked = r.value === x.kind);
    if (x.vehicle && !$('#e_veh').value) $('#e_veh').value = x.vehicle;
    suggest(); (x.amount ? $('#addForm button[type=submit]') : $('#e_amount')).focus();
  };
  const sgQuick = guard(async i => {
    const x = sg[i]; if (!x) return; sgHide();
    await api('expenses', { json: { date: $('#e_date').value, description: x.text, amount: x.amount, category_id: x.category_id, kind: x.kind, vehicle: x.vehicle } });
    toast('ثبت شد: ' + x.text + ' — ' + fmt(x.amount)); $('#e_desc').value = ''; $('#e_amount').value = ''; $('#hint').innerHTML = ''; manualCat = false; $('#e_desc').focus(); loadEx(); sgFetch();
  });
  $('#e_desc').addEventListener('input', () => { clearTimeout(sgt); sgt = setTimeout(sgFetch, 120); });
  $('#e_desc').addEventListener('focus', sgFetch);
  $('#e_desc').addEventListener('keydown', e => {
    if (sgBox.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sgi = (sgi + 1) % sg.length; sgPaint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sgi = (sgi - 1 + sg.length) % sg.length; sgPaint(); }
    else if (e.key === 'Enter' && sgi >= 0) { e.preventDefault(); sgPick(sgi); }
    else if (e.key === 'Escape') sgHide();
  });
  sgBox.addEventListener('mousedown', e => e.preventDefault());   // فوکوس از کادر نپرد
  sgBox.addEventListener('click', e => { const q = e.target.closest('[data-q]'); if (q) return sgQuick(+q.dataset.q); const r = e.target.closest('.sg'); if (r) sgPick(+r.dataset.i); });
  $('#e_desc').addEventListener('blur', () => setTimeout(sgHide, 150));
  $('#e_amount').addEventListener('blur', guard(async () => {  // هشدار مبلغ غیرعادی هنگام ثبت
    const t = ($('#hint').querySelector('#useTyp')); const a = +toLatin($('#e_amount').value).replace(/,/g, ''); const d = $('#e_desc').value.trim();
    if (!d || !a) return; const s = await api('suggest', { json: { description: d } }); if (s.typical && s.typical.n >= 5 && a > s.typical.median * 3) $('#hint').insertAdjacentHTML('beforeend', `<span class="chip warn">این مبلغ حدود ${(a / s.typical.median).toFixed(1)} برابر معمول است — مطمئن هستید؟</span>`);
  }));
  $('#addForm').onsubmit = guard(async e => {
    e.preventDefault();
    await api('expenses', { json: { date: $('#e_date').value, description: $('#e_desc').value, amount: $('#e_amount').value, invoice_no: $('#e_inv').value, category_id: manualCat ? $('#e_cat').value : undefined, kind: manualCat ? $('[name=e_kind]:checked').value : undefined, vehicle: $('#e_veh').value, waybill: $('#e_wb').value, party: $('#e_party').value } });
    toast('هزینه ثبت شد'); ['e_desc', 'e_amount', 'e_inv', 'e_veh', 'e_wb', 'e_party'].forEach(i => $('#' + i).value = ''); $('#hint').innerHTML = ''; manualCat = false; $('#e_desc').focus(); loadEx();
  });
  const upd = () => { EX = { status: $('#f_status').value, cat: $('#f_cat').value, q: $('#f_q').value }; loadEx(); };
  $('#f_status').onchange = $('#f_cat').onchange = upd; let ft; $('#f_q').oninput = () => { clearTimeout(ft); ft = setTimeout(upd, 250); };
  loadEx();
}
async function loadEx() {
  const p = new URLSearchParams({ limit: 400, ...(EX.status !== 'all' ? { status: EX.status } : {}), ...(EX.cat ? { cat: EX.cat } : {}), ...(EX.q ? { q: EX.q } : {}) });
  const d = await api('expenses?' + p); const box = $('#exList'); if (!box) return;
  if (!d.rows.length) { box.innerHTML = '<div class="empty">هزینه‌ای با این فیلتر پیدا نشد.</div>'; return; }
  box.innerHTML = `<div class="sum"><div>تعداد<b>${fmt(d.count)}</b></div><div>جمع مبلغ (ریال)<b class="num">${fmt(d.sum)}</b></div>${d.count > d.rows.length ? `<div class="mut">فقط ${d.rows.length} ردیف اخیر نمایش داده شده؛ فیلتر را دقیق‌تر کنید.</div>` : ''}</div>
  <div class="scroll"><table class="tbl"><thead><tr><th>تاریخ</th><th>شرح</th><th>دسته</th><th class="num">مبلغ</th><th>فاکتور</th><th>تنخواه</th><th></th></tr></thead><tbody>${d.rows.map(r => `
    <tr><td class="num">${r.date || '<span class="tag r">بدون تاریخ</span>'}</td><td>${esc(r.description)}${r.waybill ? ` <span class="tag">بارنامه ${esc(r.waybill)}</span>` : ''}${r.vehicle ? ` <span class="tag">${esc(r.vehicle)}</span>` : ''}${r.bank_tx_id ? ' <span class="tag g">بانک ✓</span>' : ''}</td>
    <td>${esc(r.category || '')}</td><td class="num">${fmt(r.amount)}</td><td class="num">${esc(r.invoice_no || '')}</td>
    <td>${r.snum ? `<a href="#/settlement/${r.settlement_id}">${KIND[r.skind]} ${r.snum}</a>` : '<span class="tag a">تسویه‌نشده</span>'}</td>
    <td class="act">${r.sstatus === 'final' ? '' : `<button class="ghost sm" data-edit="${r.id}">ویرایش</button> <button class="danger sm" data-del="${r.id}">حذف</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-edit]', box).forEach(b => b.onclick = () => editExpense(d.rows.find(r => r.id == b.dataset.edit)));
  $$('[data-del]', box).forEach(b => b.onclick = guard(async () => { if (!confirm('این هزینه حذف شود؟')) return; await api('expenses/' + b.dataset.del, { method: 'DELETE' }); toast('حذف شد'); loadEx(); }));
}
function dialog(html) { const d = $('#dlg'); d.innerHTML = html; d.showModal(); return d; }
function editExpense(r, after) {
  const d = dialog(`<h3>ویرایش هزینه</h3><div class="row">
    <label class="f">تاریخ${dateIn('x_date', r.date)}</label><label class="f" style="flex:1">شرح<input id="x_desc" value="${esc(r.description)}"></label>
    <label class="f">مبلغ<input id="x_amt" class="num" value="${fmt(r.amount)}" size="14"></label></div>
    <div class="row" style="margin-top:10px"><label class="f">دسته<select id="x_cat">${catOptions(r.category_id)}</select></label>
    <div class="f">نوع<div class="seg"><label><input type="radio" name="x_kind" value="official" ${r.kind === 'official' ? 'checked' : ''}><span>رسمی</span></label><label><input type="radio" name="x_kind" value="unofficial" ${r.kind === 'unofficial' ? 'checked' : ''}><span>غیر رسمی</span></label></div></div>
    <label class="f">شماره فاکتور<input id="x_inv" class="num" value="${esc(r.invoice_no || '')}" size="10"></label></div>
    <div class="row" style="margin-top:10px"><label class="f">خودرو<input id="x_veh" value="${esc(r.vehicle || '')}" size="9"></label><label class="f">بارنامه<input id="x_wb" class="num" value="${esc(r.waybill || '')}" size="10"></label><label class="f">مشتری<input id="x_party" value="${esc(r.party || '')}"></label></div>
    <div class="dlg-actions"><button id="x_save">ذخیره</button><button class="ghost" onclick="this.closest('dialog').close()">انصراف</button></div>`);
  bindMoney($('#x_amt'));
  $('#x_save').onclick = guard(async () => { await api('expenses/' + r.id, { method: 'PUT', json: { date: $('#x_date').value, description: $('#x_desc').value, amount: $('#x_amt').value, category_id: $('#x_cat').value, kind: $('[name=x_kind]:checked').value, invoice_no: $('#x_inv').value, vehicle: $('#x_veh').value, waybill: $('#x_wb').value, party: $('#x_party').value } }); d.close(); toast('ذخیره شد'); (after || loadEx)(); });
}

/* ---------- تنخواه‌ها ---------- */
async function settlements() {
  const params = new URLSearchParams((location.hash.split('?')[1]) || ''); const year = +B.today.slice(0, 4);
  const list = await api('settlements');
  const years = [...new Set(list.map(s => s.year).concat(year))].sort((a, b) => b - a); const sel = +(window._sy || years[0]);
  const rows = list.filter(s => s.year === sel);
  main.innerHTML = `<div class="head"><div><h1>تنخواه‌ها</h1><p class="lead" style="margin:0">هر تنخواه یک «صورت خلاصه هزینه‌ها» برای دفتر است. رسمی و غیررسمی جدا شماره‌گذاری می‌شوند.</p></div>
    <div class="tools"><select id="sy">${years.map(y => `<option ${y === sel ? 'selected' : ''}>${y}</option>`).join('')}</select><button id="newO">تنخواه رسمی جدید</button><button class="ghost" id="newU">تنخواه غیر رسمی جدید</button></div></div>
  ${rows.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>تنخواه</th><th>تاریخ</th><th class="num">ردیف</th><th class="num">جمع (ریال)</th><th>وضعیت</th></tr></thead><tbody>${rows.map(s => `
    <tr><td><a href="#/settlement/${s.id}"><b>${KIND[s.kind]} ${s.number}</b></a></td><td class="num">${s.date}</td><td class="num">${s.count}</td><td class="num">${fmt(s.total)}</td><td>${s.status === 'final' ? '<span class="tag g">نهایی</span>' : '<span class="tag a">پیش‌نویس</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">برای این سال هنوز تنخواهی ساخته نشده.</div>'}`;
  $('#sy').onchange = e => { window._sy = e.target.value; settlements(); };
  const newS = guard(async kind => {
    const open = await api(`expenses?status=open&kind=${kind}&limit=1000`);
    if (!open.count) return toast(`هزینهٔ تسویه‌نشدهٔ ${KIND[kind]} وجود ندارد. ابتدا هزینه ثبت کنید.`, true);
    const next = kind === 'official' ? B.nextNumbers.official : B.nextNumbers.unofficial;
    const d = dialog(`<h3>تنخواه ${KIND[kind]} جدید</h3><p>${fmt(open.count)} هزینهٔ تسویه‌نشده به مبلغ <b class="num">${fmt(open.sum)}</b> ریال در این تنخواه می‌آید. بعداً می‌توانید قبل از نهایی کردن ردیف‌ها را کم یا زیاد کنید.</p>
      <div class="row"><label class="f">تاریخ تهیه${dateIn('n_date', B.today)}</label><label class="f">شماره (خودکار)<input id="n_num" class="num" size="6" placeholder="${next}"></label></div>
      <div class="dlg-actions"><button id="n_ok">ساخت تنخواه</button><button class="ghost" onclick="this.closest('dialog').close()">انصراف</button></div>`);
    $('#n_ok').onclick = guard(async () => { const r = await api('settlements', { json: { kind, date: $('#n_date').value, number: $('#n_num').value || undefined } }); d.close(); const nn = await api('bootstrap'); B = nn; location.hash = '#/settlement/' + r.id; });
  });
  $('#newO').onclick = () => newS('official'); $('#newU').onclick = () => newS('unofficial');
  if (params.get('new')) { history.replaceState(null, '', '#/settlements'); newS(params.get('new')); }
}
async function settlementPage(id) {
  const s = await api('settlements/' + id); const fin = s.status === 'final';
  main.innerHTML = `<div class="head"><div><a href="#/settlements" class="mut sm">← همهٔ تنخواه‌ها</a><h1>تنخواه ${s.title} — ${s.year}</h1>
    <p class="lead" style="margin:0">${esc(s.company)} · تاریخ ${s.date} · ${fin ? '<span class="tag g">نهایی</span>' : '<span class="tag a">پیش‌نویس</span>'}</p></div>
    <div class="tools"><a class="btn" href="/api/settlements/${id}/xlsx">Excel (فرم دفتر)</a><a class="btn ghost" target="_blank" href="/print/settlement/${id}">چاپ / PDF</a>
    ${fin ? '<button class="ghost" id="reopen">بازگشایی</button>' : '<button id="final">نهایی کردن</button><button class="ghost" id="hdr">ویرایش سربرگ</button><button class="danger" id="delS">حذف تنخواه</button>'}</div></div>
  ${fin ? '' : '<p class="note">پیش‌نویس است؛ تا نهایی نشود در دفتر گردش کسر نمی‌شود. با «حذف از تنخواه» هزینه به لیست تسویه‌نشده برمی‌گردد.</p>'}
  <div class="scroll"><table class="tbl"><thead><tr><th class="num">ردیف</th><th>تاریخ</th><th>فاکتور</th><th>شرح</th><th>دسته</th><th class="num">مبلغ</th><th></th></tr></thead><tbody>
  ${s.rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td class="num">${r.date || ''}</td><td class="num">${esc(r.invoice_no || '')}</td><td>${esc(r.description)}</td><td>${esc(r.category || '')}</td><td class="num">${fmt(r.amount)}</td>
    <td class="act">${fin ? '' : `<button class="ghost sm" data-e="${i}">ویرایش</button> <button class="danger sm" data-rm="${r.id}">حذف از تنخواه</button>`}</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="5">جمع</td><td class="num">${fmt(s.total)}</td><td></td></tr></tfoot></table></div>`;
  const reload = () => settlementPage(id);
  $$('[data-e]').forEach(b => b.onclick = () => editExpense(s.rows[b.dataset.e], reload));
  $$('[data-rm]').forEach(b => b.onclick = guard(async () => { await api(`settlements/${id}/remove-expense`, { json: { expense_id: b.dataset.rm } }); reload(); }));
  if ($('#final')) $('#final').onclick = guard(async () => { await api(`settlements/${id}/finalize`, { json: {} }); toast('تنخواه نهایی شد و در دفتر گردش کسر شد'); reload(); });
  if ($('#reopen')) $('#reopen').onclick = guard(async () => { if (!confirm('تنخواه بازگشایی شود؟ تا نهایی‌شدن دوباره از دفتر گردش کسر نمی‌شود.')) return; await api(`settlements/${id}/reopen`, { json: {} }); reload(); });
  if ($('#delS')) $('#delS').onclick = guard(async () => { if (!confirm('تنخواه حذف شود؟ هزینه‌ها حذف نمی‌شوند و به لیست تسویه‌نشده برمی‌گردند.')) return; await api('settlements/' + id, { method: 'DELETE' }); location.hash = '#/settlements'; });
  if ($('#hdr')) $('#hdr').onclick = () => { const d = dialog(`<h3>سربرگ تنخواه</h3><div class="row"><label class="f">تاریخ${dateIn('h_date', s.date)}</label><label class="f" style="flex:1">نام شرکت<input id="h_co" value="${esc(s.company)}"></label></div><div class="row" style="margin-top:10px"><label class="f">تهیه‌کننده<input id="h_pre" value="${esc(s.preparer || '')}"></label><label class="f">واحد<input id="h_unit" value="${esc(s.unit || '')}"></label></div><div class="dlg-actions"><button id="h_ok">ذخیره</button><button class="ghost" onclick="this.closest('dialog').close()">انصراف</button></div>`);
    $('#h_ok').onclick = guard(async () => { await api('settlements/' + id, { method: 'PUT', json: { date: $('#h_date').value, company: $('#h_co').value, preparer: $('#h_pre').value, unit: $('#h_unit').value } }); d.close(); reload(); }); };
}

/* ---------- بانک ---------- */
let PREV = [];
async function bank() {
  const st = new URLSearchParams(location.hash.split('?')[1] || '').get('state') || '';
  main.innerHTML = `<div class="head"><div><h1>بانک (بلو)</h1><p class="lead" style="margin:0">صورت‌حساب یا پیامک‌های بلو را وارد کنید؛ برنامه تکراری‌ها را حذف، واریزها را به دفتر اضافه و برداشت‌ها را با هزینه‌ها تطبیق می‌دهد.</p></div></div>
  <div class="grid2">
    <div class="drop"><b>۱) فایل صورت‌حساب (xlsx یا csv)</b><p class="mut sm">از برنامهٔ بلو، بخش صورت‌حساب، خروجی اکسل بگیرید و اینجا انتخاب کنید.</p><input type="file" id="bf" accept=".xlsx,.csv,.txt,.tsv"></div>
    <div class="drop"><b>۲) یا متن پیامک‌ها</b><p class="mut sm">پیامک‌ها را پشت‌سرهم بچسبانید و بین هر دو پیامک یک خط خالی بگذارید.</p><textarea class="sms" id="sms" placeholder="برداشت 1,250,000 ریال … مانده 85,000,000"></textarea><button id="smsGo" style="margin-top:6px">خواندن پیامک‌ها</button></div>
  </div>
  <div id="prev"></div>
  <h2>تراکنش‌های ثبت‌شده</h2>
  <div class="row noprint" style="margin-bottom:10px"><label class="f">نمایش<select id="bs"><option value="">همه</option><option value="unmatched">برداشت‌های بدون هزینه</option><option value="matched">تطبیق‌شده</option></select></label></div>
  <div id="blist"></div>`;
  $('#bs').value = st; $('#bs').onchange = () => loadBank($('#bs').value);
  $('#bf').onchange = guard(async e => { const f = e.target.files[0]; if (!f) return; PREV = await api('bank/preview', { raw: await f.arrayBuffer(), filename: f.name }); showPrev(); });
  $('#smsGo').onclick = guard(async () => { PREV = await api('bank/preview', { json: { sms: $('#sms').value } }); showPrev(); });
  loadBank(st);
}
function showPrev() {
  const fresh = PREV.filter(t => !t.duplicate); const box = $('#prev');
  box.innerHTML = `<h2>پیش‌نمایش (${PREV.length} تراکنش، ${PREV.length - fresh.length} تکراری)</h2>
  ${PREV.some(t => t.guessedDate) ? '<p class="note">برای بعضی پیامک‌ها تاریخ پیدا نشد و تاریخ امروز گذاشته شد؛ بهتر است پیامک را با تاریخ کامل وارد کنید.</p>' : ''}
  <div class="scroll" style="max-height:50vh"><table class="tbl"><thead><tr><th>تاریخ</th><th>نوع</th><th class="num">مبلغ</th><th>شرح</th><th>وضعیت</th></tr></thead><tbody>${PREV.map(t => `
    <tr class="${t.duplicate ? 'dim' : ''}"><td class="num">${t.date}${t.time ? ' ' + esc(t.time) : ''}</td><td>${t.direction === 'in' ? '<span class="tag g">واریز</span>' : '<span class="tag r">برداشت</span>'}</td><td class="num">${fmt(t.amount)}</td><td>${esc((t.description || '').slice(0, 90))}</td>
    <td>${t.duplicate ? 'قبلاً ثبت شده' : t.candidates.length ? `<span class="tag g">هم‌مبلغ با هزینهٔ «${esc(t.candidates[0].description.slice(0, 24))}»</span>` : t.direction === 'in' ? 'به دفتر اضافه می‌شود' : (t.suggestion ? `<span class="mut sm">دسته پیشنهادی: ${esc(catName(t.suggestion.category_id))}</span>` : '')}</td></tr>`).join('')}</tbody></table></div>
  <div class="tools" style="margin-top:10px"><button id="commit" ${fresh.length ? '' : 'disabled'}>ثبت ${fresh.length} تراکنش جدید</button><button class="ghost" id="cancel">لغو</button></div>`;
  $('#cancel').onclick = () => { PREV = []; box.innerHTML = ''; };
  $('#commit').onclick = guard(async () => { const r = await api('bank/commit', { json: { txs: fresh } }); toast(`${r.added} تراکنش ثبت شد · ${r.deposits} واریز به دفتر · ${r.matched} تطبیق خودکار با هزینه`); PREV = []; box.innerHTML = ''; loadBank($('#bs').value); });
}
async function loadBank(state) {
  const rows = await api('bank?' + new URLSearchParams(state ? { state } : {})); const box = $('#blist');
  if (!rows.length) { box.innerHTML = '<div class="empty">هنوز تراکنش بانکی وارد نشده. فایل صورت‌حساب یا متن پیامک را بالا وارد کنید.</div>'; return; }
  box.innerHTML = `<div class="scroll"><table class="tbl"><thead><tr><th>تاریخ</th><th>نوع</th><th class="num">مبلغ</th><th>شرح</th><th>وضعیت / اقدام</th></tr></thead><tbody>${rows.map(t => `
  <tr class="${t.ignored ? 'dim' : ''}"><td class="num">${t.date}</td><td>${t.direction === 'in' ? '<span class="tag g">واریز</span>' : '<span class="tag r">برداشت</span>'}</td><td class="num">${fmt(t.amount)}</td><td>${esc((t.description || '').slice(0, 100))}</td>
  <td class="act">${t.expense_id ? `<span class="tag g">هزینه: ${esc((t.expense_desc || '').slice(0, 28))}</span> <button class="ghost sm" data-un="${t.id}">لغو تطبیق</button>`
    : t.direction === 'in' ? (t.ignored ? `<span class="tag">نادیده</span> <button class="ghost sm" data-ign="${t.id}" data-v="0">به دفتر برگردان</button>` : `<span class="tag g">واریز در دفتر</span> <button class="ghost sm" data-ign="${t.id}" data-v="1">واریز تنخواه نیست</button>`)
    : t.ignored ? `<span class="tag">نادیده</span> <button class="ghost sm" data-ign="${t.id}" data-v="0">برگردان</button>`
    : `${t.candidates.map(c => `<button class="ghost sm" data-link="${t.id}:${c.id}" title="${esc(c.description)}">تطبیق با «${esc(c.description.slice(0, 18))}» (${c.date})</button>`).join(' ')} <button class="sm" data-mk="${t.id}">ثبت به‌عنوان هزینه</button> <button class="ghost sm" data-ign="${t.id}" data-v="1">نادیده</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  const re = () => loadBank($('#bs').value);
  $$('[data-un]', box).forEach(b => b.onclick = guard(async () => { await api(`bank/${b.dataset.un}/link`, { json: {} }); re(); }));
  $$('[data-ign]', box).forEach(b => b.onclick = guard(async () => { await api(`bank/${b.dataset.ign}/ignore`, { json: { ignored: b.dataset.v === '1' } }); re(); }));
  $$('[data-link]', box).forEach(b => b.onclick = guard(async () => { const [t, e] = b.dataset.link.split(':'); await api(`bank/${t}/link`, { json: { expense_id: +e } }); toast('تطبیق داده شد'); re(); }));
  $$('[data-mk]', box).forEach(b => b.onclick = guard(async () => { await api(`bank/${b.dataset.mk}/make-expense`, { json: {} }); toast('هزینه ساخته شد؛ در «هزینه‌ها» شرح و دسته را کنترل کنید'); re(); }));
}

/* ---------- دفتر گردش ---------- */
async function ledger() {
  const year = window._ly || B.today.slice(0, 4); const rep = await api('report/ledger?year=' + year); const rows = rep.sections[0].rows;
  const allYears = (await api('settlements')).map(s => s.year).concat([+B.today.slice(0, 4)]); const ys = [...new Set(allYears)].sort((a, b) => b - a);
  main.innerHTML = `<div class="head"><div><h1>دفتر گردش تنخواه</h1><p class="lead" style="margin:0">واریزها و تنخواه‌های نهایی‌شده به ترتیب تاریخ، با مانده جاری. منفی‌ها با جوهر قرمز.</p></div>
    <div class="tools"><select id="ly">${ys.map(y => `<option ${y == year ? 'selected' : ''}>${y}</option>`).join('')}</select><a class="btn ghost" href="/api/export/ledger.xlsx?year=${year}">Excel</a><button class="ghost" onclick="print()">چاپ / PDF</button></div></div>
  <div class="sum">${rep.summary.map(([k, v]) => `<div>${k}<b class="num ${balCls(v)}">${fmt(v)}</b></div>`).join('')}</div>
  <div class="sheet chartbox noprint" style="margin-bottom:16px">${stepChart(rows)}</div>
  <form class="entry noprint" id="fundForm"><div class="row"><label class="f">تاریخ${dateIn('f_date', B.today)}</label><label class="f">مبلغ (ریال)<input id="f_amt" class="num" size="14"></label>
    <label class="f">نوع<select id="f_type"><option value="deposit">واریز دستی</option><option value="opening">اول دوره (مانده انتقالی)</option><option value="adjust">اصلاح (+/-)</option></select></label>
    <label class="f" style="flex:1">توضیح<input id="f_note"></label><button>افزودن</button></div><div class="mut sm" style="margin-top:6px">واریزهای بانک با وارد کردن صورت‌حساب خودکار اضافه می‌شوند؛ این فرم برای واریزهای خارج از بانک است. «اول دوره» مانده را از آن تاریخ به مبلغ ثابت تنظیم می‌کند.</div></form>
  ${rows.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>تاریخ</th><th>شرح</th><th class="num">واریز</th><th class="num">برداشت</th><th class="num">مانده</th><th class="noprint"></th></tr></thead><tbody>${rows.map(r => `
    <tr><td class="num">${r.date}</td><td>${r.settlement_id ? `<a href="#/settlement/${r.settlement_id}">${esc(r.title)}</a>` : esc(r.title)}</td><td class="num pos">${r.deposit ? fmt(r.deposit) : ''}</td><td class="num">${r.spend ? fmt(r.spend) : ''}</td><td class="num ${balCls(r.balance)}"><b>${fmt(r.balance)}</b></td>
    <td class="act noprint">${r.fund_id ? `<button class="danger sm" data-df="${r.fund_id}">حذف</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">برای ${year} واریز یا تنخواهی ثبت نشده. اگر از سال قبل مانده دارید، با «اول دوره» ثبت کنید.</div>`}`;
  bindMoney($('#f_amt')); $('#ly').onchange = e => { window._ly = e.target.value; ledger(); };
  $('#fundForm').onsubmit = guard(async e => { e.preventDefault(); await api('fund', { json: { date: $('#f_date').value, amount: $('#f_amt').value, type: $('#f_type').value, note: $('#f_note').value } }); toast('ثبت شد'); ledger(); });
  $$('[data-df]').forEach(b => b.onclick = guard(async () => { if (!confirm('این ردیف از دفتر حذف شود؟')) return; await api('fund/' + b.dataset.df, { method: 'DELETE' }); ledger(); }));
}

/* ---------- گزارش‌ها ---------- */
const REPORT_LIST = [
  ['settlements', 'فهرست تنخواه‌ها', 'همهٔ صورت‌های خلاصه سال با جمع و وضعیت'],
  ['ledger', 'دفتر گردش و مانده', 'واریز، برداشت و مانده جاری'],
  ['recon', 'مغایرت‌گیری با بانک', 'برداشت‌های بدون هزینه، هزینه‌های بدون تراکنش، واریزهای ثبت‌نشده'],
  ['categories', 'هزینه به تفکیک دسته و ماه', 'جدول ۱۲ ماهه با جمع و نمودار'],
  ['freight', 'کرایه حمل و بارنامه‌ها', 'فهرست بارنامه‌ها، جمع و میانگین'],
  ['vehicles', 'هزینهٔ خودروها', 'سوخت، تعمیر، بیمه به تفکیک خودرو'],
  ['returns', 'هزینهٔ مرجوعی‌ها', 'به تفکیک مشتری و پخش'],
  ['quality', 'نواقص و موارد مشکوک', 'بدون شرح/تاریخ، تکراری، مبلغ غیرعادی'],
  ['forecast', 'پیش‌بینی شارژ بعدی', 'روند مصرف و مبلغ پیشنهادی'],
];
async function reports() {
  main.innerHTML = `<div class="head"><div><h1>گزارش‌ها</h1><p class="lead" style="margin:0">همهٔ گزارش‌ها به Excel راست‌چین و چاپ/PDF تبدیل می‌شوند و برای دفتر آماده‌اند.</p></div></div>
  <div class="reportlist">${REPORT_LIST.map(r => `<a href="#/report/${r[0]}"><b>${r[1]}</b><span>${r[2]}</span></a>`).join('')}</div>`;
}
async function reportPage(name) {
  const y = window._ry || B.today.slice(0, 4); const q = new URLSearchParams({ year: y });
  const rep = await api(`report/${name}?${q}`);
  const noYear = ['quality', 'forecast'].includes(name);
  main.innerHTML = `<div class="head"><div><a href="#/reports" class="mut sm noprint">← همهٔ گزارش‌ها</a><h1>${esc(rep.title)}</h1><p class="lead" style="margin:0">${esc(B.settings.company)}</p></div>
    <div class="tools noprint">${noYear ? '' : `<label class="f">سال<input id="ry" class="num" size="6" value="${y}"></label>`}<a class="btn" href="/api/export/${name}.xlsx?${q}">Excel</a><button class="ghost" onclick="print()">چاپ / PDF</button></div></div>
  ${rep.note ? `<p class="note">${esc(rep.note)}</p>` : ''}
  ${rep.summary ? `<div class="sum">${rep.summary.map(([k, v, t]) => `<div>${esc(k)}<b class="num ${balCls(v)}">${v == null ? '—' : fmt(v)}</b></div>`).join('')}</div>` : ''}
  ${rep.chart ? `<div class="sheet noprint" style="margin-bottom:16px">${hbars(rep.chart.items.slice(0, 12))}</div>` : ''}
  ${rep.sections.map(sec => `${sec.title ? `<h2>${esc(sec.title)}</h2>` : ''}${sec.rows.length ? `<div class="scroll"><table class="tbl"><thead><tr>${sec.columns.map(c => `<th class="${['money', 'balance', 'int', 'date'].includes(c.type) ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map(r => `<tr>${sec.columns.map(c => cell(c, r[c.key])).join('')}</tr>`).join('')}</tbody>
    ${sec.totals ? `<tfoot><tr>${sec.columns.map(c => cell(c, sec.totals[c.key], true)).join('')}</tr></tfoot>` : ''}</table></div>` : '<div class="empty">موردی ندارد.</div>'}`).join('')}`;
  const ry = $('#ry'); if (ry) ry.onchange = () => { window._ry = toLatin(ry.value); reportPage(name); };
}
function cell(c, v, tot) {
  if (v == null || v === '') return '<td></td>';
  if (c.type === 'money' || c.type === 'balance') return `<td class="num ${v < 0 ? 'neg' : ''}">${fmt(v)}</td>`;
  if (c.type === 'int') return `<td class="num">${fmt(v)}</td>`; if (c.type === 'date') return `<td class="num">${esc(v)}</td>`;
  return `<td>${esc(v)}</td>`;
}

/* ---------- تنظیمات ---------- */
async function settings() {
  const s = B.settings; const cats = B.categories;
  main.innerHTML = `<div class="head"><div><h1>تنظیمات</h1></div></div>
  <div class="sheet"><h2 style="margin-top:0">سربرگ فرم‌ها</h2><div class="row">
    <label class="f" style="flex:1;min-width:280px">نام شرکت (بالای صورت خلاصه هزینه‌ها)<input id="s_co" value="${esc(s.company)}"></label>
    <label class="f">نام تهیه‌کننده<input id="s_pre" value="${esc(s.preparer)}"></label><label class="f">واحد<input id="s_unit" value="${esc(s.unit)}"></label></div>
  <h2>هوشمند</h2><div class="row"><label class="f">پوشش مطلوب تنخواه (روز)<input id="s_cover" class="num" size="5" value="${esc(s.cover_days)}"></label>
    <label class="f">گرد کردن مبلغ شارژ به مضرب (ریال)<input id="s_round" class="num" size="14" value="${esc(s.deposit_round)}"></label>
    <label class="f"><span><input type="checkbox" id="s_dep" ${s.auto_deposit === '1' ? 'checked' : ''}> واریزهای بانک خودکار وارد دفتر شود</span></label>
    <label class="f"><span><input type="checkbox" id="s_match" ${s.auto_match === '1' ? 'checked' : ''}> برداشت‌ها خودکار با هزینهٔ هم‌مبلغ تطبیق داده شوند</span></label></div>
  <h2>دریافت خودکار پیامک از گوشی اندروید</h2>
  <p class="mut sm" style="margin-top:0">این مقادیر را در اپ اندروید وارد کنید. آدرس سرور = آدرس این برنامه (مثلاً http://192.168.1.10:3100).</p>
  <div class="row"><label class="f">توکن اپ اندروید<input readonly value="${esc(s.sms_token)}" size="30" class="num" onclick="this.select()"></label></div>
  <h2>به‌روزرسانی برنامه</h2>
  <p class="mut sm" style="margin-top:0">نسخهٔ فعلی: <span class="num">${esc(B.version || '')}</span>. با این دکمه آخرین نسخه از گیت‌هاب گرفته می‌شود؛ اطلاعات شما دست نمی‌خورد و برنامه چند ثانیه بعد دوباره بالا می‌آید. اپ اندروید نیازی به نصب دوباره ندارد.</p>
  <button class="ghost" id="upd">به‌روزرسانی از گیت‌هاب</button> <span id="updMsg" class="mut sm"></span>
  <h2>رمز ورود (اختیاری)</h2><div class="row"><label class="f">رمز (خالی = بدون رمز)<input id="s_pw" type="password" placeholder="بدون تغییر"></label></div>
  <div style="margin-top:16px"><button id="s_save">ذخیره تنظیمات</button></div></div>
  <h2>دسته‌های هزینه و کلیدواژه‌ها</h2>
  <p class="mut sm">کلیدواژه‌ها (با ویرگول جدا شوند) به برنامه یاد می‌دهند هر شرح هزینه به کدام دسته می‌رود. هرچه بیشتر ثبت کنید، پیشنهادها دقیق‌تر می‌شود چون سابقهٔ خودتان هم یاد گرفته می‌شود.</p>
  <div class="scroll"><table class="tbl"><thead><tr><th>دسته</th><th>نوع پیش‌فرض</th><th>کلیدواژه‌ها</th><th></th></tr></thead><tbody>${cats.map(c => `<tr><td><input data-n="${c.id}" value="${esc(c.name)}"></td>
    <td><select data-k="${c.id}"><option value="official" ${c.kind === 'official' ? 'selected' : ''}>رسمی</option><option value="unofficial" ${c.kind === 'unofficial' ? 'selected' : ''}>غیر رسمی</option></select></td>
    <td><input data-w="${c.id}" value="${esc(c.keywords)}" style="width:100%"></td><td class="act"><button class="ghost sm" data-sc="${c.id}">ذخیره</button></td></tr>`).join('')}
    <tr><td><input id="nc_n" placeholder="دستهٔ جدید"></td><td><select id="nc_k"><option value="official">رسمی</option><option value="unofficial">غیر رسمی</option></select></td><td><input id="nc_w" placeholder="کلیدواژه‌ها" style="width:100%"></td><td class="act"><button class="sm" id="nc_add">افزودن</button></td></tr></tbody></table></div>
  <h2>ورود اطلاعات از اکسل‌های قدیمی</h2>
  <div class="sheet"><p class="mut" style="margin-top:0">فایل‌های اکسل تنخواه قبلی (فرم‌های «صورت خلاصه هزینه‌ها»، شیت مادر <b>m</b> و فایل دفتر گردش) را انتخاب کنید. تنخواه‌های تکراری ردّ می‌شوند و جمع هر تنخواه با دفتر گردش مقایسه می‌شود.</p>
  <div class="row"><label class="f">سال برای شیت m<input id="im_y" class="num" size="6" value="${B.today.slice(0, 4)}"></label><input type="file" id="im_f" accept=".xlsx"></div><div id="im_res"></div></div>`;
  $('#upd').onclick = guard(async () => {
    if (!confirm('برنامه به آخرین نسخه به‌روز شود؟')) return;
    $('#updMsg').textContent = 'در حال دریافت…'; const r = await api('update', { json: {} });
    $('#updMsg').textContent = `${r.files} فایل به‌روز شد. برنامه در حال راه‌اندازی مجدد است…`;
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 3000)); try { const h = await (await fetch('/api/health', { cache: 'no-store' })).json(); if (h.ok && h.version !== B.version) { location.reload(); return; } } catch { } }
    $('#updMsg').textContent = 'راه‌اندازی مجدد طول کشید؛ صفحه را دستی بازخوانی کنید.';
  });
  $('#s_save').onclick = guard(async () => { await api('settings', { method: 'PUT', json: { company: $('#s_co').value, preparer: $('#s_pre').value, unit: $('#s_unit').value, cover_days: toLatin($('#s_cover').value), deposit_round: toLatin($('#s_round').value).replace(/,/g, ''), auto_deposit: $('#s_dep').checked ? '1' : '0', auto_match: $('#s_match').checked ? '1' : '0', password: $('#s_pw').value ? $('#s_pw').value : '__keep__' } }); B = await api('bootstrap'); $('#companyName').textContent = B.settings.company; toast('ذخیره شد'); });
  $$('[data-sc]').forEach(b => b.onclick = guard(async () => { const id = b.dataset.sc; await api('categories/' + id, { method: 'PUT', json: { name: $(`[data-n="${id}"]`).value, kind: $(`[data-k="${id}"]`).value, keywords: $(`[data-w="${id}"]`).value, active: 1 } }); B = await api('bootstrap'); toast('ذخیره شد'); }));
  $('#nc_add').onclick = guard(async () => { if (!$('#nc_n').value.trim()) return toast('نام دسته را بنویسید', true); await api('categories', { json: { name: $('#nc_n').value, kind: $('#nc_k').value, keywords: $('#nc_w').value } }); B = await api('bootstrap'); toast('دسته اضافه شد'); settings(); });
  $('#im_f').onchange = guard(async e => { const f = e.target.files[0]; if (!f) return; $('#im_res').innerHTML = '<p>در حال خواندن…</p>'; const r = await api('import?year=' + toLatin($('#im_y').value), { raw: await f.arrayBuffer(), filename: f.name }); B = await api('bootstrap');
    $('#im_res').innerHTML = `<p class="note" style="background:var(--ok-bg);border-color:#bcdcc6;color:var(--green-d)">${r.settlements} تنخواه و ${r.expenses} ردیف هزینه وارد شد · ${r.ledger} ردیف دفتر گردش.</p>
    ${r.mismatches.length ? `<p class="note">مغایرت جمع با دفتر گردش:<br>${r.mismatches.map(m => `${esc(m.tag)}: دفتر ${fmt(m.ledger)} ← فرم ${fmt(m.computed)}`).join('<br>')}</p>` : ''}
    ${r.notes.length ? `<p class="note">${r.notes.map(esc).join('<br>')}</p>` : ''}
    ${r.skipped.length ? `<details><summary>${r.skipped.length} مورد ردّ شد</summary><div class="mut sm">${r.skipped.slice(0, 60).map(esc).join('<br>')}</div></details>` : ''}`; });
}
boot();
