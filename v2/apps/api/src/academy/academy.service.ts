// Academy-tenant operations: coach invitations (P0 of the SaaS Q1 slice).
//
// Invite → emailed link → coach signs up as user with role='coach', academyId=<inviter's>.
//
// Storage: `academyInvites` collection
//   { _id: <token>, academyId, invitedBy (userId), email, displayName, role,
//     createdAt, expiresAt, consumedAt?, consumedByUserId? }
// Token is 32-byte URL-safe random (single-use, opaque). We never hash it —
// this is a one-time signup link (unlike a password reset) and the whole
// point is that possession of the URL = right to become that role.

import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { sendMail } from "../lib/mail";

const INVITE_TTL_DAYS = 7;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => (
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string)));

@Injectable()
export class AcademyService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private invites() { return this.conn.db!.collection("academyInvites"); }
  private users()   { return this.conn.db!.collection("users"); }
  private academies(){return this.conn.db!.collection("academies"); }

  /** Owner-only guard: session must have role=academy_owner + academyId. */
  private ensureOwner(session: any): { academyId: string; userId: string; username: string } {
    const role = session?.role;
    const academyId = session?.academyId;
    const userId = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    if (role !== "academy_owner" || !academyId) throw new ForbiddenException("academy owner only");
    return { academyId, userId, username: session.username || userId };
  }

  /** Owner-or-coach guard: session must have role in {academy_owner, coach} + academyId. */
  private ensureCoachOrOwner(session: any): { academyId: string; userId: string; username: string; role: "academy_owner"|"coach" } {
    const role = session?.role;
    const academyId = session?.academyId;
    const userId = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    if ((role !== "academy_owner" && role !== "coach") || !academyId) throw new ForbiddenException("owner or coach only");
    return { academyId, userId, username: session.username || userId, role };
  }

  /** Create + email an invite for a coach OR student to join the caller's academy.
   *  Coach path: only academy_owner can create.
   *  Student path: owner OR coach can create. When an owner invites a student, they
   *  must supply `coachId` (the target coach in this academy). When a coach invites a
   *  student, `coachId` is auto-forced to the caller. */
  async createInvite(session: any, body: any) {
    const email = String(body?.email || "").trim().toLowerCase();
    const displayName = String(body?.displayName || "").trim().slice(0, 60);
    const wantRole = body?.role === "student" ? "student" : "coach";
    if (!email || !email.includes("@")) return { ok: false, error: "Valid email required." };

    // Authz + coachId resolution
    let academyId: string, userId: string, username: string;
    let coachId: string | null = null;
    if (wantRole === "coach") {
      ({ academyId, userId, username } = this.ensureOwner(session));
    } else {
      const g = this.ensureCoachOrOwner(session);
      academyId = g.academyId; userId = g.userId; username = g.username;
      if (g.role === "coach") {
        coachId = g.userId;
      } else {
        // owner-invite must specify a coach in this academy
        const requestedCoach = String(body?.coachId || "").trim().toLowerCase();
        if (!requestedCoach) return { ok: false, error: "Pick a coach for this student." };
        const coach = await this.users().findOne({ _id: requestedCoach as any, academyId, role: "coach" });
        if (!coach) return { ok: false, error: "That coach isn't in this academy." };
        coachId = requestedCoach;
      }
    }

    // No duplicate active invite for the same (email, academy). Consumed ones don't count.
    const existing = await this.invites().findOne({ academyId, email, consumedAt: { $exists: false } });
    if (existing) return { ok: false, error: "That email already has a pending invite for this academy." };
    const alreadyMember = await this.users().findOne({ email, academyId });
    if (alreadyMember) return { ok: false, error: "That email is already a member of this academy." };

    const token = randomBytes(24).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const acad: any = await this.academies().findOne({ _id: academyId as any });
    const academyName = acad?.name || academyId;

    await this.invites().insertOne({
      _id: token as any,
      academyId, academyName,
      invitedBy: userId, invitedByName: username,
      email, displayName, role: wantRole,
      ...(coachId ? { coachId } : {}),
      createdAt: now, expiresAt,
    });

    const publicUrl = (process.env.PUBLIC_URL || "https://harinitharanjith.com").replace(/\/+$/, "");
    const link = `${publicUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    const roleWord = wantRole === "student" ? "student" : "coach";
    const subject = `You're invited to ${academyName} on ChessGuru`;
    const text = [
      `${username} invited you to join ${academyName} as a ${roleWord} on ChessGuru.`,
      "",
      `Accept the invitation and set your password: ${link}`,
      "",
      `This link is valid for ${INVITE_TTL_DAYS} days. If you didn't expect this email, you can ignore it.`,
    ].join("\n");
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px">
        <h2 style="color:#111">You're invited to <b>${escHtml(academyName)}</b> on ChessGuru</h2>
        <p><b>${escHtml(username)}</b> invited you to join as a <b>${escHtml(roleWord)}</b>.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">Accept & set your password</a></p>
        <p style="color:#666;font-size:13px">Or paste this link in your browser:<br/><a href="${link}">${escHtml(link)}</a></p>
        <p style="color:#999;font-size:12px">This link is valid for ${INVITE_TTL_DAYS} days. If you didn't expect this, just ignore it.</p>
      </div>`;

    const mailRes = await sendMail({ to: email, subject, html, text });
    return { ok: true, invite: { token, email, displayName, role: wantRole, coachId, expiresAt, mail: mailRes.ok ? "sent" : "failed" } };
  }

  /** Owner OR coach: list students in this academy. Owner sees ALL; coach sees theirs.
   *  Enriches each row with:
   *    - puzzleRating (from userperfs.puzzle.gl.r)
   *    - attendedTotal + attendedThisWeek + lastAttendedAt (from classAttendance) */
  async listStudents(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { academyId: g.academyId, role: "student" };
    if (g.role === "coach") filter.coachId = g.userId;
    const rows = await this.users()
      .find(filter, { projection: { _id: 1, username: 1, email: 1, coachId: 1, createdAt: 1, lastLogin: 1, dailyPuzzleStreak: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    if (rows.length === 0) return [];
    const ids = rows.map((r: any) => r._id);

    // Puzzle-rating snapshot
    const perfs = await this.conn.db!.collection("userperfs")
      .find({ _id: { $in: ids } }, { projection: { _id: 1, puzzle: 1 } }).toArray();
    const rmap: Record<string, number> = {};
    for (const p of perfs as any[]) rmap[String(p._id)] = Math.round(p?.puzzle?.gl?.r ?? 1500);

    // Attendance rollup — one aggregation for count/lastAt/thisWeek + a small
    // 30-day heatmap array per student (booleans for each of the last 30 days).
    const now = new Date();
    const weekStart = new Date(now); weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    const dayMs = 24 * 60 * 60 * 1000;
    const heatStart = new Date(now.getTime() - 29 * dayMs);
    heatStart.setUTCHours(0, 0, 0, 0);
    const attRows: any[] = await this.conn.db!.collection("classAttendance").aggregate([
      { $match: { userId: { $in: ids } } },
      { $group: {
        _id: "$userId",
        attendedTotal: { $sum: 1 },
        lastAttendedAt: { $max: "$joinedAt" },
        attendedThisWeek: { $sum: { $cond: [{ $gte: ["$joinedAt", weekStart] }, 1, 0] } },
        // Collect every joinedAt from the last 30 days — client bucketing per day.
        recent: { $push: { $cond: [{ $gte: ["$joinedAt", heatStart] }, "$joinedAt", null] } },
      } },
    ]).toArray();
    const heatFor = (recent: any[]): boolean[] => {
      const strip = new Array<boolean>(30).fill(false);
      for (const d of recent || []) {
        if (!d) continue;
        const t = new Date(d).getTime();
        const dayIdx = Math.floor((t - heatStart.getTime()) / dayMs);
        if (dayIdx >= 0 && dayIdx < 30) strip[dayIdx] = true;
      }
      return strip;
    };
    const amap: Record<string, { attendedTotal: number; attendedThisWeek: number; lastAttendedAt: Date | null; attendance30d: boolean[] }> = {};
    for (const a of attRows) amap[String(a._id)] = {
      attendedTotal: a.attendedTotal ?? 0,
      attendedThisWeek: a.attendedThisWeek ?? 0,
      lastAttendedAt: a.lastAttendedAt ?? null,
      attendance30d: heatFor(a.recent),
    };

    // Phase 8e: puzzle activity per student — solves in the last 7d + most
    // recent solve timestamp. One aggregation for the whole roster: split the
    // rounds._id prefix (userId:puzzleId) and group by userId. This scans
    // rounds by the compound (d, _id) predicate; at academy scale (dozens of
    // students) it's cheap even without a per-user index.
    const weekAgo = new Date(now.getTime() - 7 * dayMs);
    const puzzleRows: any[] = await this.conn.db!.collection("rounds").aggregate([
      { $match: { d: { $gte: weekAgo } } },
      { $project: {
          u: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] },
          d: 1,
      } },
      { $match: { u: { $in: ids } } },
      { $group: { _id: "$u", solves7d: { $sum: 1 }, lastPuzzleAt: { $max: "$d" } } },
    ]).toArray();
    const pmap: Record<string, { solves7d: number; lastPuzzleAt: Date | null }> = {};
    for (const p of puzzleRows) pmap[String(p._id)] = { solves7d: p.solves7d ?? 0, lastPuzzleAt: p.lastPuzzleAt ?? null };

    // Fees rollup — sum of pending invoice amounts + oldest pending period
    // per student. One aggregation for all students in this response.
    const feeRows: any[] = await this.conn.db!.collection("feeInvoices").aggregate([
      { $match: { studentId: { $in: ids }, status: "pending", academyId: g.academyId } },
      { $group: { _id: "$studentId", pendingFeesPaise: { $sum: "$amountPaise" }, oldestPendingPeriod: { $min: "$period" } } },
    ]).toArray();
    const fmap: Record<string, { pendingFeesPaise: number; oldestPendingPeriod: string }> = {};
    for (const f of feeRows) fmap[String(f._id)] = { pendingFeesPaise: f.pendingFeesPaise ?? 0, oldestPendingPeriod: f.oldestPendingPeriod ?? "" };

    // Compute "alive" daily streak the same way the puzzles service does —
    // current is 0 when lastDate is older than yesterday, so the coach sees a
    // truthful "how consistent is this student RIGHT NOW" number.
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
    const aliveStreak = (s: any): { current: number; longest: number } => {
      const st = s?.dailyPuzzleStreak;
      if (!st) return { current: 0, longest: 0 };
      const alive = st.lastDate === today || st.lastDate === yesterday;
      return { current: alive ? (st.current || 0) : 0, longest: st.longest || 0 };
    };

    return rows.map((s: any) => {
      const streak = aliveStreak(s);
      return {
        ...s,
        puzzleRating: rmap[String(s._id)] ?? 1500,
        attendedTotal:    amap[String(s._id)]?.attendedTotal    ?? 0,
        attendedThisWeek: amap[String(s._id)]?.attendedThisWeek ?? 0,
        lastAttendedAt:   amap[String(s._id)]?.lastAttendedAt   ?? null,
        attendance30d:    amap[String(s._id)]?.attendance30d    ?? new Array<boolean>(30).fill(false),
        pendingFeesPaise:      fmap[String(s._id)]?.pendingFeesPaise      ?? 0,
        oldestPendingPeriod:   fmap[String(s._id)]?.oldestPendingPeriod   ?? null,
        // Phase 8e: puzzle-engagement snapshot for the coach view.
        puzzleSolves7d: pmap[String(s._id)]?.solves7d ?? 0,
        lastPuzzleAt:   pmap[String(s._id)]?.lastPuzzleAt ?? null,
        dailyStreakCurrent: streak.current,
        dailyStreakLongest: streak.longest,
      };
    });
  }

  /** Pending invites (not consumed, not expired). Owner sees ALL; coach sees theirs only. */
  async listInvites(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const now = new Date();
    const filter: any = { academyId: g.academyId, consumedAt: { $exists: false }, expiresAt: { $gt: now } };
    if (g.role === "coach") filter.invitedBy = g.userId;
    const rows = await this.invites().find(filter).sort({ createdAt: -1 }).toArray();
    return rows.map((r: any) => ({
      token: r._id, email: r.email, displayName: r.displayName,
      role: r.role, coachId: r.coachId ?? null,
      createdAt: r.createdAt, expiresAt: r.expiresAt,
      invitedByName: r.invitedByName,
    }));
  }

  /** Revoke a pending invite. Owner can revoke ANY invite in their academy;
   *  coach can only revoke invites they created. */
  async revokeInvite(session: any, token: string) {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { _id: token as any, academyId: g.academyId, consumedAt: { $exists: false } };
    if (g.role === "coach") filter.invitedBy = g.userId;
    const r = await this.invites().deleteOne(filter);
    return { ok: r.deletedCount === 1 };
  }

  /** Owner-only: current coaches (users with role=coach in this academy). */
  async listCoaches(session: any) {
    const { academyId } = this.ensureOwner(session);
    const rows = await this.users()
      .find({ academyId, role: "coach" }, { projection: { _id: 1, username: 1, email: 1, createdAt: 1, lastLogin: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    return rows;
  }

  /** PUBLIC — fetch invite metadata for the accept page (validate token, expiry).
   *  Does NOT consume the invite. Returns friendly error codes so the client can
   *  render an appropriate splash (expired, unknown, already-used). */
  async peekInvite(token: string) {
    if (!token || typeof token !== "string" || token.length < 20) return { ok: false, error: "invalid_token" };
    const row: any = await this.invites().findOne({ _id: token as any });
    if (!row) return { ok: false, error: "not_found" };
    if (row.consumedAt) return { ok: false, error: "already_used" };
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return { ok: false, error: "expired" };
    return {
      ok: true,
      invite: {
        email: row.email,
        displayName: row.displayName,
        role: row.role,
        academyId: row.academyId,
        academyName: row.academyName,
        invitedByName: row.invitedByName,
        expiresAt: row.expiresAt,
      },
    };
  }

  /** PUBLIC — accept an invite: create the user, mark invite consumed, set session.
   *  Called from AuthController so we can mutate the session. */
  async consumeInvite(token: string, username: string, password: string): Promise<
    { ok: true; user: { _id: string; username: string; academyId: string; role: string } } |
    { ok: false; error: string }
  > {
    const peek = await this.peekInvite(token);
    if (!peek.ok) return peek as { ok: false; error: string };
    const inv = peek.invite!;   // narrowed by peek.ok===true; TS can't see through the union

    if (!username || !/^[a-zA-Z0-9_-]{2,30}$/.test(username)) return { ok: false, error: "Username must be 2-30 chars (letters, numbers, _ or -)." };
    if (!password || String(password).length < 6) return { ok: false, error: "Password too short (min 6 chars)." };

    const uid = username.toLowerCase();
    if (await this.users().findOne({ _id: uid as any })) return { ok: false, error: "That username is taken." };
    // No global-email uniqueness — an email can legitimately belong to several people
    // in different families/academies. But warn if THIS email is already in THIS academy.
    if (await this.users().findOne({ email: inv.email, academyId: inv.academyId })) {
      return { ok: false, error: "That email is already a member of this academy." };
    }

    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash(password, 10);
    const now = new Date();
    // For student invites, the invite row carries the assigned coachId — copy it
    // onto the new user doc so /view-as authz and coach rosters both work.
    const inviteDoc: any = await this.invites().findOne({ _id: token as any });
    const coachId = inviteDoc?.coachId ?? null;
    const userDoc: any = {
      _id: uid,
      username,
      bpass: hash,
      email: inv.email,
      academyId: inv.academyId,
      role: inv.role,
      createdAt: now, lastLogin: now,
    };
    if (coachId) userDoc.coachId = coachId;
    await this.users().insertOne(userDoc);
    await this.invites().updateOne(
      { _id: token as any },
      { $set: { consumedAt: now, consumedByUserId: uid } },
    );
    return { ok: true, user: { _id: uid, username, academyId: inv.academyId, role: inv.role } };
  }

  /* ================================================================
   * Fees + billing (P0 — manual/offline). No Razorpay: the owner sets
   * their UPI VPA once, parents scan a UPI QR to pay directly, owner
   * marks the invoice paid after seeing the bank credit.
   *
   * Data model:
   *   academies.monthlyFeePaise         — default fee per student per month
   *   academies.upiVpa                  — e.g. "coach@ybl"
   *   academies.upiPayeeName            — display name in UPI app
   *   feeInvoices._id = <academyId>:<studentId>:<YYYY-MM> (idempotent)
   *   feeInvoices: { academyId, studentId, period, amountPaise,
   *                  status: "pending"|"paid"|"waived",
   *                  generatedAt, paidAt?, paidBy?, paymentMethod?,
   *                  waivedAt?, waivedBy?, note? }
   * ================================================================ */

  private invoices() { return this.conn.db!.collection("feeInvoices"); }
  private currentPeriod() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  async getFeesConfig(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const a: any = await this.academies().findOne({ _id: g.academyId as any });
    return {
      monthlyFeePaise: a?.monthlyFeePaise ?? 0,
      upiVpa:          a?.upiVpa ?? "",
      upiPayeeName:    a?.upiPayeeName ?? a?.name ?? "",
      canEdit:         g.role === "academy_owner",
    };
  }

  async setFeesConfig(session: any, body: any) {
    const { academyId } = this.ensureOwner(session);
    const raw = body ?? {};
    const monthlyFeePaise = Math.max(0, Math.min(1_00_00_00_00, Math.floor(Number(raw.monthlyFeePaise) || 0)));
    const upiVpa = String(raw.upiVpa || "").trim().toLowerCase();
    const upiPayeeName = String(raw.upiPayeeName || "").trim().slice(0, 80);
    // Very loose VPA validation — real UPI accepts a lot; block obvious garbage.
    if (upiVpa && !/^[a-z0-9._-]{2,50}@[a-z0-9.-]{2,40}$/.test(upiVpa)) {
      return { ok: false, error: "UPI VPA looks wrong (should be name@bank)." };
    }
    await this.academies().updateOne(
      { _id: academyId as any },
      { $set: { monthlyFeePaise, upiVpa, upiPayeeName } },
    );
    return { ok: true, monthlyFeePaise, upiVpa, upiPayeeName };
  }

  /** Generate this month's invoices for every student in the academy. Idempotent —
   *  the (academy,student,period) tuple is the _id, so re-running does nothing. */
  async generateInvoices(session: any) {
    const { academyId } = this.ensureOwner(session);
    const a: any = await this.academies().findOne({ _id: academyId as any });
    const fee = a?.monthlyFeePaise ?? 0;
    if (fee <= 0) return { ok: false, error: "Set a monthly fee amount first." };
    const period = this.currentPeriod();
    const students: any[] = await this.users()
      .find({ academyId, role: "student" }, { projection: { _id: 1, username: 1 } }).toArray();
    if (students.length === 0) return { ok: true, generated: 0, period, note: "No students yet." };

    const now = new Date();
    const dueDate = new Date(now.getUTCFullYear(), now.getUTCMonth(), 10);   // 10th of the month
    const docs = students.map((s) => ({
      _id: `${academyId}:${s._id}:${period}`,
      academyId, studentId: String(s._id), period,
      amountPaise: fee, status: "pending",
      generatedAt: now, dueDate,
    }));
    // insertMany with ordered:false so pre-existing rows (idempotent runs) don't
    // abort the batch — Mongo silently skips duplicates when we ignore the error.
    try {
      await this.invoices().insertMany(docs as any, { ordered: false });
    } catch (err: any) {
      // Duplicate-key errors are expected on re-runs; anything else propagates.
      const isDupOnly = err?.code === 11000 || err?.writeErrors?.every?.((w: any) => w?.code === 11000);
      if (!isDupOnly) throw err;
    }
    const nowPending = await this.invoices().countDocuments({ academyId, period, status: "pending" });
    return { ok: true, generated: docs.length, period, pendingCount: nowPending };
  }

  /** List invoices in caller's scope. Owner=all; coach=their students' only. */
  async listInvoices(session: any, filter: { status?: "pending"|"paid"|"waived"; period?: string } = {}) {
    const g = this.ensureCoachOrOwner(session);
    const q: any = { academyId: g.academyId };
    if (filter.status) q.status = filter.status;
    if (filter.period) q.period = filter.period;
    if (g.role === "coach") {
      const myStudents = await this.users()
        .find({ academyId: g.academyId, role: "student", coachId: g.userId }, { projection: { _id: 1 } })
        .toArray();
      q.studentId = { $in: myStudents.map((s: any) => String(s._id)) };
    }
    const rows = await this.invoices().find(q).sort({ period: -1, studentId: 1 }).limit(500).toArray();
    // Attach student username for display
    const uids = Array.from(new Set(rows.map((r: any) => String(r.studentId))));
    const users = await this.users().find({ _id: { $in: uids as any } }, { projection: { _id: 1, username: 1 } }).toArray();
    const uname: Record<string, string> = {};
    for (const u of users as any[]) uname[String(u._id)] = u.username;
    return rows.map((r: any) => ({ ...r, studentUsername: uname[String(r.studentId)] || r.studentId }));
  }

  async markPaid(session: any, invoiceId: string, body: any) {
    const { academyId, userId } = this.ensureOwner(session);
    const method = body?.paymentMethod === "upi" ? "upi" : "manual";
    const note = String(body?.note || "").slice(0, 200);
    const r = await this.invoices().updateOne(
      { _id: invoiceId as any, academyId, status: "pending" },
      { $set: { status: "paid", paidAt: new Date(), paidBy: userId, paymentMethod: method, ...(note ? { note } : {}) } },
    );
    if (r.matchedCount === 0) return { ok: false, error: "Invoice not found or already paid." };
    return { ok: true };
  }

  async waiveInvoice(session: any, invoiceId: string, body: any) {
    const { academyId, userId } = this.ensureOwner(session);
    const note = String(body?.note || "").slice(0, 200);
    const r = await this.invoices().updateOne(
      { _id: invoiceId as any, academyId, status: "pending" },
      { $set: { status: "waived", waivedAt: new Date(), waivedBy: userId, ...(note ? { note } : {}) } },
    );
    if (r.matchedCount === 0) return { ok: false, error: "Invoice not found or already resolved." };
    return { ok: true };
  }

  /* ================================================================
   * Post-class summary (rule-based today; Claude-polish comes when
   * ANTHROPIC_API_KEY lands in env). Given a scheduled class, computes
   * per-student attendance + puzzles solved during the class window
   * and emails each attendee a personal summary via dw-otp.
   * ================================================================ */
  async sendClassSummary(session: any, classId: string, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const note = String(body?.note || "").slice(0, 500);

    const sched: any = await this.conn.db!.collection("classSchedules").findOne({ _id: classId as any });
    if (!sched) return { ok: false, error: "Class not found." };
    if (sched.academyId && sched.academyId !== g.academyId) return { ok: false, error: "Class not in your academy." };
    if (g.role === "coach" && sched.createdByUserId !== g.userId) return { ok: false, error: "Only the class creator can send this." };

    const start = new Date(sched.startAt);
    const end = new Date(start.getTime() + (sched.durationMin || 60) * 60_000);
    const winStart = new Date(start.getTime() - 15 * 60_000);   // count joins 15m early too

    // Attendees during the class window (skip guests — no email to send to)
    const attendees: any[] = await this.conn.db!.collection("classAttendance").find({
      classId, joinedAt: { $gte: winStart, $lte: new Date(end.getTime() + 30 * 60_000) },
      userId: { $ne: null },
    }).toArray();
    if (attendees.length === 0) return { ok: true, sent: 0, note: "No signed-in attendees to email." };

    // Enrich each attendee with their email + puzzle-solve tally during the window
    const uids = attendees.map((a: any) => String(a.userId));
    const users: any[] = await this.users().find({ _id: { $in: uids as any } },
      { projection: { _id: 1, username: 1, email: 1 } }).toArray();
    const umap: Record<string, any> = {};
    for (const u of users) umap[String(u._id)] = u;

    // Puzzles solved by each user during the window (rounds._id = "<userId>:<puzzleId>")
    // Use $regex on _id — collection is small enough per user that this is fine for MVP.
    const puzzleCounts: Record<string, { total: number; wins: number }> = {};
    for (const uid of uids) {
      const rows: any[] = await this.conn.db!.collection("rounds").find({
        _id: { $gte: `${uid}:`, $lt: `${uid};` } as any,
        d: { $gte: winStart, $lte: new Date(end.getTime() + 30 * 60_000) },
      }, { projection: { w: 1 } }).toArray();
      puzzleCounts[uid] = { total: rows.length, wins: rows.filter((r: any) => r.w).length };
    }

    // Send one email per attendee (idempotent per-recipient; failures don't stop the batch)
    const acadName: string = sched.title || `Class ${classId}`;
    const dateStr = start.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    let sent = 0, failed = 0;
    for (const a of attendees) {
      const uid = String(a.userId);
      const u = umap[uid];
      if (!u?.email) continue;
      const p = puzzleCounts[uid] || { total: 0, wins: 0 };
      const winRate = p.total ? Math.round((p.wins / p.total) * 100) : null;
      const subject = `Class summary: ${acadName} — ${dateStr}`;
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:520px">
          <h2 style="color:#111;margin-bottom:4px">${escHtml(acadName)}</h2>
          <p style="color:#666;margin-top:0">${escHtml(dateStr)} · ${sched.durationMin || 60} min · Coach: ${escHtml(sched.coach || "")}</p>
          <p>Hi <b>${escHtml(u.username)}</b> — here's your recap.</p>
          <ul style="line-height:1.7">
            <li>You attended <b>${sched.durationMin || 60}m</b> of the class.</li>
            <li>Puzzles solved during class: <b>${p.total}</b>${winRate !== null ? ` (win rate <b>${winRate}%</b>)` : ""}.</li>
          </ul>
          ${note ? `<div style="border-left:3px solid #2563eb;padding:8px 12px;background:#f0f7ff;margin:16px 0"><b>Note from your coach:</b><br/>${escHtml(note)}</div>` : ""}
          <p style="color:#666;font-size:13px">Keep it up! Log in at <a href="https://harinitharanjith.com">ChessGuru</a> to see your full history.</p>
        </div>`;
      const text = [
        `${acadName} — ${dateStr}`, "",
        `Hi ${u.username} — here's your recap.`, "",
        `- Class duration: ${sched.durationMin || 60}m`,
        `- Puzzles solved during class: ${p.total}${winRate !== null ? ` (win rate ${winRate}%)` : ""}`,
        note ? `\nNote from your coach: ${note}` : "",
        "",
        "Keep it up! https://harinitharanjith.com",
      ].join("\n");
      const r = await sendMail({ to: u.email, subject, html, text });
      if (r.ok) sent++; else failed++;
    }
    return { ok: true, sent, failed, attendees: attendees.length };
  }

  /** Owner OR coach: list recording files across the academy's classes.
   *  Owner sees every scheduled class in the academy; coach sees only classes
   *  they created. Reads the on-disk RECORDINGS_DIR/<classId>/*.webm tree. */
  async listRecordings(session: any, limit = 100) {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { academyId: g.academyId };
    if (g.role === "coach") filter.createdByUserId = g.userId;
    const classes: any[] = await this.conn.db!.collection("classSchedules")
      .find(filter, { projection: { _id: 1, title: 1, startAt: 1 } })
      .sort({ startAt: -1 }).limit(200).toArray();
    if (classes.length === 0) return [];

    const dir = process.env.CLASS_RECORDINGS_DIR ?? "/home/ubuntu/chessguru-recordings";
    const fs = await import("fs/promises");
    const path = await import("path");
    const out: Array<{ classId: string; title: string; startAt: Date; filename: string; bytes: number; createdAt: Date }> = [];
    for (const c of classes) {
      const classDir = path.join(dir, String(c._id));
      let entries: string[] = [];
      try { entries = await fs.readdir(classDir); } catch { continue; }
      for (const name of entries) {
        if (!/\.webm$/i.test(name)) continue;
        try {
          const st = await fs.stat(path.join(classDir, name));
          out.push({ classId: String(c._id), title: c.title || c._id, startAt: c.startAt, filename: name, bytes: st.size, createdAt: st.mtime });
        } catch { /* skip unreadable */ }
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  }

  /** Owner OR coach: list classSnaps rows across the academy's classes.
   *  Same authz shape as listRecordings — coach sees theirs only. */
  async listSnaps(session: any, limit = 100) {
    const g = this.ensureCoachOrOwner(session);
    const classFilter: any = { academyId: g.academyId };
    if (g.role === "coach") classFilter.createdByUserId = g.userId;
    const classes: any[] = await this.conn.db!.collection("classSchedules")
      .find(classFilter, { projection: { _id: 1, title: 1 } }).limit(200).toArray();
    if (classes.length === 0) return [];
    const classIds = classes.map((c) => String(c._id));
    const titleById: Record<string, string> = {};
    for (const c of classes) titleById[String(c._id)] = c.title || String(c._id);

    const rows = await this.conn.db!.collection("classSnaps")
      .find({ classId: { $in: classIds } })
      .sort({ at: -1 }).limit(limit).toArray();
    return rows.map((r: any) => ({
      _id: r._id,
      classId: r.classId, classTitle: titleById[r.classId] || r.classId,
      fen: r.fen, note: r.note || "",
      shapes: Array.isArray(r.shapes) ? r.shapes : [],
      starred: !!r.starred,
      hasAudio: !!r.hasAudio,
      byUserId: String(r.byUserId), byName: r.byName || r.byUserId,
      at: r.at,
    }));
  }
}
