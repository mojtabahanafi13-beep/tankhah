'use strict';
const { q } = require('./db');

const toLatin = s => String(s ?? '').replace(/[۰-۹]/g, c => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, c => c.charCodeAt(0) - 1632);
function norm(s) {
  return toLatin(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌‏‎]/g, ' ').replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[()\[\]{}"'،,:؛;.\-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
const shape = s => norm(s).replace(/\d+/g, '#');            // برای گروه‌بندی توضیحات مشابه (شماره‌ها حذف)
const tokens = s => new Set(shape(s).split(' ').filter(t => t.length > 1 && t !== '#' && !STOP.has(t)));
const STOP = new Set(['هزینه', 'بابت', 'از', 'به', 'در', 'و', 'با', 'برای', 'جهت', 'خرید', 'انبار', 'شماره', 'تهران']);
const parseAmount = v => { if (typeof v === 'number') return Math.round(v); const n = toLatin(v).replace(/[,٬،\s]/g, '').replace(/[^\d.-]/g, ''); return n ? Math.round(Number(n)) : 0; };

function categories() { return q.all('SELECT * FROM categories WHERE active=1 ORDER BY sort,id'); }

// ---- استخراج فیلدهای ساختاری از متن توضیحات ----
function extract(desc) {
  const t = toLatin(desc || '');
  const out = {};
  const wb = t.match(/بارنامه\s*(?:شماره|ش)?\s*[:.]?\s*(\d{3,})/); if (wb) out.waybill = wb[1];
  const veh = t.match(/(?<![\u0600-\u06FF])(پراید|نیسان|پیکان|وانت|کامیونت)(?![\u0600-\u06FF])/);
  if (veh) { const m = t.match(/(?<![\u0600-\u06FF])(پراید|نیسان|پیکان)(?![\u0600-\u06FF])/); out.vehicle = m ? m[1] : veh[1]; }
  const ret = t.match(/مرجوعی\s*(?:بار)?\s*(?:از|پخش)?\s*(.+)$/); if (ret) out.party = ret[1].replace(/^(پخش)\s+/, '').trim().slice(0, 80);
  return out;
}

// ---- طبقه‌بندی: ۱) دقیقاً مشابه تاریخچه ۲) کلیدواژه ۳) شباهت واژگانی ----
let learnCache = null, learnAt = 0;
function learned() {
  if (learnCache && Date.now() - learnAt < 5000) return learnCache;
  const rows = q.all('SELECT description, category_id, kind FROM expenses WHERE category_id IS NOT NULL');
  const exact = new Map(), toks = [];
  for (const r of rows) {
    const k = shape(r.description); const e = exact.get(k) || { cat: new Map(), kind: new Map() };
    e.cat.set(r.category_id, (e.cat.get(r.category_id) || 0) + 1); e.kind.set(r.kind, (e.kind.get(r.kind) || 0) + 1); exact.set(k, e);
  }
  for (const [k, e] of exact) toks.push({ k, tokens: new Set(k.split(' ').filter(t => t.length > 1 && t !== '#' && !STOP.has(t))), e });
  learnCache = { exact, toks }; learnAt = Date.now(); return learnCache;
}
const top = m => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
function classify(desc) {
  const cats = categories(); const text = ' ' + norm(desc) + ' ';
  const L = learned(); const k = shape(desc);
  const ex = L.exact.get(k);
  if (ex) { const cid = top(ex.cat); return { category_id: cid, kind: top(ex.kind), how: 'history', confidence: 0.95 }; }
  // کلیدواژه: بلندترین کلیدواژهٔ منطبق برنده است
  let best = null;
  for (const c of cats) for (const kw of (c.keywords || '').split(',').map(norm).filter(Boolean)) {
    if (text.includes(' ' + kw) || text.includes(kw + ' ') || text.includes(kw)) { if (!best || kw.length > best.len) best = { c, len: kw.length }; }
  }
  // مرجوعی و دریافت مواد اولیه بر کرایه/حمل می‌چربند (توضیحات «هزینه بابت دریافت مرجوعی...»)
  if (best) return { category_id: best.c.id, kind: best.c.kind, how: 'keyword', confidence: 0.8 };
  const tk = tokens(desc);
  if (tk.size) {
    let bs = 0, be = null;
    for (const t of L.toks) { let inter = 0; for (const x of tk) if (t.tokens.has(x)) inter++; const j = inter / (tk.size + t.tokens.size - inter); if (j > bs) { bs = j; be = t; } }
    if (be && bs >= 0.5) return { category_id: top(be.e.cat), kind: top(be.e.kind), how: 'similar', confidence: bs };
  }
  const misc = cats.find(c => c.name === 'متفرقه');
  return { category_id: misc?.id ?? null, kind: misc?.kind ?? 'official', how: 'none', confidence: 0 };
}
const invalidate = () => { learnCache = null; };

// ---- مبلغ معمول برای یک توضیح ----
function typicalAmount(desc) {
  const k = shape(desc); const rows = q.all('SELECT amount FROM expenses WHERE description IS NOT NULL').filter(r => true);
  const same = q.all('SELECT description, amount FROM expenses ORDER BY id DESC LIMIT 4000').filter(r => shape(r.description) === k).map(r => r.amount).sort((a, b) => a - b);
  if (!same.length) return null;
  return { median: same[Math.floor(same.length / 2)], n: same.length, min: same[0], max: same[same.length - 1] };
}

// ---- کنترل کیفیت و ناهنجاری ----
function qualityIssues() {
  const rows = q.all(`SELECT e.*, c.name cat FROM expenses e LEFT JOIN categories c ON c.id=e.category_id ORDER BY e.date, e.id`);
  const issues = [];
  const push = (e, type, msg) => issues.push({ expense_id: e.id, date: e.date, description: e.description, amount: e.amount, settlement_id: e.settlement_id, type, message: msg });
  const groups = new Map();
  for (const e of rows) { const k = shape(e.description); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const seen = new Map();
  const off = rows.filter(r => r.kind === 'official'); const usesInvoice = off.length > 0 && off.filter(r => r.invoice_no).length / off.length >= 0.2;
  for (const e of rows) {
    if (!e.description || !e.description.trim()) push(e, 'بدون شرح', 'شرح هزینه خالی است');
    if (!e.date) push(e, 'بدون تاریخ', 'تاریخ هزینه ثبت نشده');
    if (!(e.amount > 0)) push(e, 'مبلغ نامعتبر', 'مبلغ صفر یا منفی است');
    const dk = `${e.date}|${e.amount}|${shape(e.description)}`;
    const casual = e.kind === 'unofficial'; // کارگر روزمزد و مشابه: تکرار و مبلغ متغیر عادی است
    if (!casual && seen.has(dk)) push(e, 'احتمال تکراری', `مشابه ردیف ${seen.get(dk)} (همان روز، همان مبلغ و شرح)`); else if (!casual) seen.set(dk, e.id);
    const g = groups.get(shape(e.description));
    if (g.length >= 6 && !casual) {
      const a = g.map(x => x.amount).sort((x, y) => x - y), med = a[Math.floor(a.length / 2)];
      if (e.amount > med * 3 && e.amount - med > 1000000) push(e, 'مبلغ غیرعادی', `حدود ${(e.amount / med).toFixed(1)} برابر مبلغ معمول این شرح (${med.toLocaleString('en-US')})`);
    }
    if (usesInvoice && e.kind === 'official' && !e.invoice_no && e.cat && /بیمه|تعمیر|لوازم|اداری|ملزومات|ساختمان/.test(e.cat) && e.amount >= 5000000) push(e, 'بدون شماره فاکتور', 'هزینهٔ رسمی بالای ۵ میلیون ریال بدون شماره فاکتور');
  }
  return issues;
}

module.exports = { norm, shape, toLatin, parseAmount, extract, classify, typicalAmount, qualityIssues, invalidate, categories };
