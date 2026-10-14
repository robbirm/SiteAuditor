'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Crawl } = require('../lib/crawler');
const { parseUserUrl } = require('../lib/safeUrl');
const { BASE, html, okPage, fakeSite } = require('./fixtures');

const mk = (site, limit, opts = {}) =>
  new Crawl('t1', parseUserUrl(BASE + '/'), limit, { fetchUrl: site.fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0, ...opts });
const hub = n => { const p = { '/': okPage('/', { links: Array.from({ length: n }, (_, i) => ['/p' + i, 'Page ' + i]) }) }; for (let i = 0; i < n; i++) p['/p' + i] = okPage('/p' + i); return p; };
const paths = site => site.pageRequests().map(u => new URL(u).pathname).sort();
const robots = txt => ({ '/robots.txt': { status: 200, type: 'text/plain', html: txt } });

test('discovers internal links by following them; skips external, mailto, anchors and non-HTML files', async () => {
  const site = fakeSite({
    '/': okPage('/', { links: [['/a', 'A'], ['https://other.example.org/x', 'Ext'], ['/file.pdf', 'PDF'], ['mailto:a@b.co', 'Mail'], ['#top', 'Top'], ['/a#section', 'A again'], ['https://www.site.example.com/w', 'WWW']] }),
    '/a': okPage('/a', { links: [['/b', 'B'], ['/', 'Home']] }), '/b': okPage('/b'), '/w': okPage('/w')
  });
  const c = mk(site, 100);
  await c.run();
  assert.equal(c.status, 'done');
  assert.deepEqual(paths(site), ['/', '/a', '/b', '/w']);
  assert.equal(c.completed, 4);
  assert.ok(c.links.some(l => l.destination === 'https://other.example.org/x' && l.internal === false));
  assert.equal(c.links.filter(l => l.destination === BASE + '/a').length, 1);   // /a and /a#section de-duplicated
  assert.equal(c.results.find(r => r.url === BASE + '/a').discoveredFrom, BASE + '/');
});

test('extracts title, description, H1s, canonical, robots, redirect target and response time', async () => {
  const site = fakeSite({
    '/': { status: 200, html: html({ title: ' My  Title ', desc: 'My description', h1: ['One', 'Two'], canonical: '/canon', robots: 'noindex', links: [['/old', 'old']] }) },
    '/old': { status: 301, location: '/new' }, '/new': okPage('/new')
  });
  const c = mk(site, 10);
  await c.run();
  const home = c.results.find(r => r.url === BASE + '/');
  assert.equal(home.title, 'My Title');
  assert.equal(home.metaDescription, 'My description');
  assert.deepEqual(home.h1, ['One', 'Two']);
  assert.equal(home.canonical, BASE + '/canon');
  assert.equal(home.metaRobots, 'noindex');
  assert.equal(home.responseMs, 5);
  const old = c.results.find(r => r.url === BASE + '/old');
  assert.equal(old.status, 301);
  assert.equal(old.redirectTo, BASE + '/new');
  assert.ok(c.results.some(r => r.url === BASE + '/new'));   // redirect targets are crawled too
});

test('page limit is respected', async () => {
  const site = fakeSite(hub(60));
  const c = mk(site, 10);
  await c.run();
  assert.equal(c.status, 'done');
  assert.equal(c.completed, 10);
  assert.equal(site.pageRequests().length, 10);
  assert.ok(c.notes.some(n => /page limit/.test(n)));
});

test('never more than 2 simultaneous requests', async () => {
  const site = fakeSite(hub(30), { latency: 15 });
  const c = mk(site, 40);
  await c.run();
  assert.equal(c.completed, 31);
  assert.ok(site.stats.maxActive >= 1 && site.stats.maxActive <= 2, 'maxActive=' + site.stats.maxActive);
  assert.ok(c.maxActive <= 2);
});

test('cancellation stops the crawl and no further requests are made', async () => {
  const site = fakeSite(hub(100), { latency: 40 });
  const c = mk(site, 100);
  const done = c.run();
  await new Promise(r => setTimeout(r, 150));
  c.cancel();
  assert.equal(c.status, 'cancelling');
  await done;
  assert.equal(c.status, 'cancelled');
  assert.ok(c.completed < 100 && c.completed >= 1, 'completed=' + c.completed);
  const n = site.stats.requests.length;
  await new Promise(r => setTimeout(r, 150));
  assert.equal(site.stats.requests.length, n);
});

test('robots.txt Disallow rules are respected and blocked URLs are never fetched', async () => {
  const site = fakeSite({ ...robots('User-agent: *\nDisallow: /private\n'),
    '/': okPage('/', { links: [['/private/a', 'p'], ['/public', 'q']] }), '/private/a': okPage('/private/a'), '/public': okPage('/public') });
  const c = mk(site, 10);
  await c.run();
  assert.deepEqual(paths(site), ['/', '/public']);
  const blocked = c.results.find(r => r.url === BASE + '/private/a');
  assert.equal(blocked.blocked, true);
  assert.equal(c.blocked, 1);
  assert.equal(c.completed, 2);
});

test('robots.txt server error means the site is not crawled; a missing robots.txt means allowed', async () => {
  const bad = fakeSite({ '/robots.txt': { status: 503 }, '/': okPage('/') });
  const c1 = mk(bad, 10);
  await c1.run();
  assert.equal(bad.pageRequests().length, 0);
  assert.ok(c1.notes.some(n => /robots\.txt returned HTTP 503/.test(n)));
  const none = fakeSite({ '/': okPage('/') });
  const c2 = mk(none, 10);
  await c2.run();
  assert.equal(c2.completed, 1);
});

test('request failures are recorded, not fatal', async () => {
  const site = fakeSite({ '/': okPage('/', { links: [['/boom', 'x'], ['/fine', 'y']] }), '/fine': okPage('/fine'), '/boom': okPage('/boom') });
  const real = site.fetchUrl;
  site.fetchUrl = async (u, o) => { if (u.endsWith('/boom')) throw new Error('Timed out'); return real(u, o); };
  const c = mk(site, 10);
  await c.run();
  assert.equal(c.status, 'done');
  const boom = c.results.find(r => r.url === BASE + '/boom');
  assert.equal(boom.status, 0);
  assert.equal(boom.note, 'Timed out');
  assert.ok(c.analysis(true).issues.some(i => i.type === 'request_failed' && i.url === BASE + '/boom'));
});
