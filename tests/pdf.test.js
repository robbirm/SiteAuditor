'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pdf, PdfError, loadImage, width, fit, wrapText, codes } = require('../lib/pdf');
const { assertValidPdf, pdfText, makePng, tinyJpeg } = require('./pdfhelpers');

test('text is encoded to WinAnsi safely; unsupported characters become ?', () => {
  assert.deepEqual(codes('Ab1'), [65, 98, 49]);
  assert.deepEqual(codes('café'), [99, 97, 102, 233]);
  assert.deepEqual(codes('€–“'), [0x80, 0x96, 0x93]);
  assert.deepEqual(codes('日😀'), [63, 63]);          // CJK and an emoji (one code point each)
  assert.deepEqual(codes('a\u0000b​c\n'), [97, 98, 99, 32]);   // control and zero-width characters
});

test('text measuring uses real Helvetica metrics', () => {
  assert.equal(Math.round(width('Hello', 10) * 100) / 100, 22.78);
  assert.ok(width('Hello', 10, true) > width('Hello', 10, false));
  assert.equal(width('', 10), 0);
  assert.equal(width('AAAA', 10, false, 1), 4 * 6.67 + 4);
});

test('wrapping and truncating respect the width, including very long unbroken words', () => {
  const lines = wrapText('The quick brown fox jumps over the lazy dog and keeps on running far away', 120, 10);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(width(l, 10) <= 120.01, l);
  const url = 'x'.repeat(200);
  const broken = wrapText(url, 100, 10);
  assert.ok(broken.length > 1);
  for (const l of broken) assert.ok(width(l, 10) <= 100.01);
  assert.equal(broken.join(''), url);
  assert.deepEqual(wrapText('   ', 100, 10), []);
  const t = fit('A very long page title that will not fit in a small space', 90, 10);
  assert.ok(width(t, 10) <= 90.01 && t.endsWith('…'));
  assert.equal(fit('short', 90, 10), 'short');
});

test('PNG decoding: every filter type, colour type and bit depth', () => {
  const grad = (x, y) => [x * 40 + y * 3, 255 - x * 30, (x * y * 20) & 255];
  for (const filter of [0, 1, 2, 3, 4]) {
    const img = loadImage(makePng({ w: 6, h: 5, ct: 2, samples: grad, filter }));
    assert.equal(img.width, 6); assert.equal(img.height, 5); assert.equal(img.alpha, null);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) assert.deepEqual([...img.rgb.subarray((y * 6 + x) * 3, (y * 6 + x) * 3 + 3)], grad(x, y).map(v => v & 255), `filter ${filter} @${x},${y}`);
  }
  const rgba = loadImage(makePng({ w: 4, h: 4, ct: 6, samples: (x, y) => [10, 20, 30, x * 60], filter: 4 }));
  assert.deepEqual([...rgba.alpha.subarray(0, 4)], [0, 60, 120, 180]);
  assert.deepEqual([...rgba.rgb.subarray(0, 3)], [10, 20, 30]);
  assert.equal(loadImage(makePng({ w: 3, h: 3, ct: 6, samples: () => [1, 2, 3, 255] })).alpha, null);   // opaque: no soft mask
  const gray = loadImage(makePng({ w: 4, h: 2, ct: 0, samples: x => [x * 80], filter: 1 }));
  assert.deepEqual([...gray.rgb.subarray(3 * 3, 3 * 3 + 3)], [240, 240, 240]);
  const gray4 = loadImage(makePng({ w: 5, h: 2, ct: 0, depth: 4, samples: x => [x * 3] }));       // 4-bit grayscale
  assert.deepEqual([...gray4.rgb.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual([...gray4.rgb.subarray(4 * 3, 4 * 3 + 3)], [Math.round(12 * 255 / 15), Math.round(12 * 255 / 15), Math.round(12 * 255 / 15)]);
  const ga = loadImage(makePng({ w: 3, h: 3, ct: 4, samples: x => [100, x * 100] }));
  assert.deepEqual([...ga.alpha.subarray(0, 3)], [0, 100, 200]);
  const pal = loadImage(makePng({ w: 4, h: 2, ct: 3, depth: 2, samples: x => [x], palette: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]], trns: [255, 128] }));
  assert.deepEqual([...pal.rgb.subarray(3, 6)], [0, 255, 0]);
  assert.deepEqual([...pal.alpha.subarray(0, 4)], [255, 128, 255, 255]);
  const pal8 = loadImage(makePng({ w: 2, h: 2, ct: 3, samples: x => [x], palette: [[1, 2, 3], [4, 5, 6]] }));
  assert.equal(pal8.alpha, null); assert.deepEqual([...pal8.rgb.subarray(3, 6)], [4, 5, 6]);
  const rgb16 = loadImage(makePng({ w: 2, h: 2, ct: 2, depth: 16, samples: () => [65535, 32768, 0] }));
  assert.deepEqual([...rgb16.rgb.subarray(0, 3)], [255, 128, 0]);
});

test('bad, hostile or unsupported images are rejected with friendly errors', () => {
  const ok = makePng({ w: 4, h: 4, ct: 2, samples: () => [1, 2, 3] });
  const expectErr = (buf, re) => assert.throws(() => loadImage(buf), e => e instanceof PdfError && re.test(e.message), String(re));
  expectErr(Buffer.from('not an image'), /PNG or JPG/);
  expectErr(Buffer.alloc(0), /PNG or JPG|No image/);
  expectErr(ok.subarray(0, 40), /damaged/);
  expectErr(makePng({ w: 4, h: 4, ct: 2, samples: () => [1, 2, 3], interlace: 1 }), /Interlaced/);
  const huge = Buffer.from(ok); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(100000, 20);   // IHDR claims 100000 x 100000
  expectErr(huge, /too large/);
  const lying = Buffer.from(ok); lying.writeUInt32BE(5000, 16); lying.writeUInt32BE(1000, 20);      // claims 5000 x 1000 but only has 4 x 4 of data
  expectErr(lying, /damaged/);
  const badDepth = makePng({ w: 2, h: 2, ct: 2, samples: () => [1, 2, 3] }); badDepth[24] = 4;
  expectErr(badDepth, /Unsupported/);
  const badFilter = makePng({ w: 2, h: 2, ct: 0, samples: () => [1] }); // corrupt the zlib stream
  badFilter[badFilter.length - 20] ^= 0xff;
  assert.throws(() => loadImage(badFilter), PdfError);
  expectErr(Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]), /damaged|not a valid/);
});

test('JPEG headers are read; CMYK is refused', () => {
  const j = loadImage(tinyJpeg());
  assert.equal(j.kind, 'jpeg'); assert.equal(j.width, 32); assert.equal(j.height, 16); assert.equal(j.comps, 3);
  const cmyk = Buffer.from(tinyJpeg()); cmyk[11] = 4;
  assert.throws(() => loadImage(cmyk), /Unsupported JPEG/);
});

test('a document with shapes, text, charts and images is a structurally valid PDF', () => {
  const doc = new Pdf({ title: 'Tést ✓', author: 'A' });
  const rgba = loadImage(makePng({ w: 8, h: 8, ct: 6, samples: x => [200, 30, 30, x * 30] }));
  const jpg = loadImage(tinyJpeg());
  for (let p = 0; p < 3; p++) {
    doc.addPage();
    doc.rect(10, 10, 100, 50, { fill: '#2563eb', stroke: '#000', r: 8 }); doc.line(0, 0, 100, 100, { dash: [2, 2] });
    doc.donut(100, 200, 40, 12, [{ value: 3, color: '#16a34a' }, { value: 0, color: '#f00' }, { value: 1, color: '#dc2626' }]);
    doc.donut(300, 200, 40, 12, [{ value: 0, color: '#16a34a' }]);
    doc.arcStroke(400, 200, 30, 0, 5, { cap: 1 }); doc.polyline([[1, 1], [5, 9], [20, 2]], {});
    doc.text('Page (with) \\ odd ) Tj ET characters', 20, 300, { size: 12, bold: true, maxWidth: 480, cs: 1 });
    doc.paragraph('A paragraph '.repeat(40), 20, 320, 300, { maxLines: 3 });
    doc.drawImage(rgba, 20, 500, 60, 60); doc.drawImage(jpg, 100, 500, 60, 30);
  }
  const buf = doc.toBuffer({ footer: (d, n, total) => d.text(`Page ${n} of ${total}`, 500, 800, { align: 'right' }) });
  const info = assertValidPdf(buf);
  assert.equal(info.pages, 3);
  const text = pdfText(buf);
  assert.match(text, /Page 1 of 3/); assert.match(text, /Page 3 of 3/);
  assert.ok(text.includes('Page (with) \\ odd ) Tj ET characters'));   // special characters are data, not PDF syntax
  assert.ok(buf.toString('latin1').includes('/SMask'));
});

test('an empty document and non-finite numbers do not break the file', () => {
  const doc = new Pdf();
  doc.addPage(); doc.rect(NaN, Infinity, 10, 10, { fill: '#000' }); doc.text('x', NaN, NaN);
  assertValidPdf(doc.toBuffer());
  assertValidPdf(new Pdf().toBuffer());
});
