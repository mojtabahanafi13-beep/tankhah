'use strict';
// تبدیل صورت‌حساب (اکسل/CSV) و متن پیامک بانک به تراکنش‌های استاندارد
const crypto = require('crypto');
const { readXlsx } = require('./xlsx');
const { parseDate, todayJ } = require('./jalali');
const { toLatin, parseAmount, norm } = require('./smart');

function parseCSV(text) {
  text = text.replace(/^﻿/, ''); const first = text.split('\n')[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c; }
    else if (c === '"') inq = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); if (row.some(x => x.trim())) rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
const hashOf = t => crypto.createHash('sha1').update([t.date, t.time || '', t.direction, t.amount, t.balance ?? '', t.ref || '', norm(t.description || '').slice(0, 60)].join('|')).digest('hex');

const COLS = {
  date: ['تاریخ'], time: ['ساعت', 'زمان'], desc: ['شرح', 'توضیحات', 'عنوان', 'بابت', 'نوع تراکنش'],
  in: ['واریز', 'بستانکار', 'ورودی', 'دریافتی', 'credit', 'deposit'], out: ['برداشت', 'بدهکار', 'خروجی', 'پرداختی', 'debit', 'withdraw'],
  amount: ['مبلغ', 'amount'], type: ['نوع'], balance: ['مانده', 'balance'], ref: ['پیگیری', 'مرجع', 'سند', 'ref'],
};
const has = (h, keys) => keys.some(k => h.includes(k));
function mapHeader(row) {
  const m = {}; row.forEach((h, i) => {
    h = norm(h); if (!h) return;
    if (m.date === undefined && has(h, COLS.date) && !has(h, ['مانده'])) m.date = i;
    else if (m.time === undefined && has(h, COLS.time)) m.time = i;
    else if (m.in === undefined && has(h, COLS.in)) m.in = i;
    else if (m.out === undefined && has(h, COLS.out)) m.out = i;
    else if (m.balance === undefined && has(h, COLS.balance)) m.balance = i;
    else if (m.amount === undefined && has(h, COLS.amount)) m.amount = i;
    else if (m.ref === undefined && has(h, COLS.ref)) m.ref = i;
    else if (m.desc === undefined && has(h, COLS.desc)) m.desc = i;
    else if (m.type === undefined && has(h, COLS.type)) m.type = i;
  });
  return m;
}
function fromTable(rows) {
  let hi = rows.findIndex(r => { const m = mapHeader(r); return m.date !== undefined && (m.in !== undefined || m.out !== undefined || m.amount !== undefined); });
  if (hi < 0) throw new Error('ستون‌های «تاریخ» و «مبلغ/واریز/برداشت» در فایل پیدا نشد. فایل صورت‌حساب را بدون تغییر از برنامه بلو بگیرید.');
  const m = mapHeader(rows[hi]); const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[m.date]); if (!date) continue;
    let direction, amount;
    const vin = m.in !== undefined ? parseAmount(r[m.in]) : 0, vout = m.out !== undefined ? parseAmount(r[m.out]) : 0;
    if (vin || vout) { if (vin >= vout) { direction = 'in'; amount = vin; } else { direction = 'out'; amount = vout; } }
    else if (m.amount !== undefined) {
      const raw = r[m.amount]; amount = Math.abs(parseAmount(raw)); const t = norm((m.type !== undefined ? r[m.type] : '') + ' ' + (m.desc !== undefined ? r[m.desc] : ''));
      direction = (/-|\(/.test(String(raw)) || /برداشت|خرید|پرداخت|کسر|انتقال از|خروج/.test(t)) ? 'out' : 'in';
    }
    if (!amount) continue;
    const t = { date, time: m.time !== undefined ? String(r[m.time] ?? '').slice(0, 8) : null, direction, amount,
      balance: m.balance !== undefined ? parseAmount(r[m.balance]) : null,
      description: String([m.type !== undefined ? r[m.type] : '', m.desc !== undefined ? r[m.desc] : ''].filter(Boolean).join(' - ')).trim(), ref: m.ref !== undefined ? String(r[m.ref] ?? '') : null, source: 'statement' };
    t.hash = hashOf(t); out.push(t);
  }
  return out;
}
function fromSMS(text) {
  const out = []; const chunks = toLatin(text).replace(/\r/g, '').split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  for (const ch of chunks) {
    const flat = ch.replace(/\n/g, ' ');
    let direction = null;
    if (/برداشت|خرید|پرداخت|کسر|انتقال\s+از|خروج|پایا\s*خروجی|ساتنا\s*خروجی|-\s*[\d,]{4,}/.test(flat)) direction = 'out';
    if (/واریز|دریافت|افزایش|\+\s*[\d,]{4,}|بستانکار/.test(flat) && !/برداشت|خرید|کسر/.test(flat)) direction = 'in';
    const am = flat.match(/(?:مبلغ|مبلغ\s*:)?\s*([+\-]?\s*[\d,٬]{4,})\s*(ریال|تومان)?/); if (!am || !direction) continue;
    let amount = parseAmount(am[1]); if (am[2] === 'تومان') amount *= 10;
    const bal = flat.match(/مانده\s*[:：]?\s*([\d,٬]{3,})/); const dm = flat.match(/(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/); const tm = flat.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (!amount) continue;
    const t = { date: (dm && parseDate(dm[1])) || todayJ(), time: tm ? tm[1] : null, direction, amount, balance: bal ? parseAmount(bal[1]) : null, description: flat.slice(0, 220), ref: null, source: 'sms', guessedDate: !(dm && parseDate(dm[1])) };
    t.hash = hashOf(t); out.push(t);
  }
  return out;
}
function parseUpload(buf, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  if (ext === 'xlsx') { const wb = readXlsx(buf); for (const n of wb.sheetNames) { const rows = wb.rows(n, { maxCols: 20 }).filter(Boolean).map(r => Array.from(r, v => v ?? '')); try { const t = fromTable(rows); if (t.length) return t; } catch { } } throw new Error('در هیچ‌یک از شیت‌ها تراکنشی پیدا نشد.'); }
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') { const text = buf.toString('utf8'); try { return fromTable(parseCSV(text)); } catch (e) { const s = fromSMS(text); if (s.length) return s; throw e; } }
  throw new Error('فرمت فایل پشتیبانی نمی‌شود. از xlsx یا csv استفاده کنید (برای PDF متن پیامک را در کادر پیامک بچسبانید).');
}
module.exports = { parseUpload, fromSMS, fromTable, parseCSV };
