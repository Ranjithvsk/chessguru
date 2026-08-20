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

  /** GET /api/opening-trainer/academy-leaderboard — ranked list of every
   *  student in the caller's academy by Opening-Trainer discipline score.
   *  Any academy member can view (matches the puzzles leaderboard). */
  @Get("academy-leaderboard")
  async academyLeaderboard(@Req() req: any) {
    const me = this.requireLogin(req);
    if (!me.academyId) return { rows: [], academyStudentCount: 0 };
    const students = await this.users()
      .find(
        { academyId: me.academyId, role: "student" },
        { projection: { _id: 1, name: 1, username: 1 } },
      )
      .toArray();
    if (students.length === 0) return { rows: [], academyStudentCount: 0 };

    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const since30 = new Date(now.getTime() - 30 * dayMs);
    const since7  = new Date(now.getTime() - 7 * dayMs);
    const userIds = students.map((u: any) => String(u._id));

    // One aggregation over the whole academy — much cheaper than N per-user
    // rollups. We only need per-user 30-day totals + streak seed.
    const per30: Array<{
      _id: string;
      sessions: number; moves: number; correct: number;
      strongSlugs: string[];
      lastDay: string;
    }> = await this.sessions().aggregate([
      { $match: { userId: { $in: userIds }, finishedAt: { $gte: since30 } } },
      { $group: {
        _id: "$userId",
        sessions: { $sum: 1 },
        moves: { $sum: "$totalMoves" },
        correct: { $sum: "$correctFirstTry" },
        // Distinct slugs where scorePct >= 90 in-period — "strong" openings.
        strongSlugs: { $addToSet: { $cond: [{ $gte: ["$scorePct", 90] }, "$slug", "$$REMOVE"] } },
        // Days seen so we can compute streak below (approx — client re-uses
        // /rollup/mine for exact IST streaks; server just needs a proxy).
        lastDay: { $max: "$finishedAt" },
      } },
    ]).toArray() as any;

    // 7-day slice per user — cheap second aggregation.
    const per7: Array<{ _id: string; sessions: number; moves: number; correct: number }>
      = await this.sessions().aggregate([
      { $match: { userId: { $in: userIds }, finishedAt: { $gte: since7 } } },
      { $group: {
        _id: "$userId",
        sessions: { $sum: 1 },
        moves: { $sum: "$totalMoves" },
        correct: { $sum: "$correctFirstTry" },
      } },
    ]).toArray() as any;
    const p7Map = new Map(per7.map((r) => [String(r._id), r]));

    // Coach-assigned load per user — read myRepertoire once academy-wide.
    const rep = this.conn.db!.collection("myRepertoire");
    const assignedDocs: any[] = await rep.find(
      { ownerId: { $in: userIds }, forceTrain: true },
      { projection: { ownerId: 1, slug: 1, kind: 1, _id: 1 } },
    ).toArray();
    const assignedByUser = new Map<string, string[]>();
    for (const d of assignedDocs) {
      const slug = d.kind === "corpus" && d.slug ? d.slug : `line:${d._id}`;
      const arr = assignedByUser.get(String(d.ownerId)) ?? [];
      arr.push(slug);
      assignedByUser.set(String(d.ownerId), arr);
    }
    // Which of each user's assigned slugs was drilled in last 7d.
    const assignedDrilled: Array<{ _id: { userId: string; slug: string } }>
      = await this.sessions().aggregate([
      { $match: { userId: { $in: userIds }, finishedAt: { $gte: since7 } } },
      { $group: { _id: { userId: "$userId", slug: "$slug" } } },
    ]).toArray() as any;
    const drilledSet = new Set(assignedDrilled.map((d) => `${d._id.userId}:${d._id.slug}`));

    // Streak = consecutive IST days with ≥1 session (max 30 for scoring).
    // Cheap: per-user pull day-keys, walk backward from today.
    const dayKey = (d: Date) => {
      const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      return ist.toISOString().slice(0, 10);
    };
    const perUserDays: Record<string, Set<string>> = {};
    const dayRows: Array<{ _id: { userId: string; day: string } }> = await this.sessions().aggregate([
      { $match: { userId: { $in: userIds }, finishedAt: { $gte: new Date(now.getTime() - 60 * dayMs) } } },
      { $project: { userId: 1, finishedAt: 1 } },
    ]).toArray().then((rows: any[]) => rows.map((r) => ({ _id: { userId: String(r.userId), day: dayKey(r.finishedAt) } }))) as any;
    for (const d of dayRows) {
      const s = perUserDays[d._id.userId] ??= new Set();
      s.add(d._id.day);
    }
    const streakFor = (userId: string): number => {
      const s = perUserDays[userId];
      if (!s) return 0;
      let streak = 0;
      for (let i = 0; i < 60; i++) {
        const k = dayKey(new Date(now.getTime() - i * dayMs));
        if (s.has(k)) streak++; else break;
      }
      return streak;
    };

    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

    const rows = students.map((s: any) => {
      const uid = String(s._id);
      const r30 = per30.find((x) => String(x._id) === uid);
      const r7  = p7Map.get(uid);
      const successPct7  = r7  && r7.moves  > 0 ? Math.round((r7.correct  / r7.moves)  * 100) : 0;
      const successPct30 = r30 && r30.moves > 0 ? Math.round((r30.correct / r30.moves) * 100) : 0;
      const strongOpenings30 = r30 ? new Set(r30.strongSlugs ?? []).size : 0;
      const assignedList = assignedByUser.get(uid) ?? [];
      const assignedDone = assignedList.filter((slug) => drilledSet.has(`${uid}:${slug}`)).length;
      const streak = streakFor(uid);
      // Discipline score 0-100:
      //   40 % success (7d if you have activity, else 30d),
      //   25 % streak  (linear, capped at 30 days),
      //   15 % activity (sessions in last 7 days, capped at 20),
      //   20 % compliance (assignedDone / assignedTotal, or successPct30 as
      //                    fallback when no assignments).
      const successForScore = r7 && r7.moves > 0 ? successPct7 : successPct30;
      const streakScore = clamp(streak / 30 * 100, 0, 100);
      const activityScore = clamp((r7?.sessions ?? 0) / 20 * 100, 0, 100);
      const complianceScore = assignedList.length > 0
        ? Math.round((assignedDone / assignedList.length) * 100)
        : successPct30;
      const disciplineScore = Math.round(
        successForScore * 0.40 +
        streakScore     * 0.25 +
        activityScore   * 0.15 +
        complianceScore * 0.20,
      );
      return {
        userId: uid,
        name: s.name || s.username,
        username: s.username,
        sessions7: r7?.sessions ?? 0,
        sessions30: r30?.sessions ?? 0,
        successPct7,
        successPct30,
        streak,
        strongOpenings30,
        assignedTotal: assignedList.length,
        assignedDone,
        disciplineScore,
      };
    });

    rows.sort((a: any, b: any) => b.disciplineScore - a.disciplineScore);
    for (let i = 0; i < rows.length; i++) (rows as any)[i].rank = i + 1;
    return { rows, academyStudentCount: students.length };
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
