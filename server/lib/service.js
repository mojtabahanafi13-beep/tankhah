'use strict';
const { q, settings } = require('./db');
const S = require('./smart');
const J = require('./jalali');

const KIND_FA = { official: 'رسمی', unofficial: 'غیر رسمی' };
const yearOf = d => d ? +d.slice(0, 4) : null;
const money = n => Math.round(n || 0);

/* ---------- هزینه‌ها ---------- */
function cleanExpense(b, prev = {}) {
  const e = { ...prev };
  if ('date' in b) { e.date = b.date ? J.parseDate(b.date) : null; if (b.date && !e.date) throw new Error('تاریخ نامعتبر است (نمونه: 1405/08/13)'); }
  if ('description' in b) e.description = String(b.description || '').trim();
  if ('amount' in b) e.amount = S.parseAmount(b.amount);
  for (const k of ['invoice_no', 'vehicle', 'waybill', 'party', 'note']) if (k in b) e[k] = b[k] ? String(b[k]).trim() : null;
  if ('category_id' in b) e.category_id = b.category_id ? +b.category_id : null;
  if ('kind' in b && b.kind) e.kind = b.kind === 'unofficial' ? 'unofficial' : 'official';
  const ex = S.extract(e.description);
  if (!e.waybill && ex.waybill) e.waybill = ex.waybill;
  if (!e.vehicle && ex.vehicle) e.vehicle = ex.vehicle;
  if (!e.party && ex.party) e.party = ex.party;
  if (!e.category_id) { const c = S.classify(e.description); e.category_id = c.category_id; if (!('kind' in b) || !b.kind) e.kind = c.kind; }
  if (!e.kind) e.kind = 'official';
  return e;
}
function addExpense(b) {
  const e = cleanExpense({ kind: null, ...b });
  if (!e.description) throw new Error('شرح هزینه را بنویسید');
  if (!(e.amount > 0)) throw new Error('مبلغ باید بیشتر از صفر باشد');
  const r = q.run(`INSERT INTO expenses(date,description,amount,invoice_no,category_id,kind,vehicle,waybill,party,bank_tx_id,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    e.date ?? null, e.description, e.amount, e.invoice_no ?? null, e.category_id ?? null, e.kind, e.vehicle ?? null, e.waybill ?? null, e.party ?? null, b.bank_tx_id ?? null, e.note ?? null);
  S.invalidate(); return +r.lastInsertRowid;
}
function lockedCheck(id) {
  const x = q.get('SELECT e.settlement_id, s.status FROM expenses e LEFT JOIN settlements s ON s.id=e.settlement_id WHERE e.id=?', id);
  if (!x) throw new Error('هزینه پیدا نشد');
  if (x.status === 'final') throw new Error('این هزینه در تنخواه نهایی‌شده است. ابتدا تنخواه را «بازگشایی» کنید.');
}
function updateExpense(id, b) {
  lockedCheck(id);
  const prev = q.get('SELECT * FROM expenses WHERE id=?', id);
  const e = cleanExpense(b, prev);
  q.run(`UPDATE expenses SET date=?,description=?,amount=?,invoice_no=?,category_id=?,kind=?,vehicle=?,waybill=?,party=?,note=? WHERE id=?`,
    e.date ?? null, e.description, e.amount, e.invoice_no ?? null, e.category_id ?? null, e.kind, e.vehicle ?? null, e.waybill ?? null, e.party ?? null, e.note ?? null, id);
  S.invalidate();
}
function deleteExpense(id) { lockedCheck(id); q.run('DELETE FROM expenses WHERE id=?', id); S.invalidate(); }
function listExpenses(f = {}) {
  const w = [], p = [];
  if (f.from) { w.push('e.date>=?'); p.push(f.from); } if (f.to) { w.push('e.date<=?'); p.push(f.to); }
  if (f.cat) { w.push('e.category_id=?'); p.push(+f.cat); }
  if (f.kind) { w.push('e.kind=?'); p.push(f.kind); }
  if (f.status === 'open') w.push('e.settlement_id IS NULL'); if (f.status === 'settled') w.push('e.settlement_id IS NOT NULL');
  if (f.settlement) { w.push('e.settlement_id=?'); p.push(+f.settlement); }
  if (f.q) { w.push('(e.description LIKE ? OR e.invoice_no LIKE ? OR e.waybill LIKE ? OR e.party LIKE ?)'); const l = `%${f.q}%`; p.push(l, l, l, l); }
  const rows = q.all(`SELECT e.*, c.name category, s.number snum, s.kind skind, s.year syear, s.status sstatus FROM expenses e LEFT JOIN categories c ON c.id=e.category_id LEFT JOIN settlements s ON s.id=e.settlement_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY COALESCE(e.date,'9999') DESC, e.id DESC LIMIT ${Math.min(+f.limit || 500, 5000)}`, ...p);
  const total = q.get(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) sum FROM expenses e ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`, ...p);
  return { rows, count: total.n, sum: total.sum };
}

/* ---------- تنخواه (تسویه) ---------- */
function nextNumber(year, kind) { return (q.get('SELECT MAX(number) m FROM settlements WHERE year=? AND kind=?', year, kind).m || 0) + 1; }
function createSettlement({ kind, date, expense_ids, number }) {
  kind = kind === 'unofficial' ? 'unofficial' : 'official';
  date = J.parseDate(date) || J.todayJ(); const year = yearOf(date);
  return q.tx(() => {
    let ids = expense_ids;
    if (!ids || !ids.length) ids = q.all('SELECT id FROM expenses WHERE settlement_id IS NULL AND kind=?', kind).map(r => r.id);
    if (!ids.length) throw new Error('هزینهٔ تسویه‌نشده‌ای از این نوع وجود ندارد');
    const n = number ? +number : nextNumber(year, kind);
    if (q.get('SELECT 1 FROM settlements WHERE year=? AND kind=? AND number=?', year, kind, n)) throw new Error(`تنخواه ${KIND_FA[kind]} شماره ${n} در سال ${year} از قبل وجود دارد`);
    const st = settings();
    const r = q.run('INSERT INTO settlements(year,kind,number,date,status,company,preparer,unit) VALUES(?,?,?,?,?,?,?,?)', year, kind, n, date, 'draft', st.company, st.preparer, st.unit);
    const sid = +r.lastInsertRowid;
    for (const id of ids) q.run('UPDATE expenses SET settlement_id=? WHERE id=? AND settlement_id IS NULL AND kind=?', sid, id, kind);
    return sid;
  });
}
function getSettlement(id) {
  const s = q.get('SELECT * FROM settlements WHERE id=?', id); if (!s) return null;
  s.rows = q.all(`SELECT e.*, c.name category FROM expenses e LEFT JOIN categories c ON c.id=e.category_id WHERE e.settlement_id=? ORDER BY COALESCE(e.date,'9999'), e.id`, id);
  s.total = s.rows.reduce((a, r) => a + r.amount, 0); s.title = `${KIND_FA[s.kind]} ${s.number}`;
  return s;
}
function listSettlements(year) {
  return q.all(`SELECT s.*, COUNT(e.id) count, COALESCE(SUM(e.amount),0) total FROM settlements s LEFT JOIN expenses e ON e.settlement_id=s.id ${year ? 'WHERE s.year=' + (+year) : ''} GROUP BY s.id ORDER BY s.year DESC, s.date DESC, s.number DESC`)
    .map(s => ({ ...s, title: `${KIND_FA[s.kind]} ${s.number}` }));
}
function setSettlementStatus(id, status) { const s = q.get('SELECT * FROM settlements WHERE id=?', id); if (!s) throw new Error('پیدا نشد'); q.run('UPDATE settlements SET status=? WHERE id=?', status, id); }
function updateSettlement(id, b) {
  const s = q.get('SELECT * FROM settlements WHERE id=?', id); if (!s) throw new Error('پیدا نشد');
  const date = b.date ? J.parseDate(b.date) : s.date; if (!date) throw new Error('تاریخ نامعتبر');
  q.run('UPDATE settlements SET date=?, company=?, preparer=?, unit=?, note=? WHERE id=?', date, b.company ?? s.company, b.preparer ?? s.preparer, b.unit ?? s.unit, b.note ?? s.note, id);
}
function deleteSettlement(id) {
  const s = q.get('SELECT * FROM settlements WHERE id=?', id); if (!s) return;
  if (s.status === 'final') throw new Error('ابتدا تنخواه را بازگشایی کنید');
  q.tx(() => { q.run('UPDATE expenses SET settlement_id=NULL WHERE settlement_id=?', id); q.run('DELETE FROM settlements WHERE id=?', id); });
}
function removeFromSettlement(expId) { lockedCheck(expId); q.run('UPDATE expenses SET settlement_id=NULL WHERE id=?', expId); }

/* ---------- دفتر گردش تنخواه ---------- */
function ledger(year) {
  const entries = [];
  for (const f of q.all('SELECT * FROM fund_entries')) entries.push({ date: f.date, ord: f.type === 'opening' ? 0 : 1, id: f.id, kind: f.type, title: f.type === 'opening' ? 'اول دوره' : f.type === 'deposit' ? 'واریز' + (f.note ? ' - ' + f.note : '') : 'اصلاح' + (f.note ? ' - ' + f.note : ''), amount: f.amount, fund_id: f.id, bank_tx_id: f.bank_tx_id });
  for (const s of listSettlements().filter(s => s.status === 'final')) entries.push({ date: s.date, ord: 2, id: s.id, kind: 'settlement', title: `تنخواه شماره ${s.title}`, amount: -s.total, settlement_id: s.id });
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.ord - b.ord || a.id - b.id);
  let bal = 0; const rows = [];
  for (const e of entries) {
    if (e.kind === 'opening') bal = e.amount; else bal += e.amount;
    rows.push({ ...e, deposit: e.amount > 0 ? e.amount : 0, spend: e.amount < 0 ? -e.amount : 0, balance: bal });
  }
  const out = year ? rows.filter(r => yearOf(r.date) === +year) : rows;
  return { rows: out, balance: rows.length ? rows[rows.length - 1].balance : 0 };
}
function addFund({ date, type, amount, note }) {
  date = J.parseDate(date); if (!date) throw new Error('تاریخ نامعتبر است'); amount = S.parseAmount(amount);
  if (!amount) throw new Error('مبلغ را وارد کنید'); type = ['opening', 'deposit', 'adjust'].includes(type) ? type : 'deposit';
  return +q.run('INSERT INTO fund_entries(date,type,amount,note) VALUES(?,?,?,?)', date, type, amount, note || null).lastInsertRowid;
}

function getFund(id) { const f = q.get('SELECT * FROM fund_entries WHERE id=?', id); if (!f) throw new Error('ردیف پیدا نشد'); return f; }
function updateFund(id, { date, type, amount, note }) {
  const f = getFund(id); const fromBank = !!f.bank_tx_id;
  date = J.parseDate(date); if (!date) throw new Error('تاریخ نامعتبر است');
  if (fromBank) { amount = f.amount; type = f.type; } else {
    amount = S.parseAmount(amount); if (!amount) throw new Error('مبلغ را وارد کنید');
    type = ['opening', 'deposit', 'adjust'].includes(type) ? type : f.type;
  }
  q.run('UPDATE fund_entries SET date=?, type=?, amount=?, note=? WHERE id=?', date, type, amount, note || null, id);
}

/* ---------- بانک ---------- */
function candidates(tx, windowDays = 5) {
  const list = q.all('SELECT e.id, e.date, e.description, e.amount FROM expenses e WHERE e.bank_tx_id IS NULL AND e.amount=?', tx.amount);
  return list.filter(e => e.date && Math.abs(J.diffDays(e.date, tx.date)) <= windowDays).sort((a, b) => Math.abs(J.diffDays(a.date, tx.date)) - Math.abs(J.diffDays(b.date, tx.date)));
}
function previewBank(txs) {
  return txs.map(t => {
    const dup = q.get('SELECT id FROM bank_tx WHERE hash=?', t.hash);
    const sugg = t.direction === 'out' ? S.classify(t.description) : null;
    return { ...t, duplicate: !!dup, candidates: t.direction === 'out' && !dup ? candidates(t) : [], suggestion: sugg ? { category_id: sugg.category_id, kind: sugg.kind, how: sugg.how } : null };
  });
}
// واریز دستیِ هم‌مبلغ و هم‌تاریخ (±۳ روز) که هنوز به تراکنش بانک وصل نشده
function manualDepositFor(t, exclude = []) {
  return q.all("SELECT id, date FROM fund_entries WHERE type='deposit' AND bank_tx_id IS NULL AND amount=?", t.amount)
    .filter(f => !exclude.includes(f.id) && Math.abs(J.diffDays(f.date, t.date)) <= 3)
    .sort((a, b) => Math.abs(J.diffDays(a.date, t.date)) - Math.abs(J.diffDays(b.date, t.date)))[0] || null;
}
// واریزهایی که هم دستی ثبت شده‌اند و هم خودکار از بانک/پیامک اضافه شده‌اند
function fundDupes(apply) {
  const autos = q.all("SELECT * FROM fund_entries WHERE bank_tx_id IS NOT NULL AND type='deposit' ORDER BY id"); const used = [], out = [];
  for (const e of autos) {
    const m = manualDepositFor(e, used); if (!m) continue; used.push(m.id);
    out.push({ auto_id: e.id, manual_id: m.id, amount: e.amount, auto_date: e.date, manual_date: m.date });
    if (apply) q.tx(() => { q.run('UPDATE fund_entries SET bank_tx_id=? WHERE id=?', e.bank_tx_id, m.id); q.run('DELETE FROM fund_entries WHERE id=?', e.id); });
  }
  return out;
}
function commitBank(txs) {
  const st = settings(); let added = 0, dups = 0, deposits = 0, matched = 0, linked = 0;
  q.tx(() => {
    for (const t of txs) {
      if (q.get('SELECT 1 FROM bank_tx WHERE hash=?', t.hash)) { dups++; continue; }
      // همان پیامک با نسخهٔ قدیمی‌تر تشخیص (مثلاً بدون مانده) قبلاً ثبت شده؟
      if (t.source === 'sms' && q.all('SELECT description, time FROM bank_tx WHERE date=? AND direction=? AND amount=?', t.date, t.direction, t.amount)
        .some(r => (!r.time || !t.time || r.time === t.time) && S.norm(r.description || '').slice(0, 40) === S.norm(t.description || '').slice(0, 40))) { dups++; continue; }
      const id = +q.run('INSERT INTO bank_tx(hash,date,time,direction,amount,balance,description,ref,source) VALUES(?,?,?,?,?,?,?,?,?)', t.hash, t.date, t.time || null, t.direction, t.amount, t.balance ?? null, t.description || '', t.ref || null, t.source || 'statement').lastInsertRowid;
      added++;
      if (t.direction === 'in' && st.auto_deposit === '1') { const man = manualDepositFor(t); if (man) { q.run('UPDATE fund_entries SET bank_tx_id=? WHERE id=?', id, man.id); linked++; } else { q.run('INSERT INTO fund_entries(date,type,amount,note,bank_tx_id) VALUES(?,?,?,?,?)', t.date, 'deposit', t.amount, 'از بانک', id); deposits++; } }
      if (t.direction === 'out' && st.auto_match === '1') { const c = candidates(t); if (c.length >= 1 && (c.length === 1 || c[0].date === t.date)) { q.run('UPDATE expenses SET bank_tx_id=? WHERE id=?', id, c[0].id); matched++; } }
    }
  });
  return { added, dups, deposits, matched, linked };
}
function listBank(f = {}) {
  const w = [], p = [];
  if (f.from) { w.push('t.date>=?'); p.push(f.from); } if (f.to) { w.push('t.date<=?'); p.push(f.to); }
  if (f.dir) { w.push('t.direction=?'); p.push(f.dir); }
  if (f.state === 'unmatched') w.push("t.direction='out' AND t.ignored=0 AND NOT EXISTS(SELECT 1 FROM expenses e WHERE e.bank_tx_id=t.id)");
  if (f.state === 'matched') w.push('EXISTS(SELECT 1 FROM expenses e WHERE e.bank_tx_id=t.id)');
  const rows = q.all(`SELECT t.*, (SELECT e.id FROM expenses e WHERE e.bank_tx_id=t.id LIMIT 1) expense_id, (SELECT e.description FROM expenses e WHERE e.bank_tx_id=t.id LIMIT 1) expense_desc FROM bank_tx t ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY t.date DESC, t.time DESC, t.id DESC LIMIT 1000`, ...p);
  return rows.map(r => ({ ...r, candidates: (r.direction === 'out' && !r.expense_id && !r.ignored) ? candidates(r) : [] }));
}
function linkBank(txId, expenseId) {
  q.tx(() => { q.run('UPDATE expenses SET bank_tx_id=NULL WHERE bank_tx_id=?', txId); if (expenseId) q.run('UPDATE expenses SET bank_tx_id=? WHERE id=?', txId, expenseId); });
}
function ignoreBank(txId, flag) {
  q.run('UPDATE bank_tx SET ignored=? WHERE id=?', flag ? 1 : 0, txId);
  const t = q.get('SELECT * FROM bank_tx WHERE id=?', txId);
  if (t.direction === 'in') {
    const f = q.get('SELECT id FROM fund_entries WHERE bank_tx_id=?', txId);
    if (flag && f) q.run('DELETE FROM fund_entries WHERE id=?', f.id);
    if (!flag && !f) q.run('INSERT INTO fund_entries(date,type,amount,note,bank_tx_id) VALUES(?,?,?,?,?)', t.date, 'deposit', t.amount, 'از بانک', txId);
  }
}
function expenseFromBank(txId, b = {}) {
  const t = q.get('SELECT * FROM bank_tx WHERE id=?', txId); if (!t || t.direction !== 'out') throw new Error('فقط برای برداشت‌ها');
  const id = addExpense({ date: t.date, description: b.description || t.description.replace(/\s+/g, ' ').slice(0, 120), amount: t.amount, category_id: b.category_id, kind: b.kind, bank_tx_id: txId });
  return id;
}

/* ---------- گزارش‌ها ---------- */
const C = (key, label, type = 'text') => ({ key, label, type });
const rangeOf = f => { const y = +f.year || yearOf(J.todayJ()); return { from: f.from || `${y}/01/01`, to: f.to || `${y}/12/31`, year: y }; };
function sumRows(rows, keys) { const t = {}; keys.forEach(k => t[k] = rows.reduce((a, r) => a + (r[k] || 0), 0)); return t; }

const REPORTS = {
  ledger(f) {
    const { year } = rangeOf(f); const L = ledger(year);
    const pend = q.get('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM expenses WHERE settlement_id IS NULL OR settlement_id IN (SELECT id FROM settlements WHERE status!=\'final\')');
    return { title: `دفتر گردش تنخواه ${year}`, summary: [['مانده دفتر', L.balance], ['هزینه‌های تسویه‌نشده', pend.s], ['مانده واقعی', L.balance - pend.s]],
      sections: [{ columns: [C('date', 'تاریخ', 'date'), C('title', 'شرح'), C('deposit', 'واریز', 'money'), C('spend', 'برداشت (تنخواه)', 'money'), C('balance', 'مانده', 'balance')], rows: L.rows,
        totals: { title: 'جمع', ...sumRows(L.rows.filter(r => r.kind !== 'opening'), ['deposit', 'spend']) } }] };
  },
  settlements(f) {
    const { year } = rangeOf(f); const rows = listSettlements(year).map(s => ({ ...s, kind_fa: KIND_FA[s.kind], status_fa: s.status === 'final' ? 'نهایی' : 'پیش‌نویس' }));
    return { title: `فهرست تنخواه‌ها ${year}`, sections: [{ columns: [C('kind_fa', 'نوع'), C('number', 'شماره', 'int'), C('date', 'تاریخ', 'date'), C('count', 'تعداد ردیف', 'int'), C('total', 'جمع مبلغ (ریال)', 'money'), C('status_fa', 'وضعیت')], rows, totals: { kind_fa: 'جمع', ...sumRows(rows, ['count', 'total']) } }] };
  },
  categories(f) {
    const { year } = rangeOf(f);
    const data = q.all(`SELECT COALESCE(c.name,'بدون دسته') cat, CAST(substr(e.date,6,2) AS INTEGER) m, SUM(e.amount) s FROM expenses e LEFT JOIN categories c ON c.id=e.category_id WHERE e.date LIKE ? GROUP BY 1,2`, year + '/%');
    const by = {}; for (const d of data) { by[d.cat] ??= { cat: d.cat, total: 0 }; by[d.cat]['m' + d.m] = d.s; by[d.cat].total += d.s; }
    const rows = Object.values(by).sort((a, b) => b.total - a.total);
    const cols = [C('cat', 'دسته')]; J.MONTHS.forEach((n, i) => cols.push(C('m' + (i + 1), n, 'money'))); cols.push(C('total', 'جمع سال', 'money'));
    const tot = { cat: 'جمع' }; for (let i = 1; i <= 12; i++) tot['m' + i] = rows.reduce((a, r) => a + (r['m' + i] || 0), 0); tot.total = rows.reduce((a, r) => a + r.total, 0);
    return { title: `هزینه به تفکیک دسته و ماه ${year}`, sections: [{ columns: cols, rows, totals: tot }], chart: { type: 'bars', items: rows.map(r => ({ label: r.cat, value: r.total })) } };
  },
  freight(f) {
    const { from, to } = rangeOf(f);
    const rows = q.all(`SELECT e.date, e.waybill, e.description, e.amount, s.number snum, s.kind skind FROM expenses e JOIN categories c ON c.id=e.category_id LEFT JOIN settlements s ON s.id=e.settlement_id WHERE c.name LIKE 'کرایه حمل%' AND e.date BETWEEN ? AND ? ORDER BY e.date, e.id`, from, to)
      .map(r => ({ ...r, tank: r.snum ? `${KIND_FA[r.skind]} ${r.snum}` : 'تسویه‌نشده' }));
    const total = rows.reduce((a, r) => a + r.amount, 0), noWb = rows.filter(r => !r.waybill).length;
    return { title: `کرایه حمل و بارنامه‌ها (${from} تا ${to})`, summary: [['تعداد بارنامه', rows.length, 'int'], ['جمع کرایه', total], ['میانگین هر بارنامه', rows.length ? Math.round(total / rows.length) : 0], ['ردیف بدون شمارهٔ بارنامه', noWb, 'int']],
      sections: [{ columns: [C('date', 'تاریخ', 'date'), C('waybill', 'شماره بارنامه'), C('description', 'شرح'), C('amount', 'مبلغ (ریال)', 'money'), C('tank', 'تنخواه')], rows, totals: { description: 'جمع', amount: total } }] };
  },
  vehicles(f) {
    const { from, to } = rangeOf(f);
    const data = q.all(`SELECT COALESCE(NULLIF(e.vehicle,''),'نامشخص') v, COALESCE(c.name,'بدون دسته') cat, SUM(e.amount) s, COUNT(*) n FROM expenses e LEFT JOIN categories c ON c.id=e.category_id
      WHERE e.date BETWEEN ? AND ? AND (e.vehicle IS NOT NULL OR c.name IN ('سوخت خودرو','تعمیر و نگهداری خودرو','بیمه','پارکینگ و عوارض')) GROUP BY 1,2`, from, to);
    const by = {}; for (const d of data) { by[d.v] ??= { v: d.v, fuel: 0, repair: 0, ins: 0, other: 0, total: 0 }; const k = d.cat === 'سوخت خودرو' ? 'fuel' : d.cat === 'تعمیر و نگهداری خودرو' ? 'repair' : d.cat === 'بیمه' ? 'ins' : 'other'; by[d.v][k] += d.s; by[d.v].total += d.s; }
    const rows = Object.values(by).sort((a, b) => b.total - a.total);
    return { title: `هزینهٔ خودروها (${from} تا ${to})`, note: 'سوخت معمولاً بدون نام خودرو ثبت می‌شود و در «نامشخص» می‌آید. برای تفکیک، در ثبت هزینه فیلد «خودرو» را پر کنید.',
      sections: [{ columns: [C('v', 'خودرو'), C('fuel', 'سوخت', 'money'), C('repair', 'تعمیر و قطعه', 'money'), C('ins', 'بیمه', 'money'), C('other', 'سایر', 'money'), C('total', 'جمع', 'money')], rows, totals: { v: 'جمع', ...sumRows(rows, ['fuel', 'repair', 'ins', 'other', 'total']) } }] };
  },
  returns(f) {
    const { from, to } = rangeOf(f);
    const data = q.all(`SELECT e.party, e.amount, e.date FROM expenses e JOIN categories c ON c.id=e.category_id WHERE c.name='هزینه دریافت مرجوعی' AND e.date BETWEEN ? AND ?`, from, to);
    const by = {}; for (const d of data) { const k = S.norm(d.party || 'نامشخص'); by[k] ??= { party: d.party || 'نامشخص', n: 0, total: 0, last: '' }; by[k].n++; by[k].total += d.amount; if (d.date > by[k].last) by[k].last = d.date; }
    const rows = Object.values(by).sort((a, b) => b.total - a.total);
    return { title: `هزینهٔ دریافت مرجوعی به تفکیک مشتری (${from} تا ${to})`, sections: [{ columns: [C('party', 'مشتری / پخش'), C('n', 'دفعات', 'int'), C('total', 'جمع هزینه (ریال)', 'money'), C('last', 'آخرین تاریخ', 'date')], rows, totals: { party: 'جمع', ...sumRows(rows, ['n', 'total']) } }] };
  },
  quality() {
    const rows = S.qualityIssues();
    return { title: 'گزارش نواقص و موارد مشکوک', summary: [['تعداد موارد', rows.length, 'int']], sections: [{ columns: [C('type', 'نوع مشکل'), C('date', 'تاریخ', 'date'), C('description', 'شرح'), C('amount', 'مبلغ', 'money'), C('message', 'توضیح')], rows }] };
  },
  recon(f) {
    const { from, to } = rangeOf(f);
    const outs = listBank({ from, to, state: 'unmatched' });
    const cash = q.all(`SELECT e.date, e.description, e.amount FROM expenses e WHERE e.bank_tx_id IS NULL AND e.date BETWEEN ? AND ? ORDER BY e.date`, from, to);
    const nodep = q.all(`SELECT t.date, t.description, t.amount FROM bank_tx t WHERE t.direction='in' AND NOT EXISTS(SELECT 1 FROM fund_entries f WHERE f.bank_tx_id=t.id) AND t.date BETWEEN ? AND ?`, from, to);
    const manualDep = q.all(`SELECT f.date, f.note description, f.amount FROM fund_entries f WHERE f.type='deposit' AND f.bank_tx_id IS NULL AND f.date BETWEEN ? AND ?`, from, to);
    const bankOut = q.get(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM bank_tx WHERE direction='out' AND ignored=0 AND date BETWEEN ? AND ?`, from, to);
    const linked = q.get(`SELECT COUNT(*) n, COALESCE(SUM(e.amount),0) s FROM expenses e WHERE e.bank_tx_id IS NOT NULL AND e.date BETWEEN ? AND ?`, from, to);
    const cols = [C('date', 'تاریخ', 'date'), C('description', 'شرح'), C('amount', 'مبلغ', 'money')];
    return { title: `مغایرت‌گیری با بانک (${from} تا ${to})`, summary: [['برداشت‌های بانک', bankOut.s], ['هزینه‌های تطبیق‌شده با بانک', linked.s], ['تعداد برداشت بدون هزینه', outs.length, 'int']],
      sections: [
        { title: 'برداشت‌های بانکی که هزینه‌ای برایشان ثبت نشده', columns: cols, rows: outs.map(t => ({ date: t.date, description: t.description, amount: t.amount })), totals: { description: 'جمع', amount: outs.reduce((a, r) => a + r.amount, 0) } },
        { title: 'هزینه‌های ثبت‌شده بدون تراکنش بانکی (نقدی یا هنوز وارد نشده)', columns: cols, rows: cash, totals: { description: 'جمع', amount: cash.reduce((a, r) => a + r.amount, 0) } },
        { title: 'واریزهای بانکی که در دفتر تنخواه نیامده‌اند', columns: cols, rows: nodep },
        { title: 'واریزهای دستی دفتر که در صورت‌حساب بانک پیدا نشده‌اند', columns: cols, rows: manualDep }] };
  },
  forecast() { return forecast(); },
};
function forecast() {
  const st = settings(); const today = J.todayJ(); const from = J.addDays(today, -60);
  const spent = q.get('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date>? AND date<=?', from, today).s;
  const daily = spent / 60; const L = ledger();
  const pend = q.get(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE settlement_id IS NULL OR settlement_id IN (SELECT id FROM settlements WHERE status!='final')`).s;
  const bal = L.balance - pend; const cover = +st.cover_days || 10, round = +st.deposit_round || 50000000;
  const need = Math.max(0, Math.ceil((daily * cover - bal) / round) * round);
  const deps = q.all(`SELECT date, amount FROM fund_entries WHERE type='deposit' ORDER BY date DESC LIMIT 12`);
  let gaps = []; for (let i = 0; i < deps.length - 1; i++) gaps.push(J.diffDays(deps[i].date, deps[i + 1].date));
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null, avgDep = deps.length ? deps.reduce((a, b) => a + b.amount, 0) / deps.length : null;
  const daysLeft = daily > 0 ? Math.floor(bal / daily) : null;
  const dow = q.all(`SELECT date, amount FROM expenses WHERE date>? AND date<=?`, from, today);
  return { title: 'پیش‌بینی نیاز به شارژ', summary: [['میانگین هزینهٔ روزانه (۶۰ روز اخیر)', Math.round(daily)], ['مانده واقعی (دفتر منهای تسویه‌نشده)', bal], ['مبلغ پیشنهادی شارژ بعدی', need], ['مانده کافی برای (روز)', daysLeft, 'int'], ['میانگین فاصلهٔ واریزها (روز)', avgGap ? Math.round(avgGap) : null, 'int'], ['میانگین مبلغ واریز', avgDep ? Math.round(avgDep) : null]],
    note: `مبلغ پیشنهادی بر اساس پوشش ${cover} روز هزینه است و به مضرب ${round.toLocaleString('en-US')} ریال گرد می‌شود (از «تنظیمات» قابل تغییر).`, sections: [], data: { daily, bal, need, daysLeft, cover, avgGap, avgDep, n: dow.length } };
}
function runReport(name, f = {}) { const r = REPORTS[name]; if (!r) throw new Error('گزارش ناشناخته'); const out = r(f); out.name = name; return out; }

function dashboard() {
  const st = settings(); const L = ledger(); const today = J.todayJ(); const year = yearOf(today);
  const pend = q.get(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM expenses WHERE settlement_id IS NULL`);
  const draft = q.get(`SELECT COUNT(*) n FROM settlements WHERE status!='final'`);
  const lastDep = q.get(`SELECT date, amount FROM fund_entries WHERE type='deposit' ORDER BY date DESC, id DESC LIMIT 1`);
  const lastExp = q.get('SELECT MAX(date) d FROM expenses').d;
  const refYear = q.get('SELECT 1 FROM expenses WHERE date LIKE ?', year + '/%') ? year : (lastExp ? yearOf(lastExp) : year);
  const months = q.all(`SELECT CAST(substr(date,6,2) AS INTEGER) m, SUM(amount) s FROM expenses WHERE date LIKE ? GROUP BY 1`, refYear + '/%');
  const mm = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, label: J.MONTHS[i], value: months.find(x => x.m === i + 1)?.s || 0 }));
  const cats = q.all(`SELECT COALESCE(c.name,'بدون دسته') label, SUM(e.amount) value FROM expenses e LEFT JOIN categories c ON c.id=e.category_id WHERE e.date LIKE ? GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, refYear + '/%');
  const issues = S.qualityIssues(); const unm = q.get(`SELECT COUNT(*) n FROM bank_tx t WHERE direction='out' AND ignored=0 AND NOT EXISTS(SELECT 1 FROM expenses e WHERE e.bank_tx_id=t.id)`).n;
  const fc = forecast();
  const counts = { expenses: q.get('SELECT COUNT(*) n FROM expenses').n, bank: q.get('SELECT COUNT(*) n FROM bank_tx').n };
  return { ledgerBalance: L.balance, pending: pend, trueBalance: L.balance - q.get(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE settlement_id IS NULL OR settlement_id IN (SELECT id FROM settlements WHERE status!='final')`).s,
    drafts: draft.n, lastDeposit: lastDep, months: mm, refYear, cats, issues: issues.length, issueSample: issues.slice(0, 6), unmatchedBank: unm, forecast: fc.data, forecastSummary: fc.summary, counts, company: st.company, today,
    openByKind: q.all(`SELECT kind, COUNT(*) n, SUM(amount) s FROM expenses WHERE settlement_id IS NULL GROUP BY kind`) };
}
module.exports = { addExpense, updateExpense, deleteExpense, listExpenses, createSettlement, getSettlement, listSettlements, setSettlementStatus, updateSettlement, deleteSettlement, removeFromSettlement,
  ledger, fundDupes, addFund, getFund, updateFund, previewBank, commitBank, listBank, linkBank, ignoreBank, expenseFromBank, candidates, runReport, dashboard, KIND_FA, nextNumber, yearOf };
