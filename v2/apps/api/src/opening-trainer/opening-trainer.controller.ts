// Opening Trainer analytics — session write path + per-user / per-student
// rollups. Feeds:
//   * student's own performance card (/dashboard, /study/daily strip)
//   * coach compliance % + heatmap on /academy/performance/:studentId
//   * academy leaderboard "Openings" tab
//   * award emit (streaks, mastery, homework hero, ...)
//
// All writes are trusted client submissions — the drill runs client-side
// and reports its outcome here. We record the raw session for later
// analytics rebuilds; the /rollup endpoints re-aggregate on demand.

import { BadRequestException, Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";

interface SessionBody {
  slug: string;
  name: string;
  totalMoves: number;
  correctFirstTry: number;
  correctWithPeek: number;
  wrongAtLeastOnce: number;
  scorePct: number;
  durationMs?: number;
  isForceAssigned?: boolean;
}

@Controller("opening-trainer")
export class OpeningTrainerController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private sessions() { return this.conn.db!.collection("openingSession"); }
  private users()    { return this.conn.db!.collection("users"); }

  private requireLogin(req: any): { userId: string; role: string | null; academyId: string | null } {
    const userId = req?.session?.userId;
    if (!userId) throw new BadRequestException("not-signed-in");
    return {
      userId: String(userId),
      role: req?.session?.role ?? null,
      academyId: req?.session?.academyId ?? null,
    };
  }

  /** POST /api/opening-trainer/session — client posts one drill's outcome.
   *  Body: SessionBody. Small, no auth on payload — the userId comes from
   *  the session. */
  @Post("session")
  async recordSession(@Req() req: any, @Body() body: any) {
    const me = this.requireLogin(req);
    const b = body as Partial<SessionBody>;
    const doc = {
      _id: new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 8),
      userId: me.userId,
      academyId: me.academyId,
      slug: String(b.slug || "").slice(0, 200),
      name: String(b.name || "").slice(0, 300),
      totalMoves: Math.max(0, Math.min(1000, Number(b.totalMoves) || 0)),
      correctFirstTry: Math.max(0, Math.min(1000, Number(b.correctFirstTry) || 0)),
      correctWithPeek: Math.max(0, Math.min(1000, Number(b.correctWithPeek) || 0)),
      wrongAtLeastOnce: Math.max(0, Math.min(1000, Number(b.wrongAtLeastOnce) || 0)),
      scorePct: Math.max(0, Math.min(100, Number(b.scorePct) || 0)),
      durationMs: Math.max(0, Math.min(60 * 60 * 1000, Number(b.durationMs) || 0)),
      isForceAssigned: b.isForceAssigned === true,
      finishedAt: new Date(),
    };
    if (!doc.slug || doc.totalMoves === 0) throw new BadRequestException("bad-session");
    await this.sessions().insertOne(doc as any);
    return { ok: true, id: doc._id };
  }

  /** GET /api/opening-trainer/rollup/mine — student's own last-30-day
   *  activity + all-time totals + current streak. Cheap enough to compute
   *  on read (single-user aggregation over ~30 rows). */
  @Get("rollup/mine")
  async mineRollup(@Req() req: any) {
    const me = this.requireLogin(req);
    return this.userRollup(me.userId);
  }

  /** GET /api/opening-trainer/rollup/:studentId — coach/owner view of a
   *  single student's rollup. Same shape as /mine so the client can reuse
   *  the same card component. */
  @Get("rollup/:studentId")
  async studentRollup(@Req() req: any, @Param("studentId") studentId: string) {
    const me = this.requireLogin(req);
    if (me.role !== "coach" && me.role !== "academy_owner") {
      throw new BadRequestException("coach-only");
    }
    // Confirm the student is in the caller's academy — coaches can't peek
    // across academies.
    const student: any = await this.users().findOne(
      { _id: studentId as any, academyId: me.academyId, role: "student" },
      { projection: { _id: 1 } },
    );
    if (!student) throw new BadRequestException("student-not-in-your-academy");
    return this.userRollup(studentId);
  }

  /** Compute a user's rollup: 30-day daily activity, 7-day + 30-day + all-
   *  time totals, current streak (consecutive days with ≥1 session, IST),
   *  per-opening latest score, unique openings drilled last 30d. */
  private async userRollup(userId: string) {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const start30 = new Date(now.getTime() - 30 * dayMs);
    const rows: any[] = await this.sessions()
      .find({ userId, finishedAt: { $gte: start30 } })
      .project({ slug: 1, name: 1, totalMoves: 1, correctFirstTry: 1, scorePct: 1, finishedAt: 1, isForceAssigned: 1 })
      .sort({ finishedAt: 1 })
      .toArray();
    // Bucket per IST day.
    const dayKey = (d: Date) => {
      const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      return ist.toISOString().slice(0, 10);
    };
    const perDay: Record<string, { sessions: number; moves: number; correct: number; scoreSum: number; openings: Set<string> }> = {};
    for (const r of rows) {
      const k = dayKey(r.finishedAt);
      const d = perDay[k] ??= { sessions: 0, moves: 0, correct: 0, scoreSum: 0, openings: new Set() };
      d.sessions++;
      d.moves += r.totalMoves;
      d.correct += r.correctFirstTry;
      d.scoreSum += r.scorePct;
      d.openings.add(r.slug);
    }
    // 30-day array of {day, sessions, moves, correctPct} — always 30 entries
    // so charts don't have gaps.
    const heat: Array<{ day: string; sessions: number; moves: number; correctPct: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * dayMs);
      const k = dayKey(d);
      const b = perDay[k];
      heat.push({
        day: k,
        sessions: b?.sessions ?? 0,
        moves: b?.moves ?? 0,
        correctPct: b && b.moves > 0 ? Math.round((b.correct / b.moves) * 100) : 0,
      });
    }
    // 7-day + 30-day totals (walk heat).
    const totals7  = heat.slice(-7).reduce((a, x) => ({ sessions: a.sessions + x.sessions, moves: a.moves + x.moves }), { sessions: 0, moves: 0 });
    const totals30 = heat.reduce((a, x) => ({ sessions: a.sessions + x.sessions, moves: a.moves + x.moves }), { sessions: 0, moves: 0 });
    const correctSum30 = rows.reduce((a, r) => a + r.correctFirstTry, 0);
    const movesSum30   = rows.reduce((a, r) => a + r.totalMoves, 0);
    const successPct30 = movesSum30 > 0 ? Math.round((correctSum30 / movesSum30) * 100) : 0;
    const correctSum7  = rows.filter((r) => r.finishedAt >= new Date(now.getTime() - 7 * dayMs)).reduce((a, r) => a + r.correctFirstTry, 0);
    const movesSum7    = rows.filter((r) => r.finishedAt >= new Date(now.getTime() - 7 * dayMs)).reduce((a, r) => a + r.totalMoves, 0);
    const successPct7  = movesSum7 > 0 ? Math.round((correctSum7 / movesSum7) * 100) : 0;

    // Current streak — walk heat from today back, count consecutive days with
    // ≥1 session. First zero breaks.
    let streak = 0;
    for (let i = heat.length - 1; i >= 0; i--) {
      if ((heat[i]!.sessions) > 0) streak++;
      else break;
    }

    // All-time totals — cheap count on the whole collection for this user.
    const allTime = await this.sessions().countDocuments({ userId });
    const forcedCompliance = await this.forcedCompliance7d(userId);

    return {
      heat,
      totals: { sessions7: totals7.sessions, sessions30: totals30.sessions, moves7: totals7.moves, moves30: totals30.moves, allSessions: allTime },
      successPct7,
      successPct30,
      streak,
      uniqueOpenings30: new Set(rows.map((r) => r.slug)).size,
      forcedCompliance,
    };
  }

  /** Coach-compliance percentage: of force-assigned openings this user is
   *  currently activated on, how many were drilled in the last 7 days at
   *  least once. Returns { assigned, done, pct } or null if the user
   *  has no coach-assigned openings. */
  private async forcedCompliance7d(userId: string): Promise<{ assigned: number; done: number; pct: number } | null> {
    const rep = this.conn.db!.collection("myRepertoire");
    const assignedSlugs: string[] = [];
    const cursor = rep.find({ ownerId: userId, forceTrain: true }, { projection: { slug: 1, _id: 1, kind: 1 } });
    for await (const r of cursor as any) {
      const slug = r.kind === "corpus" && r.slug ? r.slug : `line:${r._id}`;
      assignedSlugs.push(slug);
    }
    if (assignedSlugs.length === 0) return null;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const drilled = await this.sessions()
      .aggregate([
        { $match: { userId, slug: { $in: assignedSlugs }, finishedAt: { $gte: since } } },
        { $group: { _id: "$slug" } },
      ])
      .toArray();
    const done = drilled.length;
    return { assigned: assignedSlugs.length, done, pct: Math.round((done / assignedSlugs.length) * 100) };
  }
}
