'use strict';
// به‌روزرسانی از گیت‌هاب: فقط کد برنامه (lib, public, server.js) جایگزین می‌شود؛ پوشهٔ data و logs هرگز دست نمی‌خورد.
const fs = require('fs'), path = require('path');
const { unzip } = require('./xlsx');
const VERSION = '2026-11-06.2';
const REPO = 'mojtabahanafi13-beep/tankhah', BRANCH = 'main';
const ROOT = path.join(__dirname, '..');
const ALLOW = [/^lib\//, /^public\//, /^server\.js$/, /^README-FA\.md$/, /^start-tankhah\.bat$/, /^restart-tankhah\.bat$/];

async function update(targetRoot = ROOT) {
  const res = await fetch(`https://codeload.github.com/${REPO}/zip/refs/heads/${BRANCH}`, { redirect: 'follow' });
  if (!res.ok) throw new Error('دریافت از گیت‌هاب ناموفق بود (' + res.status + ')');
  const z = unzip(Buffer.from(await res.arrayBuffer()));
  const top = z.names[0].split('/')[0]; const prefix = top + '/server/';
  const ts = new Date().toISOString().replace(/[:.]/g, '-'); const backup = path.join(targetRoot, 'backup', ts);
  let n = 0;
  for (const name of z.names) {
    if (!name.startsWith(prefix) || name.endsWith('/')) continue;
    const rel = name.slice(prefix.length);
    if (!ALLOW.some(r => r.test(rel)) || rel.includes('..')) continue;
    const dest = path.join(targetRoot, rel); if (!dest.startsWith(targetRoot)) continue;
    if (fs.existsSync(dest)) { const b = path.join(backup, rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(dest, b); }
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, z.get(name)); n++;
  }
  if (!n) throw new Error('فایل قابل‌به‌روزرسانی پیدا نشد');
  return { ok: true, files: n };
}
module.exports = { update, VERSION };
