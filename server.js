'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Crawl } = require('./lib/crawler');
const { parseUserUrl, preflight, UrlError } = require('./lib/safeUrl');
const { toCsv } = require('./lib/csv');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD must be set to at least 12 characters. Refusing to start.');
  process.exit(1);
}
const DEFAULT_LIMIT = 500, MAX_LIMIT = 1000, MAX_STORED = 5;
const TTL_MS = (Number(process.env.RESULT_TTL_MINUTES) || 120) * 60000;

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
  next();
});

// ---- Private access: HTTP Basic auth on everything (UI and API) ----
const digest = s => crypto.createHash('sha256').update(String(s)).digest();
const failures = new Map(); // ip -> { n, reset }
function auth(req, res, next) {
  const f = failures.get(req.ip);
  if (f && f.n >= 10 && Date.now() < f.reset) return res.status(429).type('text').send('Too many failed attempts. Try again later.');
  const m = /^Basic (.+)$/i.exec(req.headers.authorization || '');
  if (m) {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const user = i < 0 ? decoded : decoded.slice(0, i), pass = i < 0 ? '' : decoded.slice(i + 1);
    const okUser = crypto.timingSafeEqual(digest(user), digest(ADMIN_USER));
    const okPass = crypto.timingSafeEqual(digest(pass), digest(ADMIN_PASSWORD));
    if (okUser && okPass) return next();
    const live = f && Date.now() < f.reset;
    failures.set(req.ip, { n: (live ? f.n : 0) + 1, reset: live ? f.reset : Date.now() + 15 * 60000 });
  }
  res.set('WWW-Authenticate', 'Basic realm="Modernise Site Auditor", charset="UTF-8"').status(401).type('text').send('Authentication required');
}
app.use(auth);

// Block cross-site state-changing requests (browsers cache Basic credentials).
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
app.use(express.json({ limit: '2kb' }));

// ---- Temporary in-memory storage (cleared on restart) ----
const crawls = new Map();
const isBusy = () => [...crawls.values()].some(c => ['queued', 'running', 'cancelling'].includes(c.status));
function evict() {
  const finished = [...crawls.values()].filter(c => c.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
  for (const c of finished) if (Date.now() - c.finishedAt > TTL_MS) crawls.delete(c.id);
  const left = finished.filter(c => crawls.has(c.id));
  while (left.length >= MAX_STORED) crawls.delete(left.shift().id);
}
setInterval(() => { evict(); for (const [ip, f] of failures) if (Date.now() > f.reset) failures.delete(ip); }, 60000).unref();

function find(req, res, next) {
  const c = /^[a-f0-9]{24}$/.test(req.params.id) && crawls.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Crawl not found. Results are only kept temporarily.' });
  req.crawl = c;
  next();
}

// ---- API ----
app.post('/api/crawls', async (req, res, next) => {
  try {
    if (isBusy()) return res.status(409).json({ error: 'A crawl is already running. Cancel it or wait for it to finish.' });
    const body = req.body || {};
    let u;
    try { u = parseUserUrl(body.url); await preflight(u); }
    catch (e) { return res.status(400).json({ error: e instanceof UrlError ? e.message : 'Could not resolve that website' }); }
    let limit = Number.parseInt(body.limit, 10);
    if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;
    limit = Math.min(MAX_LIMIT, Math.max(1, limit));
    if (isBusy()) return res.status(409).json({ error: 'A crawl is already running.' });
    evict();
    const crawl = new Crawl(crypto.randomBytes(12).toString('hex'), u, limit);
    crawls.set(crawl.id, crawl);
    crawl.run().catch(e => console.error(e));
    res.status(201).json(crawl.progress());
  } catch (e) { next(e); }
});

app.get('/api/crawls/:id', find, (req, res) => res.json(req.crawl.progress()));

app.get('/api/crawls/:id/pages', find, (req, res) => {
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
  res.json({ total: req.crawl.results.length, offset, pages: req.crawl.page(offset, limit) });
});

app.post('/api/crawls/:id/cancel', find, (req, res) => { req.crawl.cancel(); res.json(req.crawl.progress()); });

app.get('/api/crawls/:id/export/pages.csv', find, (req, res) => {
  const site = req.crawl.site.replace(/[^a-z0-9.-]/gi, '');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="modernise-pages-${site}-${new Date().toISOString().slice(0, 10)}.csv"` });
  res.send(toCsv(req.crawl.results)); // ALL scanned pages
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Frontend ----
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
app.listen(PORT, () => console.log(`Modernise Site Auditor listening on port ${PORT}`));
