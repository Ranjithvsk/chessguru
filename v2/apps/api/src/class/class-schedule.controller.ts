// Phase 4b: class scheduling.
//
// Persists planned classes so students can see a "what's next" list and join at
// the scheduled time. Ad-hoc classes (the existing "Start a class" button, minting
// a random room id on the fly) still work — those simply never touch this
// collection.
//
// Model (Mongo classSchedules): { _id: roomId, title, coach, startAt, durationMin,
//                                 notes, createdAt }. Room id is a short random
// string that doubles as the join URL (same charset the class-ws bus accepts).
//
// Auth: no user gate. Same trust model as the rest of the class feature — the
// link IS the shared secret. Coach's display name is captured in the form so
// students can see who's teaching.

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, HttpException, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;
const MAX_TITLE = 120;
const MAX_COACH = 80;
const MAX_NOTES = 2000;

function newRoomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

type ScheduleDoc = {
  _id: string; title: string; coach: string;
  startAt: Date; durationMin: number; notes: string;
  // Topics to be covered — coach lists as short pills on the schedule form
  // ("Ruy López · Bg5 pin · endgame drills"). Rendered as chips on the class
  // card + calendar day cell. Max 8 items, each ≤ 40 chars.
  topics?: string[];
  createdAt: Date;
  // Coach identity — set from the session at create time. Anonymous coaches
  // (not signed in) get null and simply lose the ability to cancel/edit later.
  createdByUserId: string | null;
  // Multi-tenant SaaS: stamped from session.academyId on create. Null for
  // legacy / non-tenant users; non-null rows are scoped to that academy and
  // only surfaced to its members in list()/detail().
  academyId?: string | null;
  // Which video room this class runs in: "call" = from-scratch mesh room
  // (/call, default), "meet" = self-hosted LiveKit "Dream Meet" (/class-v2).
  roomKind?: "call" | "meet";
  // Recurrence — materialized at create time. Every doc in a series shares
  // the same seriesId (= the FIRST doc's _id). seriesIndex/seriesTotal drive
  // the "3 of 12" badge on the client. Standalone one-off classes leave
  // seriesId null (implicit series of one).
  seriesId?: string | null;
  seriesIndex?: number;    // 1-based position in the series
  seriesTotal?: number;    // total number of instances originally created
  // Invitee emails (validated on the way in). The reminder scheduler emails
  // each ~15 min before startAt. Small cap so a runaway paste can't spam.
  invitees?: Array<{ email: string }>;
  // Reminder-stage stamps. Each stage stamps its own field when it starts
  // sending that stage's batch (belt-and-braces against a mid-batch crash
  // resending to everyone on restart).
  reminderSentAt?: Date | null;    // 15-min-before
  reminded1hAt?: Date | null;      // 1-hour-before
  reminded24hAt?: Date | null;     // day-before
  // Coach-picked stages that should fire for this class. Legacy / missing =
  // treat as ["h24","m15"] in the scheduler so unpatched classes keep
  // yesterday's behaviour. Set to [] to disable all reminders.
  reminderStages?: string[];
  // Auto-summary opt-in. When true, a cron worker fires the class-summary
  // email 15 min after endAt (if not already sent manually). Coach can flip
  // on the schedule form or via PATCH.
  autoSummary?: boolean;
  // Optional evergreen note baked into the auto-sent summary. Coach writes
  // this once at schedule time (e.g. "Practise the tactics from today's
  // Italian for 20 minutes tomorrow morning."). Max 500 chars.
  autoSummaryNote?: string;
  summarySentAt?: Date | null;
};

const ALLOWED_STAGES = new Set(["m15", "h1", "h24"]);
const DEFAULT_STAGES = ["h24", "m15"];

const MAX_RECUR = 12;
const MAX_INVITEES = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Parse whatever the client sends into a validated invitees array. Accepts an
// array of strings, an array of {email}, or a raw string with newline/comma
// separators — real coaches paste however they've got their list.
export function parseInvitees(raw: unknown): Array<{ email: string }> {
  const out: string[] = [];
  const push = (s: unknown) => { if (typeof s === "string") out.push(s); };
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === "string") push(x);
      else if (x && typeof x === "object" && "email" in (x as any)) push((x as any).email);
    }
  } else if (typeof raw === "string") {
    for (const s of raw.split(/[\s,;]+/)) push(s);
  }
  const uniq = new Set<string>();
  const result: Array<{ email: string }> = [];
  for (const s of out) {
    const e = s.trim().toLowerCase();
    if (!e || !EMAIL_RE.test(e) || uniq.has(e)) continue;
    uniq.add(e);
    result.push({ email: e });
    if (result.length >= MAX_INVITEES) break;
  }
  return result;
}

@Controller("class/schedule")
export class ClassScheduleController {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection<ScheduleDoc>("classSchedules"); }

  // POST /api/class/schedule — create a scheduled class. Body validated + trimmed.
  // Returns the persisted row (including the minted room id / join link).
  @Post()
  async create(@Body() body: unknown, @Req() req: any) {
    const b: any = body ?? {};
    const title = String(b.title ?? "").trim();
    const coach = String(b.coach ?? "").trim();
    const notes = String(b.notes ?? "").trim();
    // Topics: accept an array of short strings, sanitize + clamp.
    const topicsIn = Array.isArray(b.topics) ? b.topics : [];
    const topics = topicsIn
      .map((t: unknown) => String(t ?? "").trim().slice(0, 40))
      .filter((t: string) => t.length > 0)
      .slice(0, 8);
    const durationMin = Math.max(5, Math.min(600, Math.floor(Number(b.durationMin) || 60)));
    const roomKind: "call" | "meet" = (b as any).roomKind === "meet" ? "meet" : "call";
    const startAtNum = Number(new Date(b.startAt || "").getTime());
    if (!title) throw new HttpException("title required", HttpStatus.BAD_REQUEST);
    if (title.length > MAX_TITLE) throw new HttpException("title too long", HttpStatus.BAD_REQUEST);
    if (coach.length > MAX_COACH) throw new HttpException("coach name too long", HttpStatus.BAD_REQUEST);
    if (notes.length > MAX_NOTES) throw new HttpException("notes too long", HttpStatus.BAD_REQUEST);
    if (!Number.isFinite(startAtNum)) throw new HttpException("bad startAt", HttpStatus.BAD_REQUEST);
    // Recurrence — 'none' or 'weekly'. Count is clamped so the API can't be used to
    // spam thousands of docs from a single request; MAX_RECUR keeps the semester
    // shape sane (12 weeks fits a typical school term).
    const recurrence: "none" | "weekly" = b.recurrence === "weekly" ? "weekly" : "none";
    const count = recurrence === "weekly"
      ? Math.max(1, Math.min(MAX_RECUR, Math.floor(Number(b.recurrenceCount) || 1)))
      : 1;
    // Optional weekday mask for weekly recurrence (Sunday=0..Saturday=6). Empty →
    // every-7-days from startAt (classic behaviour). Populated → walk day-by-day
    // and materialize on matching weekdays. Coaches teaching Mon/Wed/Fri or
    // Tue/Thu patterns can now schedule the whole term in one form.
    const weekdaysRaw = Array.isArray(b.recurrenceWeekdays) ? b.recurrenceWeekdays : [];
    const weekdays = Array.from(new Set(weekdaysRaw
      .map((n: unknown) => Math.floor(Number(n)))
      .filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))) as number[];
    if (recurrence === "weekly" && weekdays.length > 0) {
      // Reject when startAt's weekday isn't in the mask — otherwise the FIRST
      // instance would fall on a "not selected" day, which is confusing.
      const startDow = new Date(startAtNum).getDay();
      if (!weekdays.includes(startDow)) {
        throw new HttpException(
          "Start date's weekday must be one of the selected recurrence days.",
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const userId: string | null = req?.session?.userId ?? null;
    const username: string | null = req?.session?.username ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    const coachName = coach || username || "Coach";
    // Invitees — optional, deduped + validated. Same list is stamped on every
    // instance of a materialized series so the reminder scheduler doesn't have
    // to walk seriesId to find the target list.
    const invitees = parseInvitees(b.invitees);
    // Reminder stages. Client sends an array of allowed keys; unknown keys
    // dropped, order deduped. If the field is absent, default to today's
    // behaviour (24h + 15min). An explicit [] disables all reminders.
    const reminderStages = Array.isArray(b.reminderStages)
      ? Array.from(new Set(b.reminderStages.filter((s: unknown) => typeof s === "string" && ALLOWED_STAGES.has(s))))
      : DEFAULT_STAGES.slice();
    // Build the list of instance start times.
    // - No weekday mask: instances 7 days apart (existing behaviour).
    // - Mask given: start at startAt, then walk 1 day at a time, taking dates
    //   whose weekday is in the mask, until we have `count` instances. Cap the
    //   walk at count * 14 iterations so pathological input (e.g. count=12 with
    //   weekdays=[Sun] which only fires once per week) can't infinite-loop.
    const startTimes: number[] = [startAtNum];
    if (recurrence === "weekly" && count > 1) {
      if (weekdays.length === 0) {
        for (let i = 1; i < count; i++) startTimes.push(startAtNum + i * 7 * 24 * 60 * 60 * 1000);
      } else {
        let cursor = startAtNum;
        const dayMs = 24 * 60 * 60 * 1000;
        for (let step = 1; startTimes.length < count && step <= count * 14; step++) {
          const next = cursor + step * dayMs;
          if (weekdays.includes(new Date(next).getDay())) startTimes.push(next);
        }
      }
    }
    // Materialise N docs. First doc's _id doubles as the seriesId when count>1 so we
    // don't need a separate uuid. One-off classes leave seriesId null.
    const total = startTimes.length;
    const docs: ScheduleDoc[] = [];
    for (let i = 0; i < total; i++) {
      let id = newRoomId();
      for (let r = 0; r < 3; r++) {
        const existing = await this.col().findOne({ _id: id as any }, { projection: { _id: 1 } });
        if (!existing) break;
        id = newRoomId();
      }
      const seriesId = total > 1 ? (i === 0 ? id : docs[0]!._id) : null;
      docs.push({
        _id: id, title, coach: coachName,
        startAt: new Date(startTimes[i]!),
        durationMin, notes, topics, createdAt: new Date(),
        createdByUserId: userId,
        academyId,
        roomKind,
        seriesId, seriesIndex: total > 1 ? i + 1 : undefined,
        seriesTotal: total > 1 ? total : undefined,
        invitees: invitees.length ? invitees : undefined,
        reminderSentAt: null,
        reminded1hAt: null,
        reminded24hAt: null,
        reminderStages: reminderStages as string[],
        autoSummary: !!b.autoSummary,
        autoSummaryNote: typeof b.autoSummaryNote === "string" ? b.autoSummaryNote.slice(0, 500) : "",
      });
    }
    await this.col().insertMany(docs);
    // Return the FIRST doc — that's the "canonical" entry the client navigates into.
    // Client's list refresh will pick up the rest.
    return { ...docs[0], mine: true };
  }

  // GET /api/class/schedule — list live + upcoming classes. Each row gets a
  // `mine: boolean` flag based on the caller's session so the client can render
  // owner-only controls (Delete) without a second round-trip. Rows the caller
  // OWNS also get `attendedCount` so the coach can see roster health at a glance
  // on the landing (fetched via one aggregate to avoid N+1 on busy days).
  // Ended classes are hidden by default (a separate ?past=1 query would return
  // the recent past).
  @Get()
  async list(@Req() req: any) {
    const now = new Date();
    const me: string | null = req?.session?.userId ?? null;
    const myAcademy: string | null = req?.session?.academyId ?? null;
    // Academy scoping — STRICT: tenant members see ONLY their academy's classes.
    // Previously the OR fallback included orphan-academyId rows too, which
    // leaked cross-tenant classes (e.g. harinitharanjith's class showing up on
    // gunachess.com). Non-tenant users (platform-only) still see orphan rows.
    const filter: any = myAcademy
      ? { academyId: myAcademy }
      : { academyId: { $in: [null, undefined] } };
    const rows = await this.col().find(filter, { sort: { startAt: 1 } }).limit(200).toArray();
    const live: (ScheduleDoc & { mine: boolean; attendedCount?: number })[] = [];
    const upcoming: (ScheduleDoc & { mine: boolean; attendedCount?: number })[] = [];
    const mineIds: string[] = [];
    for (const r of rows) {
      const endAt = new Date(r.startAt.getTime() + r.durationMin * 60_000);
      if (endAt <= now) continue;
      const mine = !!me && r.createdByUserId === me;
      if (mine) mineIds.push(r._id);
      const flagged = { ...r, mine };
      if (r.startAt <= now) live.push(flagged);
      else upcoming.push(flagged);
    }
    // Attendance counts for the caller's own rows only — students can see live
    // participants directly in the room anyway; coach cares about it on the
    // landing when scanning their schedule.
    if (mineIds.length) {
      const counts = await this.conn.db!.collection("classAttendance").aggregate([
        { $match: { classId: { $in: mineIds } } },
        { $group: { _id: "$classId", n: { $sum: 1 } } },
      ]).toArray();
      const byId = new Map<string, number>(counts.map((c: any) => [c._id, c.n]));
      for (const r of [...live, ...upcoming]) {
        if (r.mine) r.attendedCount = byId.get(r._id) ?? 0;
      }
    }
    return { live, upcoming };
  }

  // PATCH /api/class/schedule/:id  — coach-only edit. Body may include any subset
  // of { title, coach, notes, durationMin }. startAt is intentionally NOT editable
  // here — moving the class time requires re-materializing series positions and
  // is safer as cancel + re-create. Query ?scope=series applies the same change
  // to every FUTURE instance of the series (past instances are historical record
  // and stay untouched).
  @Patch(":id")
  async edit(@Param("id") id: string, @Body() body: unknown, @Query("scope") scope: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const row = await this.col().findOne({ _id: id as any });
    if (!row) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    if (row.createdByUserId !== me) throw new HttpException("only the creator can edit", HttpStatus.FORBIDDEN);
    const b: any = body ?? {};
    const patch: Partial<ScheduleDoc> = {};
    if (typeof b.title === "string") {
      const v = b.title.trim();
      if (!v) throw new HttpException("title required", HttpStatus.BAD_REQUEST);
      if (v.length > MAX_TITLE) throw new HttpException("title too long", HttpStatus.BAD_REQUEST);
      patch.title = v;
    }
    if (typeof b.coach === "string") {
      const v = b.coach.trim();
      if (v.length > MAX_COACH) throw new HttpException("coach name too long", HttpStatus.BAD_REQUEST);
      patch.coach = v || "Coach";
    }
    if (typeof b.notes === "string") {
      const v = b.notes.trim();
      if (v.length > MAX_NOTES) throw new HttpException("notes too long", HttpStatus.BAD_REQUEST);
      patch.notes = v;
    }
    if (b.topics !== undefined) {
      const arr = Array.isArray(b.topics) ? b.topics : [];
      patch.topics = arr
        .map((t: unknown) => String(t ?? "").trim().slice(0, 40))
        .filter((t: string) => t.length > 0)
        .slice(0, 8);
    }
    if (b.durationMin != null) {
      patch.durationMin = Math.max(5, Math.min(600, Math.floor(Number(b.durationMin) || 60)));
    }
    // Invitees can be replaced (send [] to clear). Only apply when the caller
    // actually included the key — undefined means "leave the current list alone".
    if (b.invitees !== undefined) {
      const parsed = parseInvitees(b.invitees);
      patch.invitees = parsed.length ? parsed : [];
    }
    // reminderStages likewise — [] valid (disables all reminders), undefined =
    // leave alone. Unknown keys silently dropped so a client-side typo can't
    // wedge the row into an unrecognisable state.
    if (b.reminderStages !== undefined) {
      const arr = Array.isArray(b.reminderStages)
        ? Array.from(new Set(b.reminderStages.filter((s: unknown) => typeof s === "string" && ALLOWED_STAGES.has(s))))
        : DEFAULT_STAGES.slice();
      patch.reminderStages = arr as string[];
    }
    if (typeof b.autoSummary === "boolean") {
      patch.autoSummary = b.autoSummary;
    }
    if (typeof b.autoSummaryNote === "string") {
      patch.autoSummaryNote = b.autoSummaryNote.slice(0, 500);
    }
    if (Object.keys(patch).length === 0) return { ok: true, matched: 0 };
    if (scope === "series" && row.seriesId) {
      // Cascade to every FUTURE instance in the series (past instances stay as-is
      // so old attendance / recordings retain the title they were held under).
      const now = new Date();
      const r = await this.col().updateMany({ seriesId: row.seriesId, startAt: { $gte: now } }, { $set: patch });
      return { ok: true, matched: r.matchedCount ?? 0 };
    }
    await this.col().updateOne({ _id: id as any }, { $set: patch });
    return { ok: true, matched: 1 };
  }

  // DELETE /api/class/schedule/:id — coach-only cancel. Deletes the schedule row;
  // does NOT touch any recordings that may already exist for the room (those live
  // in a separate on-disk tree and remain accessible via their known filenames).
  @Delete(":id")
  async cancel(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const row = await this.col().findOne({ _id: id as any });
    if (!row) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    if (row.createdByUserId !== me) throw new HttpException("only the creator can cancel", HttpStatus.FORBIDDEN);
    await this.col().deleteOne({ _id: id as any });
    return { ok: true };
  }

  // DELETE /api/class/schedule/series/:sid — bulk cancel every FUTURE instance in
  // the series (past instances stay — they're history and may have recordings /
  // attendance rows). Coach-only. Returns how many were removed so the client can
  // show a "N cancelled" toast if it wants.
  @Delete("series/:sid")
  async cancelSeries(@Param("sid") sid: string, @Req() req: any) {
    if (!ROOM_RE.test(sid)) throw new HttpException("bad seriesId", HttpStatus.BAD_REQUEST);
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    // Verify ownership on any single doc in the series (they all share the same
    // creator by construction) before touching anything.
    const sample = await this.col().findOne({ seriesId: sid as any });
    if (!sample) throw new HttpException("series not found", HttpStatus.NOT_FOUND);
    if (sample.createdByUserId !== me) throw new HttpException("only the creator can cancel the series", HttpStatus.FORBIDDEN);
    const now = new Date();
    const r = await this.col().deleteMany({ seriesId: sid as any, startAt: { $gt: now } });
    return { ok: true, cancelled: r.deletedCount ?? 0 };
  }

  // GET /api/class/schedule/:id — single class detail. 404 when not found (either
  // never scheduled or an ad-hoc room that never created a schedule row).
  // Also 404 (not 403) when the caller isn't in this class's academy — same
  // shape as a missing row so no info-leak on which academies host what.
  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: any) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const row = await this.col().findOne({ _id: id as any });
    if (!row) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    if (row.academyId) {
      const myAcademy: string | null = req?.session?.academyId ?? null;
      if (myAcademy !== row.academyId) throw new HttpException("not found", HttpStatus.NOT_FOUND);
    }
    return row;
  }
}
