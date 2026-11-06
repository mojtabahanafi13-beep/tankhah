'use strict';
// به‌روزرسانی از گیت‌هاب: فقط کد برنامه (lib, public, server.js) جایگزین می‌شود؛ پوشهٔ data و logs هرگز دست نمی‌خورد.
const fs = require('fs'), path = require('path');
const { unzip } = require('./xlsx');
const VERSION = '2026-11-07.3';
const REPO = 'mojtabahanafi13-beep/tankhah', BRANCH = 'main';
const ROOT = path.join(__dirname, '..');
const ALLOW = [/^lib\//, /^public\//, /^server\.js$/, /^README-FA\.md$/, /^start-tankhah\.bat$/, /^restart-tankhah\.bat$/];

const URLS = [`https://codeload.github.com/${REPO}/zip/refs/heads/${BRANCH}`, `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip`];

async function download() {
  let last = null;
  for (const u of URLS) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
      const res = await fetch(u, { redirect: 'follow', signal: ctl.signal }); clearTimeout(t);
      if (!res.ok) { last = 'کد ' + res.status; continue; }
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { last = (e.cause && e.cause.code) || e.name || e.message; }
  }
  throw new Error('سرور به گیت‌هاب دسترسی ندارد (' + last + '). از دکمهٔ «به‌روزرسانی از فایل» استفاده کنید.');
}

// zipBuf: فایل zip مخزن گیت‌هاب (Download ZIP) یا بستهٔ به‌روزرسانی که پوشه‌های lib و public در آن است
function apply(zipBuf, targetRoot = ROOT) {
  let z; try { z = unzip(zipBuf); } catch (e) { throw new Error('فایل zip معتبر نیست'); }
  const ts = new Date().toISOString().replace(/[:.]/g, '-'); const backup = path.join(targetRoot, 'backup', ts);
  let n = 0;
  for (const name of z.names) {
    if (name.endsWith('/')) continue;
    const i = name.indexOf('/server/');
    let rel = i >= 0 ? name.slice(i + 8) : name.replace(/^[^/]+\//, '');
    if (!ALLOW.some(r => r.test(rel)) || rel.includes('..')) continue;
    const dest = path.join(targetRoot, rel); if (!dest.startsWith(targetRoot)) continue;
    if (fs.existsSync(dest)) { const b = path.join(backup, rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(dest, b); }
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, z.get(name)); n++;
  }
  if (!n) throw new Error('در این فایل چیزی برای به‌روزرسانی پیدا نشد');
  return { ok: true, files: n };
}
async function update(targetRoot = ROOT) { return apply(await download(), targetRoot); }
module.exports = { update, apply, VERSION };
