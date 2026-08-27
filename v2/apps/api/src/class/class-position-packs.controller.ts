// Coach → student "position packs" — during a live Dream Meet class, the
// coach clicks 📤 Send position and the current board state (startFen +
// history + cursorIdx pulled from the class-ws room) is snapshotted into a
// classPositionPacks row and pushed into the recipient students' Notebook
// (under the "📚 Online class" section). Complements class-notes which goes
// student → coach (paper photo reflection). Phase 1 — Phase 2 will layer
// revise mode + leaderboard on top of these packs.
//
// Data model (mongo `classPositionPacks`):
//   { _id: "pp_<12chars>", classId, classTitle, academyId, coachId,
//     coachName, sentAt, title, startFen, history: [{from,to,promotion?}],
//     cursorIdx, currentFen, recipientUserIds: [uid, ...] }

import {
  BadRequestException, Body, Controller, ForbiddenException, Get,
  NotFoundException, Param, Post, Req, UnauthorizedException,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Chess } from "chess.js";
import { randomBytes } from "crypto";
import { resolveEligibility, isStudentEligible } from "./class-eligibility";
import * as http from "http";

// Fire-and-forget Maia difficulty rating. book-engine at 127.0.0.1:4101
// exposes /rate?fen=<url-fen>&sol=<uci> and returns { rating, band, ... }.
// Called AFTER the pack is inserted so a slow engine never blocks the
// coach's send. Writes maiaRating + maiaBand back onto the pack row when
// the response arrives.
const BOOK_ENGINE_HOST = process.env.CHESSGURU_BOOK_ENGINE_HOST ?? "127.0.0.1";
const BOOK_ENGINE_PORT = Number(process.env.CHESSGURU_BOOK_ENGINE_PORT ?? "4101");
function requestMaiaRating(fen: string, uciSol: string, cb: (r: { rating: number; band?: string } | null) => void) {
  try {
    const path = `/rate?fen=${encodeURIComponent(fen)}&sol=${encodeURIComponent(uciSol)}`;
    const req = http.request({ host: BOOK_ENGINE_HOST, port: BOOK_ENGINE_PORT, path, method: "GET", timeout: 12_000 }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { buf += c; if (buf.length > 32_000) req.destroy(); });
      res.on("end", () => {
        try {
          const j = JSON.parse(buf);
          if (j && typeof j.rating === "number") cb({ rating: Math.round(j.rating), band: typeof j.band === "string" ? j.band : undefined });
          else cb(null);
        } catch { cb(null); }
      });
    });
    req.on("error", () => cb(null));
    req.on("timeout", () => { try { req.destroy(); } catch { /* */ } cb(null); });
    req.end();
  } catch { cb(null); }
}

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PACK_ID_RE = /^pp_[A-Za-z0-9_-]{6,32}$/;
const MAX_TITLE = 140;
const MAX_HISTORY = 800;   // 400 full-moves of chess, well past any real class snippet

type Move = { from: string; to: string; promotion?: string };

function newPackId(): string {
  return "pp_" + randomBytes(9).toString("base64url").slice(0, 12);
}

/** Replay startFen + history to derive the canonical currentFen. Also gives
 *  us a cheap validity check — a pack we can't replay is one we shouldn't
 *  accept, since the notebook viewer would break. */
function replayToFen(startFen: string, history: Move[], cursorIdx: number): { fen: string; capped: number } {
  const c = new Chess(startFen);        // throws if startFen is malformed
  const capped = Math.max(0, Math.min(cursorIdx | 0, history.length));
  for (let i = 0; i < capped; i++) {
    const m = history[i]!;
    c.move({ from: m.from, to: m.to, promotion: (m.promotion as any) || "q" });
  }
  return { fen: c.fen(), capped };
}

/** Cleanse an incoming history array — drops obvious garbage rather than
 *  rejecting the whole request. Later chess.js replay will fail hard on any
 *  illegal move, which is the real gate. */
function cleanHistory(raw: unknown): Move[] {
  if (!Array.isArray(raw)) return [];
  const out: Move[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const from = (m as any).from, to = (m as any).to;
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) continue;
    const promo = (m as any).promotion;
    out.push({ from, to, promotion: (typeof promo === "string" && /^[qrbn]$/i.test(promo)) ? promo.toLowerCase() : undefined });
    if (out.length >= MAX_HISTORY) break;
  }
  return out;
}

@Controller("class")
export class ClassPositionPacksController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private packs()   { return this.conn.db!.collection("classPositionPacks"); }
  private classes() { return this.conn.db!.collection("classSchedules"); }
  private ann()     { return this.conn.db!.collection("classLiveAnnouncements"); }
  private users()   { return this.conn.db!.collection("users"); }

  /** POST /api/class/:id/send-position  — coach captures the current board
   *  and pushes it into every listed recipient's Notebook. Body:
   *    { title?: string,
   *      startFen: string, history: [{from,to,promotion?}], cursorIdx: number,
   *      recipientUserIds?: string[] }  // omit for "everyone eligible" */
  @Post(":id/send-position")
  async send(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new BadRequestException("bad room");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();

    // Locate the class row (or announcement fallback for ad-hoc rooms) so we
    // can enforce tenant + coach ownership.
    const klass: any = await this.classes().findOne({ _id: id as any });
    const announce: any = klass ? null : await this.ann().findOne({ _id: id as any });
    if (!klass && !announce) throw new NotFoundException("class not found");
    const academyId: string | null = klass?.academyId ?? announce?.academyId ?? null;
    const coachUserId: string | null = klass?.createdByUserId ?? announce?.coachUserId ?? null;
    const mineAcademy: string | null = req.session.academyId ?? null;
    if (academyId && mineAcademy !== academyId) throw new NotFoundException();
    const isCreator = coachUserId && coachUserId === userId;
    const isOwner = req.session.role === "academy_owner";
    if (!isCreator && !isOwner) throw new ForbiddenException("only the class coach can send positions");

    // Validate + replay the position — chess.js throws on illegal FEN / move.
    const startFen = typeof body?.startFen === "string" ? body.startFen : "";
    const history = cleanHistory(body?.history);
    const cursorIdx = Number.isFinite(Number(body?.cursorIdx)) ? Number(body.cursorIdx) : history.length;
    let currentFen: string;
    let capped: number;
    try {
      const r = replayToFen(startFen, history, cursorIdx);
      currentFen = r.fen; capped = r.capped;
    } catch { throw new BadRequestException("position replay failed"); }

    // Recipient list: explicit ids first (deduped), otherwise "everyone
    // eligible to join this class" — restricted-batch gets that batch, an
    // unrestricted class opens to every student in the academy. Coach never
    // sends to themselves.
    let recipients: string[] = [];
    if (Array.isArray(body?.recipientUserIds) && body.recipientUserIds.length > 0) {
      recipients = [...new Set(body.recipientUserIds
        .filter((u: any) => typeof u === "string" && u.length > 0 && u.length < 64))] as string[];
    } else {
      const elig = await resolveEligibility(this.conn, id, coachUserId);
      if (elig.restricted) {
        recipients = [...elig.studentIds];
      } else if (academyId) {
        const rows: any[] = await this.users()
          .find({ academyId, role: "student" }, { projection: { _id: 1 } })
          .limit(500).toArray();
        recipients = rows.map((r) => String(r._id));
      }
    }
    recipients = recipients.filter((u) => u !== userId);
    // Sanity-cap so a bad picker can't blow up a document.
    if (recipients.length > 500) recipients = recipients.slice(0, 500);

    // Coach display name — falls back to username. Cheap 1-doc lookup.
    const me: any = await this.users().findOne({ _id: userId as any }, { projection: { name: 1, username: 1 } });
    const coachName = me?.name || me?.username || "Coach";

    const packId = newPackId();
    const title = String(body?.title ?? "Position from class").slice(0, MAX_TITLE);
    const now = new Date();
    await this.packs().insertOne({
      _id: packId as any,
      classId: id,
      classTitle: klass?.title || "Class",
      academyId,
      coachId: userId,
      coachName,
      sentAt: now,
      title,
      startFen,
      history,
      cursorIdx: capped,
      currentFen,
      recipientUserIds: recipients,
      maiaRating: null as number | null,
      maiaBand: null as string | null,
    });
    // Fire-and-forget Maia rating: rate the STARTING position with the
    // first move as the expected solution — that's the "puzzle" the coach
    // was setting up. Runs after the response is sent so a slow engine
    // never blocks send. Silently no-op if history is empty.
    if (history.length > 0) {
      const first = history[0]!;
      const sol = `${first.from}${first.to}${first.promotion ?? ""}`;
      const rateFor = startFen;
      const packs = this.packs();
      setImmediate(() => {
        requestMaiaRating(rateFor, sol, (r) => {
          if (!r) return;
          void packs.updateOne({ _id: packId as any }, { $set: { maiaRating: r.rating, maiaBand: r.band ?? null } });
        });
      });
    }
    return { ok: true, packId, sentTo: recipients.length };
  }
}

// Student-facing endpoints — separate @Controller so the URL prefixes match
// the pattern the notebook page fetches from.
@Controller()
export class NotebookController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private packs() { return this.conn.db!.collection("classPositionPacks"); }
  private attempts() { return this.conn.db!.collection("notebookReviseAttempts"); }
  private users() { return this.conn.db!.collection("users"); }

  /** GET /api/me/notebook — every position pack sent to the caller, most
   *  recent first, plus the caller's own sent packs (so a coach sees what
   *  they've distributed in the same view students do). */
  @Get("me/notebook")
  async mine(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!userId) return { packs: [] };
    const filter: any = {
      $or: [
        { recipientUserIds: userId },
        { coachId: userId },
      ],
    };
    if (academyId) filter.academyId = academyId;
    const rows = await this.packs()
      .find(filter, { projection: { history: 0 } })   // history is heavy — only fetched in detail view
      .sort({ sentAt: -1 })
      .limit(500)
      .toArray();
    return {
      packs: rows.map((r: any) => ({
        _id: String(r._id),
        classId: r.classId,
        classTitle: r.classTitle || "Class",
        coachId: r.coachId,
        coachName: r.coachName || "Coach",
        sentAt: r.sentAt,
        title: r.title || "Position",
        startFen: r.startFen,
        cursorIdx: r.cursorIdx,
        currentFen: r.currentFen,
        recipientCount: Array.isArray(r.recipientUserIds) ? r.recipientUserIds.length : 0,
        sentByMe: r.coachId === userId,
        maiaRating: typeof r.maiaRating === "number" ? r.maiaRating : null,
        maiaBand: typeof r.maiaBand === "string" ? r.maiaBand : null,
      })),
    };
  }

  /** GET /api/notebook/:packId — full pack (history included) for the
   *  detail view. Access: coach who sent it, listed recipient, or same-academy
   *  owner. Anyone else 404s (no existence oracle). */
  @Get("notebook/:packId")
  async detail(@Param("packId") packId: string, @Req() req: any) {
    if (!PACK_ID_RE.test(packId)) throw new BadRequestException("bad pack id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const row: any = await this.packs().findOne({ _id: packId as any });
    if (!row) throw new NotFoundException();
    const mineAcademy: string | null = req.session.academyId ?? null;
    const role: string | null = req.session.role ?? null;
    const isRecipient = Array.isArray(row.recipientUserIds) && row.recipientUserIds.includes(userId);
    const isCoach = row.coachId === userId;
    const isOwnerHere = role === "academy_owner" && mineAcademy && row.academyId === mineAcademy;
    if (!isRecipient && !isCoach && !isOwnerHere) throw new NotFoundException();
    // Best-score-so-far for this user on this pack — lets the revise page pre-
    // show "Your best 8/10" without a second round-trip.
    const bestAttempt: any = await this.attempts()
      .find({ packId, userId })
      .sort({ scorePct: -1, tookMs: 1 })
      .limit(1).toArray().then((r) => r[0] ?? null);
    return {
      _id: String(row._id),
      classId: row.classId,
      classTitle: row.classTitle || "Class",
      coachId: row.coachId,
      coachName: row.coachName || "Coach",
      sentAt: row.sentAt,
      title: row.title || "Position",
      startFen: row.startFen,
      history: Array.isArray(row.history) ? row.history : [],
      cursorIdx: row.cursorIdx,
      currentFen: row.currentFen,
      recipientCount: Array.isArray(row.recipientUserIds) ? row.recipientUserIds.length : 0,
      sentByMe: row.coachId === userId,
      maiaRating: typeof row.maiaRating === "number" ? row.maiaRating : null,
      maiaBand: typeof row.maiaBand === "string" ? row.maiaBand : null,
      bestAttempt: bestAttempt ? {
        scorePct: bestAttempt.scorePct,
        correctCount: bestAttempt.correctCount,
        totalPly: bestAttempt.totalPly,
        tookMs: bestAttempt.tookMs,
        finishedAt: bestAttempt.finishedAt,
      } : null,
    };
  }

  /** POST /api/notebook/:packId/revise — student submits the result of a
   *  revise attempt. Body: { correctCount, totalPly, tookMs, mistakes? }.
   *  Server clamps + recomputes scorePct so a rogue client can't inflate.
   *  Every attempt is stored (not just personal-best) so the coach can see
   *  a student's progression over time in Phase 3. */
  @Post("notebook/:packId/revise")
  async recordRevise(@Param("packId") packId: string, @Body() body: any, @Req() req: any) {
    if (!PACK_ID_RE.test(packId)) throw new BadRequestException("bad pack id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const pack: any = await this.packs().findOne({ _id: packId as any });
    if (!pack) throw new NotFoundException();
    // Only recipients can revise — a coach reviewing their own pack doesn't
    // need a score row (and would drown their own leaderboard). Academy
    // owner is also excluded from scoring.
    const isRecipient = Array.isArray(pack.recipientUserIds) && pack.recipientUserIds.includes(userId);
    if (!isRecipient) throw new ForbiddenException("only recipients can revise this pack");

    const totalPly = Math.max(0, Math.min(Number(body?.totalPly) || 0, MAX_HISTORY));
    if (totalPly === 0) throw new BadRequestException("nothing to revise");
    const correctCount = Math.max(0, Math.min(Number(body?.correctCount) || 0, totalPly));
    const tookMs = Math.max(0, Math.min(Number(body?.tookMs) || 0, 24 * 3600 * 1000));
    const mistakes = Array.isArray(body?.mistakes)
      ? body.mistakes.slice(0, 200).map((m: any) => ({
          ply: Math.max(0, Math.min(Number(m?.ply) || 0, totalPly)),
          expected: typeof m?.expected === "string" ? m.expected.slice(0, 8) : "",
          got: typeof m?.got === "string" ? m.got.slice(0, 8) : "",
        }))
      : [];
    const scorePct = Math.round((correctCount / totalPly) * 100);

    await this.attempts().insertOne({
      packId,
      userId,
      academyId: pack.academyId ?? null,
      coachId: pack.coachId,
      classId: pack.classId,
      startedAt: new Date(Date.now() - tookMs),
      finishedAt: new Date(),
      correctCount, totalPly, tookMs, mistakes, scorePct,
    });
    return { ok: true, scorePct, correctCount, totalPly };
  }

  /** GET /api/notebook/:packId/scores — coach (or academy owner) view of
   *  which students revised the pack + best score / attempt count / when.
   *  Every listed recipient shows up, even those with zero attempts, so the
   *  coach can chase up who's ignoring the drills. Non-coach 403s. */
  @Get("notebook/:packId/scores")
  async packScores(@Param("packId") packId: string, @Req() req: any) {
    if (!PACK_ID_RE.test(packId)) throw new BadRequestException("bad pack id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const pack: any = await this.packs().findOne({ _id: packId as any });
    if (!pack) throw new NotFoundException();
    const role: string | null = req.session.role ?? null;
    const mineAcademy: string | null = req.session.academyId ?? null;
    const isCoach = pack.coachId === userId;
    const isOwnerHere = role === "academy_owner" && mineAcademy && pack.academyId === mineAcademy;
    if (!isCoach && !isOwnerHere) throw new ForbiddenException("coach only");

    const recipients: string[] = Array.isArray(pack.recipientUserIds) ? pack.recipientUserIds : [];
    if (recipients.length === 0) return { rows: [] };
    // Best attempt per student in one aggregate.
    const agg = await this.attempts().aggregate([
      { $match: { packId, userId: { $in: recipients } } },
      { $sort: { userId: 1, scorePct: -1, tookMs: 1 } },
      { $group: {
          _id: "$userId",
          bestScore: { $first: "$scorePct" },
          bestCorrect: { $first: "$correctCount" },
          bestTotal: { $first: "$totalPly" },
          bestMs: { $first: "$tookMs" },
          lastAt: { $max: "$finishedAt" },
          attempts: { $sum: 1 },
      } },
    ]).toArray();
    const byUser = new Map(agg.map((r: any) => [String(r._id), r]));
    const users: any[] = await this.users().find(
      { _id: { $in: recipients } as any },
      { projection: { username: 1, name: 1 } },
    ).toArray();
    const userMeta = new Map(users.map((u: any) => [String(u._id), u]));

    const rows = recipients.map((uid) => {
      const s: any = byUser.get(uid);
      const u: any = userMeta.get(uid);
      return {
        userId: uid,
        username: u?.username ?? uid,
        name: u?.name ?? u?.username ?? uid,
        attempts: s?.attempts ?? 0,
        bestScore: s?.bestScore ?? null,
        bestCorrect: s?.bestCorrect ?? null,
        bestTotal: s?.bestTotal ?? null,
        bestMs: s?.bestMs ?? null,
        lastAt: s?.lastAt ?? null,
      };
    }).sort((a, b) => {
      // Best-first, unrevised (null) sink to the bottom so the coach's
      // "who needs a nudge" list stays visible.
      if (a.bestScore == null && b.bestScore == null) return a.name.localeCompare(b.name);
      if (a.bestScore == null) return 1;
      if (b.bestScore == null) return -1;
      return (b.bestScore - a.bestScore) || ((a.bestMs ?? 0) - (b.bestMs ?? 0));
    });
    return { rows };
  }

  /** POST /api/notebook/:packId/share  — coach or academy owner appends
   *  more recipients to an existing pack (share-forward from the notebook).
   *  Body: { recipientUserIds: string[] }. $addToSet so duplicates no-op.
   *  Recipients validated against session academy so a coach can't push a
   *  pack into another tenant's user's inbox. */
  @Post("notebook/:packId/share")
  async share(@Param("packId") packId: string, @Body() body: any, @Req() req: any) {
    if (!PACK_ID_RE.test(packId)) throw new BadRequestException("bad pack id");
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new UnauthorizedException();
    const pack: any = await this.packs().findOne({ _id: packId as any });
    if (!pack) throw new NotFoundException();
    const role: string | null = req.session.role ?? null;
    const mineAcademy: string | null = req.session.academyId ?? null;
    const isCoach = pack.coachId === userId;
    const isOwnerHere = role === "academy_owner" && mineAcademy && pack.academyId === mineAcademy;
    if (!isCoach && !isOwnerHere) throw new ForbiddenException("coach only");

    const raw: string[] = Array.isArray(body?.recipientUserIds) ? body.recipientUserIds : [];
    let cleaned = [...new Set(raw.filter((u) => typeof u === "string" && u.length > 0 && u.length < 64))] as string[];
    if (cleaned.length === 0) throw new BadRequestException("no recipients");
    // Only allow adding users that are in the same academy — blocks a
    // cross-tenant push via the share endpoint.
    if (pack.academyId) {
      const inAcademy = await this.users().find(
        { _id: { $in: cleaned } as any, academyId: pack.academyId },
        { projection: { _id: 1 } },
      ).toArray();
      const allowed = new Set(inAcademy.map((u: any) => String(u._id)));
      cleaned = cleaned.filter((u) => allowed.has(u));
    }
    if (cleaned.length === 0) throw new BadRequestException("no valid recipients");
    const r = await this.packs().updateOne(
      { _id: packId as any },
      { $addToSet: { recipientUserIds: { $each: cleaned } } as any },
    );
    return { ok: true, added: cleaned.length, matched: r.matchedCount };
  }

  /** GET /api/academy/students-lite — thin roster for the share-picker.
   *  { userId, username, name } for every student in the caller's academy,
   *  minus the caller. Coach-only (students shouldn't need a roster list). */
  @Get("academy/students-lite")
  async studentsLite(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    const role: string | null = req?.session?.role ?? null;
    if (!userId || !academyId) return { students: [] };
    if (role !== "coach" && role !== "academy_owner") return { students: [] };
    const rows = await this.users()
      .find({ academyId, role: "student" }, { projection: { username: 1, name: 1 } })
      .limit(500).toArray();
    return { students: rows
      .filter((u: any) => String(u._id) !== userId)
      .map((u: any) => ({ userId: String(u._id), username: u.username ?? String(u._id), name: u.name ?? u.username ?? String(u._id) }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)) };
  }

  /** GET /api/me/notebook/attempts — every revise attempt the caller has
   *  made, most recent first. Powers a "Recent revisions" strip on the
   *  Notebook page and per-pack "Your last try" pill. */
  @Get("me/notebook/attempts")
  async myAttempts(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) return { attempts: [] };
    const rows = await this.attempts()
      .find({ userId })
      .sort({ finishedAt: -1 })
      .limit(200)
      .toArray();
    return { attempts: rows.map((r: any) => ({
      packId: r.packId,
      scorePct: r.scorePct,
      correctCount: r.correctCount,
      totalPly: r.totalPly,
      tookMs: r.tookMs,
      finishedAt: r.finishedAt,
    })) };
  }

  /** GET /api/academy/notebook-leaderboard — top revisers in the caller's
   *  academy, ranked by sum of best-per-pack scorePct (so someone who nails
   *  10 packs at 100% out-scores someone who half-heartedly tried 20).
   *  Ties broken by number-of-packs-revised desc, then total ms asc. */
  @Get("academy/notebook-leaderboard")
  async leaderboard(@Req() req: any) {
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!academyId) return { rows: [] };
    // Aggregate: for each (userId, packId) keep the best attempt, then
    // sum those bests per user. $group-then-$group in one pipeline.
    const raw = await this.attempts().aggregate([
      { $match: { academyId } },
      { $sort: { userId: 1, packId: 1, scorePct: -1, tookMs: 1 } },
      { $group: {
          _id: { userId: "$userId", packId: "$packId" },
          bestScore: { $first: "$scorePct" },
          bestMs:    { $first: "$tookMs" },
      } },
      { $group: {
          _id: "$_id.userId",
          totalScore: { $sum: "$bestScore" },
          packsRevised: { $sum: 1 },
          totalMs: { $sum: "$bestMs" },
      } },
      { $sort: { totalScore: -1, packsRevised: -1, totalMs: 1 } },
      { $limit: 100 },
    ]).toArray();
    if (!raw.length) return { rows: [] };
    const userIds = raw.map((r: any) => r._id);
    const users: any[] = await this.users().find(
      { _id: { $in: userIds } },
      { projection: { username: 1, name: 1 } },
    ).toArray();
    const byId = new Map(users.map((u: any) => [String(u._id), u]));
    return { rows: raw.map((r: any, i: number) => {
      const u = byId.get(String(r._id));
      return {
        rank: i + 1,
        userId: r._id,
        username: u?.username ?? r._id,
        name: u?.name ?? u?.username ?? r._id,
        totalScore: r.totalScore,
        packsRevised: r.packsRevised,
        avgScore: Math.round(r.totalScore / r.packsRevised),
      };
    }) };
  }
}
