// play.chessguru.cc scraper — easypaychess.com source.
// Parses index.asp, upserts each tournament into Mongo `tournaments` collection
// keyed by source_url. Ethical: 3s between requests, custom User-Agent, hourly.
//
// Run: node play-scraper-easypaychess.mjs
// Cron:  hourly (systemd timer or pm2 cron).

import { load as cheerioLoad } from "cheerio";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chessguru";
const SOURCE = "easypaychess";
const BASE = "https://easypaychess.com";
const UA = "ChessGuruBot/1.0 (+https://chessguru.cc; hello@chessguru.cc)";

async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return await res.text();
}

// Heuristic: given a tournament name + description, detect the rating type.
function detectRatingType(name) {
  const s = (name || "").toUpperCase();
  if (/\bFIDE\b/.test(s)) return "FIDE";
  if (/\bAICF\b/.test(s)) return "AICF";
  if (/\bSTATE\b/.test(s) || /\bTN[-\s]?STATE\b/.test(s)) return "STATE";
  return "UNRATED";
}

// Extract age categories from title / fees string ("U7,9,11,13,Open E.Fee Rs. 400" etc).
function detectAgeCategories(name, fees) {
  const s = `${name || ""} ${fees || ""}`.toUpperCase();
  const ages = [];
  const matches = s.match(/U-?\s?(\d+)/g) || [];
  for (const m of matches) {
    const n = parseInt(m.replace(/\D/g, ""), 10);
    if (n && !ages.includes(n)) ages.push(n);
  }
  if (/\bOPEN\b/.test(s)) ages.push("OPEN");
  return ages;
}

// Format = classical / rapid / blitz — from title
function detectFormat(name) {
  const s = (name || "").toUpperCase();
  if (/\bBLITZ\b/.test(s)) return "BLITZ";
  if (/\bRAPID\b/.test(s)) return "RAPID";
  return "CLASSICAL";
}

function toPaise(feeText) {
  // "E.Fee Rs. 400" → 40000 paise
  const m = String(feeText || "").match(/(?:Rs\.?|₹)\s*(\d+)/i);
  return m ? parseInt(m[1], 10) * 100 : null;
}

function prizePoolPaise(prizeText) {
  // "Cash Rs.25K & Trophy" → 2500000 paise
  const t = String(prizeText || "");
  const k = t.match(/Rs\.?\s*(\d+(?:\.\d+)?)\s*K/i);
  if (k) return Math.round(parseFloat(k[1]) * 1000 * 100);
  const l = t.match(/Rs\.?\s*(\d+(?:\.\d+)?)\s*L(akh|acs)?/i);
  if (l) return Math.round(parseFloat(l[1]) * 100000 * 100);
  const p = t.match(/(?:Rs\.?|₹)\s*(\d+)/);
  return p ? parseInt(p[1], 10) * 100 : null;
}

function parseDateRange(s) {
  // "23-Aug-2026 ~ 23-Aug-2026"
  const m = String(s || "").match(/(\d{1,2}-[A-Za-z]{3}-\d{4})\s*~\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/);
  if (!m) return { start: null, end: null };
  const parse = (d) => {
    const [dd, mmm, yyyy] = d.split("-");
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    return new Date(Date.UTC(parseInt(yyyy, 10), months[mmm] ?? 0, parseInt(dd, 10)));
  };
  return { start: parse(m[1]), end: parse(m[2]) };
}

function parseTournamentCard($, table) {
  const $t = $(table);
  const name = $t.find("th.c1").first().text().trim();
  if (!name) return null;
  const organizer = $t.find("td.c2").first().text().trim().replace(/^Organized by\s+/i, "");
  const dateText = $t.find("td.c3").first().text().trim();
  const { start, end } = parseDateRange(dateText);
  if (!start) return null; // skip malformed

  const locBlock = $t.find("td.c5").first();
  const mapsLink = locBlock.find("a[href*='maps']").attr("href") || null;
  const location = locBlock.clone().find("a").remove().end().text().trim().replace(/\s+/g, " ");

  const c4s = $t.find("td.c4").map((_, el) => $(el).text().trim()).get();
  const prizeText = c4s.find((t) => /cash|trophy|rs/i.test(t)) || "";
  const feesText = c4s.find((t) => /fee|u\d/i.test(t)) || "";

  const bookHref = $t.find("a[href*='TransPlayers']").attr("href") || null;
  const prospectusHref = $t.find("a[href*='.pdf']").attr("href") || null;

  const contactText = $t.find("td:contains('Ph:')").text().trim();
  const phoneMatch = contactText.match(/Ph:\s*([\d,\s]+)/);
  const phones = phoneMatch ? phoneMatch[1].split(/[,\s]+/).filter((p) => /^\d{10}$/.test(p)) : [];
  const contactPerson = $t.find("td:has(img[src*='person'])").text().trim().split("\n")[0] || null;

  return {
    source: SOURCE,
    source_url: bookHref ? `${BASE}/${bookHref}` : null,
    name,
    organizer_name: organizer,
    location_raw: location,
    maps_url: mapsLink,
    start_date: start,
    end_date: end,
    format: detectFormat(name),
    rating_type: detectRatingType(name),
    age_categories: detectAgeCategories(name, feesText),
    entry_fee_paise: toPaise(feesText),
    prize_pool_paise: prizePoolPaise(prizeText),
    contact_phones: phones,
    contact_person: contactPerson?.replace(/^\s*/, "").replace(/\s+/g, " ") || null,
    prospectus_url: prospectusHref ? `${BASE}/${prospectusHref}` : null,
    register_url: bookHref ? `${BASE}/${bookHref}` : null,
    raw_snippet: { fees: feesText, prize: prizeText, date_text: dateText },
    scraped_at: new Date(),
  };
}

async function scrapeIndex() {
  const html = await fetchPage(`${BASE}/index.asp`);
  const $ = cheerioLoad(html);
  const cards = [];
  // Each tournament is an outer <table border=1 width=910>
  $("table[width='910']").each((_, el) => {
    const t = parseTournamentCard($, el);
    if (t) cards.push(t);
  });
  return cards;
}

async function upsertAll(coll, tournaments) {
  let inserted = 0, updated = 0;
  for (const t of tournaments) {
    const key = t.source_url || `${SOURCE}:${t.name}:${t.start_date?.toISOString()}`;
    const existing = await coll.findOne({ _id: key });
    const doc = { ...t, _id: key };
    if (existing) {
      await coll.updateOne({ _id: key }, { $set: doc });
      updated++;
    } else {
      await coll.insertOne(doc);
      inserted++;
    }
  }
  return { inserted, updated };
}

(async () => {
  const started = Date.now();
  console.log(`[${new Date().toISOString()}] easypaychess scrape start`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const coll = db.collection("tournaments");
  // Ensure geo index for later (safe if already exists)
  await coll.createIndex({ start_date: 1 });
  await coll.createIndex({ source: 1 });
  await coll.createIndex({ rating_type: 1 });

  try {
    const tournaments = await scrapeIndex();
    console.log(`  parsed ${tournaments.length} cards`);
    const { inserted, updated } = await upsertAll(coll, tournaments);
    console.log(`  inserted=${inserted} updated=${updated}`);
    console.log(`  sample:`, JSON.stringify(tournaments[0], null, 2).slice(0, 800));
  } finally {
    await client.close();
  }
  console.log(`[${new Date().toISOString()}] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
})();
