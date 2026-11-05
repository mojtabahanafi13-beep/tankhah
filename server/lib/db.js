'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'tankhah.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT NOT NULL DEFAULT 'official', keywords TEXT DEFAULT '', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS settlements(
  id INTEGER PRIMARY KEY, year INTEGER NOT NULL, kind TEXT NOT NULL, number INTEGER NOT NULL, date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', company TEXT, preparer TEXT, unit TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, kind, number));
CREATE TABLE IF NOT EXISTS bank_tx(
  id INTEGER PRIMARY KEY, hash TEXT UNIQUE, date TEXT NOT NULL, time TEXT, direction TEXT NOT NULL, amount INTEGER NOT NULL,
  balance INTEGER, description TEXT, ref TEXT, source TEXT, ignored INTEGER DEFAULT 0, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS expenses(
  id INTEGER PRIMARY KEY, date TEXT, description TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0, invoice_no TEXT,
  category_id INTEGER REFERENCES categories(id), kind TEXT NOT NULL DEFAULT 'official', settlement_id INTEGER REFERENCES settlements(id),
  vehicle TEXT, waybill TEXT, party TEXT, bank_tx_id INTEGER REFERENCES bank_tx(id), note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS fund_entries(
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT, bank_tx_id INTEGER REFERENCES bank_tx(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_exp_date ON expenses(date);
CREATE INDEX IF NOT EXISTS ix_exp_settle ON expenses(settlement_id);
CREATE INDEX IF NOT EXISTS ix_tx_date ON bank_tx(date);
`);
const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
  tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
};
const DEFAULT_SETTINGS = { company: 'شرکت (نام شرکت را در تنظیمات بنویسید)', preparer: '', unit: 'انبار', cover_days: '10', deposit_round: '50000000', auto_match: '1', auto_deposit: '1', password: '' };
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) q.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, v);
if (!q.get("SELECT value FROM settings WHERE key='sms_token'")) q.run("INSERT INTO settings(key,value) VALUES('sms_token',?)", require('crypto').randomBytes(12).toString('hex'));
const settings = () => Object.fromEntries(q.all('SELECT key,value FROM settings').map(r => [r.key, r.value]));
const setSetting = (k, v) => q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v ?? ''));

// دسته‌های پیش‌فرض بر اساس هزینه‌هایی که در فایل‌های اکسل قبلی دیده می‌شود
const DEFAULT_CATS = [
  ['سوخت خودرو', 'official', 'سوخت,بنزین,گازوئیل,کارت سوخت'],
  ['کارگر روزمزد', 'unofficial', 'کارگر,روزمزد,باربر روزمزد'],
  ['کرایه حمل بار (بارنامه)', 'official', 'بارنامه,کرایه ارسال بار,کرایه حمل,باربری'],
  ['هزینه دریافت مرجوعی', 'official', 'مرجوعی'],
  ['هزینه دریافت مواد اولیه', 'official', 'ماده اولیه,مواد اولیه,دریافت ماده,دریافت مواد'],
  ['تعمیر و نگهداری خودرو', 'official', 'تعویض روغن,باطری,لاستیک,تعمیر,لوازم یدک,جلوبندی,اگزوز,یدک,تسمه تایم,لنت,رینگ'],
  ['بیمه', 'official', 'بیمه'],
  ['پارکینگ و عوارض', 'official', 'پارکینگ,عوارض,آزادراه'],
  ['حمل شهری (اسنپ/تاکسی)', 'official', 'اسنپ,تاکسی,آژانس,snapp'],
  ['لوازم اداری و چاپ', 'official', 'کاغذ,کاتریج,پرینتر,دفتر,خودکار,زونکن,منگنه,جوهر'],
  ['اینترنت و تلفن', 'official', 'اینترنت,تلفن,شارژ سیم,سیمکارت'],
  ['پذیرایی', 'official', 'چای,قند,نسکافه,شکر,بیسکویت,میوه,آب معدنی'],
  ['ملزومات بسته‌بندی و انبار', 'official', 'چسب,استرج,سلفون,شیرینک,طناب,کاور,پالت,کارتن,نایلون,تسمه,زونکن'],
  ['تعمیرات ساختمان و برق', 'official', 'برق,کولر,دوشاخه,لامپ,سیم,کلید,پریز,لوله,شیر آب,رنگ'],
  ['بهداشت و نظافت', 'official', 'سرویس بهداشتی,کیسه زباله,مایع,دستکش,دستشویی,جارو,تی,نظافت,شوینده'],
  ['استخدام و آگهی', 'official', 'آگهی,استخدام'],
  ['متفرقه', 'official', ''],
];
if (!q.get('SELECT 1 FROM categories LIMIT 1')) DEFAULT_CATS.forEach((c, i) => q.run('INSERT INTO categories(name,kind,keywords,sort) VALUES(?,?,?,?)', c[0], c[1], c[2], i));
module.exports = { db, q, settings, setSetting, DATA_DIR };
