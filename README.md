# Modernise Site Auditor (backend stage 1)

Private Node.js + Express + Cheerio crawler. The existing dashboard is in `public/index.html`
(unchanged for now: it still shows sample data until stage 2 connects it to the API).

## Test locally (outside Claude)
1. Install Node.js 20 or newer (nodejs.org, LTS).
2. In this folder: `npm install`
3. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` (12+ characters).
4. `npm run dev`, then open http://localhost:3000 (browser asks for the username and password).

## Try the API (second terminal; replace PASSWORD)
Start a small crawl:
    curl -u admin:PASSWORD -X POST http://localhost:3000/api/crawls -H "Content-Type: application/json" -d '{"url":"https://books.toscrape.com","limit":20}'
Check progress (use the id returned):
    curl -u admin:PASSWORD http://localhost:3000/api/crawls/ID
Download ALL scanned pages as CSV:
    curl -u admin:PASSWORD -o pages.csv http://localhost:3000/api/crawls/ID/export/pages.csv
Cancel:
    curl -u admin:PASSWORD -X POST http://localhost:3000/api/crawls/ID/cancel
Safety check (must return 400): 
    curl -u admin:PASSWORD -X POST http://localhost:3000/api/crawls -H "Content-Type: application/json" -d '{"url":"http://169.254.169.254"}'

## API
POST /api/crawls {url, limit}  |  GET /api/crawls/:id  |  GET /api/crawls/:id/pages?offset=&limit=
POST /api/crawls/:id/cancel    |  GET /api/crawls/:id/export/pages.csv  |  GET /healthz (no login)

## Notes
- Page limit: default 500, max 1,000. It counts every URL fetched (images, PDFs and similar files are never queued).
- Max 2 simultaneous requests, 300 ms pause between requests (longer if robots.txt asks).
- Results live in memory only (last 5 crawls, 2 hours) and are lost on restart.
- Only one crawl runs at a time.
