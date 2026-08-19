#!/usr/bin/env node
/**
 * Full-corpus regenerator — emits EVERY named opening in the Lichess ECO TSVs
 * (~3500 entries), preserving frequency + wikibook excerpts from the previous
 * generated.ts when a slug matches so the top-500 keeps its rich metadata.
 *
 * Owner ask 2026-08-19: bring the corpus to 100% Lichess parity so the
 * name-tree drilldown at /study/openings-by-name isn't thin under Sicilian /
 * King's Indian / Nimzo etc.
 *
 * Fast (~5 s) — no masters-DB frequency ranking, no wikibook fetches. Extra
 * openings beyond the previous top-500 get tier=4, frequencyBps=0, and a
 * stub idea line ("$name (ECO $eco).").
 *
 * Run: `node scripts/openings/build-full.mjs`
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { Chess } from "chess.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUT_FILE = resolve(REPO_ROOT, "apps/web/src/lib/openings/generated.ts");
const CACHE = "/tmp/cg-openings-cache";

async function fetchTsv() {
  const rows = [];
  for (const p of ["a", "b", "c", "d", "e"]) {
    const cache = `${CACHE}/${p}.tsv`;
    let text;
    if (existsSync(cache)) {
      text = await readFile(cache, "utf8");
    } else {
      const r = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${p}.tsv`);
      if (!r.ok) throw new Error(`tsv fetch ${p} failed: ${r.status}`);
      text = await r.text();
      await writeFile(cache, text);
    }
    for (const line of text.split("\n").slice(1)) {
      if (!line.trim()) continue;
      const [eco, name, pgn] = line.split("\t");
      if (!eco || !name || !pgn) continue;
      rows.push({ eco, name, pgn });
    }
  }
  return rows;
}

function pgnToSans(pgn) {
  return pgn
    .replace(/\d+\.(\.\.)?/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/[()!?+#*]/g, "")
    .replace(/\s+/g, " ")
    .trim().split(" ")
    .filter((s) => s && !/^[10-]+$/.test(s));
}
function sansToUci(sans) {
  const g = new Chess();
  const out = [];
  for (const s of sans) {
    try { const mv = g.move(s); if (!mv) return null; out.push(mv.from + mv.to + (mv.promotion ?? "")); }
    catch { return null; }
  }
  return out.join(",");
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
function familyFromEco(eco) {
  const letter = eco[0]; const n = parseInt(eco.slice(1), 10);
  if (letter === "A") {
    if (n <= 39) return "english";
    if (n <= 44) return "d4-side";
    if (n <= 49) return "kings-indian";
    if (n <= 79) return "d4-side";
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
    if (n <= 9) return "d4-side";
    if (n <= 29) return "slav";
    if (n <= 69) return "qgd";
    return "grunfeld";
  }
  if (n <= 9) return "catalan";
  if (n <= 19) return "qi-bogo";
  if (n <= 59) return "nimzo";
  return "kings-indian";
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  console.log("Fetching Lichess ECO TSVs (a–e)…");
  const all = await fetchTsv();
  console.log(`  ${all.length} rows loaded`);

  for (const r of all) {
    r.sans = pgnToSans(r.pgn);
    r.uci = r.sans.length ? sansToUci(r.sans) : null;
  }
  const parsable = all.filter((r) => r.uci);
  console.log(`  ${parsable.length} rows with parsable PGN`);

  // De-dupe by UCI — same position under multiple names (rare); keep the
  // SHORTEST name (family root) so "Sicilian Defense" beats "Sicilian, Old
  // Sicilian, Wing Gambit".
  const byUci = new Map();
  for (const r of parsable) {
    const cur = byUci.get(r.uci);
    if (!cur || r.name.length < cur.name.length) byUci.set(r.uci, r);
  }
  const unique = [...byUci.values()];
  console.log(`  ${unique.length} unique positions`);

  // Load previous generated.ts to preserve tier / frequencyBps / wikibook
  // content for slugs that already existed. Anything new gets tier=4,
  // frequencyBps=0, stub idea.
  const prevBySlug = new Map();
  try {
    const modUrl = pathToFileURL(OUT_FILE).href;
    // dynamic import of a TS file? No — read as text and parse the JSON array
    // literal after the "= " assignment. Cheap; avoids ts-node.
    const text = await readFile(OUT_FILE, "utf8");
    // First "[" would hit the Opening[] TYPE annotation — anchor on the array
    // literal assignment instead.
    const anchor = text.indexOf("GENERATED_OPENINGS");
    const jsonStart = text.indexOf("[", text.indexOf("=", anchor));
    const jsonEnd = text.lastIndexOf("]") + 1;
    const arr = JSON.parse(text.slice(jsonStart, jsonEnd));
    for (const o of arr) prevBySlug.set(o.slug, o);
    console.log(`  loaded ${prevBySlug.size} prior openings for metadata preservation`);
    // suppress unused-var lint on modUrl (we may need it if the format changes)
    void modUrl;
  } catch (e) {
    console.warn("  couldn't parse prior generated.ts — will emit fresh:", e.message);
  }

  const openings = [];
  let preserved = 0;
  for (const r of unique) {
    const slug = slugify(`${r.eco}-${r.name}`);
    const prev = prevBySlug.get(slug);
    if (prev) preserved++;
    openings.push({
      slug,
      eco: r.eco,
      ecoName: r.name,
      name: prev?.name ?? r.name,
      familyId: prev?.familyId ?? familyFromEco(r.eco),
      tier: prev?.tier ?? 4,
      frequencyBps: prev?.frequencyBps ?? 0,
      pgnStart: r.sans,
      tagSlugs: prev?.tagSlugs ?? [],
      idea: prev?.idea ?? {
        short: `${r.name} (ECO ${r.eco}).`,
        wikibookUrl: null,
        wikibookExcerpt: null,
      },
    });
  }

  // Stable sort: ECO asc, then name asc — so diffs are readable.
  openings.sort((a, b) => (a.eco.localeCompare(b.eco) || a.name.localeCompare(b.name)));

  const wbOk = openings.filter((o) => o.idea?.wikibookExcerpt).length;
  const banner =
`// AUTO-GENERATED by scripts/openings/build-full.mjs from
//   - Lichess chess-openings TSV (CC0, github.com/lichess-org/chess-openings)
//   - Wikibooks Chess Opening Theory (CC-BY-SA 3.0)
// Edit the generator, not this file. Regenerate: \`node scripts/openings/build-full.mjs\`.
//
// Generated: ${new Date().toISOString()}
// Openings: ${openings.length}  (with wikibook content: ${wbOk}; preserved from previous: ${preserved})

import type { Opening } from "./types";

export const GENERATED_OPENINGS: Opening[] = ${JSON.stringify(openings, null, 2)};
`;

  await writeFile(OUT_FILE, banner);
  console.log(`Wrote ${openings.length} openings (${preserved} preserved, ${openings.length - preserved} new) → ${OUT_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
