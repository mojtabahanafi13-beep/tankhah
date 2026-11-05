'use strict';
// برنامهٔ تنخواه‌گردانی — سرور محلی بدون وابستگی (Node 22.5+)
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const { q, settings, setSetting } = require('./lib/db');
const S = require('./lib/smart'), J = require('./lib/jalali'), svc = require('./lib/service');
const bank = require('./lib/bank'), legacy = require('./lib/legacy'), { buildXlsx } = require('./lib/xlsx');
const PORT = +process.env.PORT || 3100, PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png' };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const readBody = req => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > 60e6) { no(new Error('حجم فایل زیاد است')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = n => Math.round(n || 0).toLocaleString('en-US');

/* ---------- خروجی اکسل ---------- */
function settlementXlsx(id) {
  const s = svc.getSettlement(id); const st = settings(); const company = s.company || st.company;
  const rows = [];
  rows.push([null, { v: company, s: 'title' }]); rows.push([]); rows.push([null, null, null, null, null, { v: '(ارقام به ریال)', s: 'sub' }]);
  rows.push([]);
  rows.push([null, { v: `شماره تنخواه: ${String(s.number).padStart(2, '0')}${s.kind === 'unofficial' ? ' (غیر رسمی)' : ''}`, s: 'bold' }, null, { v: 'صورت خلاصه هزینه‌های انجام شده ' + (s.unit || ''), s: 'bold' }, null, { v: 'تاریخ تهیه: ' + s.date, s: 'bold' }]);
  rows.push([null, { v: 'نام و نام خانوادگی: ' + (s.preparer || ''), s: 'plain' }, null, null, null, { v: 'نام واحد: ' + (s.unit || ''), s: 'plain' }]);
  const head = ['ردیف', 'روز', 'ماه', 'شماره فاکتور', 'شرح', 'مبلغ ناخالص'];
  rows.push([null, ...head.map(h => ({ v: h, s: 'head' }))]);
  const first = rows.length;
  s.rows.forEach((r, i) => { const d = r.date ? r.date.split('/') : ['', '']; rows.push([null, { v: i + 1, s: 'int' }, { v: d[2] ? +d[2] : '', s: 'int' }, { v: d[1] ? +d[1] : '', s: 'int' }, { v: r.invoice_no || '', s: 'text' }, { v: r.description, s: 'text' }, { v: r.amount, s: 'num' }]); });
  rows.push([null, { v: 'جمع', s: 'totaltext' }, { v: '', s: 'totaltext' }, { v: '', s: 'totaltext' }, { v: '', s: 'totaltext' }, { v: '', s: 'totaltext' }, { v: s.total, s: 'total' }]);
  rows.push([]); rows.push([]);
  rows.push([null, { v: 'امضاء تهیه‌کننده:', s: 'bold' }, null, { v: 'امضا کنترل‌کننده:', s: 'bold' }, null, { v: 'امضاء تایید‌کننده:', s: 'bold' }]);
  const last = rows.length;
  return buildXlsx([{ name: `${svc.KIND_FA[s.kind]} ${s.number}`, widths: [3, 7, 6, 6, 14, 58, 18], rows, merges: ['B1:G1', 'B2:G2'.replace('B2', 'B2')].slice(0, 1), freeze: 0, heights: { 0: 24 } }]);
}
function reportXlsx(rep) {
  const sheets = [];
  const secs = rep.sections.length ? rep.sections : [];
  const mk = (title, sec, idx) => {
    const rows = []; const cols = sec.columns;
    rows.push([{ v: rep.title + (sec.title ? ' - ' + sec.title : ''), s: 'title' }]); rows.push([]);
    if (idx === 0 && rep.summary) { for (const [k, v, t] of rep.summary) rows.push([{ v: k, s: 'bold' }, { v: v ?? '', s: 'plain' }]); rows.push([]); }
    rows.push(cols.map(c => ({ v: c.label, s: 'head' })));
    for (const r of sec.rows) rows.push(cols.map(c => { const v = r[c.key]; if (c.type === 'money' || c.type === 'balance') return { v: v ?? 0, s: (v < 0 || (c.type === 'balance' && v < 0)) ? 'neg' : 'num' }; if (c.type === 'int') return { v: v ?? '', s: 'int' }; return { v: v ?? '', s: 'text' }; }));
    if (sec.totals) rows.push(cols.map((c, i) => ({ v: sec.totals[c.key] ?? '', s: typeof sec.totals[c.key] === 'number' ? 'total' : 'totaltext' })));
    return { name: (sec.title || rep.title).slice(0, 28) || 'گزارش', widths: cols.map(c => c.type === 'text' ? (c.key === 'description' || c.key === 'message' || c.key === 'title' ? 55 : 22) : 18), rows, merges: [`A1:${String.fromCharCode(64 + Math.min(cols.length, 26))}1`], heights: { 0: 24 }, landscape: cols.length > 6 };
  };
  if (!secs.length) { const rows = [[{ v: rep.title, s: 'title' }], []]; for (const [k, v] of rep.summary || []) rows.push([{ v: k, s: 'bold' }, { v: v ?? '', s: 'plain' }]); if (rep.note) rows.push([], [{ v: rep.note, s: 'sub' }]); return buildXlsx([{ name: 'گزارش', widths: [45, 22], rows }]); }
  secs.forEach((sec, i) => sheets.push(mk(rep.title, sec, i))); const used = new Set(); sheets.forEach(sh => { let n = sh.name, k = 2; while (used.has(n)) n = sh.name.slice(0, 25) + ' ' + k++; sh.name = n; used.add(n); });
  return buildXlsx(sheets);
}

/* ---------- چاپ فرم تنخواه (HTML آمادهٔ چاپ و ذخیره PDF) ---------- */
function printSettlement(id) {
  const s = svc.getSettlement(id); if (!s) return null; const st = settings(); const company = s.company || st.company;
  const rows = s.rows.map((r, i) => { const d = r.date ? r.date.split('/') : ['', '', '']; return `<tr><td class=c>${i + 1}</td><td class=c>${+d[2] || ''}</td><td class=c>${+d[1] || ''}</td><td class=c>${esc(r.invoice_no)}</td><td>${esc(r.description)}</td><td class=n>${fmt(r.amount)}</td></tr>`; }).join('');
  return `<!doctype html><html lang=fa dir=rtl><meta charset=utf-8><title>تنخواه ${svc.KIND_FA[s.kind]} ${s.number}</title><style>
  @page{size:A4;margin:12mm}body{font-family:Vazirmatn,Tahoma,sans-serif;font-size:11px;color:#000;margin:0}
  h1{text-align:center;font-size:16px;margin:0 0 4px}.sub{text-align:left;font-size:10px;margin-bottom:6px}
  .meta{display:flex;justify-content:space-between;gap:12px;font-weight:700;margin:6px 0}.meta2{display:flex;justify-content:space-between;margin-bottom:8px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:3px 5px;vertical-align:middle}th{background:#e4ece6}
  td.c{text-align:center;width:1%;white-space:nowrap}td.n{text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}tr.t td{font-weight:700;background:#efefef}
  .sig{display:flex;justify-content:space-between;margin-top:46px;font-weight:700}.sig div{width:30%}
  .bar{position:fixed;top:0;inset-inline:0;background:#17301f;color:#fff;padding:8px 16px;font-size:13px;display:flex;gap:10px;align-items:center}@media print{.bar{display:none}body{margin-top:0}}body{margin-top:44px}
  button{font:inherit;padding:4px 12px;cursor:pointer}</style>
  <div class=bar><button onclick=print()>چاپ / ذخیره PDF</button><span>برای PDF در پنجرهٔ چاپ «Save as PDF» را انتخاب کنید.</span></div>
  <h1>${esc(company)}</h1><div class=sub>(ارقام به ریال)</div>
  <div class=meta><span>شماره تنخواه: ${String(s.number).padStart(2, '0')}${s.kind === 'unofficial' ? ' (غیر رسمی)' : ''}</span><span>صورت خلاصه هزینه‌های انجام شده ${esc(s.unit)}</span><span>تاریخ تهیه: ${s.date}</span></div>
  <div class=meta2><span>نام و نام خانوادگی: ${esc(s.preparer)}</span><span>نام واحد: ${esc(s.unit)}</span></div>
  <table><thead><tr><th>ردیف</th><th>روز</th><th>ماه</th><th>شماره فاکتور</th><th>شرح</th><th>مبلغ ناخالص</th></tr></thead><tbody>${rows}
  <tr class=t><td colspan=5 style="text-align:center">جمع</td><td class=n>${fmt(s.total)}</td></tr></tbody></table>
  <div class=sig><div>امضاء تهیه‌کننده:</div><div>امضا کنترل‌کننده:</div><div>امضاء تایید‌کننده:</div></div></html>`;
}

/* ---------- مسیریابی ---------- */
const ok = res => json(res, { ok: true });
async function api(req, res, u, parts) {
  const m = req.method, qs = u.query;
  const body = async () => { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
  const [a, b, c] = parts;
  if (a === 'bootstrap') return json(res, { settings: { ...settings(), password: undefined }, categories: q.all('SELECT * FROM categories ORDER BY sort,id'), today: J.todayJ(), months: J.MONTHS, nextNumbers: { official: svc.nextNumber(+J.todayJ().slice(0, 4), 'official'), unofficial: svc.nextNumber(+J.todayJ().slice(0, 4), 'unofficial') } });
  if (a === 'settings') { if (m === 'PUT') { const d = await body(); for (const k of ['company', 'preparer', 'unit', 'cover_days', 'deposit_round', 'auto_match', 'auto_deposit']) if (k in d) setSetting(k, d[k]); if (d.password !== undefined && d.password !== '__keep__') setSetting('password', d.password); return ok(res); } }
  if (a === 'categories') {
    if (m === 'POST') { const d = await body(); const r = q.run('INSERT INTO categories(name,kind,keywords,sort) VALUES(?,?,?,99)', d.name, d.kind === 'unofficial' ? 'unofficial' : 'official', d.keywords || ''); S.invalidate(); return json(res, { id: +r.lastInsertRowid }); }
    if (m === 'PUT') { const d = await body(); q.run('UPDATE categories SET name=?,kind=?,keywords=?,active=? WHERE id=?', d.name, d.kind, d.keywords || '', d.active === 0 ? 0 : 1, +b); S.invalidate(); return ok(res); }
  }
  if (a === 'dashboard') return json(res, svc.dashboard());
  if (a === 'suggest' && m === 'POST') { const d = await body(); const cl = S.classify(d.description || ''); const ex = S.extract(d.description || ''); return json(res, { ...cl, ...ex, typical: S.typicalAmount(d.description || '') }); }
  if (a === 'descriptions') { const rows = q.all(`SELECT description, COUNT(*) n FROM expenses WHERE description!='' GROUP BY description ORDER BY n DESC LIMIT 300`); return json(res, rows.map(r => r.description)); }
  if (a === 'expenses') {
    if (m === 'GET') return json(res, svc.listExpenses(qs));
    if (m === 'POST') { const d = await body(); const id = svc.addExpense(d); return json(res, { id }); }
    if (m === 'PUT') { svc.updateExpense(+b, await body()); return ok(res); }
    if (m === 'DELETE') { svc.deleteExpense(+b); return ok(res); }
  }
  if (a === 'settlements') {
    if (m === 'GET' && !b) return json(res, svc.listSettlements(qs.year));
    if (m === 'GET' && b && !c) return json(res, svc.getSettlement(+b));
    if (m === 'GET' && c === 'xlsx') { const s = svc.getSettlement(+b); const buf = settlementXlsx(+b); res.writeHead(200, { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('تنخواه ' + svc.KIND_FA[s.kind] + ' ' + s.number + '.xlsx')}` }); return res.end(buf); }
    if (m === 'POST' && !b) { const d = await body(); return json(res, { id: svc.createSettlement(d) }); }
    if (m === 'POST' && c === 'finalize') { svc.setSettlementStatus(+b, 'final'); return ok(res); }
    if (m === 'POST' && c === 'reopen') { svc.setSettlementStatus(+b, 'draft'); return ok(res); }
    if (m === 'POST' && c === 'remove-expense') { const d = await body(); svc.removeFromSettlement(+d.expense_id); return ok(res); }
    if (m === 'PUT') { svc.updateSettlement(+b, await body()); return ok(res); }
    if (m === 'DELETE') { svc.deleteSettlement(+b); return ok(res); }
  }
  if (a === 'fund') {
    if (m === 'POST') { const d = await body(); return json(res, { id: svc.addFund(d) }); }
    if (m === 'DELETE') { q.run('DELETE FROM fund_entries WHERE id=?', +b); return ok(res); }
  }
  if (a === 'bank') {
    if (b === 'preview' && m === 'POST') {
      let txs; const ct = req.headers['content-type'] || '';
      if (ct.includes('json')) { const d = await body(); txs = bank.fromSMS(d.sms || ''); if (!txs.length) throw new Error('هیچ پیامک قابل‌فهمی پیدا نشد. هر پیامک را با یک خط خالی جدا کنید و مطمئن شوید مبلغ و کلمهٔ «برداشت/واریز» داخلش باشد.'); }
      else { const buf = await readBody(req); txs = bank.parseUpload(buf, decodeURIComponent(req.headers['x-filename'] || '')); }
      return json(res, svc.previewBank(txs));
    }
    if (b === 'commit' && m === 'POST') { const d = await body(); return json(res, svc.commitBank(d.txs || [])); }
    if (m === 'GET' && !b) return json(res, svc.listBank(qs));
    if (c === 'link' && m === 'POST') { const d = await body(); svc.linkBank(+b, d.expense_id ? +d.expense_id : null); return ok(res); }
    if (c === 'ignore' && m === 'POST') { const d = await body(); svc.ignoreBank(+b, !!d.ignored); return ok(res); }
    if (c === 'make-expense' && m === 'POST') { return json(res, { id: svc.expenseFromBank(+b, await body()) }); }
  }
  if (a === 'report') { const rep = svc.runReport(b, qs); return json(res, rep); }
  if (a === 'export') { const name = b.replace(/\.xlsx$/, ''); const rep = svc.runReport(name, qs); const buf = reportXlsx(rep); res.writeHead(200, { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rep.title + '.xlsx')}` }); return res.end(buf); }
  if (a === 'import' && m === 'POST') { const buf = await readBody(req); const r = legacy.importWorkbook(buf, { year: +qs.year || undefined }); return json(res, r); }
  res.writeHead(404); res.end('{"error":"پیدا نشد"}');
}
function authOK(req) {
  const pw = settings().password; if (!pw) return true;
  const h = req.headers.authorization || ''; if (!h.startsWith('Basic ')) return false;
  const [, p] = Buffer.from(h.slice(6), 'base64').toString().split(/:(.*)/s); return p === pw;
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/sms/')) { // دریافت پیامک از اپ اندروید؛ با توکن، بدون رمز مرورگر
      const tok = req.headers['x-token'] || ''; if (!tok || tok !== settings().sms_token) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"توکن نادرست است"}'); }
      if (req.url.startsWith('/api/sms/ping')) return json(res, { ok: true, company: settings().company });
      if (req.url.startsWith('/api/sms/ingest') && req.method === 'POST') {
        const d = JSON.parse((await readBody(req)).toString('utf8') || '{}'); const txs = bank.fromSMS(String(d.body || ''));
        if (!txs.length) return json(res, { ok: true, parsed: 0, note: 'پیامک تراکنش قابل‌فهم نبود' });
        const r = svc.commitBank(txs); console.log('SMS', d.sender, JSON.stringify(r)); return json(res, { ok: true, parsed: txs.length, ...r });
      }
    }
    if (!authOK(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Tankhah"' }); return res.end('نیاز به رمز'); }
    const u = url.parse(req.url, true); const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (parts[0] === 'api') return await api(req, res, u, parts.slice(1));
    if (parts[0] === 'print' && parts[1] === 'settlement') { const h = printSettlement(+parts[2]); if (!h) { res.writeHead(404); return res.end('پیدا نشد'); } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(h); }
    let f = path.join(PUB, parts.length ? parts.join('/') : 'index.html'); if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); json(res, { error: e.message || String(e) }, 400); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`تنخواه‌گردانی روی http://localhost:${PORT} اجرا شد`));
