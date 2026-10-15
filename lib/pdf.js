'use strict';
// A small, dependency-free PDF writer: vector shapes, wrapped text (standard Helvetica) and PNG/JPEG images.
// Coordinates are TOP-DOWN in points (y grows downwards), A4 portrait by default.
const zlib = require('zlib');
const METRICS = require('./fontmetrics');

class PdfError extends Error {}

const MAX_PIXELS = 6e6;

// ---------- text: Unicode -> WinAnsi (cp1252) ----------
const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89,
  0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96,
  0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };

function codes(str) {
  const out = [];
  for (const ch of String(str == null ? '' : str)) {
    const cp = ch.codePointAt(0);
    if (cp === 9 || cp === 10 || cp === 13 || cp === 0xA0) out.push(32);
    else if (cp < 32 || cp === 127 || (cp >= 0x200B && cp <= 0x200F) || cp === 0xFEFF || cp === 0x2060 || cp === 0xFE0E || cp === 0xFE0F) continue;
    else if (cp <= 0x7E || (cp >= 0xA1 && cp <= 0xFF)) out.push(cp);
    else if (WIN[cp]) out.push(WIN[cp]);
    else out.push(63);
  }
  return out;
}
const hexOf = c => Buffer.from(c).toString('hex');

function width(str, size, bold = false, cs = 0) {
  const t = METRICS[bold ? 'b' : 'r'], c = codes(str);
  let w = 0;
  for (const k of c) w += t[k];
  return w * size / 1000 + c.length * cs;
}

function fit(str, maxW, size, bold = false, cs = 0) {
  const s = Array.from(String(str == null ? '' : str).replace(/\s+/g, ' '));
  if (width(s.join(''), size, bold, cs) <= maxW) return s.join('');
  let lo = 0, hi = s.length;
  while (lo < hi) { // longest prefix that still fits with an ellipsis
    const mid = (lo + hi + 1) >> 1;
    if (width(s.slice(0, mid).join('').trimEnd() + '…', size, bold, cs) <= maxW) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).join('').trimEnd() + '…';
}

function wrapText(str, maxW, size, bold = false) {
  const words = String(str == null ? '' : str).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (width(w, size, bold) > maxW) { // a single very long token (e.g. a URL): break by character
      if (cur) { lines.push(cur); cur = ''; }
      let piece = '';
      for (const ch of Array.from(w)) {
        if (piece && width(piece + ch, size, bold) > maxW) { lines.push(piece); piece = ch; } else piece += ch;
      }
      cur = piece;
      continue;
    }
    const test = cur ? cur + ' ' + w : w;
    if (width(test, size, bold) <= maxW) cur = test; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- numbers and colours ----------
const n = v => {
  if (!Number.isFinite(v)) return '0';
  return (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
};
const nc = v => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const v = parseInt(m ? m[1] : '000000', 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
const fillOp = c => { const [r, g, b] = rgb(c); return `${nc(r)} ${nc(g)} ${nc(b)} rg`; };
const strokeOp = c => { const [r, g, b] = rgb(c); return `${nc(r)} ${nc(g)} ${nc(b)} RG`; };

// ---------- images ----------
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

function decodePng(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new PdfError('That file is not a valid PNG image.');
  let pos = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    if (len > buf.length - pos - 12) throw new PdfError('The PNG image looks damaged. Please export it again.');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.length < 13 || !idat.length) throw new PdfError('The PNG image looks damaged. Please export it again.');
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], ct = ihdr[9];
  if (!w || !h || w * h > MAX_PIXELS) throw new PdfError('The logo is too large. Please use an image under about 2,400 x 2,400 pixels.');
  if (ihdr[10] !== 0 || ihdr[11] !== 0) throw new PdfError('Unsupported PNG format.');
  if (ihdr[12] !== 0) throw new PdfError('Interlaced PNGs are not supported. Please export the logo again without interlacing.');
  const ok = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[ct];
  if (!ok || !ok.includes(depth)) throw new PdfError('Unsupported PNG colour format. Please export the logo as a standard 8-bit PNG.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const bpp = channels * depth, bytesPP = Math.max(1, bpp >> 3), rowBytes = Math.ceil(w * bpp / 8);
  if (ct === 3 && (!plte || plte.length < 3)) throw new PdfError('The PNG image looks damaged. Please export it again.');

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (rowBytes + 1) * h + 16 }); }
  catch { throw new PdfError('The PNG image looks damaged. Please export it again.'); }
  if (raw.length < (rowBytes + 1) * h) throw new PdfError('The PNG image looks damaged. Please export it again.');

  const px = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (rowBytes + 1)], src = y * (rowBytes + 1) + 1, dst = y * rowBytes, prev = dst - rowBytes;
    if (ft > 4) throw new PdfError('The PNG image looks damaged. Please export it again.');
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[src + i];
      const a = i >= bytesPP ? px[dst + i - bytesPP] : 0, b = y > 0 ? px[prev + i] : 0, c = (i >= bytesPP && y > 0) ? px[prev + i - bytesPP] : 0;
      let v;
      if (ft === 0) v = x; else if (ft === 1) v = x + a; else if (ft === 2) v = x + b; else if (ft === 3) v = x + ((a + b) >> 1); else v = x + paeth(a, b, c);
      px[dst + i] = v & 255;
    }
  }

  const out = Buffer.alloc(w * h * 3);
  let alpha = (ct === 4 || ct === 6 || (ct === 3 && trns && trns.length)) ? Buffer.alloc(w * h, 255) : null;
  const maxv = (1 << Math.min(depth, 8)) - 1;
  const bits = (rs, x) => (px[rs + ((x * depth) >> 3)] >> (8 - depth - ((x * depth) & 7))) & maxv;
  for (let y = 0; y < h; y++) {
    const rs = y * rowBytes;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (ct === 6 || ct === 2) {
        const step = depth === 16 ? 2 : 1, base = rs + x * channels * step;
        out[o] = px[base]; out[o + 1] = px[base + step]; out[o + 2] = px[base + 2 * step];
        if (ct === 6) alpha[y * w + x] = px[base + 3 * step];
      } else if (ct === 4 || (ct === 0 && depth >= 8)) {
        const step = depth === 16 ? 2 : 1, base = rs + x * channels * step, g = px[base];
        out[o] = out[o + 1] = out[o + 2] = g;
        if (ct === 4) alpha[y * w + x] = px[base + step];
      } else if (ct === 0) {
        const g = Math.round(bits(rs, x) * 255 / maxv);
        out[o] = out[o + 1] = out[o + 2] = g;
      } else { // palette
        const idx = depth === 8 ? px[rs + x] : bits(rs, x);
        if (idx * 3 + 2 < plte.length) { out[o] = plte[idx * 3]; out[o + 1] = plte[idx * 3 + 1]; out[o + 2] = plte[idx * 3 + 2]; }
        if (alpha) alpha[y * w + x] = idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  if (alpha && !alpha.some(v => v !== 255)) alpha = null; // fully opaque: no soft mask needed
  return { kind: 'png', width: w, height: h, rgb: out, alpha };
}

function decodeJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new PdfError('That file is not a valid JPEG image.');
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xFF) { pos++; continue; }
    const m = buf[pos + 1];
    if (m === 0xFF) { pos++; continue; }
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { pos += 2; continue; }
    const len = buf.readUInt16BE(pos + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      const precision = buf[pos + 4], h = buf.readUInt16BE(pos + 5), w = buf.readUInt16BE(pos + 7), comps = buf[pos + 9];
      if (precision !== 8 || (comps !== 1 && comps !== 3)) throw new PdfError('Unsupported JPEG format. Please export the logo as a standard RGB JPEG or PNG.');
      if (!w || !h || w * h > MAX_PIXELS) throw new PdfError('The logo is too large. Please use an image under about 2,400 x 2,400 pixels.');
      return { kind: 'jpeg', width: w, height: h, comps, data: buf };
    }
    pos += 2 + len;
  }
  throw new PdfError('The JPEG image looks damaged. Please export it again.');
}

function loadImage(buf) {
  if (!Buffer.isBuffer(buf)) throw new PdfError('No image data.');
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return decodePng(buf);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8) return decodeJpeg(buf);
  throw new PdfError('Please upload a PNG or JPG image.');
}

// ---------- document ----------
class Pdf {
  constructor({ title = '', author = '', creator = 'Modernise Site Auditor', size = [595.28, 841.89] } = {}) {
    this.W = size[0]; this.H = size[1];
    this.meta = { title, author, creator };
    this.pages = [];
    this.cur = null;
    this.images = [];
  }

  addPage() { this.cur = { ops: [], imgs: new Set(), links: [] }; this.pages.push(this.cur); return this.cur; }

  // Clickable area (top-down coordinates like everything else). Only http(s) addresses are accepted.
  link(x, y, w, h, url) {
    let href;
    try { const u = new URL(String(url)); if (u.protocol !== 'http:' && u.protocol !== 'https:') return; href = u.href; } catch { return; }
    if (!/^[\x21-\x7e]+$/.test(href) || href.length > 2000) return;   // URL.href is ASCII (percent-encoded); anything else is dropped
    this.cur.links.push({ x, y, w, h, href });
  }
  _op(s) { this.cur.ops.push(s); }
  textWidth(s, size, bold, cs) { return width(s, size, bold, cs); }
  wrap(s, w, size, bold) { return wrapText(s, w, size, bold); }
  fit(s, w, size, bold) { return fit(s, w, size, bold); }

  rect(x, y, w, h, { fill, stroke, lw = 1, r = 0 } = {}) {
    if (!fill && !stroke) return;
    const py = this.H - y - h, ops = ['q'];
    if (fill) ops.push(fillOp(fill));
    if (stroke) ops.push(strokeOp(stroke), `${n(lw)} w`);
    if (r > 0) {
      const rr = Math.min(r, w / 2, h / 2), k = 0.5523 * rr, x2 = x + w, y2 = py + h;
      ops.push(`${n(x + rr)} ${n(py)} m ${n(x2 - rr)} ${n(py)} l ${n(x2 - rr + k)} ${n(py)} ${n(x2)} ${n(py + rr - k)} ${n(x2)} ${n(py + rr)} c`
        + ` ${n(x2)} ${n(y2 - rr)} l ${n(x2)} ${n(y2 - rr + k)} ${n(x2 - rr + k)} ${n(y2)} ${n(x2 - rr)} ${n(y2)} c`
        + ` ${n(x + rr)} ${n(y2)} l ${n(x + rr - k)} ${n(y2)} ${n(x)} ${n(y2 - rr + k)} ${n(x)} ${n(y2 - rr)} c`
        + ` ${n(x)} ${n(py + rr)} l ${n(x)} ${n(py + rr - k)} ${n(x + rr - k)} ${n(py)} ${n(x + rr)} ${n(py)} c h`);
    } else ops.push(`${n(x)} ${n(py)} ${n(w)} ${n(h)} re`);
    ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S', 'Q');
    this._op(ops.join(' '));
  }

  line(x1, y1, x2, y2, { color = '#e2e8f0', lw = 1, dash, cap = 0 } = {}) {
    this._op(`q ${strokeOp(color)} ${n(lw)} w ${cap} J ${dash ? `[${dash.map(n).join(' ')}] 0 d ` : ''}${n(x1)} ${n(this.H - y1)} m ${n(x2)} ${n(this.H - y2)} l S Q`);
  }
  // Polyline through [[x, y], ...] with round joins (used for tick marks).
  polyline(pts, { color = '#000', lw = 1.5 } = {}) {
    this._op(`q ${strokeOp(color)} ${n(lw)} w 1 J 1 j ${pts.map((p, i) => `${n(p[0])} ${n(this.H - p[1])} ${i ? 'l' : 'm'}`).join(' ')} S Q`);
  }

  _circlePath(cx, cy, r) {
    const k = 0.5523 * r, y = this.H - cy;
    return `${n(cx + r)} ${n(y)} m ${n(cx + r)} ${n(y + k)} ${n(cx + k)} ${n(y + r)} ${n(cx)} ${n(y + r)} c `
      + `${n(cx - k)} ${n(y + r)} ${n(cx - r)} ${n(y + k)} ${n(cx - r)} ${n(y)} c `
      + `${n(cx - r)} ${n(y - k)} ${n(cx - k)} ${n(y - r)} ${n(cx)} ${n(y - r)} c `
      + `${n(cx + k)} ${n(y - r)} ${n(cx + r)} ${n(y - k)} ${n(cx + r)} ${n(y)} c h`;
  }
  circle(cx, cy, r, { fill, stroke, lw = 1 } = {}) {
    if (!fill && !stroke) return;
    this._op(`q ${fill ? fillOp(fill) + ' ' : ''}${stroke ? strokeOp(stroke) + ` ${n(lw)} w ` : ''}${this._circlePath(cx, cy, r)} ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`);
  }

  // Angles in radians, clockwise from 12 o'clock.
  _arcPath(cx, cy, r, a0, a1) {
    const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2))), d = (a1 - a0) / segs, k = 4 / 3 * Math.tan(d / 4);
    const P = t => [cx + r * Math.sin(t), this.H - cy + r * Math.cos(t)], D = t => [r * Math.cos(t), -r * Math.sin(t)];
    const s = P(a0);
    let out = `${n(s[0])} ${n(s[1])} m`;
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + i * d, t1 = t0 + d, p0 = P(t0), p1 = P(t1), d0 = D(t0), d1 = D(t1);
      out += ` ${n(p0[0] + k * d0[0])} ${n(p0[1] + k * d0[1])} ${n(p1[0] - k * d1[0])} ${n(p1[1] - k * d1[1])} ${n(p1[0])} ${n(p1[1])} c`;
    }
    return out;
  }
  arcStroke(cx, cy, r, a0, a1, { color = '#000', lw = 6, cap = 0 } = {}) {
    if (Math.abs(a1 - a0) < 1e-4) return;
    if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-4) return this.circle(cx, cy, r, { stroke: color, lw });
    this._op(`q ${strokeOp(color)} ${n(lw)} w ${cap} J ${this._arcPath(cx, cy, r, a0, a1)} S Q`);
  }
  // Ring chart: segments = [{ value, color }]
  donut(cx, cy, r, lw, segments, { track = '#e2e8f0' } = {}) {
    const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
    this.circle(cx, cy, r, { stroke: track, lw });
    if (!total) return;
    const live = segments.filter(s => s.value > 0), gap = live.length > 1 ? 0.035 : 0;
    let a = 0;
    for (const s of live) {
      const span = s.value / total * Math.PI * 2;
      this.arcStroke(cx, cy, r, a + gap / 2, a + span - gap / 2, { color: s.color, lw });
      a += span;
    }
  }

  // y is the BASELINE. Returns the drawn width.
  text(str, x, y, { size = 10, bold = false, color = '#0f172a', align = 'left', maxWidth, cs = 0 } = {}) {
    let s = String(str == null ? '' : str);
    if (maxWidth) s = fit(s, maxWidth, size, bold, cs);
    const c = codes(s);
    if (!c.length) return 0;
    const w = width(s, size, bold, cs);
    if (align === 'center') x -= w / 2; else if (align === 'right') x -= w;
    this._op(`q BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${cs ? n(cs) + ' Tc ' : ''}${fillOp(color)} ${n(x)} ${n(this.H - y)} Td <${hexOf(c)}> Tj ET Q`);
    return w;
  }

  // y is the TOP of the first line. Returns the y below the last line.
  paragraph(str, x, y, w, { size = 10, bold = false, color = '#334155', lh = 1.4, maxLines } = {}) {
    let lines = wrapText(str, w, size, bold);
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = fit(lines[maxLines - 1] + ' …', w, size, bold); }
    lines.forEach((l, i) => this.text(l, x, y + size * 0.82 + i * size * lh, { size, bold, color }));
    return y + lines.length * size * lh;
  }

  addImage(img) { if (!this.images.includes(img)) this.images.push(img); return this.images.indexOf(img) + 1; }
  drawImage(img, x, y, w, h) {
    const id = this.addImage(img);
    this.cur.imgs.add(id);
    this._op(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this.H - y - h)} cm /Im${id} Do Q`);
  }

  // footer(doc, pageNumber, pageCount) is called for every page once the total is known.
  toBuffer({ footer } = {}) {
    if (footer) this.pages.forEach((p, i) => { this.cur = p; footer(this, i + 1, this.pages.length); });
    const objs = [];            // objs[i] = Buffer holding the object body (object number i + 1)
    const add = b => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1')); return objs.length; };
    const stream = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
    add('');                    // 1: catalog (filled later)
    add('');                    // 2: pages (filled later)
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgIds = this.images.map(img => {
      if (img.kind === 'jpeg') {
        return add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.comps === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, img.data));
      }
      let sm = '';
      if (img.alpha) sm = ` /SMask ${add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(img.alpha)))} 0 R`;
      return add(stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${sm}`, zlib.deflateSync(img.rgb)));
    });
    const pageIds = [];
    for (const p of this.pages) {
      const content = add(stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'))));
      const annots = (p.links || []).map(l => {
        const esc = l.href.replace(/[\\()]/g, m => '\\' + m);
        return add(`<< /Type /Annot /Subtype /Link /Rect [${n(l.x)} ${n(this.H - l.y - l.h)} ${n(l.x + l.w)} ${n(this.H - l.y)}] /Border [0 0 0] /F 4 /A << /S /URI /URI (${esc}) >> >>`);
      });
      const xo = [...p.imgs].map(i => `/Im${i} ${imgIds[i - 1]} 0 R`).join(' ');
      pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.W)} ${n(this.H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map(i => i + ' 0 R').join(' ')}]` : ''} >>`));
    }
    objs[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1');
    objs[1] = Buffer.from(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] >>`, 'latin1');
    const u16 = s => 'FEFF' + Buffer.from(String(s || ''), 'utf16le').swap16().toString('hex');
    const d = new Date(), pad = v => String(v).padStart(2, '0');
    const date = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const info = add(`<< /Title <${u16(this.meta.title)}> /Author <${u16(this.meta.author)}> /Creator <${u16(this.meta.creator)}> /Producer <${u16('Modernise Site Auditor')}> /CreationDate (${date}) >>`);

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = [];
    let off = chunks[0].length;
    objs.forEach((body, i) => {
      offsets.push(off);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(b); off += b.length;
    });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { Pdf, PdfError, loadImage, width, fit, wrapText, codes };
