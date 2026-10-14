'use strict';
process.env.NODE_ENV = 'test';
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
    const text = await r.text();
    assert.ok(text.startsWith('\uFEFF'));
    const n = text.split('\r\n').filter(Boolean).length;
    if (count) assert.equal(n, count, name + ' rows');
  }
  assert.equal((await call(`/api/crawls/${id}/export/unknown.csv`)).status, 404);
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
