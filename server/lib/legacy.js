'use strict';
// ورود فایل‌های اکسل قدیمی: فرم‌های «صورت خلاصه هزینه‌ها»، شیت مادر «m» و دفتر گردش تنخواه
const { readXlsx } = require('./xlsx');
const { q, settings } = require('./db');
const S = require('./smart'); const J = require('./jalali'); const svc = require('./service');

const s = v => S.norm(v ?? '');
const num = v => S.parseAmount(v);
function tagParse(tag) { // «رسمی 14» / «غیر رسمی 02» / «رسمی1»
  const t = S.toLatin(tag || '').replace(/\s+/g, ' ').trim(); const m = t.match(/^(غیر\s*رسمی|رسمی)\.?\s*(\d+)/); if (!m) return null;
  return { kind: m[1].startsWith('غیر') ? 'unofficial' : 'official', number: +m[2] };
}
function findHeader(rows, need) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) { const r = rows[i]; if (!r) continue; const map = {}; r.forEach((v, c) => { const h = s(v); for (const [k, keys] of Object.entries(need)) if (map[k] === undefined && keys.some(x => h.includes(x))) map[k] = c; });
    if (Object.keys(need).every(k => map[k] !== undefined || k.startsWith('?'))) return { row: i, map }; }
  return null;
}
const EXP_HEAD = { day: ['روز'], month: ['ماه'], desc: ['شرح'], amount: ['مبلغ ناخالص', 'مبلغ'] };
function mkDate(y, m, d) { m = +m; d = +d; if (!m || !d || m > 12 || d > J.monthLen(y, m)) return null; return J.fmt(y, m, d); }

function importWorkbook(buf, opts = {}) {
  const wb = readXlsx(buf); const report = { forms: 0, master: 0, ledger: 0, settlements: 0, expenses: 0, skipped: [], mismatches: [], notes: [] };
  const ledgerInfo = {};            // year -> {tag -> {amount, date}}
  const importYear = +opts.year || 1405;
  // ۱) دفتر گردش (شیت‌هایی با ستون‌های ردیف/شرح کالا/واریز/قیمت/مانده)
  for (const name of wb.sheetNames) {
    if (!/^\s*14\d\d\s*$/.test(name)) continue;
    const rows = wb.rows(name, { maxCols: 8 }); const hd = findHeader(rows, { desc: ['شرح'], dep: ['واریز'], price: ['قیمت'] }); if (!hd) continue;
    let y = +name.trim(); const firstDate = rows.slice(hd.row + 1).map(r => r && J.parseDate(r[5])).find(Boolean);
    if (firstDate && +firstDate.slice(0, 4) !== y) { report.notes.push(`شیت «${name.trim()}» تاریخ‌های سال ${firstDate.slice(0, 4)} دارد؛ بر اساس تاریخ‌ها خوانده شد.`); y = +firstDate.slice(0, 4); }
    ledgerInfo[y] ??= {}; let lastDate = `${y}/01/01`; let opened = false;
    for (let i = hd.row + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue; const title = String(r[hd.map.desc] ?? '').trim(); const dep = num(r[hd.map.dep]), price = num(r[hd.map.price]); const date = J.parseDate(r[5]);
      if (/اول دوره/.test(title) && dep) { if (!q.get("SELECT 1 FROM fund_entries WHERE type='opening' AND date=?", `${y}/01/01`)) svc.addFund({ date: `${y}/01/01`, type: 'opening', amount: dep, note: 'اول دوره' }); opened = true; report.ledger++; continue; }
      if (date) lastDate = date;
      if (/^واریز/.test(title) && dep) { if (!q.get("SELECT 1 FROM fund_entries WHERE type='deposit' AND date=? AND amount=?", date || lastDate, dep)) svc.addFund({ date: date || lastDate, type: 'deposit', amount: dep }); report.ledger++; }
      else { const t = tagParse(title.replace(/تنخواه\s*شماره\s*/, '')); if (t && price) ledgerInfo[y][`${t.kind}-${t.number}`] = { amount: price, date: date || null }; }
    }
  }
  // ۲) فرم‌های تکی «صورت خلاصه هزینه‌ها»
  for (const name of wb.sheetNames) {
    if (/^(m|خام)$/.test(name.trim()) || /^\s*14\d\d\s*$/.test(name)) continue;
    const rows = wb.rows(name, { maxCols: 12, maxRows: 120 }); const flat = rows.filter(Boolean).slice(0, 8).map(r => r.map(v => String(v)).join(' ')).join(' | ');
    if (!/شماره تنخواه/.test(flat)) continue;
    const numM = S.toLatin(flat).match(/شماره تنخواه\s*[:：]?\s*(\d+)/); const dM = J.parseDate((S.toLatin(flat).match(/تاریخ تهیه\s*[:：]?\s*([\d\/\-]+)/) || [])[1]);
    if (!numM || !dM) { report.skipped.push(`${name.trim()}: شماره یا تاریخ تنخواه خوانده نشد`); continue; }
    const kind = /غیر/.test(name) ? 'unofficial' : 'official'; const sy = +dM.slice(0, 4), sm = +dM.slice(5, 7), number = +numM[1];
    if (q.get('SELECT 1 FROM settlements WHERE year=? AND kind=? AND number=?', sy, kind, number)) { report.skipped.push(`${name.trim()}: تنخواه ${svc.KIND_FA[kind]} ${number} (${sy}) از قبل موجود است`); continue; }
    const hd = findHeader(rows, { day: ['روز'], month: ['ماه'], desc: ['شرح'], amount: ['مبلغ'], '?inv': ['فاکتور'] }); if (!hd) { report.skipped.push(`${name.trim()}: سرستون‌ها پیدا نشد`); continue; }
    const items = [];
    for (let i = hd.row + 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; if (/جمع/.test(String(r[1] ?? r[2] ?? ''))) break;
      const desc = String(r[hd.map.desc] ?? '').trim(), amount = num(r[hd.map.amount]); if (!desc && !amount) continue;
      let month = +r[hd.map.month], y = sy; if (month > sm) y = sy - 1; const date = mkDate(y, month, +r[hd.map.day]);
      items.push({ date, description: desc, amount, invoice_no: hd.map['?inv'] !== undefined ? String(r[hd.map['?inv']] ?? '') : '', kind }); }
    if (!items.length) continue;
    insertSettlement({ year: sy, kind, number, date: dM, items }); report.forms++; report.settlements++; report.expenses += items.length;
  }
  // ۳) شیت مادر «m» (هر ردیف یک هزینه با برچسب تنخواه)
  const mName = wb.sheetNames.find(n => n.trim() === 'm');
  if (mName && opts.master !== false) {
    const rows = wb.rows(mName, { maxCols: 14 }); const hd = findHeader(rows, { day: ['روز'], month: ['ماه'], desc: ['شرح'], amount: ['مبلغ ناخالص', 'مبلغ'] });
    if (hd) {
      const tagCol = rows[hd.row].findIndex((v, i) => i > hd.map.amount && /Column2|تنخواه|برچسب/.test(String(v))); const invCol = rows[hd.row].findIndex(v => /فاکتور/.test(String(v)));
      const groups = {};
      for (let i = hd.row + 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; const desc = String(r[hd.map.desc] ?? '').trim(), amount = num(r[hd.map.amount]); if (!desc || !amount) continue;
        const t = tagParse(r[tagCol >= 0 ? tagCol : hd.map.amount + 1]); if (!t) { report.skipped.push(`m ردیف ${i + 1}: برچسب تنخواه ندارد`); continue; }
        const g = groups[`${t.kind}-${t.number}`] ??= { ...t, items: [] };
        g.items.push({ date: mkDate(importYear, r[hd.map.month], r[hd.map.day]), description: desc, amount, invoice_no: invCol >= 0 ? String(r[invCol] ?? '') : '', kind: t.kind }); }
      for (const [key, g] of Object.entries(groups)) {
        if (q.get('SELECT 1 FROM settlements WHERE year=? AND kind=? AND number=?', importYear, g.kind, g.number)) { report.skipped.push(`m: تنخواه ${svc.KIND_FA[g.kind]} ${g.number} (${importYear}) از قبل موجود است`); continue; }
        const li = ledgerInfo[importYear]?.[key]; const lastDate = g.items.map(x => x.date).filter(Boolean).sort().pop() || `${importYear}/01/01`;
        const date = li?.date || lastDate; const total = g.items.reduce((a, b) => a + b.amount, 0);
        if (li && li.amount !== total) report.mismatches.push({ tag: `${svc.KIND_FA[g.kind]} ${g.number}`, ledger: li.amount, computed: total, diff: total - li.amount });
        insertSettlement({ year: importYear, kind: g.kind, number: g.number, date, items: g.items }); report.master++; report.settlements++; report.expenses += g.items.length;
      }
      for (const [k, v] of Object.entries(ledgerInfo[importYear] || {})) if (!groups[k]) report.notes.push(`در دفتر گردش، «${k.replace('unofficial-', 'غیر رسمی ').replace('official-', 'رسمی ')}» (${v.amount.toLocaleString('en-US')}) هست ولی ردیف‌هایش در شیت m نبود.`);
    }
  }
  S.invalidate(); return report;
}
function insertSettlement({ year, kind, number, date, items }) {
  const st = settings();
  q.tx(() => {
    const sid = +q.run('INSERT INTO settlements(year,kind,number,date,status,company,preparer,unit) VALUES(?,?,?,?,?,?,?,?)', year, kind, number, date, 'final', st.company, st.preparer, st.unit).lastInsertRowid;
    for (const it of items) {
      // دسته‌بندی با خود هوش برنامه؛ نوع (رسمی/غیررسمی) همان نوع تنخواه است
      const c = S.classify(it.description); const ex = S.extract(it.description);
      q.run('INSERT INTO expenses(date,description,amount,invoice_no,category_id,kind,settlement_id,vehicle,waybill,party) VALUES(?,?,?,?,?,?,?,?,?,?)', it.date, it.description, it.amount, it.invoice_no || null, c.category_id, kind, sid, ex.vehicle || null, ex.waybill || null, ex.party || null);
    }
  });
  S.invalidate();
}
module.exports = { importWorkbook };
