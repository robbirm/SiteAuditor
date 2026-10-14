'use strict';
// CSV export. Every export is built from the FULL analysis, never from what the table shows.
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const COLUMNS = {
  pages: [
    ['URL', r => r.url], ['Status Code', r => r.status || ''],
    ['Crawl Result', r => (r.blocked ? 'Blocked by robots.txt' : r.failed ? 'Failed to load' : 'Crawled')],
    ['Content Type', r => r.contentType], ['Title', r => r.title], ['Title Length', r => (r.parsed ? r.title.length : '')],
    ['Meta Description', r => r.metaDescription], ['Meta Description Length', r => (r.parsed ? r.metaDescription.length : '')],
    ['H1 Count', r => (r.parsed ? r.h1Count : '')], ['H1 Headings', r => r.h1.join(' | ')],
    ['Canonical URL', r => r.canonical], ['Canonical Status', r => r.canonicalStatus],
    ['Meta Robots', r => r.metaRobots], ['X-Robots-Tag', r => r.xRobots],
    ['Redirect Target', r => r.redirectTo], ['Redirect Final URL', r => r.finalUrl], ['Redirect Hops', r => r.redirectHops || ''],
    ['Response Time (ms)', r => r.responseMs], ['Inlinks', r => r.inlinks],
    ['Severity', r => cap(r.severity)], ['Issue Count', r => r.issues.length], ['Issues', r => r.issues.map(i => i.label).join('; ')],
    ['Discovered From', r => r.discoveredFrom], ['Notes', r => r.note]
  ],
  issues: [
    ['Severity', i => cap(i.severity)], ['Issue Type', i => i.label], ['Issue Code', i => i.type],
    ['Affected URL', i => i.url], ['Detail', i => i.detail], ['Suggested Fix', i => i.fix]
  ],
  links: [
    ['Source URL', l => l.source], ['Destination URL', l => l.destination], ['Anchor Text', l => l.anchor],
    ['Link Type', l => l.type], ['Status Code', l => l.status], ['Status', l => l.statusText]
  ],
  'broken-links': [
    ['Source URL', l => l.source], ['Broken Destination URL', l => l.destination], ['Anchor Text', l => l.anchor],
    ['Status Code', l => l.status], ['Status', l => l.statusText]
  ],
  images: [
    ['Image URL', i => i.src], ['Source Page URL', i => i.page], ['ALT Status', i => i.altStatus], ['ALT Text', i => i.alt]
  ]
};

const ROWS = {
  pages: a => a.pages, issues: a => a.issues, links: a => a.links,
  'broken-links': a => a.links.filter(l => l.broken), images: a => a.images
};

// Quotes cells and neutralises spreadsheet formulas (=, +, -, @) coming from untrusted web content.
function cell(v) {
  let s = v == null ? '' : String(v).replace(/\0/g, '');
  if (/^[=+\-@\t\r]/.test(s) || /^\s+[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map(c => cell(c[0])).join(',')];
  for (const r of rows) lines.push(columns.map(c => cell(c[1](r))).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8 correctly
}

function exportCsv(name, analysis) {
  if (!COLUMNS[name]) return null;
  return toCsv(COLUMNS[name], ROWS[name](analysis));
}

module.exports = { toCsv, exportCsv, COLUMNS, cell };
