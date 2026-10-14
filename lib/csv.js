'use strict';
const COLUMNS = [
  ['URL', r => r.url],
  ['Status Code', r => r.status || ''],
  ['Content Type', r => r.contentType],
  ['Title', r => r.title],
  ['Title Length', r => (r.title ? r.title.length : 0)],
  ['Meta Description', r => r.metaDescription],
  ['Meta Description Length', r => (r.metaDescription ? r.metaDescription.length : 0)],
  ['H1 Headings', r => r.h1.join(' | ')],
  ['H1 Count', r => r.h1Count],
  ['Canonical URL', r => r.canonical],
  ['Meta Robots', r => r.metaRobots],
  ['Redirect Target', r => r.redirectTo],
  ['Response Time (ms)', r => r.responseMs],
  ['Issues', r => r.issues.join('; ')],
  ['Discovered From', r => r.discoveredFrom],
  ['Notes', r => r.note]
];

// Quotes cells, and neutralises spreadsheet formulas (=, +, -, @) from untrusted page text.
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
  const lines = [COLUMNS.map(c => cell(c[0])).join(',')];
  for (const r of rows) lines.push(COLUMNS.map(c => cell(c[1](r))).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv };
