// GET /api/me/challenges — student's own past "find the good moves"
// challenge answers. Populated from the `classChallenges` collection
// which class-ws writes on each challenge_end.
//
// Session-based: no need for a userId param; we filter by req.session.userId.

import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

interface StudentChallengeRow {
  classId: string;
  classTitle?: string;
  positionFen: string;
  startFen: string;
  prompt: string;
  startedAt: string;
  endedAt: string;
  myMovesSan: string[];
  myFinalFen?: string;
  myTimeMs?: number;
  correct?: boolean | null;     // coach's mark: true=correct, false=wrong, null/undefined=unmarked
  totalAnswers: number;         // how many students answered — for context
}

@Controller("me")
export class MyChallengesController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Get("challenges")
  async myChallenges(@Req() req: any, @Query("limit") limitRaw?: string): Promise<{ challenges: StudentChallengeRow[] }> {
    const userId: string | undefined = req?.session?.userId;
    if (!userId) throw new UnauthorizedException();
    const limit = Math.min(200, Math.max(1, parseInt(limitRaw || "50", 10) || 50));

    const rows = await this.conn.db!
      .collection("classChallenges")
      .find({ "answers.userId": userId }, {
        projection: { classId: 1, positionFen: 1, startFen: 1, prompt: 1, startedAt: 1, endedAt: 1, answers: 1 },
      })
      .sort({ endedAt: -1 })
      .limit(limit)
      .toArray();

    if (rows.length === 0) return { challenges: [] };

    // Enrich each row with the class title (best-effort — missing classSchedules docs shouldn't break the page).
    const classIds = Array.from(new Set(rows.map((r: any) => String(r.classId))));
    const classDocs = classIds.length
      ? await this.conn.db!.collection("classSchedules").find({ _id: { $in: classIds as any } }, { projection: { title: 1 } }).toArray()
      : [];
    const titleById = new Map(classDocs.map((c: any) => [String(c._id), String(c.title || "")]));

    const out: StudentChallengeRow[] = rows.map((r: any) => {
      const answers: any[] = Array.isArray(r.answers) ? r.answers : [];
      const mine = answers.find((a) => a?.userId === userId) ?? null;
      const myTimeMs = mine && mine.firstMoveAt && mine.lastMoveAt
        ? new Date(mine.lastMoveAt).getTime() - new Date(mine.firstMoveAt).getTime()
        : undefined;
      return {
        classId: String(r.classId),
        classTitle: titleById.get(String(r.classId)) || undefined,
        positionFen: String(r.positionFen ?? ""),
        startFen: String(r.startFen ?? r.positionFen ?? ""),
        prompt: String(r.prompt ?? ""),
        startedAt: (r.startedAt instanceof Date ? r.startedAt : new Date(r.startedAt)).toISOString(),
        endedAt: (r.endedAt instanceof Date ? r.endedAt : new Date(r.endedAt)).toISOString(),
        myMovesSan: Array.isArray(mine?.movesSan) ? mine.movesSan.map(String) : [],
        myFinalFen: mine?.finalFen ? String(mine.finalFen) : undefined,
        myTimeMs,
        correct: (mine && (mine.correct === true || mine.correct === false)) ? mine.correct : null,
        totalAnswers: answers.length,
      };
    });
    return { challenges: out };
  }
}

/** Coach-only: mark a single student's answer to a class challenge as
 *  correct/wrong (or unmark = null). Keyed by (classId, startedAt) since
 *  the classChallenges doc doesn't have a stable app-side id — we key on
 *  the unix-ms startedAt which is unique per class. */
@Controller("class")
export class ChallengeMarkController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Post("challenges/mark-answer")
  async markAnswer(@Req() req: any, @Body() body: any): Promise<{ ok: true }> {
    const userIdCaller: string | undefined = req?.session?.userId;
    if (!userIdCaller) throw new UnauthorizedException();
    const classId = typeof body?.classId === "string" ? body.classId : "";
    const startedAtRaw = Number(body?.startedAt);
    const studentUserId = typeof body?.userId === "string" ? body.userId : "";
    const correct: boolean | null =
      body?.correct === true ? true :
      body?.correct === false ? false :
      null;
    if (!classId || !Number.isFinite(startedAtRaw) || !studentUserId) {
      throw new BadRequestException("classId, startedAt, userId are required.");
    }

    // Coach gate — the caller must be the class's creator (from
    // classSchedules) OR the current coach seat of the room (from
    // classLiveAnnouncements). Matches the class-ws hello promotion rule.
    const [klass, announce]: any[] = await Promise.all([
      this.conn.db!.collection("classSchedules").findOne({ _id: classId as any }, { projection: { createdByUserId: 1 } }),
      this.conn.db!.collection("classLiveAnnouncements").findOne({ _id: classId as any }, { projection: { coachUserId: 1 } }),
    ]);
    const creator = klass?.createdByUserId ?? announce?.coachUserId ?? null;
    if (!creator || String(creator) !== String(userIdCaller)) {
      throw new ForbiddenException("Only the class coach can mark answers.");
    }

    // classChallenges keys: (classId, startedAt). Use a ±5s window on
    // startedAt so a slight clock skew between server + client (challenge
    // was persisted after our in-memory startedAt Date was rounded) still
    // matches. In practice they're the same ms; the window is defensive.
    const lo = new Date(startedAtRaw - 5_000);
    const hi = new Date(startedAtRaw + 5_000);
    const filter = { classId, startedAt: { $gte: lo, $lte: hi } } as any;
    const patch = correct === null
      ? { $unset: { "answers.$[e].correct": "" } }
      : { $set: { "answers.$[e].correct": correct } };
    const arrayFilters = [{ "e.userId": studentUserId }];
    const r = await this.conn.db!.collection("classChallenges").updateOne(filter, patch, { arrayFilters });
    if (r.matchedCount === 0) throw new BadRequestException("Challenge not found.");
    return { ok: true };
  }
}
