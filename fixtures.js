'use strict';
// Shared test fixtures: an in-memory "website" (no network) and synthetic crawl rows.
const BASE = 'https://site.example.com';

const row = (url, o = {}) => ({
  url, status: 200, contentType: 'text/html', parsed: true, blocked: false,
  title: 'A good page title for ' + url, metaDescription: 'A helpful description for ' + url,
  h1: ['Heading'], h1Count: 1, canonical: url, metaRobots: '', xRobots: '', redirectTo: '',
  responseMs: 10, discoveredFrom: '', note: '', ...o
});

// html({title, desc, h1, canonical, robots, links:[[href,text]], imgs:[[src,alt]]}); title/desc null = omit the tag
const html = ({ title, desc, h1 = ['Main heading'], canonical, robots, links = [], imgs = [] } = {}) =>
  '<!doctype html><html><head>' +
  (title === null ? '' : `<title>${title === undefined ? 'Default page title' : title}</title>`) +
  (desc === null ? '' : `<meta name="description" content="${desc === undefined ? 'Default description' : desc}">`) +
  (canonical ? `<link rel="canonical" href="${canonical}">` : '') +
  (robots ? `<meta name="robots" content="${robots}">` : '') +
  '</head><body>' + h1.map(x => `<h1>${x}</h1>`).join('') +
  links.map(([href, text]) => `<a href="${href}">${text || 'link'}</a>`).join('') +
  imgs.map(([src, alt]) => `<img src="${src}"${alt === undefined ? '' : ` alt="${alt}"`}>`).join('') +
  '</body></html>';

// A healthy page: unique title/description, one H1, self canonical.
const okPage = (path, o = {}) => ({ status: 200, html: html({ title: `${path} page title`, desc: `${path} page description`, canonical: BASE + path, ...o }) });

// Fake of lib/fetcher's fetchUrl: pages = { '/path': {status, html, type, headers, location} }. Unknown paths are 404.
function fakeSite(pages, { latency = 0 } = {}) {
  const stats = { active: 0, maxActive: 0, requests: [] };
  async function fetchUrl(url, opts = {}) {
    const { signal, anyType } = opts;
    stats.requests.push(url);
    stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active);
    try {
      if (signal && signal.aborted) throw new Error('Cancelled');
      if (latency) await new Promise((res, rej) => {
        const t = setTimeout(res, latency);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('Cancelled')); }, { once: true });
      });
      const u = new URL(url), p = pages[u.pathname + u.search];
      if (!p) return { status: 404, headers: {}, contentType: 'text/html', responseMs: 5, body: null, truncated: false };
      const status = p.status || 200, type = p.type || 'text/html; charset=utf-8';
      const headers = { ...(p.headers || {}) };
      if (p.location) headers.location = p.location;
      const body = status >= 200 && status < 300 && p.html != null && (anyType || /html/.test(type)) ? Buffer.from(p.html) : null;
      return { status, headers, contentType: type, responseMs: 5, body, truncated: false };
    } finally { stats.active--; }
  }
  return { fetchUrl, fetchFollow: fetchUrl, stats, pageRequests: () => stats.requests.filter(u => !u.endsWith('/robots.txt')) };
}

module.exports = { BASE, row, html, okPage, fakeSite };
