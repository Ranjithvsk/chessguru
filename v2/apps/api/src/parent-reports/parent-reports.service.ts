// Parent Reports — end-of-month per-student summary the coach can annotate,
// save, and send. Aggregates from existing collections; no new heavy schema.
//
// Storage: `parentReports` collection — one doc per generated report, so the
// coach can edit the note / add parent email / mark sent. Regenerating a
// report for the same period upserts (creates a new one).
//
// Data sources per section:
//   Rating:      userperfs.puzzle.gl.r  (Glicko-2 rating from puzzles module)
//   Games:       myGames in [start,end]  — parsed from Result + ourColor
//   Studies:     studies owned by student + chapters completed count
//   Puzzles:     userperfs.puzzle.nb  (total puzzles solved — accuracy est. from history if we have it)
//   Revision:    revisions max streak
//   Weaknesses:  myGameAnalysis tagCounts aggregated over period
//   Books:       bookProgress chaptersCompleted in period
//   Exams:       examAttempts submitted in period

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";

const TAG_LABEL: Record<string, string> = {
  missed_mate:         "Missed mate",
  hung_piece:          "Hung piece",
  missed_capture:      "Missed capture",
  missed_knight_fork:  "Missed knight fork",
  missed_check:        "Missed check/pin/skewer",
  missed_promotion:   "Missed promotion",
  opening_deviation:   "Opening deviation",
  positional:          "Positional",
};

function shortId(bytes = 8): string { return randomBytes(bytes).toString("base64url"); }

export interface ReportData {
  student: { userId: string; username: string; name?: string; role: string };
  period: { start: string; end: string };
  rating: { current: number | null; change: number | null; historyPoints: number; history?: number[] };
  games: { played: number; won: number; drawn: number; lost: number };
  puzzles: { solved: number; inPeriod?: number; wonInPeriod?: number; lostInPeriod?: number };
  revision: { longestStreak: number; totalCards: number };
  weaknesses: { tag: string; label: string; count: number }[];
  studies: { studyId: string; title: string; chapterCount: number }[];
  books: { bookId: string; title: string; chaptersDoneInPeriod: number; totalDone: number; totalChapters: number }[];
  exams: { examId: string; title: string; scorePct: number; passed: boolean }[];
}

export interface ReportDoc {
  _id: string;
  ownerId: string;        // coach who generated
  academyId: string;
  studentId: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  data: ReportData;
  coachNote?: string;
  parentEmail?: string;
  sentAt?: Date;
}

@Injectable()
export class ParentReportsService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private reports() { return this.conn.db!.collection<ReportDoc>("parentReports"); }
  private users() { return this.conn.db!.collection<any>("users"); }
  private analysis() { return this.conn.db!.collection<any>("myGameAnalysis"); }
  private games() { return this.conn.db!.collection<any>("myGames"); }
  private revisions() { return this.conn.db!.collection<any>("revisions"); }
  private examAttempts() { return this.conn.db!.collection<any>("examAttempts"); }
  private bookProgress() { return this.conn.db!.collection<any>("bookProgress"); }
  private books() { return this.conn.db!.collection<any>("books"); }
  private studies() { return this.conn.db!.collection<any>("studies"); }
  private userperfs() { return this.conn.db!.collection<any>("userperfs"); }
  private examsCol() { return this.conn.db!.collection<any>("exams"); }
  private rounds() { return this.conn.db!.collection<any>("rounds"); }
  private puzzles() { return this.conn.db!.collection<any>("puzzles"); }
  private studyRounds() { return this.conn.db!.collection<any>("study_rounds"); }
  private studyPuzzles() { return this.conn.db!.collection<any>("study_puzzles"); }

  private async ensureCoach(session: any): Promise<{ userId: string; academyId: string; role: string }> {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    const me = await this.users().findOne({ _id: userId as any });
    if (!me) throw new UnauthorizedException("no user");
    if (!["academy_owner", "coach"].includes(me.role)) throw new ForbiddenException("coaches only");
    const academyId = session?.academyId || me.academyId;
    if (!academyId) throw new ForbiddenException("no academy");
    return { userId, academyId, role: me.role };
  }

  private async assertStudentInScope(coach: { userId: string; academyId: string; role: string }, studentId: string) {
    const s = await this.users().findOne({ _id: studentId as any, academyId: coach.academyId });
    if (!s) throw new NotFoundException("no such student in your academy");
    if (coach.role === "coach" && s.assignedCoachId && s.assignedCoachId !== coach.userId) {
      throw new ForbiddenException("that student isn't assigned to you");
    }
    return s;
  }

  /** Aggregate all sections for a student × period. Read-only — doesn't
   *  persist. Used by preview + as the payload builder for save/regenerate. */
  async buildData(studentId: string, start: Date, end: Date): Promise<ReportData> {
    const s = await this.users().findOne({ _id: studentId as any });
    if (!s) throw new NotFoundException("no such student");

    // Round._id is "<userId>:<puzzleId>"; range-scan on the indexed _id
    // brackets exactly this user's rounds. Filter by d (solved date) to get
    // the puzzles actually solved in the period — the lifetime nb counter
    // on userperfs can't tell us that. Added 2026-08-18 so the period-
    // performance table doesn't show identical puzzle counts for every row.
    const roundsFrom = `${studentId}:`;
    const roundsTo   = `${studentId};`;
    const [perf, gamesRaw, analysesRaw, reviseRows, examAttemptRows, bookProgs, studyRows, roundsInPeriod] = await Promise.all([
      this.userperfs().findOne({ _id: studentId as any }),
      this.games().find({ ownerId: studentId, createdAt: { $gte: start, $lte: end } }).toArray(),
      this.analysis().find({ ownerId: studentId, updatedAt: { $gte: start, $lte: end } }).toArray(),
      this.revisions().find({ userId: studentId }).toArray(),
      this.examAttempts().find({ userId: studentId, submittedAt: { $gte: start, $lte: end } }).toArray(),
      this.bookProgress().find({ userId: studentId }).toArray(),
      this.studies().find({ ownerId: studentId, updatedAt: { $gte: start, $lte: end } }, { projection: { title: 1, chapterCount: 1 } }).toArray(),
      this.rounds().find({ _id: { $gte: roundsFrom, $lt: roundsTo } as any, d: { $gte: start, $lte: end } }, { projection: { w: 1 } }).toArray(),
    ]);

    // Rating
    const curRating: number | null = perf?.puzzle?.gl?.r ?? null;
    const re: number[] = perf?.puzzle?.re ?? [];
    let ratingChange: number | null = null;
    if (curRating !== null && re.length >= 2) {
      // last N history entries — approximate change over period
      const earliest = re[re.length - 1] ?? curRating;
      ratingChange = curRating - earliest;
    }
    const puzzlesSolved = perf?.puzzle?.nb ?? 0;
    const puzzlesInPeriod = roundsInPeriod.length;
    const puzzlesWonInPeriod = roundsInPeriod.filter((r: any) => !!r.w).length;
    const puzzlesLostInPeriod = puzzlesInPeriod - puzzlesWonInPeriod;

    // Games W/D/L based on ourColor + Result
    let won = 0, drawn = 0, lost = 0;
    for (const g of gamesRaw) {
      const r = g.result;
      if (r === "1/2-1/2") { drawn += 1; continue; }
      if (g.ourColor === "white") {
        if (r === "1-0") won += 1;
        else if (r === "0-1") lost += 1;
      } else if (g.ourColor === "black") {
        if (r === "0-1") won += 1;
        else if (r === "1-0") lost += 1;
      }
    }

    // Weaknesses aggregated over the period
    const tagCounts: Record<string, number> = {};
    for (const a of analysesRaw) {
      for (const [t, n] of Object.entries(a.tagCounts || {})) tagCounts[t] = (tagCounts[t] || 0) + (n as number);
    }
    const weaknesses = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({
      tag, label: TAG_LABEL[tag] || tag, count,
    }));

    // Revision
    const longestStreak = reviseRows.reduce((m, r) => Math.max(m, r.streak || 0), 0);

    // Books — chapters done + which were completed in period (bookProgress
    // doesn't yet store per-chapter timestamps, so "in period" is an
    // approximation: total done at report time; we could compare to a
    // snapshot later.)
    const bookIds = bookProgs.map((b) => b.bookId);
    const bookMeta = bookIds.length
      ? await this.books().find({ _id: { $in: bookIds } }, { projection: { title: 1, chapters: 1 } }).toArray()
      : [];
    const bookById = new Map(bookMeta.map((b) => [String(b._id), b]));
    const books = bookProgs
      .map((bp) => {
        const meta = bookById.get(bp.bookId);
        if (!meta) return null;
        const totalDone = (bp.chaptersCompleted || []).length;
        // For "chaptersDoneInPeriod" we don't yet have per-chapter dates —
        // report total done and note total. Sufficient for parents.
        const inPeriod = bp.updatedAt && new Date(bp.updatedAt) >= start && new Date(bp.updatedAt) <= end ? totalDone : 0;
        return {
          bookId: bp.bookId,
          title: meta.title,
          chaptersDoneInPeriod: inPeriod,
          totalDone,
          totalChapters: (meta.chapters || []).length,
        };
      })
      .filter(Boolean) as ReportData["books"];

    // Exams
    const examIds = Array.from(new Set(examAttemptRows.map((e) => e.examId)));
    const examMeta = examIds.length
      ? await this.examsCol().find({ _id: { $in: examIds } }, { projection: { title: 1 } }).toArray()
      : [];
    const examTitleById = new Map(examMeta.map((e) => [String(e._id), e.title]));
    // Best score per exam
    const byExam = new Map<string, any>();
    for (const a of examAttemptRows) {
      const prev = byExam.get(a.examId);
      if (!prev || (a.scorePct || 0) > (prev.scorePct || 0)) byExam.set(a.examId, a);
    }
    const exams = Array.from(byExam.values()).map((a) => ({
      examId: a.examId,
      title: examTitleById.get(a.examId) || "Untitled",
      scorePct: a.scorePct || 0,
      passed: !!a.passed,
    }));

    return {
      student: { userId: studentId, username: s.username, name: s.name, role: s.role },
      period: { start: start.toISOString(), end: end.toISOString() },
      // Expose the raw rating history in OLDEST→NEWEST order so the coach
      // dashboard sparkline reads left-to-right. userperfs.puzzle.re is stored
      // NEWEST-first (see ratingChange calc above which reads re[re.length-1]
      // as the earliest), so we take the most-recent 200 (re.slice(0, 200))
      // and reverse. Cap keeps the payload small (2026-08-18 owner ask).
      rating: {
        current: curRating,
        change: ratingChange,
        historyPoints: re.length,
        history: (re.length > 200 ? re.slice(0, 200) : [...re]).reverse(),
      },
      games: { played: gamesRaw.length, won, drawn, lost },
      puzzles: {
        solved: puzzlesSolved,
        inPeriod: puzzlesInPeriod,
        wonInPeriod: puzzlesWonInPeriod,
        lostInPeriod: puzzlesLostInPeriod,
      },
      revision: { longestStreak, totalCards: reviseRows.length },
      weaknesses,
      studies: studyRows.map((s) => ({ studyId: s._id, title: s.title, chapterCount: s.chapterCount || 0 })),
      books,
      exams,
    };
  }

  /* ─── endpoints ────────────────────────────────────────────────────── */

  async preview(session: any, body: any): Promise<ReportData> {
    const coach = await this.ensureCoach(session);
    const { studentId, start, end } = this.parseInput(body);
    await this.assertStudentInScope(coach, studentId);
    return this.buildData(studentId, start, end);
  }

  /** Puzzles a student got WRONG in a period, newest-first. Each row is
   *  resolved from the rounds collection (wr = wrong move UCI stored on
   *  miss) to the actual puzzle document so the coach can view the FEN,
   *  see the correct solution, and jump to /board-editor or /?puzzle=…
   *  to reteach the position. Owner ask 2026-08-18: "puzzle solved
   *  mistake, coach can reteach". */
  async studentMistakes(session: any, body: any): Promise<Array<{
    puzzleId: string;
    fen: string;
    solution: string[];
    themes: string[];
    rating: number | null;
    wrongMove: string | null;
    ratedAt: string | null;
  }>> {
    const coach = await this.ensureCoach(session);
    const { studentId, start, end } = this.parseInput(body);
    await this.assertStudentInScope(coach, studentId);
    const limit = Math.max(1, Math.min(200, Number(body?.limit) || 50));
    // rounds._id = "<userId>:<puzzleId>" — range-scan on _id then filter to
    // wins=false in the period. Sort by d desc so newest mistake surfaces.
    const missRows = await this.rounds().find(
      {
        _id: { $gte: `${studentId}:`, $lt: `${studentId};` } as any,
        w: false,
        d: { $gte: start, $lte: end },
      },
      { projection: { d: 1, wr: 1, pr: 1, _id: 1 } },
    ).sort({ d: -1 }).limit(limit).toArray();
    if (!missRows.length) return [];
    // Resolve puzzles in one batch. Puzzle IDs are Lichess-style (short
    // strings), stored on the puzzles collection as `puzzleId` (the round's
    // suffix). We keep both possible fields for robustness.
    const pids = missRows.map((r: any) => String(r._id).split(":")[1]).filter(Boolean) as string[];
    const puzDocs = await this.puzzles().find(
      { $or: [{ puzzleId: { $in: pids } }, { _id: { $in: pids as any } }] },
      { projection: { puzzleId: 1, _id: 1, fen: 1, solution: 1, themes: 1, rating: 1 } },
    ).toArray();
    const byId = new Map<string, any>();
    for (const p of puzDocs) {
      const key = String(p.puzzleId || p._id);
      byId.set(key, p);
    }
    return missRows.map((r: any): {
      puzzleId: string; fen: string; solution: string[]; themes: string[];
      rating: number | null; wrongMove: string | null; ratedAt: string | null;
    } => {
      const pid = String(r._id).split(":")[1] || "";
      const p = byId.get(pid);
      return {
        puzzleId: pid,
        fen: p?.fen || "",
        solution: Array.isArray(p?.solution) ? p.solution : (typeof p?.solution === "string" ? p.solution.split(/\s+/).filter(Boolean) : []),
        themes: Array.isArray(p?.themes) ? p.themes : [],
        rating: typeof r.pr === "number" ? r.pr : (typeof p?.rating === "number" ? p.rating : null),
        wrongMove: typeof r.wr === "string" ? r.wr : null,
        ratedAt: r.d ? new Date(r.d).toISOString() : null,
      };
    });
  }

  /** Academy-wide reteach queue — most recent misses across every student in
   *  the caller's academy (coach: only their assigned students; owner: all).
   *  Combines PUZZLE misses (rounds w=false) and STUDY-drill misses
   *  (study_rounds w=false), sorted newest-first, resolved to FEN/solution.
   *  Powers the /academy/performance overview module so a coach sees the
   *  whole academy's recent wrong-answers at a glance. Owner ask 2026-08-18:
   *  "main page small module for coach to see all students study mistakes,
   *  puzzle mistakes". */
  async academyMistakes(session: any, body: any): Promise<Array<{
    kind: "puzzle" | "study";
    studentId: string;
    studentName: string;
    studentUsername: string;
    puzzleId: string;
    fen: string;
    solution: string[];
    themes: string[];
    rating: number | null;
    wrongMove: string | null;
    ratedAt: string | null;
    studyType?: string;
  }>> {
    const coach = await this.ensureCoach(session);
    const limit = Math.max(1, Math.min(100, Number(body?.limit) || 20));
    const start = body?.periodStart ? new Date(body.periodStart) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = body?.periodEnd ? new Date(body.periodEnd) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException("bad dates");
    const kind: "puzzle" | "study" | "both" = body?.kind === "puzzle" || body?.kind === "study" ? body.kind : "both";
    // Roster: which students the caller can see. Coach sees own assignments
    // (via coachId — matches ensureStudentInScope's older field name — plus
    // assignedCoachId to be safe); owner sees the whole academy.
    const studentFilter: any = { academyId: coach.academyId, role: "student" };
    if (coach.role === "coach") {
      studentFilter.$or = [{ coachId: coach.userId }, { assignedCoachId: coach.userId }];
    }
    const students = await this.users().find(studentFilter, { projection: { _id: 1, username: 1, name: 1 } }).toArray();
    if (!students.length) return [];
    const studentIds = students.map((s: any) => String(s._id));
    const nameOf = (id: string) => {
      const s = students.find((u: any) => String(u._id) === id);
      return { name: (s?.name || s?.username || id) as string, username: (s?.username || id) as string };
    };
    // Puzzle misses: one $in on the _id range would over-scan; instead use $or
    // of per-student range predicates. Cheap for ≤30 students, which is the
    // realistic academy size before we introduce pagination server-side.
    const puzzleQuery = kind === "study" ? [] : await this.rounds().find(
      {
        $or: studentIds.map((sid) => ({ _id: { $gte: `${sid}:`, $lt: `${sid};` } as any })),
        w: false,
        d: { $gte: start, $lte: end },
      },
      { projection: { d: 1, wr: 1, pr: 1, _id: 1 } },
    ).sort({ d: -1 }).limit(limit).toArray();
    // Study misses: same shape, different collection. No wr field on
    // study_rounds so wrongMove will be null for these rows.
    const studyQuery = kind === "puzzle" ? [] : await this.studyRounds().find(
      {
        $or: studentIds.map((sid) => ({ _id: { $gte: `${sid}:`, $lt: `${sid};` } as any })),
        w: false,
        d: { $gte: start, $lte: end },
      },
      { projection: { d: 1, t: 1, r: 1, _id: 1 } },
    ).sort({ d: -1 }).limit(limit).toArray();
    // Resolve puzzles in one batch each.
    const puzIds = puzzleQuery.map((r: any) => String(r._id).split(":")[1]).filter(Boolean) as string[];
    const studyPuzIds = studyQuery.map((r: any) => String(r._id).split(":")[1]).filter(Boolean) as string[];
    const [puzDocs, studyDocs] = await Promise.all([
      puzIds.length
        ? this.puzzles().find({ $or: [{ puzzleId: { $in: puzIds } }, { _id: { $in: puzIds as any } }] }, { projection: { puzzleId: 1, _id: 1, fen: 1, solution: 1, themes: 1, rating: 1 } }).toArray()
        : Promise.resolve([]),
      // study_puzzles use ObjectId _id — decode from hex.
      studyPuzIds.length
        ? this.studyPuzzles().find({ _id: { $in: studyPuzIds.map((id) => { try { return new (require("mongodb").ObjectId)(id); } catch { return id; } }) as any } }, { projection: { _id: 1, fen: 1, solution: 1, type: 1, rating: 1 } }).toArray()
        : Promise.resolve([]),
    ]);
    const puzMap = new Map<string, any>(puzDocs.map((p: any) => [String(p.puzzleId || p._id), p]));
    const studyMap = new Map<string, any>(studyDocs.map((p: any) => [String(p._id), p]));

    const puzzleRows = puzzleQuery.map((r: any) => {
      const [sid, pid] = String(r._id).split(":");
      const p = puzMap.get(pid || "");
      const meta = nameOf(sid || "");
      return {
        kind: "puzzle" as const,
        studentId: sid || "",
        studentName: meta.name,
        studentUsername: meta.username,
        puzzleId: pid || "",
        fen: p?.fen || "",
        solution: Array.isArray(p?.solution) ? p.solution : (typeof p?.solution === "string" ? p.solution.split(/\s+/).filter(Boolean) : []),
        themes: Array.isArray(p?.themes) ? p.themes : [],
        rating: typeof r.pr === "number" ? r.pr : (typeof p?.rating === "number" ? p.rating : null),
        wrongMove: typeof r.wr === "string" ? r.wr : null,
        ratedAt: r.d ? new Date(r.d).toISOString() : null,
      };
    });
    const studyRows = studyQuery.map((r: any) => {
      const [sid, pid] = String(r._id).split(":");
      const p = studyMap.get(pid || "");
      const meta = nameOf(sid || "");
      return {
        kind: "study" as const,
        studentId: sid || "",
        studentName: meta.name,
        studentUsername: meta.username,
        puzzleId: pid || "",
        fen: p?.fen || "",
        solution: Array.isArray(p?.solution) ? p.solution : (typeof p?.solution === "string" ? p.solution.split(/\s+/).filter(Boolean) : []),
        themes: [],
        rating: typeof r.r === "number" ? r.r : (typeof p?.rating === "number" ? p.rating : null),
        wrongMove: null,
        ratedAt: r.d ? new Date(r.d).toISOString() : null,
        studyType: (typeof r.t === "string" ? r.t : (p?.type || "")) as string,
      };
    });
    // Merge, sort by date desc, cap to limit.
    return [...puzzleRows, ...studyRows]
      .sort((a, b) => (b.ratedAt || "").localeCompare(a.ratedAt || ""))
      .slice(0, limit);
  }

  /** Self-scoped preview — same metric bundle, but for the CURRENT LOGGED-IN
   *  user. Powers the "My performance" dashboard's period table so a student
   *  can see their own rating/puzzles/games broken down by weekly/monthly/etc.
   *  No coach-scope check because studentId is derived from the session, not
   *  passed in — a user is always allowed to see their own data. */
  async previewSelf(session: any, body: any): Promise<ReportData> {
    const userId: string | undefined = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    const start = body?.periodStart ? new Date(String(body.periodStart)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = body?.periodEnd ? new Date(String(body.periodEnd)) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException("bad period dates");
    return this.buildData(String(userId), start, end);
  }

  async save(session: any, body: any) {
    const coach = await this.ensureCoach(session);
    const { studentId, start, end } = this.parseInput(body);
    await this.assertStudentInScope(coach, studentId);
    const data = await this.buildData(studentId, start, end);
    const now = new Date();
    const _id = shortId(10);
    const doc: ReportDoc = {
      _id,
      ownerId: coach.userId,
      academyId: coach.academyId,
      studentId,
      periodStart: start,
      periodEnd: end,
      generatedAt: now,
      data,
      coachNote: typeof body?.coachNote === "string" ? String(body.coachNote).slice(0, 4000) : undefined,
      parentEmail: typeof body?.parentEmail === "string" ? String(body.parentEmail).trim().slice(0, 200) : undefined,
    };
    await this.reports().insertOne(doc);
    return { reportId: _id };
  }

  async list(session: any, studentId?: string) {
    const coach = await this.ensureCoach(session);
    const q: any = { ownerId: coach.userId };
    if (studentId) q.studentId = studentId;
    const items = await this.reports().find(q).sort({ generatedAt: -1 }).limit(100).toArray();
    return { items };
  }

  async get(session: any, reportId: string) {
    const coach = await this.ensureCoach(session);
    const r = await this.reports().findOne({ _id: reportId });
    if (!r) throw new NotFoundException("no such report");
    if (r.ownerId !== coach.userId) throw new ForbiddenException("not your report");
    return r;
  }

  async updateMeta(session: any, reportId: string, body: any) {
    const coach = await this.ensureCoach(session);
    const r = await this.reports().findOne({ _id: reportId });
    if (!r) throw new NotFoundException("no such report");
    if (r.ownerId !== coach.userId) throw new ForbiddenException("not your report");
    const set: any = {};
    if (typeof body?.coachNote === "string") set.coachNote = String(body.coachNote).slice(0, 4000);
    if (typeof body?.parentEmail === "string") set.parentEmail = String(body.parentEmail).trim().slice(0, 200);
    if (Object.keys(set).length) await this.reports().updateOne({ _id: reportId }, { $set: set });
    return { ok: true };
  }

  async markSent(session: any, reportId: string) {
    const coach = await this.ensureCoach(session);
    const r = await this.reports().findOne({ _id: reportId });
    if (!r) throw new NotFoundException("no such report");
    if (r.ownerId !== coach.userId) throw new ForbiddenException("not your report");
    await this.reports().updateOne({ _id: reportId }, { $set: { sentAt: new Date() } });
    return { ok: true };
  }

  async remove(session: any, reportId: string) {
    const coach = await this.ensureCoach(session);
    const r = await this.reports().findOne({ _id: reportId });
    if (!r) throw new NotFoundException("no such report");
    if (r.ownerId !== coach.userId) throw new ForbiddenException("not your report");
    await this.reports().deleteOne({ _id: reportId });
    return { ok: true };
  }

  private parseInput(body: any): { studentId: string; start: Date; end: Date } {
    const studentId = String(body?.studentId || "").trim();
    if (!studentId) throw new BadRequestException("studentId required");
    const start = body?.periodStart ? new Date(body.periodStart) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = body?.periodEnd ? new Date(body.periodEnd) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException("bad dates");
    if (end.getTime() < start.getTime()) throw new BadRequestException("end before start");
    return { studentId, start, end };
  }
}
