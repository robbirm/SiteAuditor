'use strict';
// Simulates "another server process": a second store instance on the same folder with an empty cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createStore, STALE_MS } = require('../lib/store');
const { row } = require('./fixtures');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'msa-store-'));
const ID = n => String(n).padStart(24, 'a');
const U = p => 'https://x.example.com' + p;
function fakeCrawl(id, status = 'running') {
  return { id, status, results: [], links: [], images: [], finishedAt: null, startedAt: Date.now(),
    meta() { return { id, status: this.status, startUrl: U('/'), site: 'x.example.com', limit: 100, pagesCrawled: this.results.length, queued: 0, discovered: this.results.length, blockedByRobots: 0, percent: 50, notes: [], message: '', startedAt: this.startedAt, finishedAt: this.finishedAt }; } };
}

test('a second process can read progress and results written by the crawling process', () => {
  const dir = tmp(), writer = createStore(dir), reader = createStore(dir);
  const c = fakeCrawl(ID(1));
  writer.init(c);
  assert.equal(reader.get(ID(1)).meta.status, 'running');            // visible immediately after creation
  c.results.push(row(U('/a')), row(U('/b'), { title: '' }));
  c.links.push({ source: U('/a'), destination: U('/b'), anchor: 'B', internal: true });
  writer.flush(c);
  let v = reader.get(ID(1));
  assert.equal(v.progress().pagesCrawled, 2);
  assert.equal(v.analysis().summary.totals.pages, 2);
  assert.equal(v.analysis().summary.totals.links, 1);
  c.results.push(row(U('/c')));
  c.status = 'done'; c.finishedAt = Date.now();
  writer.flush(c);
  v = reader.get(ID(1));                                               // incremental: only new lines are read
  assert.equal(v.meta.status, 'done');
  assert.equal(v.analysis().summary.totals.pages, 3);
});

test('a half-written line is ignored until it is complete', () => {
  const dir = tmp(), s = createStore(dir), c = fakeCrawl(ID(2));
  s.init(c);
  c.results.push(row(U('/a')));
  s.flush(c);
  const file = path.join(dir, ID(2), 'results.jsonl');
  fs.appendFileSync(file, '{"url":"https://x.example.com/partial","sta');
  assert.equal(createStore(dir).get(ID(2)).analysis().summary.totals.pages, 1);
  fs.appendFileSync(file, 'tus":200,"parsed":false,"blocked":false,"h1":[]}\n');
  assert.equal(createStore(dir).get(ID(2)).analysis().summary.totals.pages, 2);
});

test('cancel requests are visible to the process that runs the crawl', () => {
  const dir = tmp(), a = createStore(dir), b = createStore(dir), c = fakeCrawl(ID(3));
  a.init(c);
  assert.equal(a.cancelRequested(ID(3)), false);
  b.requestCancel(ID(3));
  assert.equal(a.cancelRequested(ID(3)), true);
});

test('a crawl whose process died is reported as interrupted and no longer blocks new crawls', () => {
  const dir = tmp(), s = createStore(dir), c = fakeCrawl(ID(4));
  s.init(c);
  assert.equal(s.isBusy(), true);
  const f = path.join(dir, ID(4), 'meta.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  m.heartbeat = Date.now() - STALE_MS - 5000;
  fs.writeFileSync(f, JSON.stringify(m));
  const v = createStore(dir).get(ID(4));
  assert.equal(v.meta.status, 'error');
  assert.equal(v.meta.interrupted, true);
  assert.match(v.progress().message, /interrupted/);
  assert.equal(createStore(dir).isBusy(), false);
});

test('old and surplus finished crawls are removed; running ones never are', () => {
  const dir = tmp(), s = createStore(dir);
  const make = (n, status, age) => { const c = fakeCrawl(ID(n), status); c.finishedAt = status === 'done' ? Date.now() - age : null; s.init(c); c.finishedAt = status === 'done' ? Date.now() - age : null; s.flush(c); };
  make(10, 'done', 5 * 3600e3);   // older than the 2 h TTL
  make(11, 'done', 3000);
  make(12, 'done', 2000);
  make(13, 'done', 1000);
  make(14, 'running', 0);
  assert.equal(s.evict(2 * 3600e3, 2), 2);                      // the expired one + the oldest surplus one
  const left = s.list().map(m => m.id).sort();
  assert.deepEqual(left, [ID(12), ID(13), ID(14)]);
});

test('ids are validated: no path traversal, unknown ids return null', () => {
  const s = createStore(tmp());
  for (const id of ['../etc', '..', 'abc', ID(99), '', null, undefined, 'a'.repeat(24) + '/x']) assert.equal(s.get(id), null);
});
