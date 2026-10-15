'use strict';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'msa-api-'));
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test-password-123';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');
const { okPage, fakeSite } = require('./fixtures');

let base;
const server = app.listen(0);
base = 'http://127.0.0.1:' + server.address().port;
test.after(() => { server.closeAllConnections && server.closeAllConnections(); server.close(); });

const AUTH = { Authorization: 'Basic ' + Buffer.from('admin:test-password-123').toString('base64') };
const call = (path, o = {}) => fetch(base + path, { ...o, headers: { ...AUTH, 'Content-Type': 'application/json', ...(o.headers || {}) } });
const post = (path, body, headers) => call(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers });
const START = 'http://93.184.216.34/';
const hub = (n, extra = []) => { const p = { '/': okPage('/', { links: [...Array.from({ length: n }, (_, i) => ['/p' + i, 'P' + i]), ...extra] }) }; for (let i = 0; i < n; i++) p['/p' + i] = okPage('/p' + i); return p; };
async function waitFor(id, wanted) {
  for (let i = 0; i < 200; i++) {
    const p = await (await call('/api/crawls/' + id)).json();
    if (wanted.includes(p.status)) return p;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('timeout waiting for ' + wanted);
}
const useSite = (pages, o) => { const s = fakeSite(pages, o); app.locals.crawlOptions = { fetchUrl: s.fetchUrl, fetchFollow: s.fetchFollow, delayMs: 0 }; return s; };

test('authentication is required for the UI and API; /healthz is open', async () => {
  assert.equal((await fetch(base + '/healthz')).status, 200);
  for (const p of ['/', '/api/status', '/api/crawls/abc']) assert.equal((await fetch(base + p)).status, 401, p);
  const bad = await fetch(base + '/api/status', { headers: { Authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') } });
  assert.equal(bad.status, 401);
  assert.equal((await call('/api/status')).status, 200);
});

test('unsafe or invalid URLs are rejected before any request is made', async () => {
  for (const url of ['http://127.0.0.1', 'http://localhost', 'http://169.254.169.254', 'http://10.0.0.1', 'ftp://example.com', '']) {
    const r = await post('/api/crawls', { url });
    assert.equal(r.status, 400, url);
  }
});

test('cross-site POSTs are blocked and oversized bodies rejected', async () => {
  assert.equal((await post('/api/crawls', { url: START }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/crawls', { method: 'POST', body: JSON.stringify({ url: 'x'.repeat(5000) }) })).status, 413);
});

test('full crawl through the API: progress, filtered lists, details and complete CSV exports', async () => {
  useSite(hub(150, [['/missing', 'Broken']]));
  const start = await post('/api/crawls', { url: START, limit: 500 });
  assert.equal(start.status, 201);
  const { id } = await start.json();
  const p = await waitFor(id, ['done']);
  assert.equal(p.pagesCrawled, 152);          // home + 150 pages + the 404
  assert.equal(p.summary.totals.brokenLinks, 1);
  assert.equal(typeof p.summary.score, 'number');
  assert.ok(p.summary.scoreModel.text.length > 50);

  const page1 = await (await call(`/api/crawls/${id}/pages?limit=100`)).json();
  assert.equal(page1.rows.length, 100);
  assert.equal(page1.total, 152);
  const page2 = await (await call(`/api/crawls/${id}/pages?offset=100&limit=100`)).json();
  assert.equal(page2.rows.length, 52);
  assert.equal((await (await call(`/api/crawls/${id}/pages?status=4xx`)).json()).total, 1);
  assert.equal((await (await call(`/api/crawls/${id}/pages?q=p149`)).json()).total, 1);
  assert.equal((await (await call(`/api/crawls/${id}/links?filter=broken`)).json()).total, 1);
  assert.equal((await (await call(`/api/crawls/${id}/issues?severity=critical`)).json()).rows.every(i => i.severity === 'critical'), true);

  const names = { pages: 153, issues: null, links: 152, 'broken-links': 2, images: 1 };
  for (const [name, count] of Object.entries(names)) {
    const r = await call(`/api/crawls/${id}/export/${name}.csv`);
    assert.equal(r.status, 200, name);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), new RegExp(`attachment; filename="modernise-${name}-`));
    const buf = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], name + ' BOM');   // fetch's .text() would hide the BOM
    const text = buf.toString('utf8');
    const n = text.split('\r\n').filter(Boolean).length;
    if (count) assert.equal(n, count, name + ' rows');
  }
  assert.equal((await call(`/api/crawls/${id}/export/unknown.csv`)).status, 404);
  // Results are on disk, so a different server process (fresh cache) sees the same crawl
  const other = require('../lib/store').createStore(process.env.DATA_DIR).get(id);
  assert.equal(other.progress().pagesCrawled, 152);
  assert.equal(other.analysis().pages.length, 152);
  assert.equal((await call('/api/crawls/' + 'f'.repeat(24))).status, 404);
});

test('one crawl at a time; cancel stops a running crawl', async () => {
  const site = useSite(hub(100), { latency: 30 });
  const { id } = await (await post('/api/crawls', { url: START, limit: 100 })).json();
  assert.equal((await post('/api/crawls', { url: START })).status, 409);
  await new Promise(r => setTimeout(r, 120));
  const c = await (await post(`/api/crawls/${id}/cancel`)).json();
  assert.ok(['cancelling', 'cancelled'].includes(c.status));
  const fin = await waitFor(id, ['cancelled']);
  assert.ok(fin.pagesCrawled < 100);
  const n = site.stats.requests.length;
  await new Promise(r => setTimeout(r, 120));
  assert.equal(site.stats.requests.length, n);
});

test('page limit is clamped to the 1,000 maximum and defaults to 500', async () => {
  useSite({ '/': okPage('/') });
  const a = await (await post('/api/crawls', { url: START, limit: 999999 })).json();
  assert.equal(a.limit, 1000);
  await waitFor(a.id, ['done']);
  const b = await (await post('/api/crawls', { url: START })).json();
  assert.equal(b.limit, 500);
  await waitFor(b.id, ['done']);
});

test('PDF report: branded download, validation, size limit and 409 while a crawl is running', async () => {
  const { assertValidPdf, pdfText, makePng, dataUrl } = require('./pdfhelpers');
  const png = makePng({ w: 30, h: 10, ct: 6, samples: x => [20, 100, 200, x * 8] });
  const pages = hub(4);
  pages['/'] = okPage('/', { links: [['/p0', 'P0'], ['/p1', 'P1']], imgs: [['/i1.png', 'Logo'], ['/i2.png']] });
  pages['/i1.png'] = { type: 'image/png', headers: { 'content-length': String(40 * 1024) } };
  pages['/i2.png'] = { type: 'image/png', headers: { 'content-length': String(900 * 1024) } };
  useSite(pages);
  const { id } = await (await post('/api/crawls', { url: START })).json();
  await waitFor(id, ['done']);

  const r = await post(`/api/crawls/${id}/report`, { company: 'Acme Studio', client: 'Client Ltd', accent: '#0f766e', logoAlign: 'right', logo: dataUrl(png) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="modernise-seo-report-93\.184\.216\.34-\d{4}-\d{2}-\d{2}\.pdf"/);
  const pdf = Buffer.from(await r.arrayBuffer());
  assert.equal(Number(r.headers.get('content-length')), pdf.length);
  const { pages: pageCount } = assertValidPdf(pdf);
  assert.ok(pageCount >= 6);
  const text = pdfText(pdf);
  assert.match(text, /Acme Studio/); assert.match(text, /Client Ltd/); assert.match(text, /Oversized images/);   // the 900 KB image was measured during the crawl

  assert.equal((await post(`/api/crawls/${id}/report`)).status, 200);                                     // no branding at all is fine
  const bad = await post(`/api/crawls/${id}/report`, { logo: 'data:image/png;base64,' + Buffer.from('nope').toString('base64') });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /PNG/);
  assert.equal((await post(`/api/crawls/${id}/report`, { logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status, 400);
  const big = await call(`/api/crawls/${id}/report`, { method: 'POST', body: JSON.stringify({ logo: 'data:image/png;base64,' + 'A'.repeat(2.8e6) }) });
  assert.equal(big.status, 413);                                                                        // only this route accepts a large body, and only up to the limit
  assert.equal((await post(`/api/crawls/${'e'.repeat(24)}/report`)).status, 404);
  assert.equal((await post('/api/crawls', { url: START, limit: 'x'.repeat(3000) })).status, 413);      // other routes keep the small limit
  assert.equal((await post(`/api/crawls/${id}/report`, { logo: dataUrl(png) }, { Origin: 'https://evil.example' })).status, 403);

  // the image export now carries file size and status
  const csv = await (await call(`/api/crawls/${id}/export/images.csv`)).text();
  assert.match(csv.split('\r\n')[0], /File Size \(KB\),Image HTTP Status/);
  assert.match(csv, /i2\.png,.*,900,200/);
});

test('a report cannot be requested while the crawl is still running', async () => {
  useSite(hub(60), { latency: 30 });
  const { id } = await (await post('/api/crawls', { url: START, limit: 60 })).json();
  const r = await post(`/api/crawls/${id}/report`, {});
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /still running/);
  await post(`/api/crawls/${id}/cancel`);
  await waitFor(id, ['cancelled']);
  assert.equal((await post(`/api/crawls/${id}/report`, {})).status, 200);                               // a stopped crawl can still be reported (partial)
});

test('diagnostics endpoint needs login and reports what the server sees', async () => {
  const anon = await fetch(base + '/api/diagnostics');
  assert.equal(anon.status, 401);
  const r = await call('/api/diagnostics');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.dataDirWritable, true);
  assert.match(j.node, /^v\d+/);
  assert.ok(Array.isArray(j.savedCrawls));
});

test('history lists finished audits; page details can be fetched for an issue; removing works', async () => {
  const pages = hub(3);
  pages['/'] = okPage('/', { links: [['/p0', 'P0']] });
  pages['/p0'] = { status: 200, html: '<html><head></head><body>no title</body></html>' };
  useSite(pages);
  const { id } = await (await post('/api/crawls', { url: START })).json();
  await waitFor(id, ['done']);

  assert.equal((await fetch(base + '/api/history')).status, 401);
  const h = await (await call('/api/history')).json();
  const item = h.items.find(i => i.id === id);
  assert.ok(item, 'the audit is in the history');
  assert.equal(item.available, true); assert.equal(item.status, 'done'); assert.equal(typeof item.score, 'number');
  assert.ok(item.pages >= 2); assert.ok(item.counts.critical >= 1);
  assert.ok(h.keepsResultsFor > 0 && h.keepsLast >= 1);

  const issue = (await (await call(`/api/crawls/${id}/issues?type=missing_title`)).json()).rows[0];
  assert.ok(issue, 'a missing-title issue exists');
  const pg = await call(`/api/crawls/${id}/page?url=${encodeURIComponent(issue.url)}`);
  assert.equal(pg.status, 200);
  const page = await pg.json();
  assert.equal(page.url, issue.url); assert.ok(page.issues.some(i => i.type === 'missing_title'));
  assert.equal((await call(`/api/crawls/${id}/page?url=${encodeURIComponent('https://elsewhere.example/')}`)).status, 404);
  assert.equal((await call(`/api/crawls/${id}/page`)).status, 404);

  assert.equal((await post('/api/history/not-an-id/delete')).status, 409);
  assert.equal((await post(`/api/history/${id}/delete`, {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(`/api/history/${id}/delete`)).status, 200);
  assert.equal((await call(`/api/crawls/${id}`)).status, 404);           // saved results removed
  assert.equal((await (await call('/api/history')).json()).items.some(i => i.id === id), false);
});
