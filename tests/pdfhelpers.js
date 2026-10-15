'use strict';
// Helpers for PDF tests: structural validation, text extraction and a small PNG encoder.
const zlib = require('zlib');
const assert = require('node:assert/strict');

function assertValidPdf(buf) {
  assert.ok(Buffer.isBuffer(buf));
  const s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n'), 'header');
  assert.ok(s.endsWith('%%EOF\n'), 'trailer');
  const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(s);
  assert.ok(sx, 'startxref');
  const pos = Number(sx[1]);
  assert.equal(s.slice(pos, pos + 5), 'xref\n', 'xref offset points at the xref table');
  const m = /^xref\n0 (\d+)\n/.exec(s.slice(pos));
  const count = Number(m[1]);
  const body = s.slice(pos + m[0].length);
  assert.equal(body.slice(0, 20), '0000000000 65535 f \n');
  for (let i = 1; i < count; i++) {
    const entry = body.slice(i * 20, i * 20 + 20);
    assert.match(entry, /^\d{10} 00000 n \n$/);
    const off = Number(entry.slice(0, 10));
    assert.ok(s.startsWith(`${i} 0 obj\n`, off), `object ${i} at its xref offset`);
  }
  const pages = (s.match(/\/Type \/Page /g) || []).length;
  assert.equal(Number(/\/Type \/Pages \/Count (\d+)/.exec(s)[1]), pages, 'page count matches');
  return { pages, objects: count - 1 };
}

// Inflated page content streams (everything that is not an image).
function contentStreams(buf) {
  const s = buf.toString('latin1'), out = [];
  const re = /<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    out.push(zlib.inflateSync(buf.subarray(start, start + Number(m[1]))).toString('latin1'));
  }
  return out;
}
function pdfText(buf) {
  return contentStreams(buf).map(c => [...c.matchAll(/<([0-9a-f]+)> Tj/g)].map(m => Buffer.from(m[1], 'hex').toString('latin1')).join('\n')).join('\n');
}

// ---- PNG encoder (all colour types, bit depths and filter types) ----
const TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const paethP = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); };

// samples(x, y) -> array of channel values (0..2^depth-1)
function makePng({ w, h, ct, depth = 8, samples, palette, trns, filter = 0, interlace = 0 }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], bpp = channels * depth, rowBytes = Math.ceil(w * bpp / 8), bytesPP = Math.max(1, bpp >> 3);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(rowBytes);
    let bit = 0;
    for (let x = 0; x < w; x++) for (const v of samples(x, y)) {
      if (depth === 16) { row.writeUInt16BE(v, bit >> 3); } else if (depth === 8) row[bit >> 3] = v; else row[bit >> 3] |= v << (8 - depth - (bit & 7));
      bit += depth;
    }
    rows.push(row);
  }
  const raw = [];
  rows.forEach((row, y) => {
    const prev = y ? rows[y - 1] : Buffer.alloc(rowBytes), f = Buffer.alloc(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bytesPP ? row[i - bytesPP] : 0, b = prev[i], c = i >= bytesPP ? prev[i - bytesPP] : 0;
      f[i] = (row[i] - [0, a, b, (a + b) >> 1, paethP(a, b, c)][filter]) & 255;
    }
    raw.push(Buffer.from([filter]), f);
  });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = ct; ihdr[12] = interlace;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
    ...(palette ? [chunk('PLTE', Buffer.from(palette.flat()))] : []), ...(trns ? [chunk('tRNS', Buffer.from(trns))] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))), chunk('IEND', Buffer.alloc(0))]);
}

const tinyJpeg = () => Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9]);
const dataUrl = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

module.exports = { assertValidPdf, contentStreams, pdfText, makePng, tinyJpeg, dataUrl };
