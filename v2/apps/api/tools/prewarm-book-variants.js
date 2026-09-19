// One-off / nightly: build the sized variants for every local book so no reader waits for the
// first conversion. Same names as user-books.controller.ts (REMOTE_CACHE/<id>/<kind>-pNNNN.jpg).
// Run as the API user (ubuntu) with nice: node tools/prewarm-book-variants.js [w800,w1200,thumb]
const fs = require("fs"), path = require("path");
const sharp = require("sharp");
const STORE = "/var/lib/chessguru/user-books", CACHE = "/var/lib/chessguru/user-books-cache";
const VARIANTS = { thumb: { width: 320, quality: 70 }, w800: { width: 800, quality: 78 }, w1200: { width: 1200, quality: 80 }, w1600: { width: 1600, quality: 82 } };
const kinds = (process.argv[2] || "thumb,w800,w1200").split(",");
(async () => {
  let made = 0, skipped = 0; const t0 = Date.now();
  for (const id of fs.readdirSync(STORE)) {
    const pdir = path.join(STORE, id, "pages"); if (!fs.existsSync(pdir)) continue;
    const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(STORE, id, "meta.json"), "utf8")); } catch { return {}; } })();
    const cdir = path.join(CACHE, id.replace(/[^A-Za-z0-9._-]/g, "_")); fs.mkdirSync(cdir, { recursive: true });
    const pages = fs.readdirSync(pdir).filter((f) => /^p\d{4}\.jpg$/.test(f)).sort();
    for (const f of pages) {
      const n = f.slice(1, 5);
      for (const kind of kinds) {
        if (kind === "thumb" && Number(n) !== (Number.isInteger(meta.coverPage) ? meta.coverPage : 0) && Number(n) !== 0) continue;  // thumbs only for the cover
        const out = path.join(cdir, `${kind}-p${n}.jpg`);
        if (fs.existsSync(out)) { skipped++; continue; }
        const spec = VARIANTS[kind]; if (!spec) continue;
        try {
          const buf = await sharp(fs.readFileSync(path.join(pdir, f))).rotate().resize({ width: spec.width, withoutEnlargement: true }).jpeg({ quality: spec.quality, progressive: true, mozjpeg: true }).toBuffer();
          const tmp = `${out}.${process.pid}.tmp`; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, out); made++;
        } catch (e) { console.warn("fail", id, f, kind, e.message); }
      }
    }
    console.log(`${id}: ${pages.length} pages done (${made} made so far, ${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  console.log(`done: made ${made}, already had ${skipped}, ${Math.round((Date.now() - t0) / 1000)} s`);
})();
