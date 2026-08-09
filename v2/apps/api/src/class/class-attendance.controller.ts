// Attendance list for a class — populated by class-ws.ts on WS join/leave and read
// here for display on the class page + coach's landing card.
//
// Auth: no user gate today. Anyone in the class (which is anyone with the URL) can
// see who's attended. The class URL is the shared secret; the panel is a nicer view
// of what Jitsi's participant list already shows live.
//
// Data (classAttendance collection): one doc per (classId, key) with
//   { classId, key, userId, name, joinedAt, lastSeenAt }
// Key = userId when signed in, "guest:<name>" otherwise. A rejoin updates
// lastSeenAt but preserves the original joinedAt.

import { Body, Controller, Get, Param, Post, Query, Req, Res, HttpException, HttpStatus } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";
type Response = any;

// Shape used by the escape helpers in this controller — same as the reminder
// service so the visual style stays consistent across coach → student emails.
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

const ROOM_RE = /^[A-Za-z0-9_-]{4,64}$/;

@Controller("class")
export class ClassAttendanceController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  // GET /api/class/coach/students — coach-only roster of every unique attendee
  // across the caller's classes. Aggregated on the fly (no separate rollup
  // collection to keep in sync). Sorted newest-first by lastSeen so the
  // people the coach is actively teaching float to the top.
  //
  // Query ?limit=N caps the row count client-side; default 500 is enough for
  // even a busy academy without paying the wire cost of a full unbounded scan.
  @Get("coach/students")
  async coachStudents(@Req() req: any, @Query("limit") limitRaw?: string) {
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const limit = Math.max(1, Math.min(2000, parseInt(String(limitRaw ?? "500"), 10) || 500));
    // 1) find every class the caller owns
    const owned: any[] = await this.conn.db!.collection("classSchedules")
      .find({ createdByUserId: me }, { projection: { _id: 1 } as any }).limit(2000).toArray();
    if (owned.length === 0) return { students: [] };
    const classIds = owned.map((c) => c._id);
    // 2) aggregate distinct attendees. Key = userId when signed in, else the
    //    "guest:<name>" pattern class-ws already stores. Same person joining
    //    with different guest names counts as different rows (there's no way
    //    to tell them apart post-hoc); logged-in users always collapse to one.
    const rows = await this.conn.db!.collection("classAttendance").aggregate([
      { $match: { classId: { $in: classIds } } },
      { $group: {
          _id: "$key",
          userId: { $last: "$userId" },
          name:   { $last: "$name" },
          classes: { $addToSet: "$classId" },
          firstSeen: { $min: "$joinedAt" },
          lastSeen:  { $max: "$lastSeenAt" },
        } },
      { $project: {
          _id: 0,
          userId: 1, name: 1,
          classesAttended: { $size: "$classes" },
          firstSeen: 1, lastSeen: 1,
        } },
      { $sort: { lastSeen: -1 } as any },
      { $limit: limit },
    ]).toArray();
    // Enrich signed-in rows with the student's email so the client can offer
    // "add to invitee list" bulk actions without a per-card lookup. Guests
    // don't have userIds → email stays null and the bulk action will skip
    // them with a visible reason.
    const userIds = rows.map((r: any) => r.userId).filter((u: any) => typeof u === "string" && u.length > 0);
    if (userIds.length) {
      const users = await this.conn.db!.collection("users")
        .find({ _id: { $in: userIds } as any }, { projection: { _id: 1, email: 1 } as any }).toArray();
      const emailByUid = new Map<string, string | null>(users.map((u: any) => [String(u._id), typeof u.email === "string" ? u.email : null]));
      for (const r of rows as any[]) {
        if (r.userId) r.email = emailByUid.get(r.userId) ?? null;
        else r.email = null;
      }
    } else {
      for (const r of rows as any[]) r.email = null;
    }
    return { students: rows };
  }

  // GET /api/class/coach/students/history?key=X — coach-only per-student
  // attendance history. Returns the list of THIS coach's classes the student
  // joined, with the class title / startAt + the student's joinedAt / lastSeenAt
  // per row. Sorted newest-first by class startAt. Restricted to classes the
  // caller owns so a student's activity in someone else's classes stays private.
  @Get("coach/students/history")
  async coachStudentHistory(@Req() req: any, @Query("key") keyRaw?: string) {
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const key = String(keyRaw ?? "").trim().slice(0, 200);
    if (!key) throw new HttpException("key required", HttpStatus.BAD_REQUEST);
    const owned: any[] = await this.conn.db!.collection("classSchedules")
      .find({ createdByUserId: me }, { projection: { _id: 1, title: 1, startAt: 1 } as any }).limit(2000).toArray();
    if (owned.length === 0) return { entries: [] };
    const classById = new Map<string, { title: string; startAt: Date }>(owned.map((c) => [String(c._id), { title: c.title, startAt: c.startAt }]));
    const rows: any[] = await this.conn.db!.collection("classAttendance")
      .find({ key, classId: { $in: owned.map((c) => c._id) } }).limit(1000).toArray();
    const entries = rows
      .map((r) => {
        const c = classById.get(String(r.classId));
        return c ? { classId: r.classId, title: c.title, startAt: c.startAt,
                     joinedAt: r.joinedAt, lastSeenAt: r.lastSeenAt } : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

    // Look up the student's email so we can pull their mail history. For
    // signed-in students it's a single users lookup; guests have no email so
    // mail history is naturally empty. Scoped to THIS coach's outgoing log
    // so we never leak another coach's messages.
    let mail: any[] = [];
    if (key.startsWith("guest:")) {
      mail = [];
    } else {
      const user: any = await this.conn.db!.collection("users").findOne(
        { _id: key as any }, { projection: { email: 1 } as any },
      );
      const email: string | null = user && typeof user.email === "string" ? user.email.toLowerCase() : null;
      if (email) {
        mail = await this.conn.db!.collection("classMailLog")
          .find({ coachId: me, to: email }, { sort: { at: -1 } as any })
          .limit(50).toArray();
      }
    }
    return { entries, mail: mail.map((m: any) => ({
      at: m.at, subject: m.subject, kind: m.kind ?? "adhoc",
      classId: m.classId ?? null,
      // Only the body of adhoc messages is exposed — reminder bodies are
      // auto-generated boilerplate the coach never wrote, so surfacing them
      // for "resend" would be more confusing than useful.
      body: (m.kind === "adhoc" && typeof m.body === "string") ? m.body : null,
      // Delivery status from the Resend webhook (sent / delivered / bounced /
      // complained / delayed / opened / clicked / send-failed). Older rows
      // predate this — treat missing as "sent" so the client can show a
      // neutral pill.
      status: typeof m.status === "string" ? m.status : "sent",
    })) };
  }

  // POST /api/class/coach/students/message — coach-only ad-hoc email to any
  // subset of the caller's roster. Recipients are server-verified against the
  // caller's own classAttendance rows so this endpoint can't be used as a
  // spam relay to arbitrary addresses.
  //
  // Body: { subject: string, message: string (plain text), recipients: string[] }
  // Returns: { ok, sent, skipped, invalid } — coach's UI can show a toast.
  @Post("coach/students/message")
  async coachMessage(@Req() req: any, @Body() body: unknown) {
    const me: string | null = req?.session?.userId ?? null;
    const meName: string | null = req?.session?.username ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const b: any = body ?? {};
    const subject = String(b.subject ?? "").trim().slice(0, 160);
    const message = String(b.message ?? "").trim().slice(0, 5000);
    const asked: string[] = Array.isArray(b.recipients)
      ? b.recipients.filter((r: unknown) => typeof r === "string").map((r: string) => r.trim().toLowerCase())
      : [];
    if (!subject) throw new HttpException("subject required", HttpStatus.BAD_REQUEST);
    if (!message) throw new HttpException("message required", HttpStatus.BAD_REQUEST);
    if (asked.length === 0) throw new HttpException("recipients required", HttpStatus.BAD_REQUEST);
    if (asked.length > 200) throw new HttpException("too many recipients", HttpStatus.BAD_REQUEST);

    // Build the set of emails legitimately in the coach's roster (any email
    // ever attached to a user who joined one of the coach's classes).
    const owned: any[] = await this.conn.db!.collection("classSchedules")
      .find({ createdByUserId: me }, { projection: { _id: 1 } as any }).limit(2000).toArray();
    if (owned.length === 0) throw new HttpException("no roster", HttpStatus.FORBIDDEN);
    const classIds = owned.map((c) => c._id);
    const attRows: any[] = await this.conn.db!.collection("classAttendance")
      .find({ classId: { $in: classIds } }, { projection: { userId: 1 } as any }).limit(5000).toArray();
    const uids = Array.from(new Set(attRows.map((r) => r.userId).filter((u: unknown) => typeof u === "string")));
    const users: any[] = uids.length
      ? await this.conn.db!.collection("users").find({ _id: { $in: uids } as any }, { projection: { email: 1 } as any }).toArray()
      : [];
    const allowed = new Set<string>();
    for (const u of users) if (typeof u.email === "string") allowed.add(u.email.toLowerCase());

    const toSend: string[] = [];
    const skipped: string[] = [];
    const invalid: string[] = [];
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seen = new Set<string>();
    for (const raw of asked) {
      if (!emailRe.test(raw)) { invalid.push(raw); continue; }
      if (seen.has(raw)) continue;
      seen.add(raw);
      if (!allowed.has(raw)) { skipped.push(raw); continue; }   // not in roster
      toSend.push(raw);
    }
    if (toSend.length === 0) return { ok: true, sent: 0, skipped: skipped.length, invalid: invalid.length };

    const coachName = meName || "your coach";
    const bodyText = `${message}\n\n— ${coachName} (via ChessGuru)`;
    const bodyHtml = `
      <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:520px">
        <div style="background:linear-gradient(135deg,#6d28d9,#4338ca);color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.75">Message from your coach</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">${escapeHtml(subject)}</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:20px 24px;border-radius:0 0 12px 12px">
          <p style="font-size:14px;color:#374151;white-space:pre-wrap;margin:0">${escapeHtml(message)}</p>
          <p style="font-size:12px;color:#6b7280;margin:20px 0 0">— ${escapeHtml(coachName)} (via ChessGuru)</p>
        </div>
      </div>`;
    // Send + capture per-recipient Resend id so the webhook can later match
    // delivered/bounced events back to the right log row. We wait for the
    // sends here (parallel) rather than fire-and-forget so we HAVE the ids
    // to persist — a bit more latency in the response, worth it for the
    // compliance log the coach relies on.
    const sendResults = await Promise.all(
      toSend.map((to) => sendMail({ to, subject, html: bodyHtml, text: bodyText })
        .then((r) => ({ to, id: r.ok ? r.id : undefined }))),
    );
    const now = new Date();
    // Adhoc rows carry the body so the coach can click a past message and
    // resend a tweaked copy. Reminder rows don't need this (auto-generated).
    // Body is capped upstream at 5000 chars, so persisting is a bounded cost.
    this.conn.db!.collection("classMailLog").insertMany(
      sendResults.map((r) => ({
        at: now, coachId: me, to: r.to, subject, body: message,
        kind: "adhoc", classId: null,
        resendId: r.id ?? null,
        status: r.id ? "sent" : "send-failed",
      })),
    ).catch(() => { /* silent */ });
    return { ok: true, sent: toSend.length, skipped: skipped.length, invalid: invalid.length };
  }

  // GET /api/class/coach/students.csv — coach-only bulk roster export. Same
  // rows as /coach/students but flattened as CSV for archive / academy roll-up.
  @Get("coach/students.csv")
  async coachStudentsCsv(@Req() req: any, @Res() res: Response) {
    const me: string | null = req?.session?.userId ?? null;
    if (!me) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const owned: any[] = await this.conn.db!.collection("classSchedules")
      .find({ createdByUserId: me }, { projection: { _id: 1 } as any }).limit(2000).toArray();
    if (owned.length === 0) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="my-students.csv"`);
      return res.send("userId,name,classesAttended,firstSeen,lastSeen\n");
    }
    const rows = await this.conn.db!.collection("classAttendance").aggregate([
      { $match: { classId: { $in: owned.map((c) => c._id) } } },
      { $group: {
          _id: "$key",
          userId: { $last: "$userId" },
          name:   { $last: "$name" },
          classes: { $addToSet: "$classId" },
          firstSeen: { $min: "$joinedAt" },
          lastSeen:  { $max: "$lastSeenAt" },
        } },
      { $sort: { lastSeen: -1 } as any },
    ]).toArray();
    // RFC 4180 style — quote fields with commas / quotes / newlines, escape " as "".
    const q = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ["userId,name,classesAttended,firstSeen,lastSeen"];
    for (const r of rows as any[]) {
      lines.push([q(r.userId ?? ""), q(r.name ?? "Guest"),
                  q(Array.isArray(r.classes) ? r.classes.length : 0),
                  q(new Date(r.firstSeen).toISOString()),
                  q(r.lastSeen ? new Date(r.lastSeen).toISOString() : "")].join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="my-students.csv"`);
    res.send(lines.join("\n"));
  }

  // GET /api/class/:id/attendance — sorted by joinedAt asc so the display reads
  // as an arrival order. Anonymous joiners have userId: null.
  @Get(":id/attendance")
  async list(@Param("id") id: string) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const col = this.conn.db!.collection("classAttendance");
    const rows = await col.find({ classId: id }, { sort: { joinedAt: 1 } as any }).limit(500).toArray();
    return { attendees: rows.map((r: any) => ({
      userId: r.userId ?? null, name: r.name ?? "Guest",
      joinedAt: r.joinedAt, lastSeenAt: r.lastSeenAt,
    })) };
  }

  // GET /api/class/:id/attendance.csv — coach-only download. Gated to the class's
  // schedule creator (or any request when no schedule row exists at all — that's
  // an ad-hoc room where nobody "owns" the class). Renders as a CSV so a coach
  // can archive or forward to parents / a management system.
  @Get(":id/attendance.csv")
  async csv(@Param("id") id: string, @Req() req: any, @Res() res: Response) {
    if (!ROOM_RE.test(id)) throw new HttpException("bad room", HttpStatus.BAD_REQUEST);
    const sched = await this.conn.db!.collection("classSchedules").findOne({ _id: id as any });
    if (sched && sched.createdByUserId) {
      const me: string | null = req?.session?.userId ?? null;
      if (!me || me !== sched.createdByUserId) throw new HttpException("only the class creator can export", HttpStatus.FORBIDDEN);
    }
    const rows: any[] = await this.conn.db!.collection("classAttendance")
      .find({ classId: id }, { sort: { joinedAt: 1 } as any }).limit(5000).toArray();
    // Quote every field that could contain a comma/quote/newline; escape internal
    // quotes by doubling per RFC 4180. Keeps Excel/Sheets happy even when a coach
    // signed up with a comma in their name.
    const q = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ["userId,name,joinedAt,lastSeenAt"];
    for (const r of rows) {
      lines.push([q(r.userId ?? ""), q(r.name ?? "Guest"), q(new Date(r.joinedAt).toISOString()), q(r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : "")].join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-${id}.csv"`);
    res.send(lines.join("\n"));
  }
}
