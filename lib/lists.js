'use strict';
// Server-side search / filter / sort / pagination for the dashboard tables.
const { RANK, OVERSIZE } = require('./analysis');
const has = (s, q) => String(s || '').toLowerCase().includes(q);

function queryList(section, a, qs) {
  const q = String(qs.q || '').trim().toLowerCase().slice(0, 200);
  const offset = Math.max(0, Number.parseInt(qs.offset, 10) || 0);
  const limit = Math.min(200, Math.max(1, Number.parseInt(qs.limit, 10) || 100));
  let rows;
  if (section === 'pages') {
    rows = a.pages.filter(p => {
      if (q && !(has(p.url, q) || has(p.title, q) || has(p.metaDescription, q) || p.h1.some(x => has(x, q)))) return false;
      const st = qs.status;
      if (st === 'issues' && !p.issues.length) return false;
      if (/^[2-5]xx$/.test(st || '') && Math.floor(p.status / 100) !== Number(st[0])) return false;
      if (qs.severity && qs.severity !== 'all' && p.severity !== qs.severity) return false;
      return true;
    });
    const key = ['url', 'status', 'responseMs', 'title', 'severity', 'inlinks'].includes(qs.sort) ? qs.sort : null;
    if (key) {
      const dir = qs.dir === 'desc' ? -1 : 1;
      const val = p => (key === 'severity' ? RANK[p.severity] : p[key]);
      rows = rows.slice().sort((x, y) => {
        const a1 = val(x), b1 = val(y);
        return (typeof a1 === 'number' && typeof b1 === 'number' ? a1 - b1 : String(a1).localeCompare(String(b1))) * dir;
      });
    }
  } else if (section === 'issues') {
    rows = a.issues.filter(i => (!qs.severity || qs.severity === 'all' || i.severity === qs.severity)
      && (!qs.type || qs.type === 'all' || i.type === qs.type)
      && (!q || has(i.url, q) || has(i.label, q) || has(i.detail, q)));
  } else if (section === 'links') {
    const f = qs.filter;
    rows = a.links.filter(l => (!f || f === 'all' || (f === 'broken' && l.broken) || (f === 'redirect' && l.redirect)
      || (f === 'internal' && l.type === 'Internal') || (f === 'external' && l.type === 'External'))
      && (!q || has(l.source, q) || has(l.destination, q) || has(l.anchor, q)));
  } else if (section === 'images') {
    const f = qs.filter;
    rows = a.images.filter(i => (!f || f === 'all' || i.altStatus.toLowerCase() === f
      || (f === 'oversized' && i.bytes != null && i.bytes > OVERSIZE)
      || (f === 'broken' && i.imgStatus != null && (i.imgStatus >= 400 || i.imgStatus === 0)))
      && (!q || has(i.src, q) || has(i.page, q) || has(i.alt, q)));
  } else rows = [];
  return { total: rows.length, offset, rows: rows.slice(offset, offset + limit) };
}

module.exports = { queryList };
