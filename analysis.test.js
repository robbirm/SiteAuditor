'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../lib/analysis');
const { row } = require('./fixtures');

const U = p => 'https://x.example.com' + p;
const typesOf = (a, url) => a.pages.find(p => p.url === url).issues.map(i => i.type).sort();
const sevOf = (a, type) => a.issues.find(i => i.type === type).severity;

test('missing and duplicate titles / meta descriptions', () => {
  const a = analyze([
    row(U('/1'), { title: '' }),
    row(U('/2'), { title: 'Same Title', metaDescription: '' }),
    row(U('/3'), { title: 'same title', metaDescription: 'Shared description' }),
    row(U('/4'), { metaDescription: 'shared description' })
  ]);
  assert.ok(typesOf(a, U('/1')).includes('missing_title'));
  assert.ok(typesOf(a, U('/2')).includes('duplicate_title') && typesOf(a, U('/2')).includes('missing_meta_description'));
  assert.ok(typesOf(a, U('/3')).includes('duplicate_title') && typesOf(a, U('/3')).includes('duplicate_meta_description'));
  assert.ok(typesOf(a, U('/4')).includes('duplicate_meta_description'));
  assert.ok(!typesOf(a, U('/4')).includes('duplicate_title'));
});

test('missing and multiple H1', () => {
  const a = analyze([row(U('/a'), { h1: [], h1Count: 0 }), row(U('/b'), { h1: ['One', 'Two'], h1Count: 2 }), row(U('/c'))]);
  assert.deepEqual(typesOf(a, U('/a')), ['missing_h1']);
  assert.deepEqual(typesOf(a, U('/b')), ['multiple_h1']);
  assert.deepEqual(typesOf(a, U('/c')), []);
});

test('broken internal links (404 and 500) are reported on the source page and in the link table', () => {
  const a = analyze(
    [row(U('/'), {}), row(U('/gone'), { status: 404, parsed: false }), row(U('/err'), { status: 500, parsed: false }), row(U('/ok'))],
    [{ source: U('/'), destination: U('/gone'), anchor: 'Gone', internal: true },
      { source: U('/'), destination: U('/err'), anchor: 'Err', internal: true },
      { source: U('/'), destination: U('/ok'), anchor: 'Ok', internal: true },
      { source: U('/'), destination: 'https://other.example.org/', anchor: 'Ext', internal: false }]);
  assert.equal(a.summary.totals.brokenLinks, 2);
  assert.deepEqual(a.links.filter(l => l.broken).map(l => l.statusText).sort(), ['404', '500']);
  assert.ok(typesOf(a, U('/')).includes('broken_internal_link'));
  assert.equal(a.links.find(l => l.type === 'External').statusText, 'Not checked');
  assert.deepEqual(typesOf(a, U('/gone')), ['page_404']);
  assert.deepEqual(typesOf(a, U('/err')), ['page_5xx']);
});

test('redirects, redirect chains, loops and redirects to errors', () => {
  const a = analyze([
    row(U('/r1'), { status: 301, parsed: false, redirectTo: U('/ok') }),
    row(U('/c1'), { status: 301, parsed: false, redirectTo: U('/c2') }),
    row(U('/c2'), { status: 302, parsed: false, redirectTo: U('/ok') }),
    row(U('/l1'), { status: 302, parsed: false, redirectTo: U('/l2') }),
    row(U('/l2'), { status: 302, parsed: false, redirectTo: U('/l1') }),
    row(U('/e1'), { status: 301, parsed: false, redirectTo: U('/missing') }),
    row(U('/missing'), { status: 404, parsed: false }),
    row(U('/ok'))
  ]);
  assert.deepEqual(typesOf(a, U('/r1')), ['redirect']);
  assert.deepEqual(typesOf(a, U('/c1')), ['redirect_chain']);
  assert.equal(a.pages.find(p => p.url === U('/c1')).redirectHops, 2);
  assert.equal(a.pages.find(p => p.url === U('/c1')).finalUrl, U('/ok'));
  assert.deepEqual(typesOf(a, U('/l1')), ['redirect_loop']);
  assert.deepEqual(typesOf(a, U('/e1')), ['redirect_to_error']);
  assert.equal(sevOf(a, 'redirect'), 'info');
  assert.equal(sevOf(a, 'redirect_chain'), 'warning');
  assert.equal(sevOf(a, 'redirect_loop'), 'critical');
});

test('canonical and noindex checks', () => {
  const a = analyze([
    row(U('/none'), { canonical: '' }),
    row(U('/other'), { canonical: U('/ok') }),
    row(U('/bad'), { canonical: U('/missing') }),
    row(U('/slash'), { canonical: U('/slash/') }),
    row(U('/meta'), { metaRobots: 'NoIndex, follow' }),
    row(U('/header'), { xRobots: 'noindex' }),
    row(U('/ok')), row(U('/missing'), { status: 404, parsed: false })
  ]);
  assert.deepEqual(typesOf(a, U('/none')), ['missing_canonical']);
  assert.deepEqual(typesOf(a, U('/other')), ['canonical_other']);
  assert.deepEqual(typesOf(a, U('/bad')), ['canonical_non_200', 'canonical_other']);
  assert.deepEqual(typesOf(a, U('/slash')), []);
  assert.deepEqual(typesOf(a, U('/meta')), ['noindex']);
  assert.deepEqual(typesOf(a, U('/header')), ['noindex']);
});

test('images without ALT are flagged; empty ALT is treated as decorative', () => {
  const a = analyze([row(U('/p'))], [], [
    { page: U('/p'), src: U('/a.png'), alt: 'A cat' }, { page: U('/p'), src: U('/b.png'), alt: null }, { page: U('/p'), src: U('/c.png'), alt: '' }]);
  assert.deepEqual(a.images.map(i => i.altStatus), ['Present', 'Missing', 'Empty']);
  assert.deepEqual(typesOf(a, U('/p')), ['images_missing_alt']);
});

test('issues are grouped Critical / Warning / Info and sorted by severity', () => {
  const a = analyze([row(U('/a'), { title: '', canonical: '' }), row(U('/b'), { h1: [], h1Count: 0 }), row(U('/c'), { status: 301, parsed: false, redirectTo: U('/a') })]);
  assert.deepEqual(a.summary.counts, { critical: 1, warning: 1, info: 2 });
  const order = a.issues.map(i => i.severity);
  assert.deepEqual(order, [...order].sort((x, y) => ({ critical: 0, warning: 1, info: 2 })[x] - ({ critical: 0, warning: 1, info: 2 })[y]));
  for (const i of a.issues) assert.ok(i.fix && i.label);
});

test('health score: documented calculation', () => {
  // Page A is perfect (100). B has a missing title (-25) and missing meta description (-10) = 65.
  // C returns 404 = 0. D is blocked by robots.txt and is excluded. Average of 100, 65, 0 = 55.
  const a = analyze([
    row(U('/a')), row(U('/b'), { title: '', metaDescription: '' }),
    row(U('/c'), { status: 404, parsed: false }), row(U('/d'), { status: 0, parsed: false, blocked: true })
  ]);
  assert.deepEqual(a.pages.map(p => p.score), [100, 65, 0, null]);
  assert.equal(a.summary.score, 55);
  const b = analyze([row(U('/1')), row(U('/2')), row(U('/3'), { title: '' })]); // 100, 100, 75 -> 91.67
  assert.equal(b.summary.score, 92);
  assert.equal(analyze([]).summary.score, null);
  assert.match(a.summary.scoreModel.text, /25 points \(Critical\), 10 points \(Warning\) or 2 points \(Info\)/);
});

test('failed requests are critical and score 0', () => {
  const a = analyze([row(U('/t'), { status: 0, parsed: false, note: 'Timed out' })]);
  assert.deepEqual(typesOf(a, U('/t')), ['request_failed']);
  assert.equal(a.summary.score, 0);
});
