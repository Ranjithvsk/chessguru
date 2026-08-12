// Homework assignment system.
//
// A coach or academy owner assigns a bundle of practice to one or more
// students. Two entry points:
//
//   1. Custom: pick specific themes + puzzles-per-theme + due date.
//   2. One-click preset: 5 themes × 5 puzzles (25 puzzles) + 1 opening
//      revision, due in 7 days. Themes are chosen from the student's
//      WEAKEST themes when we have enough per-theme rating data; falls
//      back to a generic tactical mix for brand-new students.
//
// Storage: `homework` collection. One row per (student × assignment) so a
// batch assign to 10 students creates 10 rows — that's cheap and it makes
// per-student progress + coach roll-up dead simple.

import { Injectable, ForbiddenException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";

export type HomeworkKind = "puzzle_pack" | "study_revision" | "opening_revision";

export interface PuzzlePackTask {
  kind: "puzzle_pack";
  theme: string;
  targetCount: number;
  /** Snapshotted at assign time from userperfs.themes[theme].gl.r (or the
   *  student's overall puzzle rating when we don't have per-theme data). The
   *  student's homework CTA passes this in the URL so the puzzle picker
   *  serves puzzles in a ±100 band — each student's homework auto-scales
   *  to their level. Owner ask 2026-08-12: "assign puzzles in their students
   *  rating range". */
  targetRating?: number;
}
export interface StudyRevisionTask { kind: "study_revision"; studyType: string; }
export interface OpeningRevisionTask { kind: "opening_revision"; openingSlug: string; }
export type HomeworkTask = PuzzlePackTask | StudyRevisionTask | OpeningRevisionTask;

export interface HomeworkDoc {
  _id?: any;
  academyId: string;
  coachId: string;
  studentId: string;
  title: string;
  tasks: HomeworkTask[];
  dueAt: Date;
  assignedAt: Date;
  status: "assigned" | "in_progress" | "completed";
  progress: Record<string, number>;   // task index → current count
  completedAt?: Date | null;
}

// A friendly default mix that covers all major tactical motifs.
// Used when we don't have enough per-student rating data to pick weakest themes.
const DEFAULT_THEMES = ["pin", "fork", "skewer", "discoveredAttack", "sacrifice"];
const DEFAULT_OPENING = "sicilian";

@Injectable()
export class HomeworkService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("homework"); }
  private users() { return this.conn.db!.collection("users"); }

  private ensureCoachOrOwner(session: any): { academyId: string; userId: string; role: "academy_owner" | "coach" } {
    const role = session?.role;
    const academyId = session?.academyId;
    const userId = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    if ((role !== "academy_owner" && role !== "coach") || !academyId) {
      throw new ForbiddenException("owner or coach only");
    }
    return { academyId, userId, role };
  }

  /** Assign homework to one or more students. If the caller is a coach,
   *  they may only target their own students. Owner may target any. */
  async assign(session: any, body: {
    studentIds: string[];
    title?: string;
    tasks: HomeworkTask[];
    dueAt?: string;   // ISO date
  }) {
    const g = this.ensureCoachOrOwner(session);
    if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) {
      return { ok: false, error: "Pick at least one student" };
    }
    if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
      return { ok: false, error: "No tasks in homework" };
    }
    // Verify students are in this academy (and if coach, that they belong to this coach).
    const validRows = await this.users().find({
      _id: { $in: body.studentIds } as any,
      academyId: g.academyId,
      role: "student",
      ...(g.role === "coach" ? { coachId: g.userId } : {}),
    }).project({ _id: 1 }).toArray();
    const valid = new Set(validRows.map((r) => String(r._id)));
    if (valid.size === 0) return { ok: false, error: "No matching students" };

    const now = new Date();
    const dueAt = body.dueAt ? new Date(body.dueAt) : new Date(now.getTime() + 7 * 86_400_000);
    const title = String(body.title || defaultTitle(body.tasks)).slice(0, 120);
    const docs: any[] = [];
    for (const sid of body.studentIds) {
      if (!valid.has(sid)) continue;
      docs.push({
        academyId: g.academyId, coachId: g.userId, studentId: sid,
        title, tasks: body.tasks, dueAt, assignedAt: now,
        status: "assigned", progress: {}, completedAt: null,
      });
    }
    if (docs.length === 0) return { ok: false, error: "No matching students" };
    await this.col().insertMany(docs);
    return { ok: true, assigned: docs.length };
  }

  /** One-click preset assignment: 5 themes × 5 puzzles + 1 opening revision,
   *  due in 7 days. Themes are the student's WEAKEST when we have per-theme
   *  ratings (≥10 solves in that theme); otherwise a curated default mix.
   *  Coach-scoped: assigns to every student under the caller (or if owner, to
   *  every student in the academy). Idempotent across the week — if a preset
   *  homework was assigned to the same student in the last 3 days, skip. */
  async oneClickAssign(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const students = await this.users().find({
      academyId: g.academyId,
      role: "student",
      ...(g.role === "coach" ? { coachId: g.userId } : {}),
    }).project({ _id: 1 }).toArray();
    if (students.length === 0) return { ok: false, error: "No students to assign to" };

    // Skip students who already got a one-click assignment in the last 3 days
    // (protects against a coach hammering the button).
    const since = new Date(Date.now() - 3 * 86_400_000);
    const recent = await this.col().find({
      academyId: g.academyId,
      studentId: { $in: students.map((s) => String(s._id)) } as any,
      title: /^One-click practice/,
      assignedAt: { $gte: since },
    }).project({ studentId: 1 }).toArray();
    const skip = new Set(recent.map((r: any) => String(r.studentId)));

    const now = new Date();
    const dueAt = new Date(now.getTime() + 7 * 86_400_000);
    const docs: any[] = [];
    let skipped = 0;

    for (const s of students) {
      const sid = String(s._id);
      if (skip.has(sid)) { skipped++; continue; }
      const { themes, overallRating } = await this.pickWeakThemesForStudent(sid);
      const tasks: HomeworkTask[] = [
        ...themes.map((t) => ({
          kind: "puzzle_pack" as const,
          theme: t.theme,
          targetCount: 5,
          // Prefer per-theme rating; fall back to the student's overall puzzle
          // rating so brand-new students still get puzzles near their level.
          targetRating: Math.round(t.rating ?? overallRating ?? 1500),
        })),
        { kind: "opening_revision" as const, openingSlug: DEFAULT_OPENING },
      ];
      docs.push({
        academyId: g.academyId, coachId: g.userId, studentId: sid,
        title: `One-click practice · ${now.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}`,
        tasks, dueAt, assignedAt: now,
        status: "assigned", progress: {}, completedAt: null,
      });
    }
    if (docs.length > 0) await this.col().insertMany(docs);
    return { ok: true, assigned: docs.length, skipped, total: students.length };
  }

  /** Rank the student's per-theme ratings, return the 5 weakest with ≥3 solves.
   *  Falls back to the default themes when there isn't enough data. Also
   *  returns the student's overall puzzle rating so callers can bake it into
   *  tasks that don't have a per-theme rating available. */
  private async pickWeakThemesForStudent(userId: string): Promise<{
    themes: Array<{ theme: string; rating: number | null }>;
    overallRating: number | null;
  }> {
    const [perf, userRating]: any[] = await Promise.all([
      this.conn.db!.collection("userperfs").findOne({ _id: userId as any }, { projection: { themes: 1 } }),
      // The user's overall puzzle rating — stored on the user doc for fast reads
      this.conn.db!.collection("users").findOne({ _id: userId as any }, { projection: { puzzleRating: 1, rating: 1 } }),
    ]);
    const overallRating = (userRating?.puzzleRating ?? userRating?.rating ?? null) as number | null;
    const themes = perf?.themes || {};
    const rows: Array<{ theme: string; rating: number; nb: number }> = [];
    for (const [k, v] of Object.entries<any>(themes)) {
      if (!v?.gl?.r || !v?.nb) continue;
      if (v.nb < 3) continue;
      rows.push({ theme: k, rating: v.gl.r, nb: v.nb });
    }
    if (rows.length < 5) {
      // Not enough per-theme data — fall back to a curated tactical mix.
      // Rating null on each = client will use overallRating for the URL band.
      return { themes: DEFAULT_THEMES.map((t) => ({ theme: t, rating: null })), overallRating };
    }
    rows.sort((a, b) => a.rating - b.rating);   // ascending: weakest first
    return { themes: rows.slice(0, 5).map((r) => ({ theme: r.theme, rating: r.rating })), overallRating };
  }

  /** Coach/owner view: their homework assignments across all students. */
  async listForCoach(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { academyId: g.academyId };
    if (g.role === "coach") filter.coachId = g.userId;
    const rows = await this.col().find(filter).sort({ assignedAt: -1 }).limit(500).toArray();
    // Batch student username lookup for display.
    const sids = Array.from(new Set(rows.map((r: any) => String(r.studentId))));
    const su = sids.length ? await this.users().find({ _id: { $in: sids } as any }, { projection: { _id: 1, username: 1 } }).toArray() : [];
    const uMap: Record<string, string> = {};
    for (const u of su as any[]) uMap[String(u._id)] = u.username || String(u._id);
    return rows.map((r: any) => ({
      _id: String(r._id), studentId: r.studentId, studentName: uMap[r.studentId] || r.studentId,
      title: r.title, tasks: r.tasks, dueAt: r.dueAt, assignedAt: r.assignedAt,
      status: r.status, progress: r.progress, completedAt: r.completedAt ?? null,
    }));
  }

  /** Student view: their assigned homework. */
  async listForStudent(session: any) {
    const userId = session?.userId;
    if (!userId) return [];
    const rows = await this.col().find({ studentId: userId }).sort({ dueAt: 1 }).limit(200).toArray();
    return rows.map((r: any) => ({
      _id: String(r._id), title: r.title, tasks: r.tasks,
      dueAt: r.dueAt, assignedAt: r.assignedAt,
      status: r.status, progress: r.progress, completedAt: r.completedAt ?? null,
    }));
  }

  /** Student marks a task as complete (or bumps its progress). Server clamps
   *  to the task's target so a client can't fake overshoot. */
  async advance(session: any, id: string, taskIndex: number) {
    const userId = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    const hw: any = await this.col().findOne({ _id: safeObjectId(id) as any });
    if (!hw || hw.studentId !== userId) throw new ForbiddenException("not yours");
    const task = hw.tasks[taskIndex];
    if (!task) return { ok: false, error: "bad task index" };
    const current = (hw.progress?.[String(taskIndex)] ?? 0) + 1;
    const target = task.kind === "puzzle_pack" ? task.targetCount : 1;
    const clamped = Math.min(current, target);
    const progress = { ...(hw.progress || {}), [String(taskIndex)]: clamped };
    // Complete when EVERY task reached its target.
    const allDone = hw.tasks.every((t: any, i: number) => {
      const c = progress[String(i)] ?? 0;
      const tgt = t.kind === "puzzle_pack" ? t.targetCount : 1;
      return c >= tgt;
    });
    const set: any = { progress };
    if (allDone) { set.status = "completed"; set.completedAt = new Date(); }
    else if (hw.status === "assigned") set.status = "in_progress";
    await this.col().updateOne({ _id: hw._id }, { $set: set });
    return { ok: true, progress, status: set.status ?? hw.status, completedAt: set.completedAt ?? hw.completedAt };
  }

  /** Coach/owner deletes an assignment (e.g. wrong student, testing). */
  async remove(session: any, id: string) {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { _id: safeObjectId(id), academyId: g.academyId };
    if (g.role === "coach") filter.coachId = g.userId;
    const r = await this.col().deleteOne(filter);
    return { ok: true, removed: r.deletedCount ?? 0 };
  }
}

function defaultTitle(tasks: HomeworkTask[]): string {
  const puzzles = tasks.filter((t) => t.kind === "puzzle_pack").length;
  const studies = tasks.filter((t) => t.kind !== "puzzle_pack").length;
  const parts: string[] = [];
  if (puzzles) parts.push(`${puzzles} puzzle pack${puzzles === 1 ? "" : "s"}`);
  if (studies) parts.push(`${studies} revision${studies === 1 ? "" : "s"}`);
  return parts.length ? "Homework · " + parts.join(" + ") : "Homework";
}

function safeObjectId(id: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ObjectId } = require("mongodb");
    return new ObjectId(id);
  } catch { return id as any; }
}
