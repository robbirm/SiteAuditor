'use strict';
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const express = require('express');
const { Crawl } = require('./lib/crawler');
const { parseUserUrl, preflight, UrlError, checkUrl, safeLookup } = require('./lib/safeUrl');
const { exportCsv } = require('./lib/csv');
const { queryList } = require('./lib/lists');
const { createStore, pickDir } = require('./lib/store');
const { buildReport, PdfError } = require('./lib/report');

const PORT = process.env.PORT || 3000;
const DEFAULT_LIMIT = 500, MAX_LIMIT = 1000;
const MAX_STORED = Math.min(50, Math.max(1, Number(process.env.MAX_SAVED_CRAWLS) || 10)); // full results kept on disk
const TTL_MS = (Number(process.env.RESULT_TTL_MINUTES) || 7 * 24 * 60) * 60000;           // default: 7 days (the history summary is kept longer)

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
  next();
});

// Block cross-site state-changing requests.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch { /* invalid */ }
    if (!ok) return res.status(403).json({ error: 'Cross-origin request blocked' });
  }
  next();
});
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// The PDF report accepts a logo as a data URL (max ~1.5 MB), so only that route gets a bigger body limit.
app.use('/api/crawls/:id/report', express.json({ limit: '2.6mb' }));
app.use(express.json({ limit: '2kb' }));

// ---- Storage: crawls are saved to disk so every server process (and a restart) can read them ----
const store = createStore(pickDir());
const live = new Map(); // crawls running inside THIS process
setInterval(() => {
  try { store.evict(TTL_MS, MAX_STORED); } catch (e) { console.error('Cleanup failed:', e.message); }
}, 60000).unref();

function startCrawl(crawl) {
  live.set(crawl.id, crawl);
  crawl.run().catch(e => console.error(e)).finally(() => live.delete(crawl.id));
  keepAwake();
}

// Hosts such as Hostinger/LiteSpeed stop or restart the Node process when it gets no requests for a while
// (for example when the dashboard tab is closed or in the background), which used to kill a running crawl.
// The crawl's queue is saved to disk every second, so whichever process handles the next request carries it on.
let lastResumeCheck = 0;
function resumeStalled(force = false) {
  if (!force && Date.now() - lastResumeCheck < 2000) return;
  lastResumeCheck = Date.now();
  try {
    for (const m of store.stalled()) {
      if (live.has(m.id)) continue;
      const claim = store.claim(m.id);
      if (!claim) continue; // another process got there first
      const saved = store.loadForResume(m.id);
      if (!saved) continue;
      const crawl = Crawl.restore(m.id, saved.meta, saved.state, saved.data, { ...app.locals.crawlOptions, store });
      crawl.claim = claim;
      console.log(`Carrying on crawl ${m.id} (${crawl.results.length} pages done, ${crawl.queue.length} queued)`);
      startCrawl(crawl);
    }
  } catch (e) { console.error('Could not resume a crawl:', e.message); }
}
setInterval(resumeStalled, 5000).unref();
app.use('/api', (req, res, next) => { rememberOrigin(req); resumeStalled(); next(); });

// While a crawl runs, the server requests its own public address every 30 s so the host sees activity and
// doesn't put the app to sleep. Set PUBLIC_URL (e.g. https://audit.example.com) to choose the address,
// or KEEP_AWAKE=0 to turn this off. Without PUBLIC_URL the address the dashboard was opened on is used.
let publicOrigin = '';
function rememberOrigin(req) {
  if (process.env.PUBLIC_URL || publicOrigin) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) || !/^https?$/.test(proto)) return;
  try { publicOrigin = checkUrl(proto + '://' + host).origin; } catch { /* local or private address: no need to keep awake */ }
}
let awakeTimer = null;
function keepAwake() {
  if (awakeTimer || process.env.KEEP_AWAKE === '0' || process.env.NODE_ENV === 'test') return;
  awakeTimer = setInterval(() => {
    if (!live.size) { clearInterval(awakeTimer); awakeTimer = null; return; }
    let origin = publicOrigin;
    if (process.env.PUBLIC_URL) { try { origin = new URL(process.env.PUBLIC_URL).origin; } catch { origin = ''; } }
    if (!origin) return;
    const u = new URL('/api/crawls/' + [...live.keys()][0], origin);
    const req = (u.protocol === 'https:' ? https : http).get(u, { timeout: 10000, lookup: process.env.PUBLIC_URL ? undefined : safeLookup,
      headers: { 'User-Agent': 'ModerniseSiteAuditor-keepalive' } }, r => r.resume());
    req.on('timeout', () => req.destroy());
    req.on('error', () => { /* best effort */ });
  }, 30000);
  awakeTimer.unref();
}

// On a normal shutdown (deploy, host restart) save running crawls so the next process carries them on at once.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    for (const c of live.values()) c.pause();
    process.exit(0);
  });
}

function find(req, res, next) {
  const view = store.get(req.params.id);
  if (!view) return res.status(404).json({ error: 'Crawl not found. It may have expired: results are only kept for a limited time.' });
  req.view = view;
  next();
}

// ---- API ----
app.get('/api/status', (req, res) => res.json({ live: true, defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT }));

// Handy when something misbehaves on the host: open /api/diagnostics in the browser (login required) and read what the server sees.
app.get('/api/diagnostics', (req, res) => {
  let writable = false;
  try { require('fs').accessSync(store.root, require('fs').constants.W_OK); writable = true; } catch { /* not writable */ }
  res.json({ node: process.version, pid: process.pid, uptimeSeconds: Math.round(process.uptime()), dataDir: store.root, dataDirWritable: writable,
    crawlsRunningInThisProcess: [...live.keys()], savedCrawls: store.list().map(m => ({ id: m.id, status: m.status, site: m.site, pages: m.pagesCrawled, phase: m.phase || '', message: m.message || '' })) });
});

app.post('/api/crawls', async (req, res, next) => {
  try {
    if (store.isBusy()) return res.status(409).json({ error: 'A crawl is already running. Cancel it or wait for it to finish.' });
    const body = req.body || {};
    let u;
    try { u = parseUserUrl(body.url); await preflight(u); }
    catch (e) { return res.status(400).json({ error: e instanceof UrlError ? e.message : 'Could not resolve that website' }); }
    let limit = Number.parseInt(body.limit, 10);
    if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;
    limit = Math.min(MAX_LIMIT, Math.max(1, limit));
    if (store.isBusy()) return res.status(409).json({ error: 'A crawl is already running.' });
    store.evict(TTL_MS, MAX_STORED - 1);
    const crawl = new Crawl(crypto.randomBytes(12).toString('hex'), u, limit, { ...app.locals.crawlOptions, store });
    startCrawl(crawl);
    res.status(201).json(crawl.progress());
  } catch (e) { next(e); }
});

// History of audits (summary only). Opening one works while its results are still saved.
app.get('/api/history', (req, res) => res.json({ items: store.history(), keepsResultsFor: Math.round(TTL_MS / 60000), keepsLast: MAX_STORED }));
app.post('/api/history/:id/delete', (req, res) => {
  if (!store.removeHistory(req.params.id)) return res.status(409).json({ error: 'That audit is still running or could not be found.' });
  res.json({ ok: true });
});

// One page's full details (used when you click an issue, link or image to see the page it belongs to)
app.get('/api/crawls/:id/page', find, (req, res) => {
  const url = String(req.query.url || '');
  const page = req.view.analysis().pages.find(p => p.url === url);
  if (!page) return res.status(404).json({ error: 'That page is not part of this audit.' });
  res.json(page);
});

app.get('/api/crawls/:id', find, (req, res) => res.json(req.view.progress()));

// pages | issues | links | images, each with ?q= search, filters, ?sort=&dir= (pages), ?offset=&limit=
app.get('/api/crawls/:id/:section(pages|issues|links|images)', find, (req, res) => {
  res.json(queryList(req.params.section, req.view.analysis(), req.query));
});

app.post('/api/crawls/:id/cancel', find, (req, res) => {
  store.requestCancel(req.params.id); // works even if another server process is running the crawl
  const c = live.get(req.params.id);
  if (c) { c.cancel(); return res.json(c.progress()); }
  const p = req.view.progress();
  res.json(['queued', 'running'].includes(p.status) ? { ...p, status: 'cancelling' } : p);
});

// Branded PDF report. Body: { company, client, accent, logoAlign, logo: 'data:image/png;base64,...' } (all optional)
app.post('/api/crawls/:id/report', find, (req, res) => {
  if (!['done', 'cancelled', 'error'].includes(req.view.meta.status)) return res.status(409).json({ error: 'The audit is still running. Please wait for it to finish before creating the report.' });
  let pdf;
  try { pdf = buildReport(req.view, req.body || {}); }
  catch (e) {
    if (e instanceof PdfError) return res.status(400).json({ error: e.message });
    console.error('Report failed:', e);
    return res.status(500).json({ error: 'The report could not be created.' });
  }
  const site = String(req.view.meta.site || 'site').replace(/[^a-z0-9.-]/gi, '');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdf.length,
    'Content-Disposition': `attachment; filename="modernise-seo-report-${site}-${new Date().toISOString().slice(0, 10)}.pdf"` });
  res.send(pdf);
});

// pages | issues | links | broken-links | images: always ALL records, never just the visible table rows
app.get('/api/crawls/:id/export/:file', find, (req, res) => {
  const name = String(req.params.file).replace(/\.csv$/, '');
  const csv = exportCsv(name, req.view.analysis());
  if (csv === null) return res.status(404).json({ error: 'Unknown export' });
  const site = String(req.view.meta.site || 'site').replace(/[^a-z0-9.-]/gi, '');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="modernise-${name}-${site}-${new Date().toISOString().slice(0, 10)}.csv"` });
  res.send(csv);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Frontend ----
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Server error: ' + String(err && err.message || err).slice(0, 200) });
});

process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
// A bug must not lose a running audit: save it so the restarted process carries it on, then exit as Node normally would.
process.on('uncaughtException', e => {
  console.error('Uncaught exception:', e);
  for (const c of live.values()) { try { c.pause(); } catch { /* ignore */ } }
  process.exit(1);
});
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Modernise Site Auditor listening on port ${PORT}`));
  setImmediate(() => resumeStalled(true)); // a crawl paused by the previous process carries on straight away
}
module.exports = { app, resumeStalled, live };
