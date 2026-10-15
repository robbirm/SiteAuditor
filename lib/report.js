'use strict';
// Client-ready PDF report: numbers come from the crawl analysis, layout is drawn with lib/pdf.js.
const { Pdf, PdfError, loadImage } = require('./pdf');
const { DEFS, OVERSIZE, SLOW_MS } = require('./analysis');

const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;
const DEFAULT_ACCENT = '#2563eb';
const C = { ink: '#0f172a', body: '#334155', mut: '#64748b', line: '#e2e8f0', card: '#f8fafc', white: '#ffffff', grey: '#94a3b8',
  good: '#16a34a', goodBg: '#f0fdf4', goodTx: '#15803d', warn: '#f59e0b', warnBg: '#fffbeb', warnTx: '#b45309',
  bad: '#dc2626', badBg: '#fef2f2', badTx: '#b91c1c', info: '#3b82f6', infoBg: '#eff6ff', infoTx: '#1d4ed8', dark: '#991b1b' };
const SEV = {
  critical: { label: 'Critical', color: C.bad, bg: C.badBg, tx: C.badTx },
  warning: { label: 'Warning', color: C.warn, bg: C.warnBg, tx: C.warnTx },
  info: { label: 'Info', color: C.info, bg: C.infoBg, tx: C.infoTx }
};

const fmt = v => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + 's')}`;
const kb = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
const stripProto = u => String(u || '').replace(/^https?:\/\//i, '');
const median = arr => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const mix = (hex, other, t) => {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), a = p(hex), b = p(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const scoreColor = s => (s == null ? C.grey : s >= 75 ? C.good : s >= 50 ? C.warn : C.bad);
const rating = s => (s == null ? 'Not available' : s >= 90 ? 'Excellent' : s >= 75 ? 'Good' : s >= 50 ? 'Needs improvement' : 'Poor');
const duration = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + ' seconds' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; };
function today() {
  const d = new Date();
  try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Europe/London' }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

// ---------------------------------------------------------------- data
function computeReport(view) {
  const a = view.analysis(), meta = view.meta, S = a.summary, pages = a.pages;
  const crawled = pages.filter(p => !p.blocked);
  const ok2xx = crawled.filter(p => p.status >= 200 && p.status < 300);
  const htmlOk = pages.filter(p => p.parsed && p.status >= 200 && p.status < 300);
  const has = (p, t) => p.issues.some(i => i.type === t);
  const pct = (x, y) => Math.round(x / y * 100);

  const statusBuckets = [
    { label: '2xx', value: ok2xx.length, color: C.good },
    { label: '3xx', value: crawled.filter(p => p.status >= 300 && p.status < 400).length, color: C.info },
    { label: '4xx', value: crawled.filter(p => p.status >= 400 && p.status < 500).length, color: C.bad },
    { label: '5xx', value: crawled.filter(p => p.status >= 500).length, color: C.dark },
    { label: 'Failed', value: crawled.filter(p => p.failed).length, color: '#475569' },
    { label: 'Blocked', value: pages.length - crawled.length, color: C.grey }
  ];
  const health = [
    { label: 'Healthy', value: crawled.filter(p => p.severity === 'ok').length, color: C.good },
    { label: 'Notices only', value: crawled.filter(p => p.severity === 'info').length, color: C.info },
    { label: 'Warnings', value: crawled.filter(p => p.severity === 'warning').length, color: C.warn },
    { label: 'Critical', value: crawled.filter(p => p.severity === 'critical').length, color: C.bad }
  ];

  // images (one record per unique image file)
  const uniq = new Map();
  for (const i of a.images) if (!uniq.has(i.src)) uniq.set(i.src, { src: i.src, page: i.page, bytes: i.bytes, status: i.imgStatus, checked: i.checked });
  const imgs = [...uniq.values()];
  const measured = imgs.filter(i => i.bytes != null);
  const checkedImgs = imgs.filter(i => i.checked);
  const brokenImgs = checkedImgs.filter(i => i.status >= 400 || i.status === 0);
  const alt = { present: 0, empty: 0, missing: 0 };
  for (const i of a.images) alt[i.altStatus.toLowerCase()]++;
  const sizeBuckets = [
    { label: 'Under 100 KB', value: measured.filter(i => i.bytes < 102400).length, color: C.good },
    { label: '100 - 250 KB', value: measured.filter(i => i.bytes >= 102400 && i.bytes <= OVERSIZE).length, color: '#84cc16' },
    { label: '250 - 500 KB', value: measured.filter(i => i.bytes > OVERSIZE && i.bytes <= 512000).length, color: C.warn },
    { label: 'Over 500 KB', value: measured.filter(i => i.bytes > 512000).length, color: C.bad },
    { label: 'Size unknown', value: imgs.length - measured.length, color: C.grey }
  ];
  const largest = measured.slice().sort((x, y) => y.bytes - x.bytes).slice(0, 5);

  // speed and content
  const timed = ok2xx.filter(p => typeof p.responseMs === 'number');
  const ms = timed.map(p => p.responseMs);
  const slowest = timed.reduce((m, p) => (!m || p.responseMs > m.responseMs ? p : m), null);
  const speedBuckets = [
    { label: '< 0.5 s', value: ms.filter(v => v < 500).length, color: C.good },
    { label: '0.5 - 1 s', value: ms.filter(v => v >= 500 && v < 1000).length, color: '#84cc16' },
    { label: '1 - 1.5 s', value: ms.filter(v => v >= 1000 && v <= SLOW_MS).length, color: C.warn },
    { label: '1.5 - 3 s', value: ms.filter(v => v > SLOW_MS && v <= 3000).length, color: '#f97316' },
    { label: '> 3 s', value: ms.filter(v => v > 3000).length, color: C.bad }
  ];
  const words = htmlOk.map(p => p.words).filter(v => typeof v === 'number');
  const wordBuckets = [
    { label: '< 100', value: words.filter(v => v < 100).length, color: C.bad },
    { label: '100 - 299', value: words.filter(v => v >= 100 && v < 300).length, color: C.warn },
    { label: '300 - 599', value: words.filter(v => v >= 300 && v < 600).length, color: '#84cc16' },
    { label: '600 - 999', value: words.filter(v => v >= 600 && v < 1000).length, color: C.good },
    { label: '1,000+', value: words.filter(v => v >= 1000).length, color: C.good }
  ];

  // scorecard: share of pages / items passing each check
  const card = [];
  const add = (label, pass, total) => { if (total > 0) card.push({ label, pass, total, pct: pct(pass, total) }); };
  add('Pages load successfully (HTTP 200)', ok2xx.length, crawled.length);
  add('Pages served over HTTPS', crawled.filter(p => /^https:/i.test(p.url)).length, crawled.length);
  add('Pages have a title tag', htmlOk.filter(p => p.title).length, htmlOk.length);
  add('Titles are 30-60 characters', htmlOk.filter(p => p.title && p.title.length >= 30 && p.title.length <= 60).length, htmlOk.length);
  add('Titles are unique', htmlOk.filter(p => p.title && !has(p, 'duplicate_title')).length, htmlOk.filter(p => p.title).length);
  add('Pages have a meta description', htmlOk.filter(p => p.metaDescription).length, htmlOk.length);
  add('Descriptions are 70-160 characters', htmlOk.filter(p => p.metaDescription && p.metaDescription.length >= 70 && p.metaDescription.length <= 160).length, htmlOk.length);
  add('Descriptions are unique', htmlOk.filter(p => p.metaDescription && !has(p, 'duplicate_meta_description')).length, htmlOk.filter(p => p.metaDescription).length);
  add('Pages have exactly one H1 heading', htmlOk.filter(p => p.h1Count === 1).length, htmlOk.length);
  add('Canonical URL is set', htmlOk.filter(p => p.canonical).length, htmlOk.length);
  add('Mobile viewport tag present', htmlOk.filter(p => p.viewport).length, htmlOk.length);
  add('Page language declared', htmlOk.filter(p => p.lang).length, htmlOk.length);
  add('Indexable (no noindex)', htmlOk.filter(p => !has(p, 'noindex')).length, htmlOk.length);
  add('Fast server response (under 1.5 s)', timed.filter(p => p.responseMs <= SLOW_MS).length, timed.length);
  add('Pages have 300+ words of content', htmlOk.filter(p => p.words >= 300).length, htmlOk.length);
  const intLinks = a.links.filter(l => l.type === 'Internal' && (l.status || l.broken));
  add('Internal links work', intLinks.filter(l => !l.broken).length, intLinks.length);
  add('Images have ALT text', a.images.filter(i => i.altStatus !== 'Missing').length, a.images.length);
  add('Images are under 250 KB', measured.filter(i => i.bytes <= OVERSIZE).length, measured.length);
  add('Images load (none broken)', checkedImgs.length - brokenImgs.length, checkedImgs.length);

  const sc = meta.siteChecks || null;
  const strengths = [];
  if (sc && sc.https) strengths.push('The site is served over HTTPS');
  if (sc && sc.robots && sc.robots.found) strengths.push('A robots.txt file is in place');
  if (sc && sc.sitemap && sc.sitemap.found) strengths.push(`An XML sitemap was found (${plural(sc.sitemap.urls, 'URL')})`);
  if (S.totals.brokenLinks === 0 && intLinks.length) strengths.push('No broken internal links were found');
  const typeCount = t => (S.issueTypes.find(x => x.type === t) || { count: 0 }).count;
  if (crawled.length && !typeCount('redirect_chain') && !typeCount('redirect_loop')) strengths.push('No redirect chains or loops');
  for (const c of card.slice().sort((x, y) => y.pct - x.pct)) if (c.pct >= 90 && !(sc && sc.https && c.label === 'Pages served over HTTPS')) strengths.push(`${c.pct}% - ${c.label.charAt(0).toLowerCase() + c.label.slice(1)}`);

  const byType = new Map();
  for (const i of a.issues) { if (!byType.has(i.type)) byType.set(i.type, []); byType.get(i.type).push(i.url); }
  const plan = S.issueTypes.map(t => ({ ...t, fix: DEFS[t.type] ? DEFS[t.type].fix : '', examples: (byType.get(t.type) || []).slice(0, 2) }));
  const worst = crawled.filter(p => p.issues.length).sort((x, y) => (x.score - y.score) || (y.issues.length - x.issues.length) || x.url.localeCompare(y.url)).slice(0, 14);

  const host = hostOf(meta.startUrl);
  const partial = meta.status === 'cancelled' || meta.interrupted;
  const sentences = [`We crawled ${plural(meta.pagesCrawled, 'page')} on ${host}${partial ? ' (the crawl was stopped early, so these results are partial)' : ''}.`];
  if (S.score != null) sentences.push(`The site's technical SEO health score is ${S.score} out of 100 (${rating(S.score)}).`);
  const total = S.counts.critical + S.counts.warning + S.counts.info;
  sentences.push(total
    ? `The audit found ${plural(S.counts.critical, 'critical issue')}, ${plural(S.counts.warning, 'warning')} and ${plural(S.counts.info, 'informational note')} across ${plural(S.issueTypes.length, 'issue type')}.`
    : 'The audit found no issues.');
  if (plan[0]) sentences.push(`The most urgent item is "${plan[0].label}", affecting ${plural(plan[0].count, 'page')}.`);

  return { meta, S, host, score: S.score, rating: rating(S.score), summary: sentences.join(' '), partial,
    crawledCount: crawled.length, statusBuckets, health, scorecard: card, strengths,
    topIssues: S.issueTypes.slice().sort((x, y) => y.count - x.count || x.label.localeCompare(y.label)).slice(0, 10),
    plan, worst, siteChecks: sc,
    images: { total: imgs.length, measured: measured.length, oversized: measured.filter(i => i.bytes > OVERSIZE).length, broken: brokenImgs.length, alt, sizeBuckets, largest, missingAlt: alt.missing },
    speed: { buckets: speedBuckets, avg: ms.length ? Math.round(ms.reduce((x, y) => x + y, 0) / ms.length) : null, median: median(ms), slowest },
    content: { buckets: wordBuckets, avg: words.length ? Math.round(words.reduce((x, y) => x + y, 0) / words.length) : null, thin: words.filter(v => v < 300).length } };
}

// ---------------------------------------------------------------- brand
function parseBrand(input) {
  input = input || {};
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const brand = {
    company: clean(input.company, 80), client: clean(input.client, 80),
    accent: /^#[0-9a-f]{6}$/i.test(String(input.accent || '')) ? String(input.accent).toLowerCase() : DEFAULT_ACCENT,
    logoAlign: ['left', 'center', 'right'].includes(input.logoAlign) ? input.logoAlign : 'left', logo: null
  };
  if (input.logo) {
    const s = String(input.logo);
    if (s.length > MAX_LOGO_BYTES * 1.4) throw new PdfError('The logo file is too large. Please use an image under 1.5 MB.');
    const comma = s.indexOf(',');
    if (comma < 0 || !/^data:image\/(png|jpe?g);base64$/i.test(s.slice(0, comma))) throw new PdfError('The logo must be a PNG or JPG image.');
    const buf = Buffer.from(s.slice(comma + 1).replace(/\s/g, ''), 'base64');
    if (!buf.length) throw new PdfError('The logo file is empty.');
    if (buf.length > MAX_LOGO_BYTES) throw new PdfError('The logo file is too large. Please use an image under 1.5 MB.');
    brand.logo = loadImage(buf);
  }
  return brand;
}

// ---------------------------------------------------------------- drawing
function render(R, brand) {
  const doc = new Pdf({ title: `SEO Audit Report - ${R.host}`, author: brand.company || 'Modernise Site Auditor' });
  const W = doc.W, H = doc.H, M = 42, CW = W - 2 * M, BOTTOM = H - 80, ACC = brand.accent;
  const onAcc = lum(ACC) > 0.62 ? C.ink : C.white;
  let y = 0;

  const pageHead = (title, sub) => { doc.addPage(); doc.text(title, M, 66, { size: 21, bold: true, color: C.ink, maxWidth: CW }); if (sub) doc.text(sub, M, 84, { size: 10, color: C.mut, maxWidth: CW }); doc.rect(M, 94, 38, 3.5, { fill: ACC, r: 1.7 }); y = 118; };
  const need = (h, title) => { if (y + h > BOTTOM) pageHead(title + ' (continued)'); };
  const panel = (x, py, w, h, { fill = C.white, stroke = C.line, bar } = {}) => {
    doc.rect(x, py, w, h, { fill, stroke, r: 10 });
    if (bar) doc.rect(x, py + 10, 4, h - 20, { fill: bar, r: 2 });
  };
  const ptitle = (x, py, t, sub) => { doc.text(t, x, py, { size: 11.5, bold: true, color: C.ink }); if (sub) doc.text(sub, x, py + 13, { size: 8, color: C.mut }); };
  const dot = (x, py, col) => doc.circle(x, py, 3.2, { fill: col });
  const chip = (x, py, sev, w = 54) => { const s = SEV[sev]; doc.rect(x, py, w, 16, { fill: s.bg, r: 8 }); doc.text(s.label, x + w / 2, py + 11.3, { size: 8, bold: true, color: s.tx, align: 'center' }); };
  const tick = (x, py, col) => doc.polyline([[x, py], [x + 3.2, py + 3.4], [x + 9, py - 3.6]], { color: col, lw: 1.8 });
  const tile = (x, py, w, h, label, value, color, sub) => {
    panel(x, py, w, h); doc.rect(x + 14, py, w - 28, 3.5, { fill: color, r: 1.75 });
    doc.text(label, x + 14, py + 22, { size: 8.5, color: C.mut, bold: true, maxWidth: w - 28 });
    doc.text(value, x + 14, py + 51, { size: 24, bold: true, color, maxWidth: w - 28 });
    if (sub) doc.text(sub, x + 14, py + h - 10, { size: 7.5, color: C.mut, maxWidth: w - 28 });
  };
  const legend = (x, py, w, items, step = 22) => items.forEach((it, i) => {
    dot(x + 4, py + i * step - 3, it.color);
    doc.text(it.label, x + 14, py + i * step, { size: 9, color: C.body, maxWidth: w - 38 });
    doc.text(fmt(it.value), x + w, py + i * step, { size: 9, bold: true, color: C.ink, align: 'right' });
  });
  const colChart = (x, py, w, h, items) => {
    const gap = 9, bw = (w - gap * (items.length - 1)) / items.length, y0 = py + h - 18, max = Math.max(1, ...items.map(i => i.value));
    items.forEach((it, i) => {
      const bx = x + i * (bw + gap), bh = it.value ? Math.max(3, it.value / max * (h - 44)) : 0;
      if (bh) doc.rect(bx, y0 - bh, bw, bh, { fill: it.color, r: 3 });
      doc.text(fmt(it.value), bx + bw / 2, y0 - bh - 5, { size: 8.5, bold: true, color: C.ink, align: 'center' });
      doc.text(it.label, bx + bw / 2, y0 + 12, { size: 7.3, color: C.mut, align: 'center', maxWidth: bw + gap - 1 });
    });
    doc.line(x, y0, x + w, y0, { color: C.line });
  };
  const hbar = (x, py, labelW, barW, label, value, max, color, valueText) => {
    doc.text(label, x, py + 8, { size: 9, color: C.body, maxWidth: labelW - 8 });
    doc.rect(x + labelW, py, barW, 9, { fill: '#eef2f7', r: 4.5 });
    if (value > 0) doc.rect(x + labelW, py, Math.max(6, value / Math.max(1, max) * barW), 9, { fill: color, r: 4.5 });
    doc.text(valueText, x + labelW + barW + 10, py + 8, { size: 9, bold: true, color: C.ink });
  };
  const emptyNote = (x, py, w, t) => doc.text(t, x + w / 2, py, { size: 9, color: C.mut, align: 'center' });

  // ------------------------------------------------ 1. cover
  doc.addPage();
  doc.rect(0, 0, W, 262, { fill: ACC });
  doc.circle(W - 40, 20, 150, { fill: mix(ACC, onAcc === C.white ? '#ffffff' : '#000000', 0.1) });
  doc.circle(W - 130, 206, 50, { fill: mix(ACC, onAcc === C.white ? '#ffffff' : '#000000', 0.07) });
  doc.text('WEBSITE SEO AUDIT', M, 86, { size: 10, bold: true, color: onAcc, cs: 2.6 });
  doc.text(R.host, M, 136, { size: 30, bold: true, color: onAcc, maxWidth: CW });
  doc.text(R.meta.startUrl, M, 160, { size: 11, color: onAcc, maxWidth: CW });
  doc.text('Report generated on ' + today(), M, 184, { size: 10, color: onAcc });
  if (brand.client) { doc.text('PREPARED FOR', M, 220, { size: 7.5, bold: true, color: onAcc, cs: 1.4 }); doc.text(brand.client, M, 238, { size: 12.5, bold: true, color: onAcc, maxWidth: 220 }); }
  if (brand.company) { doc.text('PREPARED BY', M + 250, 220, { size: 7.5, bold: true, color: onAcc, cs: 1.4 }); doc.text(brand.company, M + 250, 238, { size: 12.5, bold: true, color: onAcc, maxWidth: 220 }); }

  const gcx = M + 100, gcy = 388, gr = 62, col = scoreColor(R.score);
  doc.circle(gcx, gcy, gr, { stroke: '#e5e9f0', lw: 15 });
  if (R.score != null) doc.arcStroke(gcx, gcy, gr, 0, Math.PI * 2 * Math.max(0.004, R.score / 100), { color: col, lw: 15, cap: 1 });
  doc.text(R.score == null ? '-' : String(R.score), gcx, gcy + 12, { size: 38, bold: true, color: C.ink, align: 'center' });
  doc.text('out of 100', gcx, gcy + 30, { size: 9, color: C.mut, align: 'center' });
  doc.text(R.rating, gcx, gcy + gr + 34, { size: 13, bold: true, color: col === C.warn ? C.warnTx : col, align: 'center' });
  doc.text('Technical SEO health score', gcx, gcy + gr + 50, { size: 8.5, color: C.mut, align: 'center' });
  const tx = M + 232, tw = (CW - 232 - 14) / 2;
  tile(tx, 296, tw, 82, 'PAGES CRAWLED', fmt(R.meta.pagesCrawled), lum(ACC) > 0.62 ? C.ink : ACC, `of ${fmt(R.meta.discovered)} URLs discovered`);
  tile(tx + tw + 14, 296, tw, 82, 'CRITICAL ISSUES', fmt(R.S.counts.critical), C.bad, 'fix these first');
  tile(tx, 392, tw, 82, 'WARNINGS', fmt(R.S.counts.warning), C.warnTx, 'should be fixed');
  tile(tx + tw + 14, 392, tw, 82, 'INFORMATION', fmt(R.S.counts.info), C.infoTx, 'nice to improve');
  const sumN = Math.min(5, doc.wrap(R.summary, CW - 36, 10).length), sumH = 56 + sumN * 15, sumY = 508;
  panel(M, sumY, CW, sumH, { fill: C.card });
  doc.text('Summary', M + 18, sumY + 26, { size: 12, bold: true, color: C.ink });
  doc.paragraph(R.summary, M + 18, sumY + 36, CW - 36, { size: 10, color: C.body, lh: 1.5, maxLines: 5 });
  const legY = sumY + sumH + 34;
  doc.text('How to read this report', M, legY, { size: 11, bold: true, color: C.ink });
  [['critical', 'Critical', 'Problems that block or seriously harm search visibility. Fix first.'], ['warning', 'Warning', 'Issues that weaken rankings or user experience. Fix soon.'], ['info', 'Info', 'Smaller improvements and things worth checking.']].forEach(([s, l, d], i) => {
    chip(M, legY + 14 + i * 24, s, 58); doc.text(d, M + 72, legY + 26 + i * 24, { size: 9, color: C.body, maxWidth: CW - 72 });
  });

  // ------------------------------------------------ 2. overview
  pageHead('Overview', 'How healthy the site is at a glance');
  const cw2 = (CW - 14) / 2;
  panel(M, y, cw2, 188); panel(M + cw2 + 14, y, cw2, 188);
  ptitle(M + 16, y + 26, 'Pages by health', `${fmt(R.crawledCount)} pages crawled`);
  const hcx = M + 16 + 52, hcy = y + 112;
  doc.donut(hcx, hcy, 40, 15, R.health);
  doc.text(fmt(R.crawledCount), hcx, hcy + 3, { size: 17, bold: true, color: C.ink, align: 'center' });
  doc.text('pages', hcx, hcy + 15, { size: 7.5, color: C.mut, align: 'center' });
  legend(M + 16 + 118, y + 84, cw2 - 32 - 118, R.health, 24);
  ptitle(M + cw2 + 30, y + 26, 'HTTP status codes', 'OK, redirect, client error, server error');
  colChart(M + cw2 + 30, y + 48, cw2 - 32, 128, R.statusBuckets);
  y += 188 + 14;

  const rowH = 18, sch = 52 + R.scorecard.length * rowH;
  panel(M, y, CW, sch);
  ptitle(M + 16, y + 26, 'SEO basics scorecard', 'Share of pages (or items) passing each check');
  R.scorecard.forEach((c, i) => {
    const ry = y + 56 + i * rowH, color = c.pct >= 90 ? C.good : c.pct >= 60 ? C.warn : C.bad;
    doc.text(c.label, M + 16, ry + 8, { size: 9, color: C.body, maxWidth: 210 });
    doc.rect(M + 236, ry, 180, 8, { fill: '#eef2f7', r: 4 });
    if (c.pct > 0) doc.rect(M + 236, ry, Math.max(6, c.pct * 1.8), 8, { fill: color, r: 4 });
    doc.text(c.pct + '%', M + 460, ry + 8, { size: 9, bold: true, color: C.ink, align: 'right' });
    doc.text(`${fmt(c.pass)}/${fmt(c.total)}`, M + CW - 16, ry + 8, { size: 8, color: C.mut, align: 'right' });
  });
  if (!R.scorecard.length) emptyNote(M, y + 70, CW, 'No pages could be analysed.');
  y += sch + 10;

  // ------------------------------------------------ 3. key findings
  pageHead('Key findings', 'What is working, what needs improvement and what is broken');
  const bullets = (title, color, bg, items, empty, render, limit = 6, more = 'see the action plan') => {
    const shown = items.slice(0, limit), h = 50 + Math.max(1, shown.length) * 20 + (items.length > limit ? 16 : 0);
    panel(M, y, CW, h, { fill: bg, stroke: mix(color, '#ffffff', 0.7), bar: color });
    doc.text(title, M + 20, y + 27, { size: 12, bold: true, color: C.ink });
    if (!shown.length) doc.text(empty, M + 20, y + 54, { size: 9.5, color: C.mut });
    shown.forEach((it, i) => render(it, M + 20, y + 54 + i * 20));
    if (items.length > limit) doc.text(`and ${items.length - limit} more (${more})`, M + 20, y + h - 12, { size: 8.5, color: C.mut });
    y += h + 14;
  };
  bullets('What is working well', C.good, C.goodBg, R.strengths, 'No standout strengths were detected yet.', (t, x, py) => { tick(x, py - 3, C.good); doc.text(t, x + 20, py, { size: 9.5, color: C.body, maxWidth: CW - 60 }); }, 7, 'see the scorecard on page 2');
  const sevItems = s => R.S.issueTypes.filter(t => t.severity === s);
  const issueRow = (t, x, py) => { dot(x + 4, py - 3, SEV[t.severity].color); doc.text(t.label, x + 20, py, { size: 9.5, color: C.body, maxWidth: CW - 150 }); doc.text(plural(t.count, 'page'), M + CW - 20, py, { size: 9, bold: true, color: C.ink, align: 'right' }); };
  bullets('Needs improvement', C.warn, C.warnBg, sevItems('warning'), 'No warnings - nice work.', issueRow, 6);
  bullets('Critical problems', C.bad, C.badBg, sevItems('critical'), 'No critical problems were found.', issueRow, 6);

  // ------------------------------------------------ 4. images, speed and content
  pageHead('Images, speed & content', 'File sizes, image accessibility, response times and content depth');
  const I = R.images, tw4 = (CW - 3 * 12) / 4;
  tile(M, y, tw4, 80, 'IMAGES FOUND', fmt(I.total), ACC, 'unique image files');
  tile(M + (tw4 + 12), y, tw4, 80, 'OVER 250 KB', I.measured ? fmt(I.oversized) : '-', I.oversized ? C.warnTx : C.goodTx, I.measured ? `of ${fmt(I.measured)} measured` : 'not measured');
  tile(M + 2 * (tw4 + 12), y, tw4, 80, 'BROKEN IMAGES', fmt(I.broken), I.broken ? C.bad : C.goodTx, 'return an error');
  tile(M + 3 * (tw4 + 12), y, tw4, 80, 'MISSING ALT TEXT', fmt(I.missingAlt), I.missingAlt ? C.warnTx : C.goodTx, 'image tags without ALT');
  y += 80 + 14;
  const ch = 184;
  panel(M, y, cw2, ch); panel(M + cw2 + 14, y, cw2, ch);
  ptitle(M + 16, y + 26, 'Image ALT text', 'Helps accessibility and image search');
  if (I.alt.present + I.alt.empty + I.alt.missing) {
    const alts = [{ label: 'Has ALT text', value: I.alt.present, color: C.good }, { label: 'Empty ALT', value: I.alt.empty, color: C.info }, { label: 'Missing ALT', value: I.alt.missing, color: C.bad }];
    const acx = M + 16 + 46, acy = y + 118;
    doc.donut(acx, acy, 36, 14, alts);
    const tot = I.alt.present + I.alt.empty + I.alt.missing;
    doc.text(Math.round((I.alt.present + I.alt.empty) / tot * 100) + '%', acx, acy + 5, { size: 16, bold: true, color: C.ink, align: 'center' });
    legend(M + 16 + 104, y + 96, cw2 - 32 - 104, alts, 24);
  } else emptyNote(M, y + 110, cw2, 'No images were found.');
  ptitle(M + cw2 + 30, y + 26, 'Image file sizes', 'Large images slow pages down');
  if (I.total) {
    const maxS = Math.max(1, ...I.sizeBuckets.map(b => b.value));
    I.sizeBuckets.forEach((b, i) => hbar(M + cw2 + 30, y + 60 + i * 25, 96, cw2 - 32 - 96 - 40, b.label, b.value, maxS, b.color, fmt(b.value)));
  } else emptyNote(M + cw2 + 14, y + 110, cw2, 'No images were found.');
  y += ch + 14;
  panel(M, y, cw2, ch); panel(M + cw2 + 14, y, cw2, ch);
  ptitle(M + 16, y + 26, 'Server response time', 'Time until the server starts answering');
  if (R.speed.buckets.some(b => b.value)) {
    colChart(M + 16, y + 44, cw2 - 32, 118, R.speed.buckets);
    doc.text(`Average ${fmt(R.speed.avg)} ms  |  Median ${fmt(R.speed.median)} ms  |  Slowest ${fmt(R.speed.slowest && R.speed.slowest.responseMs)} ms`, M + 16, y + ch - 12, { size: 8, color: C.mut, maxWidth: cw2 - 32 });
  } else emptyNote(M, y + 110, cw2, 'No timing data available.');
  ptitle(M + cw2 + 30, y + 26, 'Content depth', 'Words of text per page');
  if (R.content.buckets.some(b => b.value)) {
    colChart(M + cw2 + 30, y + 44, cw2 - 32, 118, R.content.buckets);
    doc.text(`Average ${fmt(R.content.avg)} words  |  ${plural(R.content.thin, 'page')} under 300 words`, M + cw2 + 30, y + ch - 12, { size: 8, color: C.mut, maxWidth: cw2 - 32 });
  } else emptyNote(M + cw2 + 14, y + 110, cw2, 'No page content was analysed.');
  y += ch + 14;
  if (I.largest.length) {
    const lh = 50 + I.largest.length * 18;
    need(lh, 'Images, speed & content');
    panel(M, y, CW, lh);
    ptitle(M + 16, y + 26, 'Largest images');
    I.largest.forEach((im, i) => {
      const ry = y + 52 + i * 18;
      doc.text(kb(im.bytes), M + 16, ry + 5, { size: 9, bold: true, color: im.bytes > OVERSIZE ? C.warnTx : C.ink });
      doc.text(stripProto(im.src), M + 76, ry + 5, { size: 8.5, color: C.body, maxWidth: CW - 92 });
    });
    y += lh + 10;
  }

  // ------------------------------------------------ 5. action plan
  pageHead('Priority action plan', 'Most common issues first, then every issue type with how to fix it');
  const topH = 52 + R.topIssues.length * 21;
  panel(M, y, CW, topH);
  ptitle(M + 16, y + 26, 'Most common issues', 'Number of pages affected');
  const maxT = Math.max(1, ...R.topIssues.map(t => t.count));
  R.topIssues.forEach((t, i) => hbar(M + 16, y + 52 + i * 21, 250, CW - 32 - 250 - 50, t.label, t.count, maxT, SEV[t.severity].color, fmt(t.count)));
  if (!R.topIssues.length) emptyNote(M, y + 60, CW, 'No issues were found.');
  y += topH + 16;
  if (R.plan.length) {
    doc.text('Every issue, in priority order', M, y + 10, { size: 12, bold: true, color: C.ink }); y += 24;
    R.plan.slice(0, 30).forEach(t => {
      const fixLines = doc.wrap(t.fix, CW - 70, 9), ex = t.examples.length;
      const h = 30 + (fixLines.length - 1) * 12.6 + (ex ? 15 : 0) + 20;
      need(h, 'Priority action plan');
      chip(M, y, t.severity, 54);
      doc.text(t.label, M + 66, y + 12, { size: 10.5, bold: true, color: C.ink, maxWidth: CW - 66 - 80 });
      doc.text(plural(t.count, 'page'), M + CW, y + 12, { size: 9, bold: true, color: SEV[t.severity].tx, align: 'right' });
      fixLines.forEach((l, i) => doc.text(l, M + 66, y + 30 + i * 12.6, { size: 9, color: C.body }));
      if (ex) doc.text('e.g. ' + t.examples.map(stripProto).join('   |   '), M + 66, y + 30 + (fixLines.length - 1) * 12.6 + 14, { size: 7.8, color: C.mut, maxWidth: CW - 66 });
      y += h; doc.line(M, y - 7, M + CW, y - 7, { color: C.line });
    });
    if (R.plan.length > 30) { need(24, 'Priority action plan'); doc.text(`Plus ${R.plan.length - 30} more issue types. See the Issues CSV export for the complete list.`, M, y + 10, { size: 9, color: C.mut }); y += 24; }
  }

  // ------------------------------------------------ 6. pages needing attention
  pageHead('Pages needing attention', 'Lowest-scoring pages first. The CSV exports list every page.');
  if (!R.worst.length) { panel(M, y, CW, 60, { fill: C.goodBg, stroke: mix(C.good, '#ffffff', 0.7) }); doc.text('No pages with issues were found.', M + 20, y + 35, { size: 11, bold: true, color: C.goodTx }); y += 74; }
  else {
    doc.rect(M, y, CW, 24, { fill: C.card, stroke: C.line, r: 6 });
    doc.text('PAGE', M + 12, y + 16, { size: 7.5, bold: true, color: C.mut, cs: 1 }); doc.text('SCORE', M + 262, y + 16, { size: 7.5, bold: true, color: C.mut, cs: 1 }); doc.text('MAIN ISSUES', M + 318, y + 16, { size: 7.5, bold: true, color: C.mut, cs: 1 });
    y += 30;
    R.worst.forEach(p => {
      const issues = p.issues.slice().sort((x, z) => ({ critical: 0, warning: 1, info: 2 })[x.severity] - ({ critical: 0, warning: 1, info: 2 })[z.severity]).map(i => i.label).join('; ');
      let lines = doc.wrap(issues, CW - 318 - 6, 8.5);
      if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = doc.fit(lines[2].replace(/[;\s]+$/, '') + ' \u2026', CW - 318 - 6, 8.5); }
      const h = Math.max(30, 16 + lines.length * 11.5);
      need(h, 'Pages needing attention');
      doc.text(stripProto(p.url), M + 12, y + 14, { size: 8.5, color: C.ink, maxWidth: 240 });
      doc.text(String(p.score), M + 262, y + 14, { size: 10, bold: true, color: scoreColor(p.score) === C.warn ? C.warnTx : scoreColor(p.score) });
      lines.forEach((l, i) => doc.text(l, M + 318, y + 14 + i * 11.5, { size: 8.5, color: C.body }));
      y += h; doc.line(M, y - 3, M + CW, y - 3, { color: C.line });
    });
  }

  // ------------------------------------------------ 7. about
  pageHead('About this audit', 'Scope, method and next steps');
  const m = R.meta, sc = R.siteChecks, yn = v => (v ? 'Yes' : 'No');
  const rows = [['Start URL', m.startUrl], ['Pages crawled', fmt(m.pagesCrawled)], ['URLs discovered', fmt(m.discovered)], ['Page limit', fmt(m.limit)], ['Blocked by robots.txt', fmt(m.blockedByRobots)],
    ['Crawl duration', m.startedAt && m.finishedAt ? duration(m.finishedAt - m.startedAt) : '-'],
    ['robots.txt found', sc ? yn(sc.robots.found) : '-'], ['XML sitemap found', sc ? (sc.sitemap.found ? `Yes (${plural(sc.sitemap.urls, 'URL')})` : 'No') : '-'], ['Served over HTTPS', sc ? yn(sc.https) : '-'],
    ['Crawl status', R.partial ? 'Stopped early (partial results)' : 'Completed']];
  const kvh = 46 + rows.length * 20;
  panel(M, y, CW, kvh); ptitle(M + 16, y + 26, 'Crawl details');
  rows.forEach(([k, v], i) => { doc.text(k, M + 16, y + 54 + i * 20, { size: 9, color: C.mut }); doc.text(v, M + 170, y + 54 + i * 20, { size: 9, bold: true, color: C.ink, maxWidth: CW - 186 }); });
  y += kvh + 14;
  const W3 = R.S.scoreModel.weights;
  const expl = doc.wrap(R.S.scoreModel.text, CW - 36, 9.5), eh = 66 + expl.length * 13.3 + 26;
  need(eh, 'About this audit');
  panel(M, y, CW, eh); ptitle(M + 16, y + 26, 'How the health score is calculated');
  expl.forEach((l, i) => doc.text(l, M + 18, y + 50 + i * 13.3, { size: 9.5, color: C.body }));
  const wy = y + 50 + expl.length * 13.3 + 8;
  [['critical', W3.critical], ['warning', W3.warning], ['info', W3.info]].forEach(([s, v], i) => { chip(M + 18 + i * 130, wy, s, 54); doc.text('-' + v + ' points', M + 18 + i * 130 + 62, wy + 11.5, { size: 9, bold: true, color: C.ink }); });
  y += eh + 14;
  const notes = [...(m.notes || [])];
  if (R.partial) notes.unshift('This crawl was stopped before it finished, so some pages are not included.');
  notes.push('Automated technical checks only. This report does not judge content quality, backlinks, rankings or keyword targeting.');
  notes.push('Every crawled URL, issue, link and image is available in the CSV exports for detailed fixing.');
  const nl = notes.map(t => doc.wrap(t, CW - 52, 9.5));
  const nh = 46 + nl.reduce((s, l) => s + l.length * 13.3 + 6, 0);
  need(nh, 'About this audit');
  panel(M, y, CW, nh); ptitle(M + 16, y + 26, 'Notes');
  let ny = y + 50;
  nl.forEach(lines => { dot(M + 22, ny - 3, C.grey); lines.forEach((l, i) => doc.text(l, M + 34, ny + i * 13.3, { size: 9.5, color: C.body })); ny += lines.length * 13.3 + 6; });

  // ------------------------------------------------ footer: logo + page numbers on every page
  const footer = (d, p, total) => {
    const fy = H - 66;
    d.line(M, fy, W - M, fy, { color: C.line });
    if (brand.logo) {
      const sc2 = Math.min(150 / brand.logo.width, 32 / brand.logo.height), lw = brand.logo.width * sc2, lh = brand.logo.height * sc2;
      const lx = brand.logoAlign === 'right' ? W - M - lw : brand.logoAlign === 'center' ? (W - lw) / 2 : M;
      d.drawImage(brand.logo, lx, fy + 9 + (32 - lh) / 2, lw, lh);
    }
    const label = `${brand.company ? brand.company + '   |   ' : ''}Page ${p} of ${total}`;
    d.text(label, brand.logoAlign === 'right' ? M : W - M, fy + 29, { size: 8, color: C.mut, align: brand.logoAlign === 'right' ? 'left' : 'right', maxWidth: 260 });
  };
  return doc.toBuffer({ footer });
}

function buildReport(view, brandInput) {
  const brand = parseBrand(brandInput);
  return render(computeReport(view), brand);
}

module.exports = { buildReport, computeReport, parseBrand, render, PdfError, MAX_LOGO_BYTES };
