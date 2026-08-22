// /api/play/* — tournament discovery + personalized feed for play.chessguru.cc.
// MVP: read-only listings + geo-cascade suggestion + favorites toggle. Scraper
// (apps/api/scripts/play-scraper-*.mjs) fills the `tournaments` collection.
import { Controller, Get, Post, Delete, Param, Query, Req, Body } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "../admin/admins";

// Haversine in km — good enough for tournament ranking (accurate within 0.5%
// for anywhere on Earth). Same-district / same-state bonuses pull tournaments
// "closer" in the ranking without needing precise polygon adjacency.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const NEIGHBOR_STATES: Record<string, string[]> = {
  "Tamil Nadu": ["Kerala", "Karnataka", "Andhra Pradesh", "Puducherry"],
  "Karnataka": ["Tamil Nadu", "Kerala", "Andhra Pradesh", "Telangana", "Maharashtra", "Goa"],
  "Kerala": ["Tamil Nadu", "Karnataka"],
  "Andhra Pradesh": ["Tamil Nadu", "Karnataka", "Telangana", "Odisha"],
  "Telangana": ["Andhra Pradesh", "Karnataka", "Maharashtra", "Chhattisgarh"],
  "Maharashtra": ["Karnataka", "Telangana", "Madhya Pradesh", "Gujarat", "Goa", "Chhattisgarh"],
};

@Controller("play")
export class PlayController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** GET /api/play/tournaments — filters + pagination. */
  @Get("tournaments")
  async list(@Query() q: any) {
    const db = this.conn.db!;
    const filter: any = { end_date: { $gte: new Date() }, hidden: { $ne: true } };
    if (q.state) filter.state = q.state;
    if (q.rating_type && q.rating_type !== "ALL") {
      if (q.rating_type === "RATED") filter.rating_type = { $in: ["FIDE", "AICF", "STATE"] };
      else filter.rating_type = q.rating_type;
    }
    if (q.format) filter.format = q.format;
    if (q.from) filter.start_date = { ...(filter.start_date || {}), $gte: new Date(q.from) };
    if (q.to)   filter.start_date = { ...(filter.start_date || {}), $lte: new Date(q.to) };
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || "50", 10)));
    const skip = Math.max(0, parseInt(q.skip || "0", 10));
    const rows = await db.collection("tournaments").find(filter).sort({ start_date: 1 }).skip(skip).limit(limit).toArray();
    const total = await db.collection("tournaments").countDocuments(filter);
    return { rows, total };
  }

  /** GET /api/play/tournaments/:id — full detail. */
  @Get("tournaments/:id")
  async get(@Param("id") id: string) {
    const doc = await this.conn.db!.collection("tournaments").findOne({ _id: id as any });
    if (!doc) return { error: "NotFound" };
    return doc;
  }

  /** GET /api/play/tournament?id=<url> — same as above but takes id from query,
   *  so IDs containing slashes / question-marks (e.g. easypaychess URLs) don't
   *  get eaten by URL routing. */
  @Get("tournament")
  async getByQuery(@Query("id") id: string) {
    if (!id) return { error: "NoId" };
    const doc = await this.conn.db!.collection("tournaments").findOne({ _id: id as any });
    if (!doc) return { error: "NotFound" };
    return doc;
  }

  /** GET /api/play/me/feed — GEO-CASCADE + AGE-MATCH personalized list.
   *  Query: ?lat= ?lng= (from browser geo). Fall back to state/pincode.
   *  Scoring (lower = shown first):
   *    score = haversine_km
   *          − 200 (same district as user)
   *          − 100 (same state as user)   OR  − 50 (neighboring state)
   *          − 150 (any of my players fits an age category the tournament offers)
   *  Age-match rule: tournament category U-N or OPEN matches a player of age A
   *  if A ≤ N ≤ A+2, or category === "OPEN". Boost applied ONCE per tournament
   *  regardless of how many kids match — we still surface the "matched_players"
   *  list so the frontend can render a "matches Aarav (11)" badge. */
  @Get("me/feed")
  async feed(@Req() req: any, @Query() q: any) {
    const db = this.conn.db!;
    const lat = parseFloat(q.lat);
    const lng = parseFloat(q.lng);
    const now = new Date();
    const upcoming = await db.collection("tournaments").find({ end_date: { $gte: now }, hidden: { $ne: true } }).limit(500).toArray();
    const userState = q.state ? String(q.state) : null;
    const userDistrict = q.district ? String(q.district) : null;

    // Age-match — signed-in users only. Look up player ages, then score matches.
    const uid = req?.session?.userId;
    let players: Array<{ name: string; age: number | null }> = [];
    if (uid) {
      const raw = await db.collection("play_players").find({ user_id: uid }, { projection: { name: 1, dob: 1 } }).toArray();
      players = raw.map((p: any) => {
        const age = p.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86_400_000)) : null;
        return { name: p.name, age };
      }).filter((p: any) => p.age != null && p.age >= 3 && p.age <= 25);
    }
    const matchAge = (t: any): Array<{ name: string; age: number }> => {
      if (!players.length) return [];
      const cats = (t.age_categories || []) as Array<number | string>;
      if (!cats.length) return [];
      const matches: Array<{ name: string; age: number }> = [];
      for (const p of players) {
        const a = p.age!;
        let hit = false;
        for (const c of cats) {
          if (typeof c === "number" && a <= c && c <= a + 2) { hit = true; break; }
          if (c === "OPEN") { hit = true; break; }
          if (c === "GIRLS" || c === "WOMEN" || c === "SENIOR") { /* ignore for age-match */ }
        }
        if (hit) matches.push({ name: p.name, age: a });
      }
      return matches;
    };

    const scored = upcoming.map((t: any) => {
      let km = Infinity;
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(t.lat) && Number.isFinite(t.lng)) {
        km = haversineKm(lat, lng, t.lat, t.lng);
      }
      let effective = km;
      if (userDistrict && t.district && userDistrict.toLowerCase() === String(t.district).toLowerCase()) effective -= 200;
      if (userState && t.state && userState.toLowerCase() === String(t.state).toLowerCase()) effective -= 100;
      else if (userState && t.state && (NEIGHBOR_STATES[userState] || []).includes(t.state)) effective -= 50;
      const matched = matchAge(t);
      if (matched.length) effective -= 150;
      return { ...t, distance_km: Number.isFinite(km) ? Math.round(km) : null, score: effective, matched_players: matched };
    });
    scored.sort((a: any, b: any) => a.score - b.score
      || (b.prize_pool_paise ?? 0) - (a.prize_pool_paise ?? 0)
      || (new Date(a.start_date).getTime() - new Date(b.start_date).getTime()));

    const rated = scored.filter((t: any) => ["FIDE", "AICF", "STATE"].includes(t.rating_type)).slice(0, 6);
    const nearby = scored.slice(0, 30);
    return { rated, nearby, total: scored.length, players_count: players.length };
  }

  /** POST /api/play/favorites/:id — toggle. Requires session. */
  @Post("favorites/:id")
  async fav(@Param("id") id: string, @Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) return { ok: false, error: "AuthRequired" };
    const coll = this.conn.db!.collection("play_favorites");
    const existing = await coll.findOne({ user_id: uid, tournament_id: id });
    if (existing) { await coll.deleteOne({ _id: existing._id }); return { ok: true, favorited: false }; }
    await coll.insertOne({ user_id: uid, tournament_id: id, created_at: new Date() });
    return { ok: true, favorited: true };
  }

  /** GET /api/play/me/favorites — my bookmarks. */
  @Get("me/favorites")
  async myFavs(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) return { rows: [] };
    const favs = await this.conn.db!.collection("play_favorites").find({ user_id: uid }).toArray();
    const ids = favs.map((f: any) => f.tournament_id);
    const rows = await this.conn.db!.collection("tournaments").find({ _id: { $in: ids as any } }).toArray();
    return { rows };
  }

  /** POST /api/play/submissions — organizer self-serve. Anonymous (no auth) so any
   *  organizer can submit in 60 seconds. Basic anti-abuse: rate-limit by IP + hostname,
   *  reject obvious spam. Auto-approve for now (we cross-check the phone number later);
   *  admin can DELETE bad ones from /api/play/admin/tournaments/:id. */
  private submitRate = new Map<string, { count: number; resetAt: number }>();
  @Post("submissions")
  async submit(@Body() body: any, @Req() req: any) {
    // Rate limit — 5/hour/IP
    const cfip = String(req.headers?.["cf-connecting-ip"] ?? "").trim();
    const xff = String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0]?.trim();
    const ip = cfip || xff || req.ip || "unknown";
    const now = Date.now();
    const rec = this.submitRate.get(ip);
    const HOUR = 60 * 60 * 1000;
    if (rec && rec.resetAt > now) {
      if (rec.count >= 5) return { ok: false, error: `Too many submissions from this IP. Try again in ${Math.ceil((rec.resetAt - now) / 60000)} min.` };
      rec.count++;
    } else {
      this.submitRate.set(ip, { count: 1, resetAt: now + HOUR });
    }

    const s = (v: any, max = 200) => String(v ?? "").trim().slice(0, max);
    const name = s(body?.name);
    const organizer = s(body?.organizer_name);
    const startISO = s(body?.start_date);
    const endISO = s(body?.end_date);
    const city = s(body?.city);
    const state = s(body?.state);
    const venue = s(body?.venue);
    const format = ["CLASSICAL", "RAPID", "BLITZ"].includes(s(body?.format).toUpperCase()) ? s(body?.format).toUpperCase() : "RAPID";
    const rating_type = ["FIDE", "AICF", "STATE", "UNRATED"].includes(s(body?.rating_type).toUpperCase()) ? s(body?.rating_type).toUpperCase() : "UNRATED";
    const ageArr = Array.isArray(body?.age_categories) ? body.age_categories : [];
    const age_categories = ageArr.slice(0, 10).map((x: any) => (typeof x === "number" ? x : String(x).slice(0, 10)));
    const entry_fee_paise = Number.isFinite(+body?.entry_fee_rupees) ? Math.round(+body.entry_fee_rupees * 100) : null;
    const prize_pool_paise = Number.isFinite(+body?.prize_pool_rupees) ? Math.round(+body.prize_pool_rupees * 100) : null;
    const contact_person = s(body?.contact_person, 80);
    const contact_phone = s(body?.contact_phone, 20).replace(/[^\d+]/g, "");
    const contact_email = s(body?.contact_email, 120);
    const prospectus_url = s(body?.prospectus_url, 500);
    const register_url = s(body?.register_url, 500);
    const maps_url = s(body?.maps_url, 500);

    if (!name || name.length < 6) return { ok: false, error: "Tournament name required (min 6 chars)." };
    if (!organizer) return { ok: false, error: "Organizer/academy name required." };
    if (!startISO || Number.isNaN(new Date(startISO).getTime())) return { ok: false, error: "Valid start date required." };
    const start = new Date(startISO);
    const end = endISO && !Number.isNaN(new Date(endISO).getTime()) ? new Date(endISO) : start;
    if (start < new Date(now - 86400000)) return { ok: false, error: "Start date must be today or later." };
    if (!city || !state) return { ok: false, error: "City and state required." };
    if (!/^\+?\d{10,15}$/.test(contact_phone)) return { ok: false, error: "Valid contact phone required." };
    if (contact_email && !contact_email.includes("@")) return { ok: false, error: "Valid email required (or leave blank)." };

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    const id = `submitted:${slug}-${start.toISOString().slice(0, 10)}`;
    const doc: any = {
      _id: id,
      source: "self-serve",
      source_url: null,
      name, organizer_name: organizer,
      location_raw: venue ? `${venue}, ${city}` : city,
      city, state,
      maps_url: maps_url || null,
      start_date: start, end_date: end,
      format, rating_type,
      age_categories,
      entry_fee_paise, prize_pool_paise,
      contact_phones: [contact_phone.replace(/^\+/, "")],
      contact_person: contact_person || null,
      contact_email: contact_email || null,
      prospectus_url: prospectus_url || null,
      register_url: register_url || null,
      submitted_at: new Date(),
      submitter_ip: ip,
      submission_status: "PENDING_REVIEW",
    };
    try {
      await this.conn.db!.collection("tournaments").updateOne({ _id: id as any }, { $set: doc }, { upsert: true });
      return { ok: true, id, message: "Tournament submitted! It's live now. We'll email you within 24 h if we need any clarification." };
    } catch (e: any) {
      return { ok: false, error: "Save failed: " + String(e.message).slice(0, 200) };
    }
  }

  /** ═══ ADMIN endpoints ═══ super-admin only. Session-gated. ═══════════ */
  private assertAdmin(req: any) {
    const uid = req?.session?.userId;
    if (!uid || !isAdmin(uid)) return false;
    return true;
  }

  /** GET /api/play/admin/tournaments?status=&source=&limit= */
  @Get("admin/tournaments")
  async adminList(@Req() req: any, @Query() q: any) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const filter: any = {};
    if (q.source) filter.source = q.source;
    if (q.status) filter.submission_status = q.status;
    if (q.hidden === "1") filter.hidden = true;
    const limit = Math.min(200, parseInt(q.limit || "100", 10));
    const rows = await this.conn.db!.collection("tournaments").find(filter).sort({ submitted_at: -1, scraped_at: -1, start_date: 1 }).limit(limit).toArray();
    return { rows, total: rows.length };
  }

  /** POST /api/play/admin/tournaments/:id/verify — approve a self-serve submission. */
  @Post("admin/tournaments/:id/verify")
  async adminVerify(@Req() req: any, @Param("id") id: string) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const r = await this.conn.db!.collection("tournaments").updateOne(
      { _id: id as any }, { $set: { submission_status: "VERIFIED", verified_at: new Date(), verified_by: req.session.userId } });
    return { ok: r.matchedCount > 0 };
  }

  /** POST /api/play/admin/tournaments/:id/hide — soft-hide from public view. */
  @Post("admin/tournaments/:id/hide")
  async adminHide(@Req() req: any, @Param("id") id: string) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const r = await this.conn.db!.collection("tournaments").updateOne(
      { _id: id as any }, { $set: { hidden: true, hidden_at: new Date() } });
    return { ok: r.matchedCount > 0 };
  }

  /** POST /api/play/admin/tournaments/:id/unhide */
  @Post("admin/tournaments/:id/unhide")
  async adminUnhide(@Req() req: any, @Param("id") id: string) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const r = await this.conn.db!.collection("tournaments").updateOne(
      { _id: id as any }, { $unset: { hidden: "", hidden_at: "" } });
    return { ok: r.matchedCount > 0 };
  }

  /** DELETE /api/play/admin/tournaments/:id — hard delete (spam, duplicates). */
  @Delete("admin/tournaments/:id")
  async adminDelete(@Req() req: any, @Param("id") id: string) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const r = await this.conn.db!.collection("tournaments").deleteOne({ _id: id as any });
    return { ok: r.deletedCount > 0 };
  }

  /** GET /api/play/admin/stats — dashboard counters. */
  @Get("admin/stats")
  async adminStats(@Req() req: any) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const db = this.conn.db!;
    const [total, upcoming, selfServe, pending, hidden, geocoded] = await Promise.all([
      db.collection("tournaments").countDocuments({}),
      db.collection("tournaments").countDocuments({ end_date: { $gte: new Date() } }),
      db.collection("tournaments").countDocuments({ source: "self-serve" }),
      db.collection("tournaments").countDocuments({ submission_status: "PENDING_REVIEW" }),
      db.collection("tournaments").countDocuments({ hidden: true }),
      db.collection("tournaments").countDocuments({ lat: { $exists: true, $ne: null } }),
    ]);
    return { total, upcoming, self_serve: selfServe, pending_review: pending, hidden, geocoded };
  }

  /** GET /api/play/me — who am I? Returns {loggedIn, userId, username}. Used by
   *  the frontend to decide whether to show login prompts or the favorites/players
   *  UI. Piggybacks on the existing ChessGuru session cookie. */
  @Get("me")
  me(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) return { loggedIn: false };
    return { loggedIn: true, userId: uid, username: req.session.username || uid };
  }

  /** ═══ Players (parent manages 1+ kids) ═══ */
  /** GET /api/play/me/players */
  @Get("me/players")
  async listMyPlayers(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) return { rows: [] };
    const rows = await this.conn.db!.collection("play_players").find({ user_id: uid }).sort({ created_at: 1 }).toArray();
    return { rows };
  }

  /** POST /api/play/me/players */
  @Post("me/players")
  async createPlayer(@Req() req: any, @Body() body: any) {
    const uid = req?.session?.userId;
    if (!uid) return { ok: false, error: "AuthRequired" };
    const s = (v: any, m = 80) => String(v ?? "").trim().slice(0, m);
    const name = s(body?.name);
    if (!name || name.length < 2) return { ok: false, error: "Name required." };
    const dob = s(body?.dob);
    if (dob && Number.isNaN(new Date(dob).getTime())) return { ok: false, error: "Invalid DOB." };
    const gender = ["M", "F", "O"].includes(s(body?.gender)) ? s(body?.gender) : null;
    const fide_id = s(body?.fide_id, 12).replace(/\D/g, "") || null;
    const aicf_id = s(body?.aicf_id, 20).toUpperCase() || null;
    const state_rating = Number.isFinite(+body?.state_rating) ? Math.round(+body.state_rating) : null;
    const home_city = s(body?.home_city);
    const home_state = s(body?.home_state);
    const doc: any = {
      _id: `player:${uid}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      user_id: uid, name,
      dob: dob ? new Date(dob) : null,
      gender, fide_id, aicf_id, state_rating,
      home_city: home_city || null, home_state: home_state || null,
      created_at: new Date(),
    };
    await this.conn.db!.collection("play_players").insertOne(doc);
    return { ok: true, id: doc._id };
  }

  /** POST /api/play/me/players/:id/edit — merge-update the fields we allow. */
  @Post("me/players/:id/edit")
  async editPlayer(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    const uid = req?.session?.userId;
    if (!uid) return { ok: false, error: "AuthRequired" };
    const coll = this.conn.db!.collection("play_players");
    const existing = await coll.findOne({ _id: id as any, user_id: uid });
    if (!existing) return { ok: false, error: "NotFound" };
    const s = (v: any, m = 80) => String(v ?? "").trim().slice(0, m);
    const update: any = {};
    if (body.name != null) update.name = s(body.name);
    if (body.dob != null) update.dob = body.dob ? new Date(s(body.dob)) : null;
    if (body.gender != null) update.gender = ["M", "F", "O"].includes(s(body.gender)) ? s(body.gender) : null;
    if (body.fide_id != null) update.fide_id = s(body.fide_id, 12).replace(/\D/g, "") || null;
    if (body.aicf_id != null) update.aicf_id = s(body.aicf_id, 20).toUpperCase() || null;
    if (body.state_rating != null) update.state_rating = Number.isFinite(+body.state_rating) ? Math.round(+body.state_rating) : null;
    if (body.home_city != null) update.home_city = s(body.home_city) || null;
    if (body.home_state != null) update.home_state = s(body.home_state) || null;
    update.updated_at = new Date();
    await coll.updateOne({ _id: id as any }, { $set: update });
    return { ok: true };
  }

  /** DELETE /api/play/me/players/:id */
  @Delete("me/players/:id")
  async deletePlayer(@Req() req: any, @Param("id") id: string) {
    const uid = req?.session?.userId;
    if (!uid) return { ok: false, error: "AuthRequired" };
    const r = await this.conn.db!.collection("play_players").deleteOne({ _id: id as any, user_id: uid });
    return { ok: r.deletedCount > 0 };
  }

  /** GET /api/play/me/rating-recs — for each of the user's players, count/list
   *  rated tournaments in the next 60 days that likely match their rating band.
   *  Heuristics (v1):
   *    • Only rated events (FIDE / AICF / STATE) count.
   *    • Rating-band match: if tournament title mentions "BELOW N" (common Indian
   *      chess naming) and player rating < N, it's a match. Untitled ("OPEN") is
   *      always a match (open events accept all ratings).
   *    • Location match: same state OR within 500 km of the player's home_city
   *      (via user's home lat/lng if provided; else state-only).
   *  Returns: per-player summary + top 6 recs. Empty when no players. */
  @Get("me/rating-recs")
  async ratingRecs(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) return { players: [] };
    const db = this.conn.db!;
    const players = await db.collection("play_players").find({ user_id: uid }).toArray();
    if (!players.length) return { players: [] };

    const now = new Date();
    const cutoff = new Date(now.getTime() + 60 * 86_400_000);
    const rated = await db.collection("tournaments").find({
      start_date: { $gte: now, $lte: cutoff },
      hidden: { $ne: true },
      rating_type: { $in: ["FIDE", "AICF", "STATE"] },
    }).limit(500).toArray();

    // Extract "BELOW N" cap from a tournament title (e.g. "…RATED BELOW 1700 CHESS TOURNAMENT")
    const belowCap = (name: string): number | null => {
      const m = String(name || "").toUpperCase().match(/\bBELOW[\s-]?(\d{3,4})\b/);
      return m ? parseInt(m[1]!, 10) : null;
    };

    const out = [] as any[];
    for (const p of players) {
      const rating = Number.isFinite(p.state_rating) ? p.state_rating : null;
      const homeState = p.home_state || null;
      // Match rule per tournament
      const matches = rated.filter((t: any) => {
        // Location: same state, OR no state info at all (don't over-filter)
        if (homeState && t.state && String(t.state).toLowerCase() !== String(homeState).toLowerCase()) return false;
        // Rating cap
        const cap = belowCap(t.name);
        if (cap != null) {
          if (rating == null) return false;      // "below 1700" tournament — we need the kid's rating to know
          if (rating >= cap) return false;
        }
        return true;
      });
      matches.sort((a: any, b: any) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
      out.push({
        player_id: p._id, player_name: p.name,
        rating: rating, home_state: homeState,
        rated_count: matches.length,
        top: matches.slice(0, 6),
      });
    }
    return { players: out };
  }

  /** GET /api/play/admin/organizer-outreach — unique-phone list assembled from the
   *  scraped tournaments, each with a pre-filled wa.me click-to-chat URL. Also
   *  attaches sent-status from play_outreach_log so the admin UI can render the
   *  "already messaged" indicator. */
  @Get("admin/organizer-outreach")
  async adminOutreach(@Req() req: any) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const db = this.conn.db!;
    const rows = await db.collection("tournaments").aggregate([
      { $match: { source: "easypaychess", contact_phones: { $exists: true, $ne: [] } } },
      { $unwind: "$contact_phones" },
      { $group: {
          _id: "$contact_phones",
          organizer: { $first: "$organizer_name" },
          city: { $first: { $ifNull: ["$city", "$location_raw"] } },
          state: { $first: "$state" },
          first_tournament: { $first: "$name" },
          first_start: { $min: "$start_date" },
          count: { $sum: 1 },
          max_prize: { $max: "$prize_pool_paise" },
        } },
      { $sort: { count: -1, max_prize: -1, first_start: 1 } },
    ]).toArray();
    const log = await db.collection("play_outreach_log").find({}).toArray();
    const logByPhone = new Map(log.map((r: any) => [r.phone, r]));
    return {
      rows: rows.map((r: any) => {
        const phone = String(r._id).replace(/\D/g, "");
        // wa.me needs country code — assume 91 (India) if it's a 10-digit local number
        const waPhone = phone.length === 10 ? "91" + phone : phone;
        const msg = `Namaste ${r.organizer || "sir/madam"} 🙏\n\nI'm from ChessGuru (chessguru.cc). We noticed your tournament:\n📅 ${String(r.first_tournament).slice(0, 90)}\n\nWe'd love to list it FREE on our new India-wide platform *play.chessguru.cc*:\n✅ India-wide player reach\n✅ Modern mobile UI (parents love it)\n✅ Auto geo-suggestion (Chennai players see your event first)\n✅ FREE — no listing fee, no cut on registrations\n\nBONUS: If you run a coaching academy, get 90 days FREE academy management (students, coaches, live classes) — worth ₹3,000. See chessguru.cc/signup-academy\n\nReply YES for a 5-min chat, or list your next tournament in 60s at play.chessguru.cc/submit-tournament\n\n— Team ChessGuru`;
        return {
          phone, waPhone,
          organizer: r.organizer, city: r.city, state: r.state,
          first_tournament: r.first_tournament, first_start: r.first_start,
          tournament_count: r.count, max_prize_paise: r.max_prize,
          wa_url: `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`,
          sent_at: logByPhone.get(phone)?.sent_at || null,
          responded_at: logByPhone.get(phone)?.responded_at || null,
          note: logByPhone.get(phone)?.note || null,
        };
      }),
    };
  }

  /** POST /api/play/admin/organizer-outreach/:phone/mark — mark sent / responded / add note. */
  @Post("admin/organizer-outreach/:phone/mark")
  async adminOutreachMark(@Req() req: any, @Param("phone") phone: string, @Body() body: any) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const p = String(phone).replace(/\D/g, "");
    const patch: any = { phone: p, updated_at: new Date(), updated_by: req.session.userId };
    if (body?.action === "sent")     patch.sent_at = new Date();
    if (body?.action === "unsent")   patch.sent_at = null;
    if (body?.action === "responded") patch.responded_at = new Date();
    if (body?.note != null) patch.note = String(body.note).slice(0, 500);
    await this.conn.db!.collection("play_outreach_log").updateOne(
      { phone: p }, { $set: patch }, { upsert: true });
    return { ok: true };
  }

  /** ═══════════════════════════════════════════════════════════════════════
   *  Meta WhatsApp Cloud API outreach sender.
   *
   *  Reuses the same tokens the DWP backend already uses (whatsappCloud.ts on
   *  Mumbai) — same phone_number_id, same WABA, so template approval carries
   *  over the whole account. Env vars (already added to apps/api/.env):
   *    WHATSAPP_TOKEN=EAAeOt…              # long-lived Meta System-User token
   *    WHATSAPP_PHONE_NUMBER_ID=110845…    # from Meta Business Manager
   *    WHATSAPP_API_VERSION=v21.0
   *    WHATSAPP_LANG=en_US
   *    WA_TPL_OUTREACH=chessguru_tournament_listed  # NEW template, needs Meta approval
   *
   *    OUTREACH_DRY_RUN=1                  # while template pending — logs but skips
   *    OUTREACH_RATE_PER_MIN=5             # burst-detection guard
   *
   *  Owner action pending: create + submit the outreach template in Meta Business
   *  Manager. Suggested copy (utility category — highest approval odds):
   *    Name: chessguru_tournament_listed
   *    Body: "Namaste {{1}}, your tournament {{2}} is now listed FREE on
   *           play.chessguru.cc so parents across India can find it. Reply YES
   *           to add more or edit this listing."
   *  Approval typically 24-72 h. Once approved, unset OUTREACH_DRY_RUN and start
   *  sending via the /admin/outreach dashboard.
   *  ═══════════════════════════════════════════════════════════════════════ */
  private outreachLast: { at: number; count: number } = { at: 0, count: 0 };
  private outreachRateAllowed(): boolean {
    const perMin = parseInt(process.env.OUTREACH_RATE_PER_MIN || "5", 10);
    const now = Date.now();
    if (now - this.outreachLast.at > 60_000) { this.outreachLast = { at: now, count: 1 }; return true; }
    if (this.outreachLast.count >= perMin) return false;
    this.outreachLast.count++;
    return true;
  }

  /** POST /api/play/admin/outreach/:phone/send — send via Twilio to one phone.
   *  Body: { channel?: "whatsapp" | "sms", vars?: string[] } — vars fill the template's
   *  {{1}} {{2}}… slots (defaults: [organizer, tournament]). */
  @Post("admin/outreach/:phone/send")
  async adminOutreachSend(@Req() req: any, @Param("phone") phone: string, @Body() body: any) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    if (!this.outreachRateAllowed()) return { ok: false, error: "RateLimited", detail: `Wait — cap is ${process.env.OUTREACH_RATE_PER_MIN || "5"} sends per minute (WhatsApp burst-detection guard)` };
    const channel = body?.channel === "sms" ? "sms" : "whatsapp";
    const p = String(phone).replace(/\D/g, "");
    const waPhone = p.length === 10 ? "91" + p : p;    // assume India

    // Look up organizer for template vars
    const org = await this.conn.db!.collection("tournaments").findOne({ contact_phones: p }, { projection: { organizer_name: 1, name: 1 } });
    const vars = Array.isArray(body?.vars) && body.vars.length
      ? body.vars.map((v: any) => String(v).slice(0, 200))
      : [org?.organizer_name || "there", String(org?.name || "your upcoming tournament").slice(0, 90)];

    const dryRun = process.env.OUTREACH_DRY_RUN === "1";
    let result: any = { channel, vars, dry_run: dryRun };
    try {
      if (channel === "whatsapp") {
        result = { ...result, ...(await this.sendTwilioWhatsApp(waPhone, vars, dryRun)) };
      } else {
        result = { ...result, ...(await this.sendMsg91Sms(waPhone, vars, dryRun)) };
      }
    } catch (e: any) {
      result.ok = false; result.error = String(e.message || e).slice(0, 300);
    }

    // Persist outreach log (even for dry-run so admin sees "would have sent")
    if (result.ok) {
      await this.conn.db!.collection("play_outreach_log").updateOne(
        { phone: p },
        { $set: { phone: p, sent_at: new Date(), sent_channel: channel, sent_provider_id: result.provider_id || null, sent_dry_run: dryRun, updated_at: new Date(), updated_by: req.session.userId } },
        { upsert: true });
    }
    return result;
  }

  private async sendTwilioWhatsApp(toPhoneDigits: string, vars: string[], dry: boolean): Promise<any> {
    // Renamed method kept for backwards compat with the batch caller — now goes
    // through Meta WhatsApp Cloud API (reusing DWP's approved WABA). Owner still
    // needs to create + approve the outreach-specific template in Business
    // Manager before real sends work — until then we return a clear error.
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const tpl = process.env.WA_TPL_OUTREACH;
    const lang = process.env.WHATSAPP_LANG || "en_US";
    const ver = process.env.WHATSAPP_API_VERSION || "v21.0";
    if (!token || !phoneId) {
      return { ok: false, error: "Meta WhatsApp not configured. Set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID in apps/api/.env (or copy from Mumbai backend) + pm2 restart chessguru-v2-api." };
    }
    if (!tpl) {
      return { ok: false, error: "Outreach template not set. Create 'chessguru_tournament_listed' in Meta Business Manager, wait for approval (24-72h), then set WA_TPL_OUTREACH=<name> in apps/api/.env + pm2 restart." };
    }
    if (dry) return { ok: true, provider_id: "dry-run", would_send: { to: toPhoneDigits, template: tpl, vars, lang } };
    const body = {
      messaging_product: "whatsapp",
      to: toPhoneDigits,
      type: "template",
      template: {
        name: tpl, language: { code: lang },
        components: vars.length
          ? [{ type: "body", parameters: vars.map((v) => ({ type: "text", text: String(v).slice(0, 900) })) }]
          : [],
      },
    };
    const res = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j?.error?.message || JSON.stringify(j).slice(0, 200);
      const code = j?.error?.code;
      // 132001 = template does not exist; 131047 = re-engagement (24h window closed).
      const hint = code === 132001 ? " — this template isn't approved for your WABA yet. Check Meta Business Manager → WhatsApp → Message Templates."
                : code === 131047 ? " — hit the 24h re-engagement rule; can only send templates outside the window."
                : "";
      return { ok: false, error: `Meta WA ${res.status}: ${msg}${hint}`, meta: j };
    }
    return { ok: true, provider_id: j?.messages?.[0]?.id || "queued", status: "sent" };
  }

  private async sendMsg91Sms(toPhoneDigits: string, vars: string[], dry: boolean): Promise<any> {
    const key = process.env.MSG91_AUTH_KEY;
    const tpl = process.env.MSG91_TEMPLATE_ID;
    if (!key || !tpl) {
      return { ok: false, error: "MSG91 not configured. Set MSG91_AUTH_KEY / MSG91_TEMPLATE_ID in apps/api/.env then pm2 restart." };
    }
    if (dry) return { ok: true, provider_id: "dry-run", would_send: { to: toPhoneDigits, template: tpl, vars } };
    // MSG91 flow API: https://docs.msg91.com/reference/send-sms-via-flow
    const payload = {
      template_id: tpl,
      short_url: "1",
      recipients: [{ mobiles: toPhoneDigits, ...Object.fromEntries(vars.map((v, i) => [`var${i + 1}`, v])) }],
    };
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json", "authkey": key },
      body: JSON.stringify(payload),
    });
    const j: any = await res.json();
    if (!res.ok || j?.type === "error") return { ok: false, error: `MSG91: ${j?.message || res.status}`, msg91: j };
    return { ok: true, provider_id: j.data?.[0]?.requestId || j.request_id || "sent", status: "queued" };
  }

  /** POST /api/play/admin/outreach/batch-send — send to N pending organizers.
   *  Body: { channel?, n?, phones? } — either specify explicit phones or send to
   *  the first `n` pending. Respects rate limit; returns per-phone results. */
  @Post("admin/outreach/batch-send")
  async adminOutreachBatch(@Req() req: any, @Body() body: any) {
    if (!this.assertAdmin(req)) return { error: "Forbidden" };
    const channel = body?.channel === "sms" ? "sms" : "whatsapp";
    const n = Math.min(20, Math.max(1, parseInt(body?.n || "5", 10)));
    let phones: string[] = Array.isArray(body?.phones) ? body.phones.map((p: any) => String(p).replace(/\D/g, "")) : [];
    if (!phones.length) {
      // Auto-pick first N pending from the aggregated outreach list
      const pending = await this.conn.db!.collection("tournaments").aggregate([
        { $match: { source: "easypaychess", contact_phones: { $exists: true, $ne: [] } } },
        { $unwind: "$contact_phones" },
        { $group: { _id: "$contact_phones", count: { $sum: 1 } } },
      ]).toArray();
      const log = await this.conn.db!.collection("play_outreach_log").find({ sent_at: { $exists: true, $ne: null } }, { projection: { phone: 1 } }).toArray();
      const sent = new Set(log.map((l: any) => l.phone));
      phones = pending.map((p: any) => String(p._id).replace(/\D/g, "")).filter((p: string) => !sent.has(p)).slice(0, n);
    }
    const results = [];
    for (const p of phones) {
      const r: any = await this.adminOutreachSend(req, p, { channel });
      results.push({ phone: p, ...r });
      // Pace with the rate-limit — sleep just under a minute if we hit the cap.
      await new Promise((r) => setTimeout(r, 800));
    }
    return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  /** GET /api/play/push/key — VAPID public key so the client can subscribe.
   *  Piggybacks on the existing chessguru-v2-api VAPID env vars. */
  @Get("push/key")
  pushKey() { return { key: process.env.VAPID_PUBLIC_KEY || null }; }

  /** POST /api/play/push/subscribe — save a PushSubscription for the signed-in user.
   *  Idempotent: upserts by endpoint. */
  @Post("push/subscribe")
  async pushSubscribe(@Req() req: any, @Body() body: any) {
    const uid = req?.session?.userId;
    if (!uid) return { ok: false, error: "AuthRequired" };
    const endpoint = String(body?.endpoint || "").trim();
    const keys = body?.keys;
    if (!endpoint || !keys?.p256dh || !keys?.auth) return { ok: false, error: "InvalidSubscription" };
    await this.conn.db!.collection("play_push_subs").updateOne(
      { endpoint }, { $set: { user_id: uid, endpoint, keys, updated_at: new Date() } }, { upsert: true });
    return { ok: true };
  }

  /** POST /api/play/geolocate — pincode → (state, district, lat, lng). Cached. */
  @Post("geolocate")
  async geolocate(@Body() body: any) {
    const pincode = String(body?.pincode || "").trim();
    if (!/^\d{6}$/.test(pincode)) return { ok: false, error: "InvalidPincode" };
    const cache = this.conn.db!.collection("pincode_cache");
    const hit = await cache.findOne({ _id: pincode as any });
    if (hit) return { ok: true, ...hit };
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(pincode + ", India")}`;
      const res = await fetch(url, { headers: { "User-Agent": "ChessGuruBot/1.0 (+https://chessguru.cc)" } });
      const arr: any = await res.json();
      if (!arr?.[0]) return { ok: false, error: "PincodeNotFound" };
      const r = arr[0], a = r.address || {};
      const doc = {
        _id: pincode as any,
        lat: parseFloat(r.lat), lng: parseFloat(r.lon),
        state: a.state || null,
        district: a.state_district || a.county || a.city_district || null,
        city: a.city || a.town || a.village || a.suburb || null,
      };
      await cache.insertOne(doc);
      return { ok: true, ...doc };
    } catch (e: any) {
      return { ok: false, error: "GeolocateFailed", detail: String(e.message).slice(0, 200) };
    }
  }
}
