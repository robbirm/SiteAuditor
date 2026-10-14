'use strict';
const http = require('http');
const https = require('https');
const { checkUrl, safeLookup } = require('./safeUrl');

const UA = 'ModerniseSiteAuditor/0.1 (+https://modernisemybusiness.co.uk)';
const HTML_RE = /text\/html|application\/xhtml\+xml/i;

// One GET request. Never follows redirects itself. Validates the URL, pins DNS to
// validated public addresses, enforces a total timeout and a response-size cap,
// and only downloads bodies for 2xx HTML (or any 2xx type when anyType is true).
function fetchUrl(urlStr, { timeoutMs = 15000, maxBytes = 2 * 1024 * 1024, signal, anyType = false } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = checkUrl(urlStr); } catch (e) { return reject(e); }
    if (signal && signal.aborted) return reject(new Error('Cancelled'));
    const started = Date.now();
    let done = false, req;
    const end = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(v);
    };
    const onAbort = () => { if (req) req.destroy(); end(reject, new Error('Cancelled')); };
    const timer = setTimeout(() => { if (req) req.destroy(); end(reject, new Error('Timed out')); }, timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const isHttps = u.protocol === 'https:';
    req = (isHttps ? https : http).request({
      hostname: u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      agent: false,
      lookup: safeLookup,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'identity' }
    }, res => {
      const info = { status: res.statusCode, headers: res.headers, contentType: String(res.headers['content-type'] || ''),
        responseMs: Date.now() - started, body: null, truncated: false };
      const wantBody = res.statusCode >= 200 && res.statusCode < 300 && (anyType || HTML_RE.test(info.contentType));
      if (!wantBody) { res.destroy(); return end(resolve, info); }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > maxBytes) {
          info.truncated = true;
          const keep = c.length - (size - maxBytes);
          if (keep > 0) chunks.push(c.subarray(0, keep));
          res.destroy();
          info.body = Buffer.concat(chunks);
          return end(resolve, info);
        }
        chunks.push(c);
      });
      res.on('end', () => { info.body = Buffer.concat(chunks); end(resolve, info); });
      res.on('error', e => end(reject, e));
    });
    req.on('error', e => end(reject, e));
    req.end();
  });
}

// For robots.txt only: follows a few redirects, re-validating every hop.
async function fetchFollow(urlStr, opts, maxRedirects = 3) {
  let cur = urlStr;
  for (let i = 0; i <= maxRedirects; i++) {
    const r = await fetchUrl(cur, opts);
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
      cur = new URL(r.headers.location, cur).href;
      continue;
    }
    return r;
  }
  throw new Error('Too many redirects');
}

module.exports = { fetchUrl, fetchFollow, UA };
