'use strict';
// خواندن و نوشتن xlsx بدون هیچ وابستگی (فقط zlib داخلی Node)
const zlib = require('zlib');

/* ---------- ZIP ---------- */
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('فایل xlsx معتبر نیست');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42), name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), ds = off + 30 + lnl + lxl;
    files[name] = { method, data: buf.slice(ds, ds + csize) };
    p += 46 + nl + xl + cl;
  }
  return { get(name) { const f = files[name]; if (!f) return null; return f.method === 0 ? f.data : zlib.inflateRawSync(f.data); }, names: Object.keys(files) };
}
function zip(entries) { // [{name, data:Buffer}]
  const parts = [], central = []; let off = 0;
  for (const { name, data } of entries) {
    const nb = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* ---------- READER ---------- */
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
function readXlsx(buf) {
  const z = unzip(buf);
  const wb = z.get('xl/workbook.xml').toString('utf8');
  const rels = z.get('xl/_rels/workbook.xml.rels').toString('utf8');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const t = m[0]; const id = /Id="([^"]+)"/.exec(t)?.[1], tg = /Target="([^"]+)"/.exec(t)?.[1]; if (id) relMap[id] = tg; }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const t = m[0]; const name = unesc(/name="([^"]*)"/.exec(t)[1]); const rid = /r:id="([^"]+)"/.exec(t)[1];
    let target = relMap[rid]; target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    sheets.push({ name, path: target });
  }
  let sst = null;
  const getSST = () => {
    if (sst) return sst; sst = [];
    const b = z.get('xl/sharedStrings.xml'); if (!b) return sst;
    for (const m of b.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let s = ''; for (const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += t[1]; sst.push(unesc(s));
    }
    return sst;
  };
  function rows(name, { maxRows = 100000, maxCols = 40 } = {}) {
    const sh = sheets.find(s => s.name === name); if (!sh) throw new Error('شیت پیدا نشد: ' + name);
    const xml = z.get(sh.path).toString('utf8'); const out = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rn = +/\br="(\d+)"/.exec(rm[1])?.[1]; if (!rn) continue; if (rn > maxRows) break;
      if (!rm[2]) continue;
      const row = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!cm[2]) continue;
        const ref = /\br="([A-Z]+\d+)"/.exec(cm[1])?.[1]; if (!ref) continue;
        const ci = colIdx(ref); if (ci >= maxCols) continue;
        const t = /\bt="(\w+)"/.exec(cm[1])?.[1];
        let v = null;
        if (t === 'inlineStr') { let s = ''; for (const x of cm[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += x[1]; v = unesc(s); }
        else { const vm = /<v>([\s\S]*?)<\/v>/.exec(cm[2]); if (!vm) continue; const raw = vm[1];
          if (t === 's') v = getSST()[+raw]; else if (t === 'str') v = unesc(raw); else if (t === 'b') v = raw === '1'; else if (t === 'e') v = null; else v = Number(raw); }
        if (v !== null && v !== '') row[ci] = v;
      }
      if (row.length) { row.__r = rn; out[rn - 1] = row; }
    }
    return out; // آرایهٔ پراکنده، اندیس = شمارهٔ ردیف - ۱
  }
  return { sheetNames: sheets.map(s => s.name), rows };
}

/* ---------- WRITER ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// ستایل‌ها: شمارهٔ شاخص = موقعیت در STYLES
const BORDER = '<border><left style="thin"><color rgb="FF888888"/></left><right style="thin"><color rgb="FF888888"/></right><top style="thin"><color rgb="FF888888"/></top><bottom style="thin"><color rgb="FF888888"/></bottom></border>';
const STYLE_NAMES = ['default', 'bold', 'title', 'head', 'text', 'num', 'total', 'int', 'plain', 'center', 'dep', 'neg', 'sub', 'totaltext'];
function stylesXml() {
  const fonts = ['<font><sz val="10"/><name val="Tahoma"/></font>', '<font><b/><sz val="10"/><name val="Tahoma"/></font>', '<font><b/><sz val="14"/><name val="Tahoma"/></font>', '<font><b/><sz val="10"/><color rgb="FFC00000"/><name val="Tahoma"/></font>', '<font><sz val="9"/><color rgb="FF555555"/><name val="Tahoma"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E5DC"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFDDF0E1"/></patternFill></fill>'];
  const xf = (font, fill, border, numFmt, h, wrap) => `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${h}" vertical="center"${wrap ? ' wrapText="1"' : ''}/></xf>`;
  const xfs = [
    xf(0, 0, 0, 0, 'general'), xf(1, 0, 0, 0, 'right'), xf(2, 0, 0, 0, 'center'), xf(1, 2, 1, 0, 'center', 1),
    xf(0, 0, 1, 0, 'right', 1), xf(0, 0, 1, 3, 'center'), xf(1, 3, 1, 3, 'center'), xf(0, 0, 1, 1, 'center'),
    xf(0, 0, 0, 0, 'right'), xf(0, 0, 0, 0, 'center'), xf(0, 4, 1, 3, 'center'), xf(3, 0, 1, 3, 'center'), xf(4, 0, 0, 0, 'right'), xf(1, 3, 1, 0, 'center', 1)];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${BORDER}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
// sheet: {name, widths:[], rows:[[cell]], merges:['A1:C1'], freeze:rowCount, rtl:true, landscape, heights:{rowIndex:pt}}
// cell: مقدار ساده یا {v, s:'num'|'text'|...}
function buildXlsx(sheets) {
  const entries = [];
  const wbSheets = [], rels = [], ct = [];
  sheets.forEach((sh, i) => {
    const id = i + 1;
    let data = '';
    sh.rows.forEach((row, r) => {
      let cells = '';
      row.forEach((c, ci) => {
        if (c === null || c === undefined) return;
        const cell = (typeof c === 'object' && c !== null && 'v' in c) ? c : { v: c };
        const s = STYLE_NAMES.indexOf(cell.s || (typeof cell.v === 'number' ? 'plain' : 'plain')); const ref = colName(ci) + (r + 1);
        if (cell.v === '' || cell.v === null) cells += `<c r="${ref}" s="${s < 0 ? 0 : s}"/>`;
        else if (typeof cell.v === 'number') cells += `<c r="${ref}" s="${s < 0 ? 0 : s}"><v>${cell.v}</v></c>`;
        else cells += `<c r="${ref}" s="${s < 0 ? 0 : s}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
      });
      const h = sh.heights?.[r]; data += `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    });
    const cols = (sh.widths || []).map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('');
    const view = `<sheetViews><sheetView ${sh.rtl === false ? '' : 'rightToLeft="1" '}workbookViewId="0">${sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews>`;
    const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    const setup = `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToHeight="0"/>`;
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${view}<sheetFormatPr defaultRowHeight="18"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>${merges}${setup}</worksheet>`;
    entries.push({ name: `xl/worksheets/sheet${id}.xml`, data: Buffer.from(xml) });
    wbSheets.push(`<sheet name="${esc(sh.name.replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31))}" sheetId="${id}" r:id="rId${id}"/>`);
    rels.push(`<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${id}.xml"/>`);
    ct.push(`<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });
  const n = sheets.length;
  rels.push(`<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  entries.push({ name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ct.join('')}</Types>`) });
  entries.push({ name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) });
  entries.push({ name: 'xl/workbook.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets.join('')}</sheets></workbook>`) });
  entries.push({ name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) });
  entries.push({ name: 'xl/styles.xml', data: Buffer.from(stylesXml()) });
  return zip(entries);
}
module.exports = { readXlsx, buildXlsx, unzip };
