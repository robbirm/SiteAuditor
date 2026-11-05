'use strict';
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const { fetchUrl, fetchFollow } = require('./fetcher');
const { checkUrl, hostKey } = require('./safeUrl');
const { analyze } = require('./analysis');

const BOT = 'ModerniseSiteAuditor';
const MAX_SEEN = 20000, MAX_LINKS = 100000, MAX_IMAGES = 50000;
const MAX_CRAWL_MS = (Number(process.env.MAX_CRAWL_MINUTES) || 20) * 60000; // time spent actually crawling (pauses don't count)
const RETRY_DELAY_MS = 2000; // a page that times out / fails to connect / returns 429 or 503 is tried once more after this
const SKIP_EXT = /\.(?:jpe?g|png|gif|webp|svg|ico|avif|bmp|tiff?|pdf|zip|gz|tgz|rar|7z|mp[34]|mov|avi|wmv|webm|wav|css|js|mjs|json|xml|txt|woff2?|ttf|eot|otf|docx?|xlsx?|pptx?|csv|dmg|exe|apk|iso)$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

class Crawl {
  // opts (used by tests): fetchUrl, fetchFollow, delayMs
  constructor(id, startUrl, limit, opts = {}) {
    this.id = id;
    this.startUrl = startUrl.href;
    this.site = hostKey(startUrl.hostname); // example.com and www.example.com count as the same site
    this.limit = limit;
    this.fetchUrl = opts.fetchUrl || fetchUrl;
    this.fetchFollow = opts.fetchFollow || fetchFollow;
    this.minDelayMs = opts.delayMs === undefined ? 300 : opts.delayMs;
    this.delayMs = this.minDelayMs;
    this.status = 'queued';
    this.results = [];
    this.links = [];   // raw link records, resolved to statuses by analysis
    this.images = [];  // raw image records
    this.queue = [];
    this.seen = new Set();
    this.from = new Map();
    this.reserved = 0;   // requests started (counts toward the page limit)
    this.completed = 0;  // requests finished
    this.active = 0;
    this.maxActive = 0;
    this.blocked = 0;
    this.notes = [];
    this.message = '';
    this.robotsCache = new Map();
    this.controller = new AbortController();
    this.startedAt = null;
    this.finishedAt = null;
    this.timedOut = false;
    this._a = null;
    this.store = opts.store || null; // optional disk store (see lib/store.js)
    this.imageChecks = [];  // file size / HTTP status of images (see checkImages)
    this.phase = 'Starting';
    this.siteChecks = null; // robots.txt / sitemap / HTTPS facts
    this.robotsInfo = {};
    this.deadline = Infinity;
    this.inflight = new Set(); // URLs being fetched right now (saved back into the queue if the server stops)
    this.stage = 'site';       // site -> pages -> images -> finished; a resumed crawl continues from its stage
    this.activeMs = 0;         // crawling time used by earlier runs of this crawl (before a server restart)
    this.resumes = 0;          // how many times this crawl was picked up again after the server stopped
    this.retryDelayMs = opts.retryDelayMs === undefined ? RETRY_DELAY_MS : opts.retryDelayMs;
    this.superseded = false;   // another server process took this crawl over: stop without writing anything
  }

  // Everything needed to carry on with this crawl in another server process. Taken in the same synchronous step
  // as the results are written (store.flush), so the saved queue always matches the saved results.
  snapshot() {
    const queue = [...this.inflight, ...this.queue];
    const from = {};
    for (const u of queue) from[u] = this.from.get(u) || '';
    return { v: 1, stage: this.stage, queue, seen: [...this.seen], from, delayMs: this.delayMs, notes: this.notes,
      siteChecks: this.siteChecks, robotsInfo: this.robotsInfo, activeMs: this.elapsed(), resumes: this.resumes,
      startedAt: this.startedAt, imagesChecked: this.imageChecks.length };
  }

  // Rebuilds a crawl from a snapshot plus the results already saved on disk.
  static restore(id, meta, state, data, opts = {}) {
    const c = new Crawl(id, new URL(meta.startUrl), meta.limit, opts);
    c.results = data.results || []; c.links = data.links || []; c.images = data.images || []; c.imageChecks = data.imageChecks || [];
    const done = new Set(c.results.map(r => r.url));
    c.queue = (state.queue || []).filter(u => !done.has(u));
    c.seen = new Set(state.seen);
    c.from = new Map(Object.entries(state.from || {}));
    c.completed = c.results.filter(r => !r.blocked).length;
    c.reserved = c.completed;
    c.blocked = c.results.length - c.completed;
    c.notes = state.notes || [];
    c.siteChecks = state.siteChecks || null;
    c.robotsInfo = state.robotsInfo || {};
    c.delayMs = Math.max(c.minDelayMs, state.delayMs || 0);
    c.activeMs = state.activeMs || 0;
    c.resumes = (state.resumes || 0) + 1;
    c.stage = state.stage || 'pages';
    c.startedAt = state.startedAt || meta.startedAt;
    c._resumed = true;
    return c;
  }

  elapsed() { return this.activeMs + (this._segStart ? Date.now() - this._segStart : 0); }

  note(msg) { if (this.notes.length < 20 && !this.notes.includes(msg)) this.notes.push(msg); }

  enqueue(u, from) {
    const href = u.href;
    if (this.seen.has(href)) return;
    if (this.seen.size >= MAX_SEEN) { this.note('URL discovery stopped at ' + MAX_SEEN + ' URLs.'); return; }
    this.seen.add(href);
    this.queue.push(href);
    this.from.set(href, from || '');
  }

  follow(t, from) {
    if (t.protocol !== 'http:' && t.protocol !== 'https:') return;
    if (t.username || t.password) return;
    if (hostKey(t.hostname) !== this.site) return;
    if (SKIP_EXT.test(t.pathname)) return;
    t.hash = '';
    this.enqueue(t, from);
  }

  async run() {
    this.status = 'running';
    this._segStart = Date.now();
    if (!this.startedAt) this.startedAt = this._segStart;
    const signal = this.controller.signal;
    this.deadline = this._segStart + Math.max(0, MAX_CRAWL_MS - this.activeMs);
    const deadline = this.deadline;
    try {
      if (this.store) {
        if (this._resumed) this.store.adopt(this); else this.store.init(this);
        this._tick = setInterval(() => { // save progress + heartbeat every second; pick up cancel requests from other processes
          try {
            if (this.store.superseded && this.store.superseded(this)) { this.superseded = true; this.controller.abort(); return; }
            if (this.store.cancelRequested(this.id)) this.cancel();
            this.store.flush(this);
          } catch (e) { console.error('Could not save crawl progress:', e.message); }
        }, 1000);
      }
      if (this._resumed) this.note('The server restarted during this audit, so it carried on from where it stopped.');
      if (this.stage === 'site') {
        this.enqueue(checkUrl(this.startUrl), '');
        this.phase = 'Checking robots.txt and sitemap';
        await this.checkSite();
        this.stage = 'pages';
      }
      if (this.stage === 'pages' && !signal.aborted) {
        this.phase = 'Crawling pages';
        const worker = async () => {
          while (!signal.aborted) {
            if (Date.now() > deadline) { this.timedOut = true; return; }
            if (this.reserved >= this.limit) return;
            const href = this.queue.shift();
            if (!href) {
              if (this.active === 0) return;
              await sleep(20);
              continue;
            }
            this.active++;
            this.inflight.add(href);
            this.maxActive = Math.max(this.maxActive, this.active);
            try { await this.processUrl(href); }
            catch (e) { // one bad page must never end the whole audit
              if (signal.aborted) break;
              console.error('Page failed:', href, e);
              const row = this.blank(href, { note: clip('Could not be audited: ' + (e && e.message), 200) });
              this.completed++; this.results.push(row);
            } finally { this.active--; this.inflight.delete(href); }
            if (this.delayMs) await sleep(this.delayMs);
          }
        };
        await Promise.all([worker(), worker()]); // never more than 2 requests at once
        if (!signal.aborted && !this.timedOut) this.stage = 'images';
      }
      if (this.stage === 'images' && !signal.aborted && !this.timedOut) {
        try { await this.checkImages(); } catch (e) { console.error('Image check failed:', e.message); }
        if (!signal.aborted) this.stage = 'finished';
      }
      if (signal.aborted) this.status = 'cancelled';
      else {
        this.status = 'done';
        this.stage = 'finished';
        if (this.timedOut) this.note('Stopped at the crawl time limit (' + Math.round(MAX_CRAWL_MS / 60000) + ' minutes). Raise MAX_CRAWL_MINUTES to allow longer audits.');
        else if (this.queue.length) this.note(this.queue.length + ' discovered URLs were not crawled because the page limit was reached.');
      }
    } catch (e) {
      console.error('Crawl failed:', e);
      this.status = 'error';
      this.message = 'The crawl failed unexpectedly.';
    }
    if (this._tick) clearInterval(this._tick);
    if (this.superseded) return; // another process carries on with this crawl; leave its files alone
    this.activeMs = this.elapsed(); this._segStart = null;
    this.phase = '';
    this.finishedAt = Date.now();
    if (this.store) { try { this.store.flush(this); } catch (e) { console.error('Could not save final crawl state:', e.message); } }
    if (this.store && this.store.saveHistory) { try { this.store.saveHistory(this); } catch (e) { console.error('Could not save the history entry:', e.message); } }
  }

  // The server is shutting down (e.g. the host restarts the app): save everything so another process can carry on.
  pause() {
    if (!['running', 'queued'].includes(this.status)) return false;
    if (this._tick) clearInterval(this._tick);
    this.superseded = true; // stop the workers without marking the crawl cancelled or writing a final state
    if (this.store && this.store.pause) { try { this.store.pause(this); } catch (e) { console.error('Could not save crawl for resuming:', e.message); } }
    this.controller.abort();
    return true;
  }

  async processUrl(href) {
    const signal = this.controller.signal;
    const u = new URL(href);
    const rb = await this.getRobots(u.origin);
    if (signal.aborted) return;
    if (rb.disallowAll || (rb.parser && rb.parser.isAllowed(href, BOT) === false)) {
      this.blocked++;
      this.results.push(this.blank(href, { note: 'Blocked by robots.txt', blocked: true }));
      return;
    }
    if (this.reserved >= this.limit) return;
    this.reserved++;
    const row = this.blank(href);
    try {
      const r = await this.fetchWithRetry(href, { signal, timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 });
      this.fill(row, r, u);
    } catch (e) {
      if (signal.aborted) { this.reserved--; return; }
      row.note = clip(e.message, 200); // status stays 0: reported as "Page failed to load"
    }
    this.completed++;
    this.results.push(row);
  }

  // Busy or flaky servers often fail one request and answer the next. A timeout, a connection error, 429 or 503
  // gets one more try after a short pause (longer if the server sends Retry-After, up to 10 s).
  async fetchWithRetry(href, opts) {
    let r;
    try { r = await this.fetchUrl(href, opts); }
    catch (e) {
      if (opts.signal && opts.signal.aborted) throw e;
      await this.pauseFor(this.retryDelayMs, opts.signal);
      return this.fetchUrl(href, opts);
    }
    if (r.status === 429 || r.status === 503) {
      const ra = Number(r.headers && r.headers['retry-after']);
      await this.pauseFor(Number.isFinite(ra) && ra > 0 ? Math.min(10000, ra * 1000) : this.retryDelayMs, opts.signal);
      try { return await this.fetchUrl(href, opts); } catch (e) { if (opts.signal && opts.signal.aborted) throw e; return r; }
    }
    return r;
  }

  pauseFor(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = setTimeout(done, ms);
      function done() { if (signal) signal.removeEventListener('abort', ab); res(); }
      function ab() { clearTimeout(t); rej(new Error('Cancelled')); }
      if (signal) { if (signal.aborted) return ab(); signal.addEventListener('abort', ab, { once: true }); }
    });
  }

  // Extracts SEO data, links and images from one response. Issues are decided later by lib/analysis.js.
  fill(row, r, u) {
    row.status = r.status;
    row.contentType = clip(r.contentType, 100);
    row.responseMs = r.responseMs;
    const loc = r.headers.location;
    if (r.status >= 300 && r.status < 400 && loc) {
      try { const t = new URL(loc, u); row.redirectTo = t.href; this.follow(t, u.href); } catch { /* ignore bad Location */ }
    }
    if (r.status < 200 || r.status >= 300) return;
    if (!r.body) { row.note = 'Non-HTML content'; return; }
    if (r.truncated) row.note = 'Response truncated at 2 MB';

    const $ = cheerio.load(r.body.toString('utf8'));
    row.parsed = true;
    row.title = clip($('title').first().text(), 500);
    row.metaDescription = clip($('meta[name="description" i]').first().attr('content'), 1000);
    const h1s = $('h1').map((_, el) => clip($(el).text(), 300)).get().filter(Boolean);
    row.h1 = h1s.slice(0, 20);
    row.h1Count = h1s.length;
    const c = ($('link[rel="canonical" i]').first().attr('href') || '').trim();
    if (c) { try { row.canonical = new URL(c, u).href; } catch { row.canonical = clip(c, 500); } }
    row.metaRobots = clip($('meta[name="robots" i]').first().attr('content'), 100);
    row.xRobots = clip(r.headers['x-robots-tag'], 100);
    row.lang = clip($('html').attr('lang'), 20);
    row.viewport = !!clip($('meta[name="viewport" i]').first().attr('content'), 200);

    const nofollow = /nofollow/i.test(row.metaRobots + ' ' + row.xRobots);
    const seenDest = new Set();
    $('a[href]').each((_, el) => {
      const raw = ($(el).attr('href') || '').trim();
      if (!raw || raw[0] === '#' || /^(mailto|tel|javascript|data|sms|ftp|file):/i.test(raw)) return;
      let t;
      try { t = new URL(raw, u); } catch { return; }
      if ((t.protocol !== 'http:' && t.protocol !== 'https:') || t.username || t.password) return;
      t.hash = '';
      if (!nofollow) this.follow(t, u.href);
      if (seenDest.has(t.href) || seenDest.size >= 1000) return;
      seenDest.add(t.href);
      if (this.links.length >= MAX_LINKS) { this.note('Link recording stopped at ' + MAX_LINKS + ' links.'); return; }
      this.links.push({ source: u.href, destination: t.href, anchor: clip($(el).text(), 200) || ($(el).find('img').length ? '[image]' : ''),
        internal: hostKey(t.hostname) === this.site });
    });

    const seenImg = new Set();
    $('img').each((_, el) => {
      if (seenImg.size >= 300) return false;
      const raw = ($(el).attr('src') || $(el).attr('data-src') || '').trim();
      if (!raw || /^data:/i.test(raw)) return;
      let t;
      try { t = new URL(raw, u); } catch { return; }
      if (t.protocol !== 'http:' && t.protocol !== 'https:') return;
      t.hash = '';
      if (seenImg.has(t.href)) return;
      seenImg.add(t.href);
      if (this.images.length >= MAX_IMAGES) return;
      const alt = $(el).attr('alt');
      this.images.push({ page: u.href, src: t.href, alt: alt === undefined ? null : clip(alt, 300) });
    });
    $('script, style, noscript').remove();
    row.words = $('body').text().split(/\s+/).filter(Boolean).length;
  }

  blank(url, extra = {}) {
    return { url, status: 0, contentType: '', parsed: false, blocked: false, title: '', metaDescription: '', h1: [], h1Count: 0,
      canonical: '', words: 0, lang: '', viewport: false, metaRobots: '', xRobots: '', redirectTo: '', responseMs: '', discoveredFrom: this.from.get(url) || '', note: '', ...extra };
  }

  getRobots(origin) {
    if (!this.robotsCache.has(origin)) this.robotsCache.set(origin, this.loadRobots(origin));
    return this.robotsCache.get(origin);
  }

  // 2xx: obey rules. 4xx: no rules (allowed). 5xx / unreachable: treated as "do not crawl" to stay polite.
  async loadRobots(origin) {
    try {
      const opts = { timeoutMs: 10000, maxBytes: 512 * 1024, signal: this.controller.signal, anyType: true };
      let r;
      try { r = await this.fetchFollow(origin + '/robots.txt', opts); }
      catch (e) { if (this.controller.signal.aborted) throw e; await this.pauseFor(this.retryDelayMs, opts.signal); r = await this.fetchFollow(origin + '/robots.txt', opts); }
      if (r.status >= 500) { await this.pauseFor(this.retryDelayMs, opts.signal); r = await this.fetchFollow(origin + '/robots.txt', opts); }
      this.robotsInfo[origin] = { status: r.status, sitemaps: [] };
      if (r.status >= 200 && r.status < 300) {
        const parser = robotsParser(origin + '/robots.txt', (r.body || Buffer.alloc(0)).toString('utf8'));
        this.robotsInfo[origin].sitemaps = (parser.getSitemaps && parser.getSitemaps()) || [];
        const cd = parser.getCrawlDelay(BOT);
        if (cd > 0) this.delayMs = Math.min(10000, Math.max(this.minDelayMs, cd * 1000));
        return { parser };
      }
      if (r.status >= 400 && r.status < 500) return { parser: null };
      this.note('robots.txt returned HTTP ' + r.status + ' for ' + origin + ', so it was not crawled.');
      return { disallowAll: true };
    } catch (e) {
      if (!this.controller.signal.aborted) this.note('Could not fetch robots.txt for ' + origin + ' (' + clip(e.message, 80) + '), so it was not crawled.');
      return { disallowAll: true };
    }
  }

  // Site-level facts for the report: HTTPS, robots.txt and sitemap.xml (one or two small requests).
  async checkSite() {
    const start = new URL(this.startUrl);
    this.siteChecks = { https: start.protocol === 'https:', robots: { found: false, status: 0 }, sitemap: { found: false, url: '', urls: 0 } };
    try {
      const rb = await this.getRobots(start.origin);
      const info = this.robotsInfo[start.origin] || {};
      this.siteChecks.robots = { found: info.status >= 200 && info.status < 300, status: info.status || 0 };
      if (rb.disallowAll) return;
      const candidates = [...new Set([...(info.sitemaps || []).slice(0, 1), start.origin + '/sitemap.xml'])];
      for (const url of candidates) {
        try {
          const r = await this.fetchFollow(url, { timeoutMs: 10000, maxBytes: 2 * 1024 * 1024, signal: this.controller.signal, anyType: true });
          const text = r.status >= 200 && r.status < 300 && r.body ? r.body.toString('utf8') : '';
          if (/<(urlset|sitemapindex)\b/i.test(text)) {
            const locs = await this.sitemapLocs(text);
            this.siteChecks.sitemap = { found: true, url, urls: locs.length };
            this.seedFromSitemap(locs);
            break;
          }
        } catch { /* try the next candidate */ }
      }
    } catch { /* site checks are best-effort */ }
  }

  // <loc> URLs of a sitemap. A sitemap index lists other sitemaps: read up to 5 of them (same site only).
  async sitemapLocs(text) {
    const locOf = t => [...t.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
    if (!/<sitemapindex\b/i.test(text)) return locOf(text);
    const out = [];
    for (const child of locOf(text).slice(0, 5)) {
      try {
        const u = new URL(child);
        if (hostKey(u.hostname) !== this.site) continue;
        const r = await this.fetchFollow(child, { timeoutMs: 10000, maxBytes: 2 * 1024 * 1024, signal: this.controller.signal, anyType: true });
        if (r.status >= 200 && r.status < 300 && r.body) out.push(...locOf(r.body.toString('utf8')));
      } catch { /* skip this sitemap */ }
      if (out.length > 5000) break;
    }
    return out;
  }

  // Pages listed in the sitemap are crawled too. This matters for sites whose menus are built by JavaScript,
  // where following links finds almost nothing. Same-site URLs only; the page limit still applies.
  seedFromSitemap(locs) {
    let added = 0;
    for (const loc of locs.slice(0, 5000)) {
      let t; try { t = new URL(loc); } catch { continue; }
      const before = this.seen.size;
      this.follow(t, 'sitemap');
      if (this.seen.size > before) added++;
    }
    if (added) this.note(added + ' page(s) were found through the sitemap.');
  }

  // After the pages: look at the file size / status of this site's images (headers only, no downloads).
  async checkImages() {
    const signal = this.controller.signal;
    const limit = Number(process.env.IMAGE_CHECK_LIMIT) || 150;
    const seen = new Set(this.imageChecks.map(c => c.src)), unique = [];
    const already = seen.size;
    for (const i of this.images) {
      if (seen.has(i.src)) continue;
      seen.add(i.src);
      let u; try { u = new URL(i.src); } catch { continue; }
      if (hostKey(u.hostname) === this.site) unique.push(i.src);
    }
    if (!unique.length) return;
    const todo = unique.slice(0, Math.max(0, limit - already));
    if (!todo.length) return;
    if (unique.length > todo.length && !already) this.note('Checked file sizes for ' + todo.length + ' of ' + unique.length + ' images (limit ' + limit + ').');
    this.phase = 'Checking image sizes (' + todo.length + ' images)';
    let next = 0;
    const worker = async () => {
      while (!signal.aborted && Date.now() < this.deadline) {
        const i = next++;
        if (i >= todo.length) return;
        await this.checkImage(todo[i]);
        if (this.delayMs) await sleep(this.delayMs);
      }
    };
    await Promise.all([worker(), worker()]);
  }

  async checkImage(src) {
    const signal = this.controller.signal;
    const rec = { src, status: 0, bytes: null, contentType: '', note: '' };
    try {
      const u = new URL(src);
      const rb = await this.getRobots(u.origin);
      if (rb.disallowAll || (rb.parser && rb.parser.isAllowed(src, BOT) === false)) return; // not checked
      const r = await this.fetchUrl(src, { signal, timeoutMs: 10000, maxBytes: 1024 });
      rec.status = r.status;
      rec.contentType = clip(r.contentType, 80);
      const raw = r.headers['content-length'];
      const len = Number(raw);
      rec.bytes = raw !== undefined && Number.isFinite(len) && len >= 0 ? len : null;
    } catch (e) {
      if (signal.aborted) return;
      rec.note = clip(e.message, 100);
    }
    this.imageChecks.push(rec);
  }

  cancel() {
    if (this.status === 'running' || this.status === 'queued') { this.status = 'cancelling'; this.controller.abort(); }
  }

  // Cached analysis. While crawling it is refreshed at most every 2 s; `force` always recomputes.
  analysis(force = false) {
    const key = [this.results.length, this.completed, this.links.length, this.images.length, this.imageChecks.length, this.status].join(':');
    const now = Date.now();
    if (!force && this._a && (this._key === key || (this.status === 'running' && now - this._at < 2000))) return this._a;
    this._a = analyze(this.results, this.links, this.images, this.imageChecks);
    this._key = key; this._at = now;
    return this._a;
  }

  // Everything except the (large) analysis: this is what gets saved to disk.
  meta() {
    const total = Math.max(1, Math.min(this.limit, this.seen.size));
    return {
      id: this.id, status: this.status, startUrl: this.startUrl, site: this.site, limit: this.limit,
      pagesCrawled: this.completed, queued: this.queue.length, discovered: this.seen.size,
      blockedByRobots: this.blocked,
      percent: this.status === 'done' ? 100 : Math.min(99, Math.round(this.completed / total * 100)),
      notes: this.notes, message: this.message, startedAt: this.startedAt, finishedAt: this.finishedAt,
      phase: this.phase, siteChecks: this.siteChecks
    };
  }

  progress() { return { ...this.meta(), summary: this.analysis().summary }; }
}

module.exports = { Crawl };
