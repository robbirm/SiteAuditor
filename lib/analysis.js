'use strict';
// SEO analysis: turns raw crawl data into issues (Critical / Warning / Info), link and image
// tables, and the technical SEO health score. Pure functions: no network, easy to test.

const WEIGHTS = { critical: 25, warning: 10, info: 2 };
const RANK = { critical: 3, warning: 2, info: 1, ok: 0 };
const OVERSIZE = 250 * 1024; // images above this size are flagged
const SLOW_MS = 1500;       // server responses slower than this are flagged
const SCORE_TEXT = 'Every crawled page starts at 100 points. For each distinct issue type found on a page we subtract ' +
  '25 points (Critical), 10 points (Warning) or 2 points (Info), down to a minimum of 0. A page that returns an error ' +
  '(4xx/5xx) or fails to load scores 0. The site health score is the average page score across all crawled pages ' +
  '(pages blocked by robots.txt are not counted), rounded to a whole number.';

const D = (severity, label, fix) => ({ severity, label, fix });
const DEFS = {
  page_404: D('critical', 'Page not found (404)', 'Restore the page, or 301-redirect it to the closest relevant live page, then update internal links that point to it.'),
  page_4xx: D('critical', 'Client error (4xx)', 'Fix or remove the URL. If the page has moved, add a 301 redirect to its new address.'),
  page_5xx: D('critical', 'Server error (5xx)', 'Check the server logs and fix the error. Repeated 5xx responses can make pages drop out of search results.'),
  request_failed: D('critical', 'Page failed to load', 'The request timed out or the connection failed. Check the URL, DNS, SSL certificate and server availability.'),
  broken_internal_link: D('critical', 'Broken internal link', 'Update the link to a working URL or remove it. If the destination moved, redirect it.'),
  redirect_loop: D('critical', 'Redirect loop', 'Break the loop so the URL redirects once to a final page that returns 200.'),
  redirect_to_error: D('critical', 'Redirect leads to an error page', 'Point the redirect at a live page that returns 200.'),
  missing_title: D('critical', 'Missing title tag', 'Add a unique, descriptive <title> of roughly 30-60 characters.'),
  missing_meta_description: D('warning', 'Missing meta description', 'Add a unique meta description of roughly 70-160 characters that summarises the page.'),
  duplicate_title: D('warning', 'Duplicate title', 'Give each page its own unique title that reflects its specific content.'),
  duplicate_meta_description: D('warning', 'Duplicate meta description', 'Write a unique meta description for each page.'),
  missing_h1: D('warning', 'Missing H1 heading', 'Add one clear H1 heading that describes the page topic.'),
  multiple_h1: D('warning', 'Multiple H1 headings', 'Keep a single H1 per page and use H2-H6 for sub-sections.'),
  redirect_chain: D('warning', 'Redirect chain', 'Redirect the original URL straight to the final destination in one hop and update internal links to the final URL.'),
  canonical_non_200: D('warning', 'Canonical points to a non-200 URL', 'Point the canonical at a live, indexable page that returns 200.'),
  noindex: D('warning', 'Page set to noindex', 'If this page should appear in search results, remove the noindex directive (meta robots tag or X-Robots-Tag header).'),
  images_missing_alt: D('warning', 'Images missing ALT attribute', 'Add descriptive alt text to content images. Use alt="" for purely decorative images.'),
  redirect: D('info', 'Redirect', 'Update internal links to point directly at the final URL.'),
  missing_canonical: D('info', 'Missing canonical URL', 'Add a self-referencing <link rel="canonical"> to help prevent duplicate-content problems.'),
  canonical_other: D('info', 'Canonical points to a different URL', 'Check this is intentional. Search engines will usually index the canonical URL instead of this page.'),
  blocked_robots: D('info', 'Blocked by robots.txt', 'If this page should be crawled and indexed, update the Disallow rules in robots.txt.'),
  title_too_long: D('warning', 'Title too long (over 60 characters)', 'Shorten the title to about 60 characters so search engines do not cut it off.'),
  title_too_short: D('info', 'Title too short (under 30 characters)', 'Expand the title so it describes the page and includes its main keyword.'),
  meta_description_too_long: D('info', 'Meta description too long (over 160 characters)', 'Trim the description to about 155 characters so it is not truncated in search results.'),
  meta_description_too_short: D('info', 'Meta description too short (under 70 characters)', 'Expand the description to summarise the page and encourage clicks.'),
  thin_content: D('info', 'Thin content (under 300 words)', 'Add useful, original content, or consider merging or removing very thin pages.'),
  missing_viewport: D('warning', 'Missing mobile viewport tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so the page displays properly on phones.'),
  missing_lang: D('info', 'Missing page language', 'Add a lang attribute to the <html> tag, for example <html lang="en-GB">.'),
  slow_response: D('warning', 'Slow server response (over 1.5 seconds)', 'Improve hosting, enable caching and reduce server-side work to speed up the response.'),
  insecure_page: D('warning', 'Page served over HTTP (not HTTPS)', 'Serve the page over HTTPS and redirect all HTTP URLs to HTTPS.'),
  images_oversized: D('warning', 'Oversized images (over 250 KB)', 'Compress or resize the images, and consider modern formats such as WebP or AVIF.'),
  images_broken: D('critical', 'Broken images', 'Fix or remove image URLs that return an error.')
};

const normKey = u => {
  try {
    const x = new URL(u);
    let p = x.pathname;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return x.protocol + '//' + x.host + p + x.search;
  } catch { return String(u); }
};

function groupBy(results, field) {
  const m = new Map();
  for (const r of results) {
    if (!r.parsed || r.status < 200 || r.status >= 300) continue;
    const k = String(r[field] || '').trim().toLowerCase();
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function analyze(results, rawLinks = [], rawImages = [], imageChecks = []) {
  const byUrl = new Map(), byNorm = new Map();
  for (const r of results) { byUrl.set(r.url, r); byNorm.set(normKey(r.url), r); }

  // ---- links (status resolved from crawled pages) ----
  const inSources = new Map(), brokenBy = new Map();
  let brokenCount = 0;
  const links = rawLinks.map(l => {
    const dest = l.internal ? byUrl.get(l.destination) : null;
    let status = 0, statusText, broken = false, redirect = false;
    if (!l.internal) statusText = 'Not checked';
    else if (!dest) statusText = 'Not crawled';
    else if (dest.blocked) statusText = 'Blocked by robots.txt';
    else if (!dest.status) { statusText = 'Failed to load'; broken = true; }
    else { status = dest.status; statusText = String(status); broken = status >= 400; redirect = status >= 300 && status < 400; }
    if (l.internal) {
      if (!inSources.has(l.destination)) inSources.set(l.destination, new Set());
      inSources.get(l.destination).add(l.source);
    }
    if (broken) {
      brokenCount++;
      if (!brokenBy.has(l.source)) brokenBy.set(l.source, []);
      brokenBy.get(l.source).push({ dest: l.destination, statusText });
    }
    return { source: l.source, destination: l.destination, anchor: l.anchor || '', type: l.internal ? 'Internal' : 'External', status: status || '', statusText, broken, redirect };
  });

  // ---- images: ALT text plus file size / HTTP status from the image checks ----
  const chk = new Map(imageChecks.map(c => [c.src, c]));
  const missingAlt = new Map(), bigBy = new Map(), brokenImgBy = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const images = rawImages.map(i => {
    const altStatus = i.alt == null ? 'Missing' : (String(i.alt).trim() ? 'Present' : 'Empty');
    const c = chk.get(i.src);
    const bytes = c && Number.isFinite(c.bytes) ? c.bytes : null;
    if (altStatus === 'Missing') push(missingAlt, i.page, i.src);
    if (bytes != null && bytes > OVERSIZE) push(bigBy, i.page, { src: i.src, bytes });
    if (c && (c.status >= 400 || c.status === 0)) push(brokenImgBy, i.page, { src: i.src, status: c.status });
    return { page: i.page, src: i.src, alt: i.alt == null ? '' : i.alt, altStatus, bytes, imgStatus: c ? c.status : null, checked: !!c };
  });

  const titleGroups = groupBy(results, 'title'), descGroups = groupBy(results, 'metaDescription');
  const pages = [], issues = [], typeCounts = new Map();
  let scoreSum = 0, scored = 0, redirects = 0;

  for (const r of results) {
    const found = [];
    const add = (type, detail = '') => { const d = DEFS[type]; found.push({ type, severity: d.severity, label: d.label, detail, fix: d.fix }); };
    const failed = !r.blocked && !r.status;
    let chain = [], finalUrl = '', canonicalStatus = '';

    if (r.blocked) add('blocked_robots');
    else if (failed) add('request_failed', r.note || '');
    else if (r.status === 404) add('page_404');
    else if (r.status >= 500) add('page_5xx', 'HTTP ' + r.status);
    else if (r.status >= 400) add('page_4xx', 'HTTP ' + r.status);

    if (r.status >= 300 && r.status < 400) {
      redirects++;
      if (r.redirectTo) {
        const seen = new Set([r.url]);
        let cur = r, loop = false;
        while (cur && cur.status >= 300 && cur.status < 400 && cur.redirectTo && chain.length < 10) {
          chain.push(cur.redirectTo);
          if (seen.has(cur.redirectTo)) { loop = true; break; }
          seen.add(cur.redirectTo);
          cur = byUrl.get(cur.redirectTo);
        }
        finalUrl = chain[chain.length - 1];
        const end = byUrl.get(finalUrl), path = [r.url, ...chain].join(' → ');
        if (loop) add('redirect_loop', path);
        else if (end && (end.status >= 400 || (!end.status && !end.blocked))) add('redirect_to_error', path + ' (' + (end.status || 'failed') + ')');
        else if (chain.length >= 2) add('redirect_chain', path + ' (' + chain.length + ' hops)');
        else add('redirect', r.status + ' redirect to ' + r.redirectTo);
      }
    }

    if (r.parsed && r.status >= 200 && r.status < 300) {
      if (!r.title) add('missing_title');
      else {
        const g = titleGroups.get(r.title.trim().toLowerCase());
        if (g && g.length > 1) add('duplicate_title', 'Shared with ' + (g.length - 1) + ' other page(s), e.g. ' + g.find(x => x !== r).url);
        if (r.title.length > 60) add('title_too_long', r.title.length + ' characters');
        else if (r.title.length < 30) add('title_too_short', r.title.length + ' characters');
      }
      if (!r.metaDescription) add('missing_meta_description');
      else {
        const g = descGroups.get(r.metaDescription.trim().toLowerCase());
        if (g && g.length > 1) add('duplicate_meta_description', 'Shared with ' + (g.length - 1) + ' other page(s), e.g. ' + g.find(x => x !== r).url);
        if (r.metaDescription.length > 160) add('meta_description_too_long', r.metaDescription.length + ' characters');
        else if (r.metaDescription.length < 70) add('meta_description_too_short', r.metaDescription.length + ' characters');
      }
      if (r.h1Count === 0) add('missing_h1');
      else if (r.h1Count > 1) add('multiple_h1', r.h1Count + ' H1 headings: ' + r.h1.slice(0, 3).join(' | '));
      if (typeof r.words === 'number' && r.words < 300) add('thin_content', r.words + ' words');
      if (!r.viewport) add('missing_viewport');
      if (!r.lang) add('missing_lang');
      if (typeof r.responseMs === 'number' && r.responseMs > SLOW_MS) add('slow_response', r.responseMs + ' ms');
      if (/^http:\/\//i.test(r.url)) add('insecure_page');

      if (!r.canonical) { canonicalStatus = 'none'; add('missing_canonical'); }
      else if (normKey(r.canonical) === normKey(r.url)) canonicalStatus = 'self';
      else {
        canonicalStatus = 'other';
        add('canonical_other', r.canonical);
        const t = byNorm.get(normKey(r.canonical));
        if (t && (t.status < 200 || t.status >= 300)) add('canonical_non_200', r.canonical + ' returns ' + (t.blocked ? 'blocked by robots.txt' : t.status || 'an error'));
      }
      const robots = ((r.metaRobots || '') + ' ' + (r.xRobots || '')).trim();
      if (/noindex/i.test(robots)) add('noindex', robots);
      if (brokenBy.has(r.url)) {
        const b = brokenBy.get(r.url);
        add('broken_internal_link', b.length + ' broken link(s): ' + b.slice(0, 3).map(x => x.dest + ' (' + x.statusText + ')').join(', ') + (b.length > 3 ? ', …' : ''));
      }
      const miss = missingAlt.get(r.url);
      if (miss) add('images_missing_alt', miss.length + ' image(s) without ALT, e.g. ' + miss[0]);
      const big = bigBy.get(r.url);
      if (big) { const top = big.reduce((m, x) => (x.bytes > m.bytes ? x : m)); add('images_oversized', big.length + ' image(s) over 250 KB, largest ' + Math.round(top.bytes / 1024) + ' KB: ' + top.src); }
      const bad = brokenImgBy.get(r.url);
      if (bad) add('images_broken', bad.length + ' broken image(s), e.g. ' + bad[0].src + ' (' + (bad[0].status || 'failed') + ')');
    }

    let score = null;
    if (!r.blocked) {
      score = (failed || r.status >= 400) ? 0 : Math.max(0, 100 - found.reduce((s, i) => s + WEIGHTS[i.severity], 0));
      scoreSum += score; scored++;
    }
    const severity = found.reduce((w, i) => (RANK[i.severity] > RANK[w] ? i.severity : w), 'ok');
    for (const i of found) {
      issues.push({ type: i.type, severity: i.severity, label: i.label, url: r.url, detail: i.detail, fix: i.fix });
      const t = typeCounts.get(i.type) || { type: i.type, label: i.label, severity: i.severity, count: 0 };
      t.count++; typeCounts.set(i.type, t);
    }
    pages.push({
      url: r.url, status: r.status, contentType: r.contentType, parsed: !!r.parsed, blocked: !!r.blocked, failed,
      title: r.title, metaDescription: r.metaDescription, h1: r.h1, h1Count: r.h1Count,
      canonical: r.canonical, canonicalStatus, metaRobots: r.metaRobots, xRobots: r.xRobots,
      redirectTo: r.redirectTo, redirectChain: chain, redirectHops: chain.length, finalUrl,
      responseMs: r.responseMs, discoveredFrom: r.discoveredFrom, note: r.note, words: r.words, lang: r.lang || '', viewport: !!r.viewport,
      inlinks: inSources.has(r.url) ? inSources.get(r.url).size : 0, severity, score, issues: found
    });
  }

  issues.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.label.localeCompare(b.label) || a.url.localeCompare(b.url));
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const issueTypes = [...typeCounts.values()].sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.count - a.count);

  return {
    pages, issues, links, images,
    summary: {
      score: scored ? Math.round(scoreSum / scored) : null,
      crawled: scored, counts, issueTypes, redirects,
      totals: { pages: pages.length, issues: issues.length, links: links.length, brokenLinks: brokenCount, images: images.length },
      scoreModel: { weights: WEIGHTS, text: SCORE_TEXT }
    }
  };
}

module.exports = { analyze, DEFS, WEIGHTS, RANK, OVERSIZE, SLOW_MS, normKey };
