'use strict';
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const { fetchUrl, fetchFollow } = require('./fetcher');
const { checkUrl, hostKey } = require('./safeUrl');
const { analyze } = require('./analysis');

const BOT = 'ModerniseSiteAuditor';
const MAX_SEEN = 20000, MAX_LINKS = 100000, MAX_IMAGES = 50000;
const MAX_CRAWL_MS = (Number(process.env.MAX_CRAWL_MINUTES) || 20) * 60000;
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
  }

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
    this.startedAt = Date.now();
    const signal = this.controller.signal;
    const deadline = this.startedAt + MAX_CRAWL_MS;
    try {
      this.enqueue(checkUrl(this.startUrl), '');
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
          this.maxActive = Math.max(this.maxActive, this.active);
          try { await this.processUrl(href); } finally { this.active--; }
          if (this.delayMs) await sleep(this.delayMs);
        }
      };
      await Promise.all([worker(), worker()]); // never more than 2 requests at once
      if (signal.aborted) this.status = 'cancelled';
      else {
        this.status = 'done';
        if (this.timedOut) this.note('Stopped at the crawl time limit.');
        else if (this.queue.length) this.note(this.queue.length + ' discovered URLs were not crawled because the page limit was reached.');
      }
    } catch (e) {
      console.error('Crawl failed:', e);
      this.status = 'error';
      this.message = 'The crawl failed unexpectedly.';
    }
    this.finishedAt = Date.now();
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
      const r = await this.fetchUrl(href, { signal, timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 });
      this.fill(row, r, u);
    } catch (e) {
      if (signal.aborted) { this.reserved--; return; }
      row.note = clip(e.message, 200); // status stays 0: reported as "Page failed to load"
    }
    this.completed++;
    this.results.push(row);
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
  }

  blank(url, extra = {}) {
    return { url, status: 0, contentType: '', parsed: false, blocked: false, title: '', metaDescription: '', h1: [], h1Count: 0,
      canonical: '', metaRobots: '', xRobots: '', redirectTo: '', responseMs: '', discoveredFrom: this.from.get(url) || '', note: '', ...extra };
  }

  getRobots(origin) {
    if (!this.robotsCache.has(origin)) this.robotsCache.set(origin, this.loadRobots(origin));
    return this.robotsCache.get(origin);
  }

  // 2xx: obey rules. 4xx: no rules (allowed). 5xx / unreachable: treated as "do not crawl" to stay polite.
  async loadRobots(origin) {
    try {
      const r = await this.fetchFollow(origin + '/robots.txt', { timeoutMs: 10000, maxBytes: 512 * 1024, signal: this.controller.signal, anyType: true });
      if (r.status >= 200 && r.status < 300) {
        const parser = robotsParser(origin + '/robots.txt', (r.body || Buffer.alloc(0)).toString('utf8'));
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

  cancel() {
    if (this.status === 'running' || this.status === 'queued') { this.status = 'cancelling'; this.controller.abort(); }
  }

  // Cached analysis. While crawling it is refreshed at most every 2 s; `force` always recomputes.
  analysis(force = false) {
    const key = [this.results.length, this.completed, this.links.length, this.images.length, this.status].join(':');
    const now = Date.now();
    if (!force && this._a && (this._key === key || (this.status === 'running' && now - this._at < 2000))) return this._a;
    this._a = analyze(this.results, this.links, this.images);
    this._key = key; this._at = now;
    return this._a;
  }

  progress() {
    const total = Math.max(1, Math.min(this.limit, this.seen.size));
    return {
      id: this.id, status: this.status, startUrl: this.startUrl, limit: this.limit,
      pagesCrawled: this.completed, queued: this.queue.length, discovered: this.seen.size,
      blockedByRobots: this.blocked,
      percent: this.status === 'done' ? 100 : Math.min(99, Math.round(this.completed / total * 100)),
      summary: this.analysis().summary, notes: this.notes, message: this.message,
      startedAt: this.startedAt, finishedAt: this.finishedAt
    };
  }
}

module.exports = { Crawl };
