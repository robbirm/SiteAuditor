'use strict';
// End-to-end over a fixture "messy" website: crawl -> analysis -> CSV, with no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Crawl } = require('../lib/crawler');
const { parseUserUrl } = require('../lib/safeUrl');
const { exportCsv } = require('../lib/csv');
const { BASE, html, okPage, fakeSite } = require('./fixtures');

const dupe = { title: 'Shared duplicate title text', desc: 'Shared duplicate description text' };
const pages = {
  '/robots.txt': { status: 200, type: 'text/plain', html: 'User-agent: *\nDisallow: /private\n' },
  '/': okPage('/', { links: ['/about', '/dup1', '/dup2', '/gone', '/old1', '/loopA', '/canon-other', '/canon-bad', '/noindex', '/noh1', '/multih1', '/images', '/notitle', '/private', '/file.pdf'].map(p => [p, p]) }),
  '/about': okPage('/about'),
  '/dup1': { status: 200, html: html({ ...dupe, canonical: BASE + '/dup1' }) },
  '/dup2': { status: 200, html: html({ ...dupe, canonical: BASE + '/dup2' }) },
  '/old1': { status: 301, location: '/old2' }, '/old2': { status: 301, location: '/new' }, '/new': okPage('/new'),
  '/loopA': { status: 302, location: '/loopB' }, '/loopB': { status: 302, location: '/loopA' },
  '/canon-other': okPage('/canon-other', { canonical: BASE + '/about' }),
  '/canon-bad': okPage('/canon-bad', { canonical: BASE + '/gone' }),
  '/noindex': okPage('/noindex', { robots: 'noindex, follow' }),
  '/noh1': okPage('/noh1', { h1: [] }), '/multih1': okPage('/multih1', { h1: ['One', 'Two'] }),
  '/images': okPage('/images', { imgs: [['/img/a.png', 'A cat'], ['/img/b.png'], ['/img/c.png', '']] }),
  '/notitle': { status: 200, html: html({ title: null, desc: null, canonical: BASE + '/notitle' }) },
  '/private': okPage('/private')
};

test('messy site: every issue type is detected on the right URL with the right severity', async () => {
  const site = fakeSite(pages);
  const c = new Crawl('s1', parseUserUrl(BASE + '/'), 100, { fetchUrl: site.fetchUrl, fetchFollow: site.fetchFollow, delayMs: 0 });
  await c.run();
  const a = c.analysis(true);
  const t = p => a.pages.find(x => x.url === BASE + p).issues.map(i => i.type).sort();

  assert.deepEqual(t('/'), ['broken_internal_link']);
  assert.deepEqual(t('/gone'), ['page_404']);
  assert.deepEqual(t('/about'), []);
  assert.deepEqual(t('/new'), []);
  assert.deepEqual(t('/dup1'), ['duplicate_meta_description', 'duplicate_title']);
  assert.deepEqual(t('/dup2'), ['duplicate_meta_description', 'duplicate_title']);
  assert.deepEqual(t('/old1'), ['redirect_chain']);
  assert.deepEqual(t('/old2'), ['redirect']);
  assert.deepEqual(t('/loopA'), ['redirect_loop']);
  assert.deepEqual(t('/loopB'), ['redirect_loop']);
  assert.deepEqual(t('/canon-other'), ['canonical_other']);
  assert.deepEqual(t('/canon-bad'), ['canonical_non_200', 'canonical_other']);
  assert.deepEqual(t('/noindex'), ['noindex']);
  assert.deepEqual(t('/noh1'), ['missing_h1']);
  assert.deepEqual(t('/multih1'), ['multiple_h1']);
  assert.deepEqual(t('/images'), ['images_missing_alt']);
  assert.deepEqual(t('/notitle'), ['missing_meta_description', 'missing_title']);
  assert.deepEqual(t('/private'), ['blocked_robots']);
  assert.equal(site.pageRequests().some(u => u.endsWith('/private')), false);
  assert.equal(site.pageRequests().some(u => u.endsWith('.pdf')), false);

  const sev = type => a.issues.find(i => i.type === type).severity;
  assert.equal(sev('page_404'), 'critical');
  assert.equal(sev('missing_title'), 'critical');
  assert.equal(sev('duplicate_title'), 'warning');
  assert.equal(sev('noindex'), 'warning');
  assert.equal(sev('redirect'), 'info');
  assert.equal(a.summary.totals.brokenLinks, 1);
  assert.equal(a.images.filter(i => i.altStatus === 'Missing').length, 1);

  // Independent recomputation of the documented score
  const W = { critical: 25, warning: 10, info: 2 };
  const scores = a.pages.filter(p => !p.blocked).map(p => (p.failed || p.status >= 400) ? 0 : Math.max(0, 100 - p.issues.reduce((s, i) => s + W[i.severity], 0)));
  assert.equal(a.summary.score, Math.round(scores.reduce((x, y) => x + y, 0) / scores.length));

  // CSV exports include every crawled URL, issue, link and image
  const lines = csv => csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.equal(lines(exportCsv('pages', a)).length, 1 + c.results.length);
  assert.equal(lines(exportCsv('issues', a)).length, 1 + a.issues.length);
  assert.equal(lines(exportCsv('links', a)).length, 1 + c.links.length);
  assert.equal(lines(exportCsv('broken-links', a)).length, 2);
  assert.equal(lines(exportCsv('images', a)).length, 1 + c.images.length);
});
