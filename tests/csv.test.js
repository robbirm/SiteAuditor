'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../lib/analysis');
const { exportCsv, cell } = require('../lib/csv');
const { queryList } = require('../lib/lists');
const { row } = require('./fixtures');

const U = p => 'https://x.example.com' + p;
const lines = csv => csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);

function bigAnalysis(n) {
  const results = [], links = [], images = [];
  for (let i = 0; i < n; i++) {
    results.push(row(U('/p' + i), { title: i === 0 ? '=HYPERLINK("http://evil","x")' : 'Title ' + i }));
    links.push({ source: U('/p' + i), destination: U(i % 2 ? '/gone' : '/p0'), anchor: i === 1 ? '+cmd|calc' : 'link ' + i, internal: true });
    images.push({ page: U('/p' + i), src: U('/i' + i + '.png'), alt: i % 3 === 0 ? null : 'alt ' + i });
  }
  results.push(row(U('/gone'), { status: 404, parsed: false }));
  results.push(row(U('/blocked'), { status: 0, parsed: false, blocked: true, note: 'Blocked by robots.txt' }));
  return analyze(results, links, images);
}

test('exports contain ALL records, not just a table page', () => {
  const a = bigAnalysis(1500);
  assert.equal(lines(exportCsv('pages', a)).length, 1 + 1500 + 2);      // every URL incl. 404 and blocked
  assert.equal(lines(exportCsv('links', a)).length, 1 + 1500);
  assert.equal(lines(exportCsv('images', a)).length, 1 + 1500);
  assert.equal(lines(exportCsv('broken-links', a)).length, 1 + 750);     // only links to /gone
  assert.equal(lines(exportCsv('issues', a)).length, 1 + a.issues.length);
  assert.ok(queryList('pages', a, { limit: 100 }).rows.length === 100 && queryList('pages', a, {}).total === 1502);
});

test('column headers match the requested fields', () => {
  const a = bigAnalysis(3);
  assert.equal(lines(exportCsv('issues', a))[0], 'Severity,Issue Type,Issue Code,Affected URL,Detail,Suggested Fix');
  assert.equal(lines(exportCsv('broken-links', a))[0], 'Source URL,Broken Destination URL,Anchor Text,Status Code,Status');
  assert.equal(lines(exportCsv('images', a))[0], 'Image URL,Source Page URL,ALT Status,ALT Text');
  assert.equal(lines(exportCsv('links', a))[0], 'Source URL,Destination URL,Anchor Text,Link Type,Status Code,Status');
  const pagesHeader = lines(exportCsv('pages', a))[0];
  for (const h of ['URL', 'Status Code', 'Title', 'Meta Description', 'H1 Headings', 'Canonical URL', 'Response Time (ms)', 'Issues']) assert.ok(pagesHeader.split(',').includes(h), h);
  assert.equal(exportCsv('nope', a), null);
});

test('Excel: UTF-8 BOM, CRLF, quoting, and formula injection is neutralised', () => {
  const a = bigAnalysis(3);
  const csv = exportCsv('pages', a);
  assert.ok(csv.startsWith('\uFEFFURL,'));
  assert.ok(csv.includes('\r\n') && !/[^\r]\n/.test(csv.replace(/"[^"]*"/g, '')));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`));
  assert.ok(exportCsv('links', a).includes("'+cmd|calc"));
  assert.equal(cell('=1+1'), "'=1+1");
  assert.equal(cell('-5 off'), "'-5 off");
  assert.equal(cell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(cell('\t=1'), "'\t=1");
  assert.equal(cell('  =1'), "'  =1");
  assert.equal(cell('a,b "c"\nd'), '"a,b ""c""\nd"');
  assert.equal(cell('Café – 日本語'), 'Café – 日本語');
  assert.equal(cell(404), '404');
});

test('image export lists ALT status for every image', () => {
  const csv = exportCsv('images', bigAnalysis(6));
  assert.equal(lines(csv).filter(l => l.includes(',Missing,')).length, 2);
  assert.equal(lines(csv).filter(l => l.includes(',Present,')).length, 4);
});

test('list filters and search', () => {
  const a = bigAnalysis(10);
  assert.equal(queryList('links', a, { filter: 'broken' }).total, 5);
  assert.equal(queryList('links', a, { q: 'link 7' }).total, 1);
  assert.equal(queryList('images', a, { filter: 'missing' }).total, 4);
  assert.equal(queryList('pages', a, { status: '4xx' }).total, 1);
  assert.equal(queryList('issues', a, { severity: 'critical' }).rows.every(i => i.severity === 'critical'), true);
  const sorted = queryList('pages', a, { sort: 'url', dir: 'desc', limit: 2 }).rows;
  assert.ok(sorted[0].url > sorted[1].url);
});
