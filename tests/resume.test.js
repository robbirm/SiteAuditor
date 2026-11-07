'use strict';
// A crawl survives its server process stopping: the queue is saved with the results, and another process carries it on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Crawl } = require('../lib/crawler');
const { createStore, STALE_MS } = require('../lib/store');
const { parseUserUrl } = require('../lib/safeUrl');
const { BASE, okPage, fakeSite } = require('./fixtures');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'msa-resume-'));
const ID = 'b'.repeat(24);
const hub = n => { const p = { '/': okPage('/', { links: Array.from({ length: n }, (_, i) => ['/p' + i, 'Page ' + i]), imgs: [['/a.png', 'A'], ['/b.png', 'B']] }) }; for (let i = 0; i < n; i++) p['/p' + i] = okPage('/p' + i, { links: [['/deep' + i, 'D']] }); for (let i = 0; i < n; i++) p['/deep' + i] = okPage('/deep' + i); p['/a.png'] = { type: 'image/png', headers: { 'content-length': '100' } }; p['/b.png'] = { type: 'image/png', headers: { 'content-length': '200' } }; return p; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await wait(10); } };

function resumeIn(dir, site) {                         // what server.js resumeStalled does, in a "new process"
  const s = createStore(dir);
  const m = s.stalled().find(x => x.id === ID);
  assert.ok(m, 'crawl is offered for resuming');
  const claim = s.claim(ID);
  assert.ok(claim > 0);
  assert.equal(createStore(dir).claim(ID) > claim, true);   // a second claimer gets a later number...
  const saved = s.loadForResume(ID);
  const c = Crawl.restore(ID, saved.meta, saved.state, saved.data, { fetchUrl: site.fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0, store: s });
  c.claim = claim + 1;                                     // ...so use that one (the first is superseded)
  return { s, c };
}

test('a crawl paused mid-way (server shutting down) is carried on by another process and finishes every page once', async () => {
  const dir = tmp(), site = fakeSite(hub(30), { latency: 8 });
  const a = new Crawl(ID, parseUserUrl(BASE + '/'), 1000, { fetchUrl: site.fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0, store: createStore(dir) });
  const run = a.run();
  await until(() => a.completed >= 15);
  assert.equal(a.pause(), true);
  await run;
  const done = a.completed;
  assert.ok(done < 61);

  const v = createStore(dir).get(ID);
  assert.equal(v.meta.status, 'running');                 // not "failed": it is waiting to be carried on
  assert.equal(v.meta.stalled, true);

  const { s, c } = resumeIn(dir, site);
  await c.run();
  assert.equal(c.status, 'done');
  const final = s.get(ID);
  assert.equal(final.meta.status, 'done');
  const urls = final.analysis().pages.map(p => p.url);
  assert.equal(urls.length, 61);                          // / + 30 + 30 deep pages
  assert.equal(new Set(urls).size, 61);                   // nothing crawled twice
  assert.equal(final.analysis().summary.totals.images, 2);
  assert.ok(final.meta.notes.some(n => /carried on/.test(n)));
  assert.equal(s.stalled().length, 0);
});

test('a crawl whose process died without warning is resumed from the last save', async () => {
  const dir = tmp(), site = fakeSite(hub(40), { latency: 50 });
  const a = new Crawl(ID, parseUserUrl(BASE + '/'), 1000, { fetchUrl: site.fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0, store: createStore(dir) });
  const run = a.run();
  await until(() => a._stateAt && a.completed >= 10);     // at least one periodic save has happened
  await wait(30);
  a.superseded = true; clearInterval(a._tick); a.controller.abort(); await run;   // "killed": nothing more is written
  const f = path.join(dir, ID, 'meta.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(m.status, 'running');
  m.heartbeat = Date.now() - STALE_MS - 1000; fs.writeFileSync(f, JSON.stringify(m));

  const { s, c } = resumeIn(dir, site);
  await c.run();
  const urls = s.get(ID).analysis().pages.map(p => p.url);
  assert.equal(urls.length, 81);
  assert.equal(new Set(urls).size, 81);
});

test('the old process stops writing once another process has taken the crawl over', async () => {
  const dir = tmp(), site = fakeSite(hub(40), { latency: 50 });
  const s = createStore(dir);
  const a = new Crawl(ID, parseUserUrl(BASE + '/'), 1000, { fetchUrl: site.fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0, store: s });
  const run = a.run();
  await until(() => a.completed >= 5);
  assert.equal(s.superseded(a), false);
  assert.ok(s.claim(ID) > 0);                              // someone else claims it
  await run;                                              // the tick notices within a second and stops quietly
  assert.equal(a.superseded, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ID, 'meta.json'), 'utf8')).status, 'running');
});

test('a crawl that cannot be carried on is still reported as interrupted', () => {
  const dir = tmp(), s = createStore(dir);
  const c = new Crawl(ID, parseUserUrl(BASE + '/'), 10, { store: s });
  c.status = 'running'; c.startedAt = Date.now();
  s.init(c);
  fs.rmSync(path.join(dir, ID, 'state.json'), { force: true });   // e.g. started by an older version
  const f = path.join(dir, ID, 'meta.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8')); m.heartbeat = Date.now() - STALE_MS - 1000; fs.writeFileSync(f, JSON.stringify(m));
  const v = createStore(dir).get(ID);
  assert.equal(v.meta.status, 'error');
  assert.equal(v.meta.interrupted, true);
});

test('a page that times out is tried again; a page that keeps failing does not stop the audit', async () => {
  const pages = { '/': okPage('/', { links: [['/flaky', 'F'], ['/dead', 'D'], ['/busy', 'B'], ['/ok', 'O']] }), '/flaky': okPage('/flaky'), '/ok': okPage('/ok'), '/busy': okPage('/busy') };
  const site = fakeSite(pages);
  const tries = {};
  const fetchUrl = async (url, o) => {
    const p = new URL(url).pathname;
    tries[p] = (tries[p] || 0) + 1;
    if (p === '/flaky' && tries[p] === 1) throw new Error('Timed out');
    if (p === '/dead') throw new Error('Timed out');
    if (p === '/busy' && tries[p] === 1) return { status: 503, headers: {}, contentType: 'text/html', responseMs: 1, body: null };
    return site.fetchUrl(url, o);
  };
  const c = new Crawl('t', parseUserUrl(BASE + '/'), 100, { fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0, retryDelayMs: 5 });
  await c.run();
  assert.equal(c.status, 'done');
  const by = p => c.results.find(r => r.url === BASE + p);
  assert.equal(by('/flaky').status, 200);
  assert.equal(by('/busy').status, 200);
  assert.equal(by('/dead').status, 0);
  assert.equal(tries['/dead'], 2);
  assert.equal(by('/ok').status, 200);
});

test('an unexpected error while auditing one page is recorded on that page and the audit carries on', async () => {
  const site = fakeSite({ '/': okPage('/', { links: [['/bad', 'B'], ['/ok', 'O']] }), '/bad': okPage('/bad'), '/ok': okPage('/ok') });
  const c = new Crawl('t', parseUserUrl(BASE + '/'), 100, { fetchUrl: site.fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0 });
  const fill = c.fill.bind(c);
  c.fill = (row, r, u) => { if (u.pathname === '/bad') throw new Error('boom'); return fill(row, r, u); };
  // fill errors are caught inside processUrl already; make processUrl itself throw for /bad to test the worker guard
  const pu = c.processUrl.bind(c);
  c.processUrl = href => (href.endsWith('/bad') ? Promise.reject(new Error('kaboom')) : pu(href));
  await c.run();
  assert.equal(c.status, 'done');
  assert.match(c.results.find(r => r.url === BASE + '/bad').note, /kaboom/);
  assert.equal(c.results.find(r => r.url === BASE + '/ok').status, 200);
});
