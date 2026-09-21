#!/usr/bin/env node
// Exhaustive Google Places crawl of chess academies for the superadmin leads list.
//
// Why a grid: one "chess academy Chennai" text search caps at 60 results, so the first
// 121-row list (web research, no Maps data at all) had zero rows in Avadi and the whole
// north-west. This tiles the metro into ~4 km rectangles and runs every query variant
// inside each tile with a hard locationRestriction, so no tile can ever hit the cap and
// every result is inside the tile. Places are deduped by Google place id.
//
// Two phases, cached in between, so the merge can be re-run (or unit-tested with a
// fixture) without spending API calls again:
//   crawl  — Text Search per tile x query, then Place Details (phone, website, address
//            components) for every unique chess place → writes the cache JSON.
//   merge  — matches cached places against academyLeads by phone, website host, or
//            normalised name; fills blanks + Maps fields on matches, inserts the rest,
//            and marks academies that are already on ChessGuru as converted.
//            DRY RUN unless --write. Never touches an owner's status/notes/activity
//            except new → converted for an academy that is already a customer.
//
// Usage:
//   GOOGLE_PLACES_KEY=... node scripts/mine-academies-places.mjs crawl [--out F] [--tile-deg 0.04]
//   node scripts/mine-academies-places.mjs merge [--in F] [--write] [--by superadmin]
//
// The key is read from GOOGLE_PLACES_KEY or --key-file <path>; it is never printed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MongoClient, ObjectId } from "mongodb";

const MONGO = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru";
const argv = process.argv.slice(2);
const mode = argv[0];
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const CACHE = resolve(flag("out", flag("in", "scripts/.cache/places-chennai.json")));

// ---------------------------------------------------------------------------------
// Crawl geometry. Chennai metro incl. Avadi, Thiruninravur, Poonamallee, Red Hills,
// Tambaram, Kelambakkam and the OMR/ECR stretch. Latitude 12.75–13.30, longitude
// 79.90–80.35. 0.04° ≈ 4.4 km, so ~14 x 12 = 168 tiles.
const BOUNDS = { latMin: 12.75, latMax: 13.3, lngMin: 79.9, lngMax: 80.35 };
const QUERIES = ["chess academy", "chess coaching", "chess classes", "chess club", "chess school", "chess coaching centre"];
// A place is "chess" if its name says so. Text Search inside a tile with no academies
// still returns the nearest schools/tuition centres; those are logged, not kept.
const CHESS_RX = /chess|sathuranga|sadhuranga|chaturanga|சதுரங்க/i;

const API = "https://places.googleapis.com/v1";
const SEARCH_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location", "places.types",
  "places.primaryType", "places.businessStatus", "nextPageToken",
].join(",");
// Phone + website + addressComponents are what the leads page needs; they sit in the
// costlier Details SKU, so Details is only called once per unique chess place.
const DETAILS_MASK = [
  "id", "displayName", "formattedAddress", "addressComponents", "location", "nationalPhoneNumber",
  "internationalPhoneNumber", "websiteUri", "rating", "userRatingCount", "businessStatus", "googleMapsUri", "primaryType",
].join(",");

function apiKey() {
  const f = flag("key-file", null);
  const k = (f ? readFileSync(f, "utf8") : process.env.GOOGLE_PLACES_KEY ?? "").trim();
  if (!k) { console.error("no key: set GOOGLE_PLACES_KEY or pass --key-file <path>"); process.exit(2); }
  return k;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(key, url, opts, mask, attempt = 0) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask, ...(opts.headers ?? {}) },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`${res.status} after ${attempt} retries: ${url}`);
    await sleep(500 * 2 ** attempt);
    return call(key, url, opts, mask, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function searchTile(key, rect, textQuery, stats) {
  const out = [];
  let pageToken;
  do {
    const body = { textQuery, languageCode: "en", regionCode: "IN", pageSize: 20, locationRestriction: { rectangle: rect } };
    if (pageToken) body.pageToken = pageToken;
    const j = await call(key, `${API}/places:searchText`, { method: "POST", body: JSON.stringify(body) }, SEARCH_MASK);
    stats.searchCalls += 1;
    out.push(...(j.places ?? []));
    pageToken = j.nextPageToken;
    if (pageToken) await sleep(300); // page tokens need a beat before they are valid
  } while (pageToken);
  return out;
}

async function crawl() {
  const key = apiKey();
  const step = Number(flag("tile-deg", 0.04));
  const tiles = [];
  for (let lat = BOUNDS.latMin; lat < BOUNDS.latMax - 1e-9; lat += step)
    for (let lng = BOUNDS.lngMin; lng < BOUNDS.lngMax - 1e-9; lng += step)
      tiles.push({ low: { latitude: r6(lat), longitude: r6(lng) }, high: { latitude: r6(Math.min(lat + step, BOUNDS.latMax)), longitude: r6(Math.min(lng + step, BOUNDS.lngMax)) } });
  console.log(`crawl: ${tiles.length} tiles x ${QUERIES.length} queries, restricted per tile`);

  const found = new Map(); // id → search-level place
  const rejected = new Map(); // non-chess names, for the log
  const stats = { searchCalls: 0, detailCalls: 0 };
  let t = 0;
  for (const rect of tiles) {
    t += 1;
    for (const q of QUERIES) {
      const places = await searchTile(key, rect, q, stats);
      for (const p of places) {
        const name = p.displayName?.text ?? "";
        if (!CHESS_RX.test(name)) { rejected.set(p.id, name); continue; }
        if (!found.has(p.id)) found.set(p.id, p);
      }
      await sleep(120);
    }
    if (t % 20 === 0) console.log(`  tiles ${t}/${tiles.length} — ${found.size} chess places so far, ${stats.searchCalls} search calls`);
  }
  console.log(`search done: ${found.size} unique chess places, ${rejected.size} non-chess results ignored, ${stats.searchCalls} calls`);

  const details = [];
  let d = 0;
  for (const id of found.keys()) {
    d += 1;
    try {
      const j = await call(key, `${API}/places/${encodeURIComponent(id)}`, { method: "GET" }, DETAILS_MASK);
      stats.detailCalls += 1;
      details.push(j);
    } catch (e) {
      console.error(`  details failed for ${id}: ${e.message}`);
    }
    if (d % 25 === 0) console.log(`  details ${d}/${found.size}`);
    await sleep(120);
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify({
    crawledAt: new Date().toISOString(), bounds: BOUNDS, tileDeg: step, queries: QUERIES, stats,
    rejectedSample: [...rejected.values()].slice(0, 40), places: details,
  }, null, 1));
  console.log(`wrote ${details.length} places → ${CACHE}  (${stats.searchCalls} search + ${stats.detailCalls} details calls)`);
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------------------------
// Merge. Pure functions first so the matching can be tested with a fixture.
export const normPhone = (s) => (s ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "").slice(-10);
// Leads store phones as free text: "98400 12345 / +91-98411-22334, 044 2345 6789". Match
// ten digits that may be split by spaces, dashes or dots, with an optional +91/0 prefix,
// and keep only Indian mobiles (start 6–9) — landlines cannot identify an academy.
export const phonesIn = (s) =>
  [...new Set((String(s ?? "").match(/(?:\+?\s*91[\s.-]*|0[\s.-]*)?[6-9](?:[\s.-]*\d){9}(?!\d)/g) ?? []).map(normPhone).filter((p) => /^[6-9]\d{9}$/.test(p)))];
export const hostOf = (u) => {
  if (!u) return "";
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
const STOP = new Set(["chess", "academy", "academies", "the", "school", "club", "of", "coaching", "centre", "center", "classes", "class", "and", "&", "institute", "for", "in", "chennai"]);
export const nameCore = (s) =>
  String(s ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).join(" ");
export const nameFull = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Locality from address components: sublocality first, then the locality/town. */
export function localityOf(p) {
  const comps = p.addressComponents ?? [];
  const pick = (t) => comps.find((c) => (c.types ?? []).includes(t))?.longText;
  return pick("sublocality_level_1") ?? pick("sublocality") ?? pick("neighborhood") ?? pick("locality") ?? "";
}
// Avadi, Tambaram, Poonamallee etc. are their own "locality" in Google's data, but every
// place inside the crawl box is a Chennai lead for the pipeline; the real town lands in
// `locality` via localityOf().
export const cityOf = () => "Chennai";

/** Decide what to do with one crawled place against the existing leads + customer academies. */
export function decide(place, leads, academies) {
  const name = place.displayName?.text ?? place.displayName ?? "";
  const phones = phonesIn([place.nationalPhoneNumber, place.internationalPhoneNumber].filter(Boolean).join(" "));
  const host = hostOf(place.websiteUri);
  const core = nameCore(name);
  const full = nameFull(name);

  let match = null, how = "";
  for (const l of leads) {
    const lp = phonesIn(l.phones);
    if (phones.length && lp.some((p) => phones.includes(p))) { match = l; how = "phone"; break; }
  }
  if (!match && host) {
    match = leads.find((l) => hostOf(l.website) === host) ?? null;
    if (match) how = "website";
  }
  if (!match) {
    match = leads.find((l) => nameFull(l.name) === full) ?? null;
    if (match) how = "name";
  }
  if (!match && core.length >= 5) {
    const c = leads.filter((l) => nameCore(l.name) === core);
    if (c.length === 1) { match = c[0]; how = "name-core"; }
  }

  const customer = academies.find((a) => {
    const af = nameFull(a.name);
    return af && (af === full || (nameCore(a.name).length >= 5 && nameCore(a.name) === core));
  }) ?? null;

  return { name, phones, host, core, match, how, customer };
}

async function merge() {
  if (!existsSync(CACHE)) { console.error(`no cache at ${CACHE} — run crawl first, or pass --in`); process.exit(2); }
  const cache = JSON.parse(readFileSync(CACHE, "utf8"));
  const write = flag("write", false) === true;
  const by = String(flag("by", "superadmin"));
  const mc = new MongoClient(MONGO);
  await mc.connect();
  const col = mc.db().collection("academyLeads");
  const leads = await col.find({}).toArray();
  const academies = await mc.db().collection("academies").find({}, { projection: { _id: 1, name: 1 } }).toArray();
  const now = new Date();
  const tally = { insert: 0, update: 0, converted: 0, closed: 0 };
  const lines = [];

  for (const p of cache.places) {
    if (p.businessStatus === "CLOSED_PERMANENTLY") { tally.closed += 1; lines.push(`  skip closed   ${p.displayName?.text}`); continue; }
    const d = decide(p, leads, academies);
    const maps = {
      mapsPlaceId: p.id, mapsUrl: p.googleMapsUri ?? "", rating: p.rating ?? null, ratingCount: p.userRatingCount ?? 0,
      lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null, mapsCheckedAt: now,
    };
    const mined = {
      locality: localityOf(p), address: p.formattedAddress ?? "", phones: d.phones.join(" / "), website: p.websiteUri ?? "",
    };
    if (d.match) {
      // Fill blanks only; the owner's edits and the original research win over Maps.
      const fill = {};
      for (const k of Object.keys(mined)) if (!String(d.match[k] ?? "").trim() && mined[k]) fill[k] = mined[k];
      const src = String(d.match.sources ?? "");
      const set = { ...maps, ...fill, updatedAt: now, sources: /google maps/i.test(src) ? src : (src ? `${src}; Google Maps` : "Google Maps") };
      const conv = d.customer && d.match.status === "new";
      if (conv) { set.status = "converted"; set.academyId = d.customer._id; tally.converted += 1; }
      tally.update += 1;
      lines.push(`  match(${d.how.padEnd(9)}) ${d.name}  →  "${d.match.name}"${Object.keys(fill).length ? "  +" + Object.keys(fill).join(",") : ""}${conv ? "  ⇒ converted (" + d.customer._id + ")" : ""}`);
      if (write) {
        const upd = { $set: set };
        if (conv) upd.$push = { activity: { at: now, by, kind: "status", text: `converted — already on ChessGuru as ${d.customer._id} (matched from Google Maps)` } };
        await col.updateOne({ _id: d.match._id }, upd);
      }
      continue;
    }
    const doc = {
      _id: new ObjectId(), name: d.name, city: cityOf(p), ...mined, email: "", coaches: "", estStudents: "", estCoaches: "", estimateBasis: "",
      notes: [p.rating ? `Google rating ${p.rating} (${p.userRatingCount ?? 0})` : "", p.businessStatus && p.businessStatus !== "OPERATIONAL" ? p.businessStatus : ""].filter(Boolean).join("; "),
      sources: "Google Maps", ...maps,
      status: d.customer ? "converted" : "new", assignee: "", nextFollowUpAt: null, lastContactAt: null,
      academyId: d.customer ? d.customer._id : null, optIn: false, optInAt: null, optInSource: "",
      activity: [{ at: now, by, kind: "note", text: `Added from the Google Places crawl of ${cache.crawledAt?.slice(0, 10)}` }],
      createdAt: now, updatedAt: now,
    };
    if (d.customer) { doc.activity.push({ at: now, by, kind: "status", text: `converted — already on ChessGuru as ${d.customer._id}` }); tally.converted += 1; }
    tally.insert += 1;
    lines.push(`  insert        ${d.name}  [${mined.locality || "?"}]${d.customer ? "  ⇒ converted (" + d.customer._id + ")" : ""}`);
    if (write) { await col.insertOne(doc); leads.push(doc); }
  }
  console.log(lines.join("\n"));
  console.log(`\n${write ? "APPLIED" : "DRY RUN"}: ${tally.insert} insert, ${tally.update} update (${tally.converted} marked converted), ${tally.closed} closed skipped, from ${cache.places.length} places vs ${leads.length} existing leads`);
  await mc.close();
}

// Only dispatch when run directly, so the matching helpers can be imported by tests.
const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  if (mode === "crawl") await crawl();
  else if (mode === "merge") await merge();
  else { console.error("usage: mine-academies-places.mjs crawl|merge [flags]"); process.exit(2); }
}
