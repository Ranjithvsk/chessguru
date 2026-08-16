// Coach Class Board — the "Monday-morning teacher dashboard".
//
// No new collections. Everything is aggregated from what's already there:
//   users            — students in the coach's academy
//   myGameAnalysis   — per-student mistake tag counts (from Slice 3)
//   revisions        — per-student due-count + streak (Slice 2A)
//   examAttempts     — per-student most-recent exam scores (Slice 2B)
//   bookProgress     — per-student books-in-progress (Slice 1B)
//   studies          — coach's studies (for the class-plan generator)
//   books            — for prescribing chapters in the class plan
//   puzzles          — for warm-up drill counts
//
// Two views:
//   classBoard()      — {students, classWeaknesses} — the dashboard landing
//   generatePlan(tag) — a class-plan draft for one weakness tag: warm-up,
//                       teach, demo positions from actual student games,
//                       practice, homework.

import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

// Mistake-tag → puzzle-theme + book-tag mapping (same taxonomy as Slice 4;
// duplicated here to keep the module standalone. When we add more tags, edit
// both places OR extract to a shared module.)
const TAG_TO_PUZZLE_THEMES: Record<string, string[]> = {
  missed_mate:         ["mate", "mateIn1", "mateIn2", "mateIn3"],
  hung_piece:          ["hangingPiece", "trappedPiece"],
  missed_capture:      ["capturingDefender", "hangingPiece"],
  missed_knight_fork:  ["fork"],
  missed_check:        ["skewer", "pin", "discoveredCheck"],
  missed_promotion:    ["promotion", "advancedPawn"],
  opening_deviation:   ["opening"],
  positional:          ["endgame", "middlegame"],
};

const TAG_TO_BOOK_TAGS: Record<string, string[]> = {
  missed_mate:         ["mate", "checkmate", "mating patterns", "king attack"],
  hung_piece:          ["tactics", "blunder"],
  missed_capture:      ["tactics", "double attack"],
  missed_knight_fork:  ["fork", "knight fork", "double attack"],
  missed_check:        ["pin", "skewer", "discovered attack"],
  missed_promotion:    ["passed pawns", "endgame principles"],
  opening_deviation:   ["opening", "opening principles"],
  positional:          ["positional play", "strategy"],
};

const TAG_LABEL: Record<string, string> = {
  missed_mate:         "Missed mate",
  hung_piece:          "Hung piece",
  missed_capture:     "Missed capture",
  missed_knight_fork:  "Missed knight fork",
  missed_check:        "Missed check/pin/skewer",
  missed_promotion:    "Missed promotion",
  opening_deviation:   "Opening deviation",
  positional:          "Positional",
};

export interface StudentRow {
  userId: string;
  username: string;
  name?: string;
  role: string;
  assignedCoachId?: string;
  gamesAnalyzed: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  topWeakness?: { tag: string; label: string; count: number };
  reviseDueNow: number;
  reviseStreak: number;
  bestExamPct: number | null;
  booksInProgress: number;
  lastGameAt: string | null;
  // Traffic-light health signal
  health: "green" | "amber" | "red";
  healthReason: string;
}

export interface ClassWeakness {
  tag: string;
  label: string;
  studentsAffected: number;      // # of students with ≥1 of this mistake
  totalOccurrences: number;
}

export interface ClassBoard {
  academyId: string;
  studentCount: number;
  students: StudentRow[];
  classWeaknesses: ClassWeakness[];
}

export interface ClassPlanExampleGame {
  studentId: string;
  studentName: string;
  gameId: string;
  ply: number;
  san: string;
  bestSan: string | null;
  fenBefore: string;
  explanation?: string;
}

export interface ClassPlan {
  tag: string;
  label: string;
  studentsAffected: number;
  warmUp: { theme: string; puzzleCount: number };
  teach: { books: { bookId: string; title: string; author: string; chapters: { number: number; title: string }[] }[] };
  demoPositions: ClassPlanExampleGame[];
  practice: { studyIds: string[] };
  homework: { puzzleTheme: string; targetCount: number };
}

@Injectable()
export class CoachBoardService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private users() { return this.conn.db!.collection<any>("users"); }
  private analysis() { return this.conn.db!.collection<any>("myGameAnalysis"); }
  private games() { return this.conn.db!.collection<any>("myGames"); }
  private revisions() { return this.conn.db!.collection<any>("revisions"); }
  private examAttempts() { return this.conn.db!.collection<any>("examAttempts"); }
  private bookProgress() { return this.conn.db!.collection<any>("bookProgress"); }
  private studies() { return this.conn.db!.collection<any>("studies"); }
  private books() { return this.conn.db!.collection<any>("books"); }
  private puzzles() { return this.conn.db!.collection<any>("puzzles"); }

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

  /** The dashboard. For coaches: their assigned students. For owners: all. */
  async classBoard(session: any): Promise<ClassBoard> {
    const { userId, academyId, role } = await this.ensureCoach(session);

    const studentFilter: any = { academyId, role: "student" };
    if (role === "coach") studentFilter.assignedCoachId = userId;

    const students = await this.users()
      .find(studentFilter, { projection: { _id: 1, username: 1, name: 1, role: 1, assignedCoachId: 1 } })
      .sort({ name: 1, username: 1 })
      .limit(300)
      .toArray();

    if (students.length === 0) return { academyId, studentCount: 0, students: [], classWeaknesses: [] };

    const studentIds = students.map((s) => String(s._id));

    // Bulk-fetch everything at once so N=50 students = ~6 queries, not 300.
    const [analyses, revisions, examSubmissions, bookProgs, latestGames] = await Promise.all([
      this.analysis().find({ ownerId: { $in: studentIds } }).toArray(),
      this.revisions().find({ userId: { $in: studentIds } }).toArray(),
      this.examAttempts().find({ userId: { $in: studentIds }, submittedAt: { $ne: null } }).toArray(),
      this.bookProgress().find({ userId: { $in: studentIds } }).toArray(),
      this.games().aggregate([
        { $match: { ownerId: { $in: studentIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$ownerId", lastGameAt: { $first: "$createdAt" } } },
      ]).toArray(),
    ]);

    // Index by userId
    const analysisByUser = new Map<string, any[]>();
    for (const a of analyses) {
      const arr = analysisByUser.get(a.ownerId) ?? [];
      arr.push(a);
      analysisByUser.set(a.ownerId, arr);
    }
    const reviseByUser = new Map<string, any[]>();
    for (const r of revisions) {
      const arr = reviseByUser.get(r.userId) ?? [];
      arr.push(r);
      reviseByUser.set(r.userId, arr);
    }
    const examByUser = new Map<string, any[]>();
    for (const e of examSubmissions) {
      const arr = examByUser.get(e.userId) ?? [];
      arr.push(e);
      examByUser.set(e.userId, arr);
    }
    const bookByUser = new Map<string, number>();
    for (const b of bookProgs) bookByUser.set(b.userId, (bookByUser.get(b.userId) || 0) + 1);
    const lastGameByUser = new Map<string, string>();
    for (const g of latestGames) lastGameByUser.set(String(g._id), (g.lastGameAt as Date).toISOString());

    // Compute per-student rows + accumulate class-wide weakness map
    const now = Date.now();
    const classTagCounts = new Map<string, { count: number; students: Set<string> }>();

    const rows: StudentRow[] = students.map((s) => {
      const uid = String(s._id);
      const aList = analysisByUser.get(uid) ?? [];
      let blunders = 0, mistakes = 0, inaccuracies = 0;
      const tagCounts: Record<string, number> = {};
      for (const a of aList) {
        blunders += a.mistakeCounts?.blunder || 0;
        mistakes += a.mistakeCounts?.mistake || 0;
        inaccuracies += a.mistakeCounts?.inaccuracy || 0;
        for (const [t, n] of Object.entries(a.tagCounts || {})) {
          tagCounts[t] = (tagCounts[t] || 0) + (n as number);
          const entry = classTagCounts.get(t) ?? { count: 0, students: new Set<string>() };
          entry.count += n as number;
          entry.students.add(uid);
          classTagCounts.set(t, entry);
        }
      }
      const topTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
      const topWeakness = topTag ? { tag: topTag[0], label: TAG_LABEL[topTag[0]] || topTag[0], count: topTag[1] } : undefined;

      const rList = reviseByUser.get(uid) ?? [];
      const reviseDueNow = rList.filter((r) => new Date(r.dueAt).getTime() <= now).length;
      const reviseStreak = rList.reduce((max, r) => Math.max(max, r.streak || 0), 0);

      const eList = examByUser.get(uid) ?? [];
      const bestExamPct = eList.length ? Math.max(...eList.map((e) => e.scorePct || 0)) : null;

      const lastGameAt = lastGameByUser.get(uid) ?? null;
      const daysSinceLastGame = lastGameAt ? Math.floor((now - new Date(lastGameAt).getTime()) / (24 * 60 * 60 * 1000)) : Infinity;

      // Health traffic-light — coach's at-a-glance signal
      let health: "green" | "amber" | "red" = "green";
      let healthReason = "On track";
      if (blunders >= 3 && aList.length >= 1) { health = "red"; healthReason = `${blunders} blunders in ${aList.length} game${aList.length === 1 ? "" : "s"}`; }
      else if (reviseDueNow > 20) { health = "red"; healthReason = `${reviseDueNow} revisions overdue`; }
      else if (daysSinceLastGame > 14 && aList.length > 0) { health = "amber"; healthReason = `No games in ${daysSinceLastGame} days`; }
      else if (reviseDueNow > 5) { health = "amber"; healthReason = `${reviseDueNow} revisions due`; }
      else if (aList.length === 0) { health = "amber"; healthReason = "No games analyzed yet"; }

      return {
        userId: uid,
        username: s.username,
        name: s.name,
        role: s.role,
        assignedCoachId: s.assignedCoachId,
        gamesAnalyzed: aList.length,
        blunders, mistakes, inaccuracies,
        topWeakness,
        reviseDueNow, reviseStreak,
        bestExamPct,
        booksInProgress: bookByUser.get(uid) || 0,
        lastGameAt,
        health,
        healthReason,
      };
    });

    // Class-wide weaknesses ranked by # students affected
    const classWeaknesses: ClassWeakness[] = Array.from(classTagCounts.entries())
      .map(([tag, v]) => ({ tag, label: TAG_LABEL[tag] || tag, studentsAffected: v.students.size, totalOccurrences: v.count }))
      .sort((a, b) => b.studentsAffected - a.studentsAffected || b.totalOccurrences - a.totalOccurrences);

    // Sort roster: red first, then amber, then green; within each, most blunders first
    const healthRank: Record<string, number> = { red: 0, amber: 1, green: 2 };
    rows.sort((a, b) => (healthRank[a.health] ?? 3) - (healthRank[b.health] ?? 3) || b.blunders - a.blunders);

    return { academyId, studentCount: rows.length, students: rows, classWeaknesses };
  }

  /** Generate a class-plan draft for a specific weakness tag. Pulls real
   *  student mistake positions as "demo positions". */
  async generatePlan(session: any, tag: string): Promise<ClassPlan> {
    const { academyId, role, userId } = await this.ensureCoach(session);
    if (!TAG_LABEL[tag]) throw new NotFoundException("unknown tag");

    const studentFilter: any = { academyId, role: "student" };
    if (role === "coach") studentFilter.assignedCoachId = userId;
    const students = await this.users().find(studentFilter, { projection: { _id: 1, name: 1, username: 1 } }).toArray();
    const studentIds = students.map((s) => String(s._id));

    // Warm-up: how many puzzles do we have for this theme?
    const primaryTheme = (TAG_TO_PUZZLE_THEMES[tag] || [])[0];
    const puzzleCount = primaryTheme ? await this.puzzles().countDocuments({ themes: primaryTheme }) : 0;

    // Teach: books with matching chapters
    const bookTags = (TAG_TO_BOOK_TAGS[tag] || []).map((t) => t.toLowerCase());
    const allBooks = await this.books().find({}, { projection: { title: 1, author: 1, chapters: 1, isSeeded: 1, academyId: 1, addedByUserId: 1 } }).toArray();
    const teachBooks: ClassPlan["teach"]["books"] = [];
    for (const book of allBooks) {
      const canSee = book.isSeeded || book.addedByUserId === userId || book.academyId === academyId;
      if (!canSee) continue;
      const matched = (book.chapters || []).filter((c: any) => (c.tags || []).some((t: string) => bookTags.some((b) => t.toLowerCase().includes(b) || b.includes(t.toLowerCase()))));
      if (matched.length) teachBooks.push({ bookId: book._id, title: book.title, author: book.author, chapters: matched.slice(0, 3).map((c: any) => ({ number: c.number, title: c.title })) });
    }
    teachBooks.splice(4); // top 4 books

    // Demo positions: pull real student mistake positions with this tag.
    const demoPositions: ClassPlanExampleGame[] = [];
    if (studentIds.length) {
      const rows = await this.analysis().find({ ownerId: { $in: studentIds } }).toArray();
      const nameById = new Map(students.map((s) => [String(s._id), s.name || s.username]));
      for (const r of rows) {
        for (const p of (r.plies || [])) {
          if (p.isMistake && p.tag === tag) {
            demoPositions.push({
              studentId: r.ownerId,
              studentName: nameById.get(r.ownerId) || r.ownerId,
              gameId: r.gameId,
              ply: p.ply,
              san: p.san,
              bestSan: p.bestSan,
              fenBefore: p.fenBefore,
              explanation: p.explanation,
            });
          }
        }
      }
      // Prefer variety across students: sort so we alternate students
      demoPositions.sort((a, b) => a.studentId.localeCompare(b.studentId));
    }

    // Practice: coach's own studies with matching sourceBook.topicTags
    let studyIds: string[] = [];
    if (bookTags.length) {
      const myStudies = await this.studies().find(
        { ownerId: userId, "sourceBook.topicTags": { $exists: true, $ne: [] } },
        { projection: { _id: 1, sourceBook: 1 } },
      ).toArray();
      studyIds = myStudies
        .filter((s) => (s.sourceBook?.topicTags || []).some((t: string) => bookTags.some((b) => t.toLowerCase().includes(b) || b.includes(t.toLowerCase()))))
        .map((s) => s._id)
        .slice(0, 5);
    }

    return {
      tag,
      label: TAG_LABEL[tag],
      studentsAffected: (await this.analysis().distinct("ownerId", { ownerId: { $in: studentIds }, [`tagCounts.${tag}`]: { $gte: 1 } })).length,
      warmUp: { theme: primaryTheme || "", puzzleCount },
      teach: { books: teachBooks },
      demoPositions: demoPositions.slice(0, 6),
      practice: { studyIds },
      homework: { puzzleTheme: primaryTheme || "", targetCount: 20 },
    };
  }
}
