'use strict';
// Disk-backed crawl storage. Hosting such as LiteSpeed/Hostinger may run several Node processes and
// restart them, so crawl state can't live in one process's memory. The process that runs a crawl
// appends its results to JSON-lines files; ANY process can read them (incrementally) to serve the API.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze } = require('./analysis');

const ACTIVE = ['queued', 'running', 'cancelling'];
const HISTORY_MAX = 100; // audits remembered in the history list
const STALE_MS = 20000; // an "active" crawl with no heartbeat for this long is treated as interrupted
const ID_RE = /^[a-f0-9]{24}$/;
const FILES = ['results', 'links', 'images', 'imageChecks'];
const fname = n => n.toLowerCase() + '.jsonl';

function pickDir() {
  const want = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  try { fs.mkdirSync(want, { recursive: true }); fs.accessSync(want, fs.constants.W_OK); return want; }
  catch {
    const tmp = path.join(os.tmpdir(), 'modernise-site-auditor-data');
    fs.mkdirSync(tmp, { recursive: true });
    return tmp;
  }
}

class Reader {
  constructor(dir) {
    this.dir = dir;
    this.pos = {};
    this.data = {};
    for (const n of FILES) { this.pos[n] = 0; this.data[n] = []; }
    this.a = null;
    this.key = '';
  }

  // Reads only the new, complete lines appended since the last call.
  sync() {
    for (const n of FILES) {
      const f = path.join(this.dir, fname(n));
      let size;
      try { size = fs.statSync(f).size; } catch { continue; }
      if (size <= this.pos[n]) continue;
      const fd = fs.openSync(f, 'r');
      try {
        const buf = Buffer.alloc(size - this.pos[n]);
        fs.readSync(fd, buf, 0, buf.length, this.pos[n]);
        const last = buf.lastIndexOf(10);
        if (last < 0) continue; // only a partial line so far
        for (const line of buf.subarray(0, last).toString('utf8').split('\n')) {
          if (line) { try { this.data[n].push(JSON.parse(line)); } catch { /* skip a damaged line */ } }
        }
        this.pos[n] += last + 1;
      } finally { fs.closeSync(fd); }
    }
  }

  analysis() {
    const key = FILES.map(n => this.data[n].length).join(':');
    if (!this.a || key !== this.key) { this.a = analyze(this.data.results, this.data.links, this.data.images, this.data.imageChecks); this.key = key; }
    return this.a;
  }
}

function createStore(root) {
  fs.mkdirSync(root, { recursive: true });
  const readers = new Map();
  const dirOf = id => path.join(root, id);
  const fileOf = (id, f) => path.join(root, id, f);
  const histDir = path.join(root, 'history');
  const histRecord = (m, S) => ({
    id: m.id, startUrl: m.startUrl, site: m.site, status: m.status, startedAt: m.startedAt || null, finishedAt: m.finishedAt || null,
    pages: m.pagesCrawled || 0, limit: m.limit || null,
    score: S ? S.score : null, counts: S ? S.counts : null,
    totals: S ? { issues: S.totals.issues, brokenLinks: S.totals.brokenLinks, images: S.totals.images } : null
  });
  function pruneHistory() {
    let names = [];
    try { names = fs.readdirSync(histDir).filter(n => /^[a-f0-9]{24}\.json$/.test(n)); } catch { return; }
    if (names.length <= HISTORY_MAX) return;
    const dated = names.map(n => { try { return [n, fs.statSync(path.join(histDir, n)).mtimeMs]; } catch { return [n, 0]; } }).sort((a, b) => a[1] - b[1]);
    for (const [n] of dated.slice(0, names.length - HISTORY_MAX)) { try { fs.rmSync(path.join(histDir, n), { force: true }); } catch { /* ignore */ } }
  }
  const readMeta = id => { try { return JSON.parse(fs.readFileSync(fileOf(id, 'meta.json'), 'utf8')); } catch { return null; } };
  const effective = m => (ACTIVE.includes(m.status) && Date.now() - (m.heartbeat || 0) > STALE_MS
    ? { ...m, status: 'error', interrupted: true, finishedAt: m.heartbeat || Date.now(),
      message: 'This crawl was interrupted because the server stopped or restarted. Partial results are shown.' }
    : m);
  function writeMeta(crawl) {
    const f = fileOf(crawl.id, 'meta.json');
    fs.writeFileSync(f + '.tmp', JSON.stringify({ ...crawl.meta(), heartbeat: Date.now() }));
    fs.renameSync(f + '.tmp', f); // atomic: readers never see a half-written file
  }

  const api = {
    root,
    // ---- used by the process that runs the crawl ----
    init(crawl) {
      fs.mkdirSync(dirOf(crawl.id), { recursive: true });
      for (const n of FILES) fs.writeFileSync(fileOf(crawl.id, fname(n)), '');
      crawl._f = {};
      writeMeta(crawl);
    },
    flush(crawl) {
      const f = crawl._f || (crawl._f = {});
      for (const n of FILES) {
        const arr = crawl[n] || [];
        f[n] = f[n] || 0;
        if (arr.length > f[n]) {
          fs.appendFileSync(fileOf(crawl.id, fname(n)), arr.slice(f[n]).map(x => JSON.stringify(x)).join('\n') + '\n');
          f[n] = arr.length;
        }
      }
      writeMeta(crawl); // data first, then meta, so readers never see counts ahead of the data
    },
    requestCancel(id) { if (ID_RE.test(id)) { try { fs.writeFileSync(fileOf(id, 'cancel.flag'), '1'); } catch { /* crawl already removed */ } } },
    cancelRequested(id) { return fs.existsSync(fileOf(id, 'cancel.flag')); },

    // ---- used by any process to serve the API ----
    get(id) {
      if (typeof id !== 'string' || !ID_RE.test(id)) return null;
      const raw = readMeta(id); // read meta BEFORE data
      if (!raw) { readers.delete(id); return null; }
      let r = readers.get(id);
      if (!r) { r = new Reader(dirOf(id)); readers.set(id, r); }
      r.sync();
      const meta = effective(raw);
      const analysis = () => r.analysis();
      return { meta, analysis, progress: () => ({ ...meta, summary: analysis().summary }) };
    },
    list() {
      let names = [];
      try { names = fs.readdirSync(root); } catch { return []; }
      return names.filter(n => ID_RE.test(n)).map(readMeta).filter(Boolean).map(effective);
    },
    isBusy() { return api.list().some(m => ACTIVE.includes(m.status)); },

    // ---- history: a small summary of every audit, kept after the (large) results are cleaned up ----
    // One tiny file per audit, so several server processes never overwrite each other.
    saveHistory(crawl) {
      const S = crawl.analysis(true).summary, m = crawl.meta();
      fs.mkdirSync(histDir, { recursive: true });
      const rec = histRecord(m, S);
      const f = path.join(histDir, m.id + '.json');
      fs.writeFileSync(f + '.tmp', JSON.stringify(rec));
      fs.renameSync(f + '.tmp', f);
      pruneHistory();
    },
    // Newest first. `available` means the full results can still be opened.
    history() {
      const out = new Map();
      let files = [];
      try { files = fs.readdirSync(histDir); } catch { /* none yet */ }
      for (const n of files) {
        if (!/^[a-f0-9]{24}\.json$/.test(n)) continue;
        try { const r = JSON.parse(fs.readFileSync(path.join(histDir, n), 'utf8')); if (r && ID_RE.test(r.id)) out.set(r.id, r); } catch { /* damaged file */ }
      }
      for (const m of api.list()) {            // audits that are running, or were interrupted before they could save a summary
        const mm = out.get(m.id);
        out.set(m.id, mm ? { ...mm, ...(ACTIVE.includes(m.status) ? { status: m.status } : {}) } : histRecord(m, null));
      }
      return [...out.values()].map(r => ({ ...r, available: !!readMeta(r.id) }))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, HISTORY_MAX);
    },
    // Removes an audit from the history together with its saved results. Running audits cannot be removed.
    removeHistory(id) {
      if (typeof id !== 'string' || !ID_RE.test(id)) return false;
      const m = readMeta(id);
      if (m && ACTIVE.includes(effective(m).status)) return false;
      readers.delete(id);
      try { fs.rmSync(dirOf(id), { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.rmSync(path.join(histDir, id + '.json'), { force: true }); } catch { /* ignore */ }
      return true;
    },
    // Removes finished crawls older than ttlMs, and keeps at most `max` finished crawls.
    evict(ttlMs, max) {
      const done = api.list().filter(m => !ACTIVE.includes(m.status)).sort((a, b) => (a.finishedAt || a.startedAt || 0) - (b.finishedAt || b.startedAt || 0));
      const drop = [], keep = [];
      for (const m of done) (Date.now() - (m.finishedAt || m.startedAt || 0) > ttlMs ? drop : keep).push(m);
      while (keep.length > max) drop.push(keep.shift());
      for (const m of drop) { readers.delete(m.id); try { fs.rmSync(dirOf(m.id), { recursive: true, force: true }); } catch { /* ignore */ } }
      return drop.length;
    }
  };
  return api;
}

module.exports = { createStore, pickDir, ACTIVE, STALE_MS };
