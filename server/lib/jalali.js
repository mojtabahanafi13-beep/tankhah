'use strict';
// تبدیل تاریخ شمسی/میلادی (الگوریتم استاندارد jalaali)
const div = (a, b) => ~~(a / b), mod = (a, b) => a - ~~(a / b) * b;
const BR = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
function jalCal(jy) {
  let gy = jy + 621, leapJ = -14, jp = BR[0], jump = 0, n;
  for (let i = 1; i < BR.length; i++) {
    const jm = BR[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm;
  }
  n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ++;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4); if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631; j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy, jm, jd) { const r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1; }
function d2j(jdn) {
  const gy = d2g(jdn).gy; let jy = gy - 621; const r = jalCal(jy); const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) { if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; k -= 186; }
  else { jy -= 1; k += 179; if (r.leap === 1) k++; }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}
const toJalali = (gy, gm, gd) => d2j(g2d(gy, gm, gd));
const toGregorian = (jy, jm, jd) => d2g(j2d(jy, jm, jd));
const isLeap = jy => jalCal(jy).leap === 0;
const monthLen = (jy, jm) => jm <= 6 ? 31 : jm <= 11 ? 30 : (isLeap(jy) ? 30 : 29);
const pad = n => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}/${pad(m)}/${pad(d)}`;
function todayJ() { const n = new Date(); return fmt(...Object.values(toJalali(n.getFullYear(), n.getMonth() + 1, n.getDate()))); }
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
// رشتهٔ تاریخ (شمسی یا میلادی، ارقام فارسی یا لاتین) را به YYYY/MM/DD شمسی تبدیل می‌کند؛ نامعتبر → null
function parseDate(s) {
  if (s == null) return null;
  s = String(s).replace(/[۰-۹]/g, c => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, c => c.charCodeAt(0) - 1632);
  const m = s.match(/(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/); if (!m) return null;
  let y = +m[1], mo = +m[2], d = +m[3];
  if (y > 1700) { const j = toJalali(y, mo, d); y = j.jy; mo = j.jm; d = j.jd; }
  if (mo < 1 || mo > 12 || d < 1 || d > monthLen(y, mo)) return null;
  return fmt(y, mo, d);
}
// تفاضل روز بین دو تاریخ شمسی
const dayNum = s => { const [y, m, d] = s.split('/').map(Number); return j2d(y, m, d); };
const diffDays = (a, b) => dayNum(a) - dayNum(b);
const addDays = (s, n) => { const x = d2j(dayNum(s) + n); return fmt(x.jy, x.jm, x.jd); };
module.exports = { toJalali, toGregorian, isLeap, monthLen, fmt, todayJ, MONTHS, parseDate, diffDays, addDays, dayNum };
