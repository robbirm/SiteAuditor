'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { analyze } = require('../lib/analysis');
const { computeReport, buildReport, parseBrand, MAX_LOGO_BYTES } = require('../lib/report');
const { PdfError } = require('../lib/pdf');
const { row } = require('./fixtures');
const { assertValidPdf, pdfText, contentStreams, makePng, tinyJpeg, dataUrl } = require('./pdfhelpers');

const U = p => 'https://shop.example.com' + p;
const KB = n => n * 1024;
const META = { id: 'a'.repeat(24), status: 'done', startUrl: U('/'), site: 'shop.example.com', limit: 500, pagesCrawled: 6, discovered: 9, blockedByRobots: 1, notes: ['A crawl note.'],
  startedAt: Date.now() - 65000, finishedAt: Date.now(), siteChecks: { https: true, robots: { found: true, status: 200 }, sitemap: { found: true, url: U('/sitemap.xml'), urls: 2 } } };
const logoPng = () => makePng({ w: 40, h: 12, ct: 6, samples: x => [37, 99, 235, x < 30 ? 255 : 90] });

function sample() {
  const results = [
    row(U('/')), row(U('/a'), { title: '', responseMs: 2500 }), row(U('/b'), { metaDescription: '', h1: [], h1Count: 0, words: 40 }),
    row(U('/gone'), { status: 404, parsed: false }), row(U('/old'), { status: 301, parsed: false, redirectTo: U('/') }),
    row(U('/hidden'), { status: 0, parsed: false, blocked: true, note: 'Blocked by robots.txt' })
  ];
  const links = [{ source: U('/'), destination: U('/gone'), anchor: 'Gone', internal: true }, { source: U('/'), destination: U('/a'), anchor: 'A', internal: true }];
  const images = [{ page: U('/'), src: U('/i/1.jpg'), alt: 'one' }, { page: U('/'), src: U('/i/2.jpg'), alt: null }, { page: U('/a'), src: U('/i/2.jpg'), alt: '' }, { page: U('/a'), src: U('/i/3.jpg'), alt: 'three' }];
  const checks = [{ src: U('/i/1.jpg'), status: 200, bytes: KB(50) }, { src: U('/i/2.jpg'), status: 200, bytes: KB(700) }, { src: U('/i/3.jpg'), status: 404, bytes: null }];
  const a = analyze(results, links, images, checks);
  return { meta: META, analysis: () => a, a };
}

test('report numbers: status, health, images, speed and content', () => {
  const R = computeReport(sample());
  const by = (arr, l) => arr.find(x => x.label === l).value;
  assert.equal(by(R.statusBuckets, '2xx'), 3); assert.equal(by(R.statusBuckets, '3xx'), 1); assert.equal(by(R.statusBuckets, '4xx'), 1); assert.equal(by(R.statusBuckets, 'Blocked'), 1);
  assert.equal(R.crawledCount, 5);
  assert.equal(R.health.reduce((s, h) => s + h.value, 0), 5);                 // blocked pages are not part of health
  // '/' has a broken internal link (critical), '/a' has no title (critical), '/gone' is a 404 (critical),
  // '/b' only has warnings/info, '/old' is just a redirect (info).
  assert.deepEqual(R.health.map(h => h.value), [0, 1, 1, 3]);               // healthy, notices only, warnings, critical
  assert.equal(R.images.total, 3);                                            // unique image files
  assert.equal(R.images.alt.missing, 1); assert.equal(R.images.alt.empty, 1); assert.equal(R.images.alt.present, 2);
  assert.equal(R.images.oversized, 1); assert.equal(R.images.broken, 1); assert.equal(R.images.measured, 2);
  assert.equal(R.images.largest[0].bytes, KB(700));
  assert.equal(R.images.sizeBuckets.find(b => b.label === 'Over 500 KB').value, 1);
  assert.equal(R.images.sizeBuckets.find(b => b.label === 'Size unknown').value, 1);
  assert.equal(R.speed.slowest.url, U('/a')); assert.equal(R.speed.buckets.find(b => b.label === '1.5 - 3 s').value, 1);
  assert.equal(R.content.thin, 1);
});

test('report content: scorecard, strengths, action plan and worst pages are consistent with the analysis', () => {
  const v = sample(), R = computeReport(v);
  const card = l => R.scorecard.find(c => c.label === l);
  assert.deepEqual([card('Pages have a title tag').pass, card('Pages have a title tag').total], [2, 3]);
  assert.equal(card('Pages have a title tag').pct, 67);
  assert.deepEqual([card('Pages load successfully (HTTP 200)').pass, card('Pages load successfully (HTTP 200)').total], [3, 5]);
  assert.ok(card('Images have ALT text').pct === 75);
  assert.ok(R.strengths.includes('The site is served over HTTPS'));
  assert.ok(R.strengths.includes('An XML sitemap was found (2 URLs)'));
  assert.ok(R.strengths.includes('A robots.txt file is in place'));
  assert.ok(!R.strengths.some(s => /Pages served over HTTPS/.test(s)));       // not repeated
  const order = { critical: 0, warning: 1, info: 2 };
  assert.deepEqual(R.plan.map(p => order[p.severity]), R.plan.map(p => order[p.severity]).sort((x, y) => x - y));
  for (const p of R.plan) { assert.ok(p.fix.length > 10); assert.ok(p.examples.length >= 1 && p.examples.length <= 2); }
  const scores = R.worst.map(p => p.score);
  assert.deepEqual(scores, scores.slice().sort((x, y) => x - y));
  assert.equal(R.worst[0].score, 0);
  assert.ok(R.worst.every(p => p.issues.length && !p.blocked));
  assert.match(R.summary, new RegExp(`health score is ${R.score} out of 100`));
  assert.match(R.summary, /shop\.example\.com/);
  assert.equal(R.topIssues.length <= 10, true);
  assert.deepEqual(R.topIssues.map(t => t.count), R.topIssues.map(t => t.count).slice().sort((x, y) => y - x));
});

test('the PDF is valid, multi-page, and shows branding, client, score and a numbered footer on every page', () => {
  const v = sample();
  const buf = buildReport(v, { company: 'Acme Web Studio', client: 'Shop Example Ltd', accent: '#0f766e', logoAlign: 'left', logo: dataUrl(logoPng()) });
  const { pages } = assertValidPdf(buf);
  assert.ok(pages >= 6, 'pages: ' + pages);
  const text = pdfText(buf);
  assert.match(text, /shop\.example\.com/); assert.match(text, /Shop Example Ltd/); assert.match(text, /Acme Web Studio/);
  assert.match(text, /Priority action plan/); assert.match(text, /Images, speed & content/); assert.match(text, /Pages needing attention/); assert.match(text, /How the health score is calculated/);
  assert.match(text, new RegExp(`Page 1 of ${pages}`)); assert.match(text, new RegExp(`Page ${pages} of ${pages}`));
  const logoDraws = contentStreams(buf).filter(c => /\/Im1 Do/.test(c)).length;
  assert.equal(logoDraws, pages, 'the logo is drawn on every page');
  assert.ok(buf.toString('latin1').includes('/SMask'), 'transparent logo keeps its alpha');
  assert.ok(contentStreams(buf)[0].includes('0.059 0.463 0.431 rg'), 'custom accent colour is used');
});

test('logo position and JPEG logos', () => {
  const v = sample();
  for (const logoAlign of ['left', 'center', 'right']) {
    const buf = buildReport(v, { logoAlign, logo: dataUrl(logoPng()) });
    assertValidPdf(buf);
    assert.match(contentStreams(buf)[0], /q [\d.]+ 0 0 [\d.]+ ([\d.]+) [\d.]+ cm \/Im1 Do Q/);
    const x = Number(/q [\d.]+ 0 0 [\d.]+ ([\d.]+) [\d.]+ cm \/Im1 Do Q/.exec(contentStreams(buf)[0])[1]);
    if (logoAlign === 'left') assert.ok(x < 50); if (logoAlign === 'center') assert.ok(x > 200 && x < 350); if (logoAlign === 'right') assert.ok(x > 380);
  }
  assertValidPdf(buildReport(v, { logo: dataUrl(tinyJpeg(), 'image/jpeg') }));
});

test('without a logo or names the report is still complete and unbranded', () => {
  const buf = buildReport(sample(), {});
  assertValidPdf(buf);
  const text = pdfText(buf);
  assert.ok(!/PREPARED FOR|PREPARED BY/.test(text));
  assert.ok(!contentStreams(buf).some(c => /Do Q/.test(c)));
  assert.match(text, /Page 1 of/);
});

test('branding input is validated', () => {
  const b = parseBrand({ company: '  A\u0000\n  B  ', client: 'x'.repeat(500), accent: 'not-a-colour', logoAlign: 'diagonal' });
  assert.equal(b.company, 'A B'); assert.equal(b.client.length, 80); assert.equal(b.accent, '#2563eb'); assert.equal(b.logoAlign, 'left'); assert.equal(b.logo, null);
  assert.equal(parseBrand({ accent: '#ABCDEF' }).accent, '#abcdef');
  assert.equal(parseBrand(null).accent, '#2563eb');
  const bad = (logo, re) => assert.throws(() => parseBrand({ logo }), e => e instanceof PdfError && re.test(e.message), String(logo).slice(0, 40));
  bad('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', /PNG or JPG/);
  bad('data:image/gif;base64,R0lGODlhAQABAAAAACw=', /PNG or JPG/);
  bad('https://evil.example/logo.png', /PNG or JPG/);
  bad('data:image/png;base64,', /empty/);
  bad('data:image/png;base64,' + Buffer.from('definitely not a png').toString('base64'), /PNG/);
  bad('data:image/png;base64,' + 'A'.repeat(Math.ceil(MAX_LOGO_BYTES * 1.5)), /too large/);
  bad(dataUrl(makePng({ w: 4, h: 4, ct: 2, samples: () => [1, 2, 3], interlace: 1 })), /Interlaced/);
  assert.ok(parseBrand({ logo: dataUrl(logoPng()) }).logo.width === 40);
  assert.equal(parseBrand({ logo: '' }).logo, null);
});

test('hostile or extreme page data cannot break the PDF', () => {
  const evil = 'x) Tj ET Q 1 0 0 rg 0 0 600 800 re f BT (';
  const results = [
    row(U('/' + evil), { title: evil.repeat(40), metaDescription: '日本語 😀 ✓ \u0000 ' + evil, h1: [evil], h1Count: 2 }),
    row(U('/' + 'long/'.repeat(300)), { title: '', status: 500, parsed: false }),
    ...Array.from({ length: 40 }, (_, i) => row(U('/p' + i), { title: 'Same title for every page here on the site', words: 20 }))
  ];
  const a = analyze(results, [], [], []);
  const buf = buildReport({ meta: { ...META, startUrl: 'https://' + 'a'.repeat(60) + '.example.com/' + 'b'.repeat(300), notes: ['n'.repeat(900)] }, analysis: () => a },
    { company: 'C'.repeat(200) + ') (', client: '日本' + evil });
  assertValidPdf(buf);
  const content = contentStreams(buf).join('\n');
  assert.ok(!/ 1 0 0 rg 0 0 600 800 re f/.test(content.replace(/<[0-9a-f]+> Tj/g, '')), 'page text never becomes drawing commands');
});

test('empty and degenerate crawls still produce a report', () => {
  const cases = [
    [],                                                                                       // nothing crawled
    [row(U('/hidden'), { status: 0, parsed: false, blocked: true })],                          // everything blocked
    [row(U('/t'), { status: 0, parsed: false, note: 'Timed out' })],                           // only a failed request
    [row(U('/only'))]                                                                         // one perfect page
  ];
  for (const results of cases) {
    const a = analyze(results, [], [], []);
    const buf = buildReport({ meta: { ...META, pagesCrawled: results.length, siteChecks: null, status: 'cancelled' }, analysis: () => a }, { company: 'Acme' });
    assertValidPdf(buf);
    assert.match(pdfText(buf), /Overview/);
  }
});

test('a large crawl (1,000 pages with every kind of issue) stays fast and valid', () => {
  const results = [], links = [], images = [];
  for (let i = 0; i < 1000; i++) {
    results.push(row(U('/p' + i), { title: i % 3 ? 'Dup' : '', metaDescription: i % 4 ? '' : 'short', h1: i % 5 ? [] : ['a', 'b'], h1Count: i % 5 ? 0 : 2, canonical: '', viewport: i % 7 === 0, lang: '', words: 10 + i % 400, responseMs: 100 + (i * 37) % 4000, status: i % 50 === 0 ? 404 : 200, parsed: i % 50 !== 0 }));
    images.push({ page: U('/p' + i), src: U('/img/' + (i % 200) + '.jpg'), alt: i % 2 ? null : 'x' });
    links.push({ source: U('/p' + i), destination: U('/p' + ((i * 7) % 1000)), anchor: 'l', internal: true });
  }
  const checks = Array.from({ length: 150 }, (_, i) => ({ src: U('/img/' + i + '.jpg'), status: i % 20 ? 200 : 404, bytes: KB(20 + i * 8) }));
  const a = analyze(results, links, images, checks);
  const t = Date.now();
  const buf = buildReport({ meta: { ...META, pagesCrawled: 1000 }, analysis: () => a }, { company: 'Acme', logo: dataUrl(logoPng()) });
  const ms = Date.now() - t;
  const { pages } = assertValidPdf(buf);
  assert.ok(pages >= 8 && pages <= 20, 'pages: ' + pages);
  assert.ok(ms < 3000, 'took ' + ms + ' ms');
  assert.ok(buf.length < 1.5e6, 'size ' + buf.length);
});

test('page addresses in the PDF are clickable links to the live pages (http/https only)', () => {
  const v = sample();
  const buf = buildReport(v, {});
  assertValidPdf(buf);
  const s = buf.toString('latin1');
  const uris = [...s.matchAll(/\/URI \(([^)]*)\)/g)].map(m => m[1]);
  assert.ok(uris.length >= 4, 'links: ' + uris.length);
  assert.ok(uris.every(u => /^https:\/\/shop\.example\.com\//.test(u)), uris.join(' '));
  assert.ok(uris.includes(U('/a')), 'a problem page is linked');
  assert.ok(uris.includes(U('/i/2.jpg')), 'a large image is linked');
  assert.match(s, /\/Annots \[\d+ 0 R/);
  const annot = /<< \/Type \/Annot \/Subtype \/Link \/Rect \[([\d. -]+)\]/.exec(s);
  const [x1, y1, x2, y2] = annot[1].split(' ').map(Number);
  assert.ok(x2 > x1 && y2 > y1 && y1 >= 0 && y2 <= 842, 'rectangle is on the page: ' + annot[1]);
  assert.match(pdfText(buf), /shop\.example\.com\/a/);
});

test('Pdf.link ignores unsafe addresses and escapes special characters', () => {
  const { Pdf } = require('../lib/pdf');
  const d = new Pdf(); d.addPage();
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'not a url', '', null, 'https://x.example/' + 'a'.repeat(2100)]) d.link(10, 10, 50, 10, bad);
  d.link(10, 30, 50, 10, 'https://x.example/a(b)c?q=1&r=2');
  const s = d.toBuffer().toString('latin1');
  assert.equal((s.match(/\/Subtype \/Link/g) || []).length, 1);
  assert.ok(s.includes('/URI (https://x.example/a\\(b\\)c?q=1&r=2)'));
  assertValidPdf(d.toBuffer());
});
