# Modernise Site Auditor

Private Node.js + Express + Cheerio SEO crawler with the Modernise dashboard (`public/index.html`).

## Run locally
1. Install Node.js 20 or newer.  2. `npm install`  3. Copy `.env.example` to `.env`, set `ADMIN_PASSWORD` (12+ chars).
4. `npm run dev` and open http://localhost:3000 (browser asks for the username and password).
5. `npm test` runs the automated tests (see below).

## What it checks
Critical: 404/4xx/5xx pages, pages that fail to load, broken internal links, missing title, redirect loops, redirects to error pages.
Also Critical: broken images (image URL returns an error).
Warning: missing/duplicate meta description, duplicate title, missing/multiple H1, redirect chains (2+ hops), canonical pointing to a non-200 URL, noindex (meta robots or X-Robots-Tag), images missing ALT, oversized images (over 250 KB), title too long, missing mobile viewport tag, slow response, page served over HTTP.
Info: single redirects, missing canonical, canonical pointing to a different URL, URLs blocked by robots.txt, short title, too short/long meta description, thin content, missing `lang`.
Site-level checks: robots.txt present, sitemap found, HTTPS in use.
Image sizes are measured with a capped request per image (at most `IMAGE_CHECK_LIMIT` images, default 150, same 2-request limit). Images that send no Content-Length show as 'Unknown'.
(`alt=""` is treated as intentionally decorative, not an error.)

## Health score (how it is calculated)
Every crawled page starts at 100. For each distinct issue type on the page subtract 25 (Critical), 10 (Warning) or 2 (Info), minimum 0.
A page returning 4xx/5xx or failing to load scores 0. The site score is the average page score over all crawled pages
(robots.txt-blocked pages excluded), rounded. The same text is shown in the dashboard ("How is this calculated?") and comes from `lib/analysis.js`.

## API (all require HTTP Basic auth except /healthz)
- `GET /api/status`
- `POST /api/crawls {url, limit}` (limit default 500, max 1000)  |  `GET /api/crawls/:id` (progress + summary)  |  `POST /api/crawls/:id/cancel`
- `GET /api/crawls/:id/{pages|issues|links|images}?q=&offset=&limit=` plus filters: pages `status=2xx|3xx|4xx|5xx|issues`, `severity`, `sort`, `dir`;
  issues `severity`, `type`; links `filter=broken|redirect|internal|external`; images `filter=missing|empty|present|oversized|broken`
  (this replaces the earlier `/pages` response shape: rows are now in `rows`)
- `POST /api/crawls/:id/report` (JSON body, optional branding) returns a PDF. Only allowed once the crawl is done/cancelled/error (409 otherwise). This route alone accepts a 2.6 MB body.
- `GET /api/crawls/:id/export/{pages|issues|links|broken-links|images}.csv` always exports ALL records.

## PDF report
`POST /api/crawls/:id/report` with `{company, client, accent:'#rrggbb', logoAlign:'left|center|right', logo:'data:image/png|jpeg;base64,...'}` (all optional; logo max 1.5 MB, PNG or JPG only).
The PDF has an overview with the health score, what is good / needs improvement / critical, charts (issue severity, score distribution, status codes, ALT coverage, response times), image and speed checks, a top-issues table and a prioritised action plan.
The logo is printed in the footer of every page. The PDF is built by a small dependency-free writer (`lib/pdf.js`, `lib/report.js`), so there is nothing extra to install. The dashboard's 'Download PDF report' button opens a branding panel that remembers settings in the browser.

## CSV
UTF-8 with BOM and CRLF (opens correctly in Excel). Cells starting with `= + - @` are prefixed with `'` to prevent formula injection.

## Tests (`npm test`, Node's built-in runner, no network needed)
`store` (disk storage, second-process reads, interruption, cleanup), `analysis` (SEO rules and score), `csv` (all five exports, all rows, injection), `safeUrl` (SSRF blocking), `crawler` (discovery, limit,
2-request concurrency, cancellation, robots.txt), `site` (messy fixture website end to end), `api` (login, validation, progress, filters, exports, cancel, 409, limit clamp, PDF report), `pdf` and `report` (PDF structure, logos, branding, content).

## Storage (important on shared hosting)
Hosts such as Hostinger/LiteSpeed can run several Node processes and restart them, so crawl results are saved to disk
(`lib/store.js`), not kept in one process's memory. The process running a crawl appends results to `data/<id>/*.jsonl`
and writes a heartbeat every second; any process can read them. Cancel works across processes (a flag file).
If a process dies mid-crawl the crawl is shown as "interrupted" after ~20 s with the partial results.
Folder: `DATA_DIR` env var, default `./data`, falling back to the system temp folder if that is not writable.

## Notes
- Finished crawls are kept for 2 hours (last 5). One crawl at a time. Max 2 simultaneous requests.
- The page limit counts every URL fetched; images, PDFs and similar files are never queued.
- External links are listed but not checked. Links to URLs beyond the page limit show "Not crawled".
