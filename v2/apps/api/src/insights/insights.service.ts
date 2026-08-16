// Weakness dashboard + prescription engine — the "personal coach" summary.
//
// For a given student:
//   1. Read myGameAnalysis rows → aggregate tagCounts across their games
//   2. For each weakness (mistake tag), look up:
//      - matching book chapters (books.chapters.tags ∩ mappedTags)
//      - matching puzzles from our lichess-themed puzzle DB
//      - matching studies (own studies with sourceBook.topicTags overlapping)
//   3. Return a ranked list of weaknesses + prescriptions per weakness
//
// Called by /api/insights/me (student) and /api/insights/students/:userId (coach).

import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

/** Mistake tag → puzzle theme names in our Lichess-imported puzzle DB.
 *  Chosen empirically from `db.puzzles.distinct("themes")` — real themes only. */
const TAG_TO_PUZZLE_THEMES: Record<string, string[]> = {
  missed_mate:         ["mate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5"],
  hung_piece:          ["hangingPiece", "trappedPiece"],
  missed_capture:      ["capturingDefender", "hangingPiece"],
  missed_knight_fork:  ["fork"],
  missed_check:        ["skewer", "pin", "discoveredCheck", "doubleCheck", "attackingF2F7"],
  missed_promotion:    ["promotion", "underPromotion", "advancedPawn"],
  opening_deviation:   ["opening"],
  positional:          ["endgame", "middlegame", "advantage"],
};

/** Mistake tag → free-form book chapter tags (from books.seed.ts). Case-insensitive match. */
const TAG_TO_BOOK_TAGS: Record<string, string[]> = {
  missed_mate:         ["mate", "checkmate", "mating patterns", "mate in 1", "mate in 2", "mate in 3", "attack", "king attack"],
  hung_piece:          ["tactics", "blunder", "combinations"],
  missed_capture:      ["tactics", "combinations", "double attack"],
  missed_knight_fork:  ["fork", "knight fork", "double attack", "tactics"],
  missed_check:        ["pin", "skewer", "discovered attack", "tactics"],
  missed_promotion:    ["passed pawns", "endgame principles"],
  opening_deviation:   ["opening", "opening principles", "development"],
  positional:          ["positional play", "strategy", "weak squares", "pawn structure"],
};

const TAG_LABEL: Record<string, string> = {
  missed_mate:         "Missed mate",
  hung_piece:          "Hung piece",
  missed_capture:      "Missed capture",
  missed_knight_fork:  "Missed knight fork",
  missed_check:        "Missed check / pin / skewer",
  missed_promotion:    "Missed promotion",
  opening_deviation:   "Opening deviation",
  positional:          "Positional error",
};

export interface Prescription {
  books: {
    bookId: string; title: string; author: string;
    chapters: { number: number; title: string; done: boolean; tags: string[] }[];
  }[];
  puzzleThemes: { theme: string; puzzleCount: number }[];
  studies: { studyId: string; title: string }[];
}

export interface Weakness {
  tag: string;
  label: string;
  count: number;
  severity: "high" | "medium" | "low";
  exampleGames: { gameId: string; ply: number; san: string; bestSan: string | null; explanation?: string }[];
  prescriptions: Prescription;
}

export interface InsightsSummary {
  userId: string;
  gamesAnalyzed: number;
  totalBlunders: number;
  totalMistakes: number;
  totalInaccuracies: number;
  weaknesses: Weakness[];
  updatedAt: string;
}

@Injectable()
export class InsightsService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private analysis() { return this.conn.db!.collection<any>("myGameAnalysis"); }
  private games() { return this.conn.db!.collection<any>("myGames"); }
  private puzzles() { return this.conn.db!.collection<any>("puzzles"); }
  private books() { return this.conn.db!.collection<any>("books"); }
  private bookProgress() { return this.conn.db!.collection<any>("bookProgress"); }
  private studies() { return this.conn.db!.collection<any>("studies"); }
  private users() { return this.conn.db!.collection<any>("users"); }

  private ensureUser(session: any): { userId: string; academyId: string | null } {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    return { userId: String(userId), academyId: session?.academyId ?? null };
  }

  /** Insights for the caller. */
  async mine(session: any): Promise<InsightsSummary> {
    const { userId } = this.ensureUser(session);
    return this.buildFor(userId);
  }

  /** Insights for a specific student — coach view. Auth: coach + student
   *  must be in the same academy. */
  async forStudent(session: any, studentId: string): Promise<InsightsSummary> {
    const { userId, academyId } = this.ensureUser(session);
    const me = await this.users().findOne({ _id: userId as any });
    if (!me) throw new NotFoundException("no such user");
    if (userId === studentId) return this.buildFor(userId);
    if (!["academy_owner", "coach"].includes(me.role) || !academyId) {
      throw new ForbiddenException("only coaches can see student insights");
    }
    const student = await this.users().findOne({ _id: studentId as any, academyId });
    if (!student) throw new NotFoundException("no such student in your academy");
    return this.buildFor(String(student._id));
  }

  private async buildFor(userId: string): Promise<InsightsSummary> {
    // 1. Aggregate mistake tags across all analyzed games for this user.
    const rows = await this.analysis().find({ ownerId: userId }).toArray();
    const tagCounts: Record<string, number> = {};
    const tagExamples: Record<string, Weakness["exampleGames"]> = {};
    let totalBlunders = 0, totalMistakes = 0, totalInaccuracies = 0;
    for (const r of rows) {
      totalBlunders += r.mistakeCounts?.blunder || 0;
      totalMistakes += r.mistakeCounts?.mistake || 0;
      totalInaccuracies += r.mistakeCounts?.inaccuracy || 0;
      for (const [t, n] of Object.entries(r.tagCounts || {})) {
        tagCounts[t] = (tagCounts[t] || 0) + (n as number);
      }
      for (const ply of (r.plies || [])) {
        if (ply.isMistake && ply.tag) {
          const list = tagExamples[ply.tag] ?? (tagExamples[ply.tag] = []);
          if (list.length < 3) {
            list.push({ gameId: r.gameId, ply: ply.ply, san: ply.san, bestSan: ply.bestSan, explanation: ply.explanation });
          }
        }
      }
    }

    // 2. Rank weaknesses by count.
    const ranked = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

    // 3. Build prescriptions per weakness in parallel.
    const weaknesses: Weakness[] = await Promise.all(
      ranked.map(async ([tag, count]) => ({
        tag,
        label: TAG_LABEL[tag] || tag,
        count,
        severity: (count >= 5 ? "high" : count >= 2 ? "medium" : "low") as "high" | "medium" | "low",
        exampleGames: tagExamples[tag] || [],
        prescriptions: await this.prescriptionsFor(userId, tag),
      })),
    );

    return {
      userId,
      gamesAnalyzed: rows.length,
      totalBlunders,
      totalMistakes,
      totalInaccuracies,
      weaknesses,
      updatedAt: new Date().toISOString(),
    };
  }

  private async prescriptionsFor(userId: string, tag: string): Promise<Prescription> {
    const puzzleThemes = TAG_TO_PUZZLE_THEMES[tag] || [];
    const bookTags = TAG_TO_BOOK_TAGS[tag] || [];

    // --- Puzzles: count how many drills we have per theme (cheap approximation).
    const puzzleCounts = await Promise.all(puzzleThemes.map(async (theme) => ({
      theme,
      puzzleCount: await this.puzzles().countDocuments({ themes: theme }),
    })));

    // --- Books: find chapters whose tags overlap with our bookTags (case-insensitive).
    // We only surface books the user CAN see (seeded + own + academy). We also join in progress
    // to mark completed chapters, so the UI can say "6/14 done."
    const lowerBookTags = bookTags.map((t) => t.toLowerCase());
    const allBooks = await this.books().find({}, { projection: { title: 1, author: 1, chapters: 1, isSeeded: 1, addedByUserId: 1, academyId: 1 } }).toArray();
    const matchingBooks: Prescription["books"] = [];
    const progRows = await this.bookProgress().find({ userId }).toArray();
    const progByBook = new Map<string, Set<number>>();
    for (const p of progRows) progByBook.set(p.bookId, new Set(p.chaptersCompleted || []));

    for (const book of allBooks) {
      // Visibility check: seeded OR owned by user (own books) — academyId filter skipped for coach view
      if (!book.isSeeded && book.addedByUserId !== userId) continue;
      const matched: any[] = [];
      for (const ch of (book.chapters || [])) {
        const chTagsLower = (ch.tags || []).map((t: string) => t.toLowerCase());
        if (chTagsLower.some((t: string) => lowerBookTags.some((b) => t.includes(b) || b.includes(t)))) {
          matched.push({
            number: ch.number,
            title: ch.title,
            done: progByBook.get(book._id)?.has(ch.number) ?? false,
            tags: ch.tags,
          });
        }
      }
      if (matched.length > 0) {
        matchingBooks.push({
          bookId: book._id,
          title: book.title,
          author: book.author,
          chapters: matched.slice(0, 5), // avoid overwhelming the UI
        });
      }
    }
    // Prefer un-finished chapters first: sort by number of remaining chapters descending.
    matchingBooks.sort((a, b) => {
      const rem = (bk: any) => bk.chapters.filter((c: any) => !c.done).length;
      return rem(b) - rem(a);
    });

    // --- Studies: user's own studies whose sourceBook.topicTags overlap with our bookTags.
    let matchingStudies: Prescription["studies"] = [];
    if (lowerBookTags.length) {
      const cursor = this.studies().find(
        {
          ownerId: userId,
          "sourceBook.topicTags": { $exists: true, $ne: [] },
        },
        { projection: { title: 1, sourceBook: 1 } },
      );
      const all = await cursor.toArray();
      matchingStudies = all
        .filter((s) => (s.sourceBook?.topicTags || []).some((t: string) => lowerBookTags.some((b) => t.toLowerCase().includes(b) || b.includes(t.toLowerCase()))))
        .map((s) => ({ studyId: s._id, title: s.title }))
        .slice(0, 8);
    }

    return {
      books: matchingBooks.slice(0, 6),
      puzzleThemes: puzzleCounts.filter((p) => p.puzzleCount > 0),
      studies: matchingStudies,
    };
  }
}
