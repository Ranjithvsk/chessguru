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
    });
    return { ok: true, packId, sentTo: recipients.length };
  }
}

// Student-facing endpoints — separate @Controller so the URL prefixes match
// the pattern the notebook page fetches from.
@Controller()
export class NotebookController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private packs() { return this.conn.db!.collection("classPositionPacks"); }

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
    };
  }
}
