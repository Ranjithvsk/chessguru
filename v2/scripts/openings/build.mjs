#!/usr/bin/env node
/**
 * Memory Master 500 — corpus bootstrap.
 *
 * Fetches:
 *   1) Lichess `chess-openings` TSV (CC0, ~3500 rows) from GitHub raw.
 *      https://github.com/lichess-org/chess-openings — ECO code, name, PGN, UCI, EPD.
 *   2) Wikibooks "Chess Opening Theory" per-move page for each corpus entry
 *      (CC-BY-SA 3.0). URL path mirrors the SAN sequence:
 *      https://en.wikibooks.org/wiki/Chess_Opening_Theory/1._e4/1...c5/2._Nf3/...
 *
 * Produces: `src/lib/openings/generated.ts` — one Opening per canonical ECO
 * code (~500 entries), each with wikibookUrl + wikibookExcerpt attributed.
 *
 * Idempotent + resumable — all HTTP responses cached under /tmp/cg-openings-cache.
 * Delete that dir to force a fresh fetch. Full run ~3 min cold, <5 s warm.
 *
 * Run: `node scripts/openings/build.mjs [--limit N] [--verbose]`
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Chess } from "chess.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUT_FILE = resolve(REPO_ROOT, "apps/web/src/lib/openings/generated.ts");
const CACHE = "/tmp/cg-openings-cache";
const WB_CACHE = `${CACHE}/wb`;
const MASTERS_CACHE = `${CACHE}/masters`;

const args = new Set(process.argv.slice(2));
const LIMIT = (() => {
  const flag = process.argv.find((a) => a.startsWith("--limit="));
  return flag ? parseInt(flag.split("=")[1], 10) : Number.POSITIVE_INFINITY;
})();
const VERBOSE = args.has("--verbose") || args.has("-v");
const log = (...a) => VERBOSE && console.log(...a);
const info = (...a) => console.log(...a);

// ── 1. Lichess ECO TSV ─────────────────────────────────────────────────────
async function fetchTsv() {
  const rows = [];
  for (const p of ["a", "b", "c", "d", "e"]) {
    const cache = `${CACHE}/${p}.tsv`;
    let text;
    if (existsSync(cache)) {
      text = await readFile(cache, "utf8");
      log(`tsv ${p}: cached (${text.length} bytes)`);
    } else {
      const r = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${p}.tsv`);
      if (!r.ok) throw new Error(`tsv fetch ${p} failed: ${r.status}`);
      text = await r.text();
      await writeFile(cache, text);
      log(`tsv ${p}: fetched (${text.length} bytes)`);
    }
    const lines = text.split("\n").slice(1); // strip header
    for (const line of lines) {
      if (!line.trim()) continue;
      // Lichess tsv has EXACTLY 3 tab-separated columns: eco, name, pgn.
      // (Earlier revision assumed 5 columns and read uci/epd as undefined.)
      const [eco, name, pgn] = line.split("\t");
      if (!eco || !name || !pgn) continue;
      rows.push({ eco, name, pgn });
    }
  }
  return rows;
}

// Convert SAN moves to UCI (e.g. "e4 c5 Nf3" → "e2e4 c7c5 g1f3"). Needed
// because Lichess Explorer's masters endpoint accepts `play=<uci-list>` but not
// SAN. Uses chess.js — same lib the web app uses to replay openings.
function sansToUci(sans) {
  const g = new Chess();
  const out = [];
  for (const s of sans) {
    try {
      const mv = g.move(s);
      if (!mv) return null;
      out.push(mv.from + mv.to + (mv.promotion ?? ""));
    } catch { return null; }
  }
  return out.join(",");
}

// ── 2. PGN → SAN array (strip move numbers + result markers) ─────────────
function pgnToSans(pgn) {
  return pgn
    .replace(/\d+\.(\.\.)?/g, " ") // "1." and "1..."
    .replace(/\{[^}]*\}/g, " ")    // comments
    .replace(/[()!?+#*]/g, "")     // annotations
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((s) => s && !/^[10-]+$/.test(s));
}

// ── 3. slug + family from ECO ────────────────────────────────────────────
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
function familyFromEco(eco) {
  const letter = eco[0];
  const n = parseInt(eco.slice(1), 10);
  if (letter === "A") {
    if (n <= 39) return "english";
    if (n <= 44) return "d4-side";
    if (n <= 49) return "kings-indian"; // KI setups
    if (n <= 79) return "d4-side";       // Trompowsky, Colle, etc.
    if (n <= 99) return "dutch";
    return "d4-side";
  }
  if (letter === "B") {
    if (n <= 5) return "scandi-alekhine";
    if (n <= 9) return "modern-pirc";
    if (n <= 19) return "caro-kann";
    return "sicilian";
  }
  if (letter === "C") {
    if (n <= 19) return "french";
    if (n <= 59) return "open-e5-misc";
    return "ruy-lopez";
  }
  if (letter === "D") {
    if (n <= 9) return "d4-side"; // Réti-transposition + Queen's pawn misc
    if (n <= 29) return "slav";
    if (n <= 69) return "qgd";
    return "grunfeld";
  }
  // E
  if (n <= 9) return "catalan";
  if (n <= 19) return "qi-bogo";
  if (n <= 59) return "nimzo";
  return "kings-indian";
}

// ── 4. Wikibook URL from SAN sequence ────────────────────────────────────
// Format: /wiki/Chess_Opening_Theory/1._e4/1...c5/2._Nf3/2...d6/…
function wikibookUrl(sans) {
  if (!sans.length) return null;
  // Wikibook URL format:  White = "1._e4", Black = "1...c5" (no underscore
  // between the ellipsis and the move — that was a bug in an earlier revision).
  const parts = ["Chess_Opening_Theory"];
  for (let i = 0; i < sans.length; i++) {
    const moveNo = Math.floor(i / 2) + 1;
    const isWhite = i % 2 === 0;
    // "=" in promotions becomes an underscore per Wikibook convention.
    const san = sans[i].replace(/=/g, "_");
    parts.push(`${moveNo}${isWhite ? "._" : "..."}${encodeURIComponent(san)}`);
  }
  return `https://en.wikibooks.org/wiki/${parts.join("/")}`;
}

// ── 4b. Fetch masters-DB frequency for one Lichess tsv entry ─────────────
// Uses the UCI move sequence to query Lichess Opening Explorer's masters DB.
// Returns { games, white, draws, black } — `games` is our popularity number.
// Cache is permanent (per UCI sequence); rerun costs only the first time.
async function fetchMastersFreq(uci) {
  const key = uci.replace(/\s+/g, "_").slice(0, 180) || "root";
  const cache = `${MASTERS_CACHE}/${key}.json`;
  if (existsSync(cache)) {
    try { return JSON.parse(await readFile(cache, "utf8")); }
    catch { /* refetch */ }
  }
  const play = uci.trim().split(/\s+/).join(",");
  const api = `https://explorer.lichess.ovh/masters?play=${play}&moves=0&topGames=0`;
  let r;
  try { r = await fetch(api, { headers: { "User-Agent": UA, "Accept": "application/json" } }); }
  catch (e) { return { games: 0, error: `fetch failed: ${e.message}` }; }
  if (r.status === 429) return { games: 0, error: "rate-limited (not cached)" };
  if (!r.ok) {
    const result = { games: 0, error: `HTTP ${r.status}` };
    await writeFile(cache, JSON.stringify(result));
    return result;
  }
  let j;
  try { j = await r.json(); }
  catch { return { games: 0, error: "non-JSON body" }; }
  const games = (j.white ?? 0) + (j.draws ?? 0) + (j.black ?? 0);
  const result = { games, white: j.white ?? 0, draws: j.draws ?? 0, black: j.black ?? 0 };
  await writeFile(cache, JSON.stringify(result));
  return result;
}

// ── 5. Fetch one Wikibook page + extract intro text ──────────────────────
// Uses the MediaWiki parse API to get rendered HTML for the leaf page. We
// strip HTML tags for the excerpt; the full page is beyond scope (users click
// the wikibookUrl link for full detail).
// Wikimedia asks for User-Agent with contact info + ≤1 req/sec for bots.
// The `parse` action returns rendered HTML; the REST `summary` endpoint returns
// EMPTY extracts for Wikibook chess pages (they start with position diagrams,
// not a lead paragraph). So we use parse and hand-strip HTML.
const UA = "ChessGuru-MemoryMaster/0.1 (https://harinitharanjith.com; hari@dreamworldplants.com)";
async function fetchWikibook(url) {
  if (!url) return { exists: false };
  const title = decodeURIComponent(url.split("/wiki/")[1]);
  const cacheKey = title.replace(/[^A-Za-z0-9]/g, "_").slice(0, 200);
  const cache = `${WB_CACHE}/${cacheKey}.json`;
  if (existsSync(cache)) {
    try {
      const cached = JSON.parse(await readFile(cache, "utf8"));
      // Refetch if cached as rate-limited or an empty error — treat as stale.
      if (!cached.error) return cached;
    } catch { /* corrupt cache, refetch */ }
  }
  const api = `https://en.wikibooks.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`;
  let r;
  try { r = await fetch(api, { headers: { "User-Agent": UA, "Accept": "application/json" } }); }
  catch (e) { return { title, exists: false, error: `fetch failed: ${e.message}` }; }
  if (r.status === 429) return { title, exists: false, error: "rate-limited (not cached)" };
  if (!r.ok) {
    const result = { title, exists: false, error: `HTTP ${r.status}` };
    await writeFile(cache, JSON.stringify(result));
    return result;
  }
  let j;
  try { j = await r.json(); }
  catch { return { title, exists: false, error: "non-JSON body (not cached)" }; }
  if (j.error) {
    // 'missingtitle' = page doesn't exist — cache the negative to skip next run.
    const result = { title, exists: false, error: j.error.code || j.error.info };
    await writeFile(cache, JSON.stringify(result));
    return result;
  }
  const html = j.parse?.text ?? "";
  const paras = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)];
  const cleaned = paras
    .map((m) =>
      m[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, " ")
        // The Wikibook chess pages prefix each paragraph with a FEN + side-to-move
        // (e.g. "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w") — strip it.
        .replace(/^[rnbqkpRNBQKP1-8/]+\s+[wb]\s*/, "")
        .trim(),
    )
    .filter((s) => s.length > 30);
  const excerpt = cleaned.slice(0, 2).join(" ").slice(0, 800) || null;
  const result = { title, exists: !!excerpt, excerpt };
  await writeFile(cache, JSON.stringify(result));
  return result;
}

// ── 6. Main ───────────────────────────────────────────────────────────────
async function main() {
  await mkdir(WB_CACHE, { recursive: true });
  await mkdir(MASTERS_CACHE, { recursive: true });
  info("Fetching Lichess chess-openings tsv…");
  const all = await fetchTsv();
  info(`  loaded ${all.length} rows`);

  // Convert every PGN to SAN[] + UCI once. Rows whose PGN doesn't cleanly parse
  // (weird sidelines with dashes / non-standard notation) get dropped.
  for (const r of all) {
    r.sans = pgnToSans(r.pgn);
    r.uci = r.sans.length ? sansToUci(r.sans) : null;
  }
  const parsable = all.filter((r) => r.uci);
  info(`  ${parsable.length} rows with parsable PGN`);

  // De-dupe by UCI — some rows share the exact same position under different
  // names. Keep the SHORTEST name (family root, e.g. prefer "Sicilian Defence"
  // over "Sicilian, Old Sicilian, Wing Gambit").
  const byUci = new Map();
  for (const r of parsable) {
    const cur = byUci.get(r.uci);
    if (!cur || r.name.length < cur.name.length) byUci.set(r.uci, r);
  }
  const unique = [...byUci.values()];
  info(`  ${unique.length} unique positions`);

  // Rank by Lichess masters DB frequency. This is Strategy A: the REAL top-500
  // most-played openings from ~2M master games. Full run is ~30 min cold (rate
  // limit ~2 req/s); cache is permanent per position, so subsequent runs are
  // instant.
  info(`Ranking ${unique.length} positions by masters DB frequency…`);
  let ranked = 0;
  for (const r of unique) {
    const f = await fetchMastersFreq(r.uci);
    r.games = f.games;
    ranked++;
    if (ranked % 100 === 0) info(`  ranked ${ranked}/${unique.length}`);
    await new Promise((res) => setTimeout(res, 450));   // Lichess: ~2 req/s safe
  }
  const sorted = unique.sort((a, b) => (b.games ?? 0) - (a.games ?? 0));
  info(`  top game count: ${sorted[0]?.games?.toLocaleString?.() ?? "?"} · median: ${sorted[Math.floor(sorted.length / 2)]?.games ?? "?"}`);

  // Take top 500 by frequency (or fewer if LIMIT).
  const targets = sorted.slice(0, Math.min(sorted.length, 500, LIMIT));
  info(`Selected top ${targets.length} openings by master-game frequency.`);
  info(`Fetching Wikibooks for ${targets.length} openings…`);

  const topGames = targets[0]?.games ?? 0;
  const openings = [];
  let done = 0;
  let wbOk = 0;
  for (const r of targets) {
    const sans = r.sans ?? pgnToSans(r.pgn);
    const wbUrl = wikibookUrl(sans);
    let wb = { exists: false };
    if (wbUrl) {
      try { wb = await fetchWikibook(wbUrl); if (wb.exists) wbOk++; }
      catch (e) { log(`wb error ${r.eco} ${r.name}: ${e.message}`); }
    }
    // frequencyBps: our position's game-count as a share of the top opening's.
    // Divides the entire tsv by the top-frequency opening for a 0-10000 scale.
    const freqBps = topGames > 0 ? Math.round(((r.games ?? 0) / topGames) * 10000) : 0;
    openings.push({
      slug: slugify(`${r.eco}-${r.name}`),
      eco: r.eco,
      ecoName: r.name,
      name: r.name,
      familyId: familyFromEco(r.eco),
      tier: 3,
      frequencyBps: freqBps,
      pgnStart: sans,
      tagSlugs: [],
      idea: {
        short: wb.excerpt ? wb.excerpt.slice(0, 140).replace(/\s+\S*$/, "…") : `${r.name} (ECO ${r.eco}).`,
        wikibookUrl: wbUrl,
        wikibookExcerpt: wb.excerpt,
        citations: wbUrl
          ? [{ work: "Wikibooks — Chess Opening Theory", licence: "CC-BY-SA", url: wbUrl }]
          : undefined,
      },
    });
    done++;
    if (done % 25 === 0) info(`  ${done}/${targets.length} (${wbOk} with wikibook content)`);
    // Wikimedia asks bots for ≤1 req/sec. 1200 ms is comfortably under; a full
    // 500-opening cold run takes ~10 min. Cache-warm runs are near-instant.
    await new Promise((res) => setTimeout(res, 1200));
  }
  info(`Done: ${done} openings, ${wbOk} with Wikibook content.`);

  // Emit TS module. Sort by ECO for stable diffs; skip openings whose slug
  // collides with a hand-authored pillar (those live in pillars.ts).
  const banner =
`// AUTO-GENERATED by scripts/openings/build.mjs from
//   - Lichess chess-openings TSV (CC0, github.com/lichess-org/chess-openings)
//   - Wikibooks Chess Opening Theory (CC-BY-SA 3.0)
// Edit the generator, not this file. Regenerate: \`node scripts/openings/build.mjs\`.
//
// Generated: ${new Date().toISOString()}
// Openings: ${openings.length}  (with wikibook content: ${wbOk})

import type { Opening } from "./types";

export const GENERATED_OPENINGS: Opening[] = ${JSON.stringify(openings, null, 2)};
`;

  await writeFile(OUT_FILE, banner);
  info(`Wrote ${openings.length} openings → ${OUT_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
