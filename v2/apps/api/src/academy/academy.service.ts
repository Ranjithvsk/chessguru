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
import { ACHIEVEMENTS, type Achievement } from "./achievements.catalog";
import { isAdmin } from "../admin/admins";

const INVITE_TTL_DAYS = 7;

/** Overall Score weights — sum to 1.0. Percentile-based dimensions so the
 *  ranking is fair inside the academy (not gated by absolute chess-strength).
 *  Tuning knob for the coach: swap these to bias toward e.g. more accuracy or
 *  more attendance. Kept as a module-level export so the leaderboard response
 *  can echo them back for transparency in the UI.
 *
 *  Owner rebalance 2026-08-23: "reward consistent players, because consistency
 *  is key to success". Consistency = 30% of the overall score.
 *
 *  The `consistency` composite blends practice (puzzles) AND attendance
 *  (physical class-showing-up) — Phase 5b, owner: "attendance streaks feed
 *  Consistency Score":
 *    Puzzles side:
 *      0.35 × active days in past 30 (puzzles solved)
 *      0.20 × puzzle daily-streak (sqrt-capped, 60 max)
 *      0.10 × weekly cadence (weeks with >= 3 active days, out of 8)
 *    Attendance side:
 *      0.20 × attendance days in past 30 (physical class attended)
 *      0.15 × attendance streak (sqrt-capped, 60 max)
 *
 *  Missing one day no longer nukes a kid's rank. Kids who show up 5 days/week
 *  for months + also practice at home beat both cramming-then-vanishing
 *  sprinters AND passive attendees who never solve puzzles. */
const WEIGHTS = {
  rating: 0.20,
  puzzles: 0.20,
  accuracy: 0.15,
  consistency: 0.30,
  themes: 0.10,
  attendance: 0.05,
} as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => (
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string)));

@Injectable()
export class AcademyService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private invites() { return this.conn.db!.collection("academyInvites"); }
  private users()   { return this.conn.db!.collection("users"); }
  private academies(){return this.conn.db!.collection("academies"); }
  private badges()  { return this.conn.db!.collection("academyBadges"); }
  private boosts()  { return this.conn.db!.collection("academyBoosts"); }

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
        const coach = await this.users().findOne({ _id: requestedCoach as any, academyId, role: { $in: ["coach", "academy_owner"] } });
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

  /** Return the caller's academy row (name, plan, trial dates). Coach/owner only. */
  async getMeta(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const acad: any = await this.academies().findOne({ _id: g.academyId as any });
    if (!acad) return { name: g.academyId };
    return {
      _id: acad._id,
      name: acad.name || acad._id,
      plan: acad.plan || null,
      subscriptionStatus: acad.subscriptionStatus || null,
      trialStartsAt: acad.trialStartsAt || null,
      trialEndsAt: acad.trialEndsAt || null,
      monthlyPricePaise: acad.monthlyPricePaise ?? null,
    };
  }

  /** Direct-add a student — creates the user immediately with an
   *  auto-generated password. Returns the credentials so the coach can hand
   *  them to the student in person / print out. Coach-invited students
   *  auto-attach to the coach; owner-invited require a coachId.
   *
   *  Username generation:
   *    - Sanitize the displayName
   *    - If blank / too short, derive from email local-part
   *    - If still blank, generate "student-<random>"
   *  Collision-append -2, -3 up to 999 if the base already exists.
   *  Email is optional (young students often don't have one). */
  /** Link a parent user to a student. If a user with the given email exists
   *  and is a parent (or a plain unrolled user), link to them. Otherwise
   *  create a new parent user (auto-gen password like quick-add students).
   *  A parent may be linked to multiple students; each student can have
   *  multiple parents. Powers the parent portal — owner ask 2026-08-18:
   *  "parent portal with billing and progress reports". */
  async linkParentToStudent(session: any, studentId: string, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const student: any = await this.users().findOne({ _id: studentId as any, academyId: g.academyId, role: "student" });
    if (!student) return { ok: false, error: "Student not found in your academy." };
    if (g.role === "coach" && String(student.coachId || "") !== g.userId) {
      return { ok: false, error: "That student isn't assigned to you." };
    }
    const displayName = String(body?.displayName || "").trim().slice(0, 60);
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return { ok: false, error: "Parent email is required." };

    let parent: any = await this.users().findOne({ email });
    let credentials: { username: string; password: string } | null = null;
    if (parent) {
      if (parent.role === "coach" || parent.role === "academy_owner") {
        return { ok: false, error: `${email} is a ${parent.role.replace("_", " ")} — cannot also be a parent.` };
      }
      // Existing account (plain user, student, or already-parent) — upgrade
      // to parent role if not already and append the child.
      const nextChildren = Array.from(new Set([...(parent.childrenIds || []).map(String), String(student._id)]));
      const patch: any = { childrenIds: nextChildren, updatedAt: new Date() };
      if (parent.role !== "parent") patch.role = "parent";
      // Existing user under a different academy? Attach to this academy so
      // the parent lands in the right portal. Parents don't belong to a
      // coach — only students do.
      if (!parent.academyId) patch.academyId = g.academyId;
      await this.users().updateOne({ _id: parent._id }, { $set: patch });
    } else {
      // Create a new parent user.
      const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
      let base = sanitize(displayName) || sanitize(email.split("@")[0] || "") || "parent";
      if (base.length < 2) base = "parent";
      let uid = base, k = 2;
      while (await this.users().findOne({ $or: [{ _id: uid as any }, { username: { $regex: new RegExp("^" + uid + "$", "i") } }] } as any)) {
        uid = `${base}-${k++}`;
        if (k > 999) return { ok: false, error: "Couldn't pick a free username — try a different name." };
      }
      const pwBase = ((displayName.split(/\s+/)[0] || uid).toLowerCase().replace(/[^a-z0-9]/g, "")) || "parent";
      const password = `${pwBase}@123`;
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash(password, 10);
      const now = new Date();
      const doc: any = {
        _id: uid, username: uid, name: displayName || uid, email, bpass: hash,
        role: "parent", academyId: g.academyId,
        childrenIds: [String(student._id)],
        createdAt: now, updatedAt: now,
      };
      await this.users().insertOne(doc);
      parent = doc;
      credentials = { username: uid, password };
    }
    // Mirror the link on the student side so we can find "who are this
    // student's parents" without an aggregation.
    await this.users().updateOne(
      { _id: student._id },
      { $addToSet: { parentIds: String(parent._id) }, $set: { updatedAt: new Date() } },
    );
    return { ok: true, parent: { _id: parent._id, username: parent.username, name: parent.name, email }, credentials };
  }

  /** Merge a quick-added duplicate student into an EXISTING platform account.
   *  Use case (owner ask 2026-08-18): coach quick-adds "harnitharanjith" not
   *  realising the real "harinitharanjith" account already exists. Owner
   *  clicks 🔀 on the duplicate row and enters the real username; server
   *  moves the duplicate's academyId + coachId onto the real user, then
   *  deletes the duplicate. Any per-student references in batches/
   *  homework/directives are rewritten so nothing points at the removed id.
   *
   *  Guardrails:
   *   - Both accounts must exist. `dupeId` (the source) MUST be in the
   *     caller's academy. `target` (real user) MUST NOT be in a different
   *     academy already.
   *   - Refuses to merge if the DUPE has ANY puzzle history (nb > 0 OR
   *     rounds > 0) — that indicates the "duplicate" is actually a real
   *     account, and merging would silently lose data. The caller can
   *     delete via the normal remove flow if they really mean it.
   *   - Refuses if target has role coach/owner (would clobber). */
  async mergeStudent(session: any, dupeId: string, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const raw = String(body?.targetUsernameOrEmail || "").trim().toLowerCase();
    if (!raw) return { ok: false, error: "Enter the existing user's username or email." };
    const dupe: any = await this.users().findOne({ _id: dupeId as any, academyId: g.academyId, role: "student" });
    if (!dupe) return { ok: false, error: "Duplicate student not found in your academy." };
    if (g.role === "coach" && String(dupe.coachId || "") !== g.userId) {
      return { ok: false, error: "That student isn't assigned to you." };
    }
    const target: any = await this.users().findOne({
      $or: [
        { _id: raw as any },
        { username: { $regex: new RegExp("^" + raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") } },
        { email: raw },
      ],
    } as any);
    if (!target) return { ok: false, error: "No existing user found with that username or email." };
    if (String(target._id) === String(dupe._id)) return { ok: false, error: "That's the same account." };
    if (target.academyId && target.academyId !== g.academyId) {
      return { ok: false, error: `${target.username} is already in another academy (${target.academyId}).` };
    }
    if (target.role === "academy_owner" || target.role === "coach") {
      return { ok: false, error: `${target.username} is a ${target.role.replace("_", " ")} — can't merge into.` };
    }
    // MOVE all of the source's data into the target — that's the whole
    // point (owner ask 2026-08-18: "no data should be lost in the merge").
    // Order matters: move rounds → merge perfs → move games/analysis →
    // rewrite batches → delete source. Any failure part-way leaves both
    // rows intact.
    const now = new Date();
    const srcId = String(dupe._id);
    const dstId = String(target._id);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Move ROUNDS. _id = "<userId>:<puzzleId>". Target's own rows win
    // (they represent later Glicko state that's harder to reconstruct);
    // source rows for the same puzzle are dropped. Cheap on the current
    // scale (a few thousand rows per user max).
    const srcRounds = await this.conn.db!.collection("rounds")
      .find({ _id: { $regex: `^${esc(srcId)}:` } as any })
      .toArray();
    if (srcRounds.length) {
      const rewrites = srcRounds.map((r: any) => {
        const puzId = String(r._id).split(":")[1];
        return { srcRow: r, dstIdNew: `${dstId}:${puzId}` };
      });
      // Fetch which of the target's existing rows already exist for the
      // same puzzleIds so we don't $insert-then-$deduplicate.
      const dstExisting = await this.conn.db!.collection("rounds")
        .find({ _id: { $in: rewrites.map((r) => r.dstIdNew) as any } }, { projection: { _id: 1 } })
        .toArray();
      const dstSet = new Set(dstExisting.map((d: any) => String(d._id)));
      const toInsert = rewrites
        .filter((r) => !dstSet.has(r.dstIdNew))
        .map((r) => ({ ...r.srcRow, _id: r.dstIdNew }));
      if (toInsert.length) {
        await this.conn.db!.collection("rounds").insertMany(toInsert as any);
      }
      await this.conn.db!.collection("rounds").deleteMany({ _id: { $regex: `^${esc(srcId)}:` } as any });
    }

    // Merge USERPERFS. If target has none, just rename. If both exist,
    // pick the row with the higher solve count as the base (that's the
    // "real" account); sum the solve counters and take max of ratings so
    // the merged row can't regress. Recomputing Glicko for real would
    // need every history entry replayed; this preserves the ceiling.
    const srcPerf: any = await this.conn.db!.collection("userperfs").findOne({ _id: srcId as any });
    const dstPerf: any = await this.conn.db!.collection("userperfs").findOne({ _id: dstId as any });
    if (srcPerf && !dstPerf) {
      await this.conn.db!.collection("userperfs").insertOne({ ...srcPerf, _id: dstId } as any);
    } else if (srcPerf && dstPerf) {
      const winner = (dstPerf.puzzle?.nb ?? 0) >= (srcPerf.puzzle?.nb ?? 0) ? dstPerf : srcPerf;
      const other = winner === dstPerf ? srcPerf : dstPerf;
      const merged: any = { ...winner };
      merged._id = dstId;
      if (winner.puzzle || other.puzzle) {
        merged.puzzle = {
          gl: {
            r: Math.max(winner.puzzle?.gl?.r ?? 0, other.puzzle?.gl?.r ?? 0) || (winner.puzzle?.gl?.r ?? 1500),
            d: Math.min(winner.puzzle?.gl?.d ?? 500, other.puzzle?.gl?.d ?? 500),
            v: winner.puzzle?.gl?.v ?? other.puzzle?.gl?.v ?? 0.06,
          },
          nb: (winner.puzzle?.nb ?? 0) + (other.puzzle?.nb ?? 0),
          re: [...(winner.puzzle?.re ?? []), ...(other.puzzle?.re ?? [])].slice(0, 100),
          la: winner.puzzle?.la ?? other.puzzle?.la ?? null,
        };
      }
      await this.conn.db!.collection("userperfs").replaceOne({ _id: dstId as any }, merged);
    }
    await this.conn.db!.collection("userperfs").deleteOne({ _id: srcId as any });

    // Move myGames + myGameAnalysis + revisions + examAttempts + bookProgress
    // + studies — anything keyed by ownerId/userId.
    await this.conn.db!.collection("myGames").updateMany({ ownerId: srcId }, { $set: { ownerId: dstId } });
    await this.conn.db!.collection("myGameAnalysis").updateMany({ ownerId: srcId }, { $set: { ownerId: dstId } });
    await this.conn.db!.collection("revisions").updateMany({ userId: srcId }, { $set: { userId: dstId } });
    await this.conn.db!.collection("examAttempts").updateMany({ userId: srcId }, { $set: { userId: dstId } });
    await this.conn.db!.collection("bookProgress").updateMany({ userId: srcId }, { $set: { userId: dstId } });
    await this.conn.db!.collection("studies").updateMany({ ownerId: srcId }, { $set: { ownerId: dstId } });
    // Study rounds — same _id pattern as puzzle rounds.
    const srcStudy = await this.conn.db!.collection("study_rounds")
      .find({ _id: { $regex: `^${esc(srcId)}:` } as any })
      .toArray();
    if (srcStudy.length) {
      const rewrites = srcStudy.map((r: any) => ({ ...r, _id: `${dstId}:${String(r._id).split(":")[1]}` }));
      const dstExisting = await this.conn.db!.collection("study_rounds")
        .find({ _id: { $in: rewrites.map((r: any) => r._id) as any } }, { projection: { _id: 1 } })
        .toArray();
      const dstSet = new Set(dstExisting.map((d: any) => String(d._id)));
      const toInsert = rewrites.filter((r: any) => !dstSet.has(String(r._id)));
      if (toInsert.length) await this.conn.db!.collection("study_rounds").insertMany(toInsert as any);
      await this.conn.db!.collection("study_rounds").deleteMany({ _id: { $regex: `^${esc(srcId)}:` } as any });
    }

    // Point the target at the duplicate's academy + coach (upgrade role to
    // student if they were a plain user).
    await this.users().updateOne(
      { _id: target._id },
      { $set: { academyId: g.academyId, coachId: dupe.coachId, role: "student", updatedAt: now, mergedFromAt: now } },
    );
    // Rewrite batch memberships: any batch that referenced the dupe now
    // references the target. Dedup if the batch already contained both.
    const batchesWithDupe = await this.batches().find({ studentIds: dupe._id }).toArray();
    for (const b of batchesWithDupe) {
      const ids = new Set<string>((b.studentIds || []).map((x: any) => String(x)));
      ids.delete(String(dupe._id));
      ids.add(String(target._id));
      await this.batches().updateOne({ _id: b._id }, { $set: { studentIds: [...ids], updatedAt: now } });
    }
    // Finally remove the source user record.
    await this.users().deleteOne({ _id: dupe._id });
    return {
      ok: true,
      removedId: srcId,
      target: { _id: target._id, username: target.username, name: target.name },
      moved: { rounds: srcRounds.length, studyRounds: srcStudy.length },
    };
  }

  /** Attach an EXISTING user (already has a ChessGuru account with their own
   *  puzzle history + rating) to this academy as a student. Unlike
   *  quickAddStudent which creates a brand-new account, this preserves the
   *  user's identity, password, rating, solve history — only the academy
   *  membership fields (academyId, coachId, role) are set.
   *
   *  Guardrails:
   *   - Owner: can attach any user not currently in another academy; must
   *     supply coachId (existing coach in this academy).
   *   - Coach: attaches under themselves (coachId auto-set to caller).
   *   - Target user must NOT already be in a different academy — moving
   *     someone across academies is a separate operation we don't do here.
   *   - Attaching an existing "academy_owner" or "coach" would clobber
   *     their role — reject unless force flag (not exposed via API).
   *
   *  Owner ask 2026-08-18: "how can i add existing users as student". */
  async attachExistingStudent(session: any, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const raw = String(body?.usernameOrEmail || "").trim().toLowerCase();
    if (!raw) return { ok: false, error: "Enter the user's username or email." };
    // Look up by _id (chosen username) OR case-insensitive username field
    // OR email — mirrors how sign-in accepts any of the three.
    const user = await this.users().findOne({
      $or: [
        { _id: raw as any },
        { username: { $regex: new RegExp("^" + raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") } },
        { email: raw },
      ],
    } as any);
    if (!user) return { ok: false, error: "No user found with that username or email." };
    if (user.academyId === g.academyId && user.role === "student") {
      return { ok: false, error: `${user.username} is already a student in your academy.` };
    }
    if (user.role === "academy_owner" || user.role === "coach") {
      return { ok: false, error: `${user.username} is a ${user.role.replace("_", " ")} — can't convert to student here.` };
    }
    // Cross-academy move — preserves the user's puzzle history + password
    // (rounds/userperfs/myGames are keyed by _id, unaffected by academyId).
    // The old academy's batches would still list them but that's a harmless
    // stale reference we can rewrite next; for now the "attach" step below
    // reassigns academyId + coachId + role.
    const movingFromOtherAcademy = user.academyId && user.academyId !== g.academyId;

    // Resolve target coach.
    const requestedCoachId = String(body?.coachId || "").trim().toLowerCase();
    let coachId: string;
    if (g.role === "coach") {
      coachId = g.userId;
    } else {
      if (!requestedCoachId) return { ok: false, error: "Pick a coach to assign this student to." };
      const coach = await this.users().findOne({ _id: requestedCoachId as any, academyId: g.academyId, role: { $in: ["coach", "academy_owner"] } });
      if (!coach) return { ok: false, error: "That coach isn't in this academy." };
      coachId = requestedCoachId;
    }

    // If moving from another academy, first strip the user out of any
    // batches in the OLD academy so we don't leave dangling roster refs.
    if (movingFromOtherAcademy) {
      await this.batches().updateMany(
        { academyId: user.academyId, studentIds: user._id },
        { $pull: { studentIds: user._id } as any, $set: { updatedAt: new Date() } },
      );
    }
    await this.users().updateOne(
      { _id: user._id },
      { $set: { academyId: g.academyId, coachId, role: "student", attachedAt: new Date() } },
    );
    return { ok: true, student: { _id: user._id, username: user.username, name: user.name }, movedFrom: movingFromOtherAcademy ? String(user.academyId) : null };
  }

  async quickAddStudent(session: any, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const displayName = String(body?.displayName || "").trim().slice(0, 60);
    const emailIn = String(body?.email || "").trim().toLowerCase();
    const requestedCoachId = String(body?.coachId || "").trim().toLowerCase();

    let coachId: string;
    if (g.role === "coach") {
      coachId = g.userId;
    } else {
      if (!requestedCoachId) return { ok: false, error: "Pick a coach for this student." };
      const coach = await this.users().findOne({ _id: requestedCoachId as any, academyId: g.academyId, role: { $in: ["coach", "academy_owner"] } });
      if (!coach) return { ok: false, error: "That coach isn't in this academy." };
      coachId = requestedCoachId;
    }

    if (emailIn) {
      if (!emailIn.includes("@")) return { ok: false, error: "Email doesn't look right." };
      const existing = await this.users().findOne({ email: emailIn });
      if (existing) return { ok: false, error: "That email already has an account." };
    }

    const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    let baseUid = sanitize(displayName);
    if (baseUid.length < 2 && emailIn) baseUid = sanitize(emailIn.split("@")[0] || "");
    if (baseUid.length < 2) return { ok: false, error: "Enter the student's name (at least 2 letters)." };

    // The display NAME may repeat (two students really can both be "Ragul"), but the
    // login USERNAME must stay unique. Auto-suffix -2/-3 until free, checking BOTH the
    // _id and the username field (sign-in matches case-insensitively on `username`),
    // so no two students ever share a login handle.
    let uid = baseUid, k = 2;
    while (await this.users().findOne({
      $or: [
        { _id: uid as any },
        { username: { $regex: new RegExp("^" + uid + "$", "i") } },
      ],
    } as any)) {
      uid = `${baseUid}-${k++}`;
      if (k > 999) return { ok: false, error: "Couldn't pick a free username — try a different name." };
    }

    // Student passwords are a simple, memorable "<firstname>@123" (e.g. ragul@123)
    // so a coach can read it out to a young student in person. Temporary — the
    // student (or coach) can change it later.
    const pwBase = ((displayName.split(/\s+/)[0] || uid).toLowerCase().replace(/[^a-z0-9]/g, "")) || uid.replace(/[^a-z0-9]/g, "") || "student";
    const password = `${pwBase}@123`;
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash(password, 10);

    const now = new Date();
    const userDoc: any = {
      _id: uid,
      username: uid,
      name: displayName || uid,
      bpass: hash,
      email: emailIn || null,
      academyId: g.academyId,
      role: "student",
      coachId,
      createdAt: now,
      lastLogin: null,
      createdBy: g.userId,
    };
    await this.users().insertOne(userDoc);
    return {
      ok: true,
      student: { _id: uid, username: userDoc.username, email: userDoc.email, coachId, createdAt: now },
      credentials: { username: uid, password },
    };
  }

  // ═══════════ MASTER COACH DIRECTIVES ═══════════
  // Owner (master coach) sends short instructions to specific coach(es) — kinds:
  //   topic / homework / student-note / general
  // Optional linked studentIds + dueAt (for homework). Each target coach can
  // acknowledge (removes red dot) + mark done. Owner sees per-coach status.
  private directives() { return this.conn.db!.collection("academyDirectives"); }

  async listDirectives(session: any): Promise<any[]> {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { academyId: g.academyId };
    if (g.role === "coach") filter.toCoachIds = g.userId;
    const rows = await this.directives().find(filter, { sort: { createdAt: -1 } }).limit(200).toArray();
    // Enrich with target coach + student mini-profiles for the UI.
    const coachIds = [...new Set(rows.flatMap((r: any) => (r.toCoachIds || []).map(String)))];
    const studentIds = [...new Set(rows.flatMap((r: any) => (r.studentIds || []).map(String)))];
    const [coaches, students] = await Promise.all([
      coachIds.length ? this.users().find({ _id: { $in: coachIds as any } }, { projection: { name: 1, username: 1 } }).toArray() : [],
      studentIds.length ? this.users().find({ _id: { $in: studentIds as any } }, { projection: { name: 1, username: 1 } }).toArray() : [],
    ]);
    const coachById = new Map(coaches.map((u: any) => [String(u._id), u]));
    const studentById = new Map(students.map((u: any) => [String(u._id), u]));
    return rows.map((r: any) => ({
      ...r,
      toCoaches: (r.toCoachIds || []).map((id: string) => {
        const u = coachById.get(String(id));
        return { _id: id, name: u?.name || u?.username || id };
      }),
      students: (r.studentIds || []).map((id: string) => {
        const u = studentById.get(String(id));
        return { _id: id, name: u?.name || u?.username || id };
      }),
    }));
  }

  async createDirective(session: any, body: any): Promise<any> {
    const g = this.ensureOwner(session);
    const kind = ["topic","homework","student-note","general"].includes(String(body?.kind)) ? String(body.kind) : "general";
    const title = String(body?.title || "").trim().slice(0, 120);
    if (!title) return { ok: false, error: "Title is required." };
    const bodyText = String(body?.body || "").trim().slice(0, 2000);
    const toRaw = Array.isArray(body?.toCoachIds) ? body.toCoachIds : [];
    if (!toRaw.length) return { ok: false, error: "Pick at least one coach." };
    const validCoaches = await this.users().find(
      { academyId: g.academyId, role: { $in: ["coach", "academy_owner"] }, _id: { $in: toRaw as any } },
      { projection: { _id: 1 } },
    ).toArray();
    const toCoachIds = validCoaches.map((u: any) => String(u._id));
    if (!toCoachIds.length) return { ok: false, error: "None of the picked coaches are in this academy." };
    const studentRaw = Array.isArray(body?.studentIds) ? body.studentIds : [];
    let studentIds: string[] = [];
    if (studentRaw.length) {
      const validStudents = await this.users().find(
        { academyId: g.academyId, role: "student", _id: { $in: studentRaw as any } },
        { projection: { _id: 1 } },
      ).toArray();
      studentIds = validStudents.map((u: any) => String(u._id));
    }
    const topicTags = (Array.isArray(body?.topicTags) ? body.topicTags : [])
      .map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 12);
    const dueRaw = String(body?.dueAt || "").trim();
    const dueAt = dueRaw ? new Date(dueRaw) : null;
    if (dueAt && isNaN(dueAt.getTime())) return { ok: false, error: "Bad due date." };
    const now = new Date();
    const doc: any = {
      _id: `dir-${Math.random().toString(36).slice(2, 10)}`,
      academyId: g.academyId,
      fromUserId: g.userId,
      toCoachIds,
      kind,
      title,
      body: bodyText,
      studentIds,
      topicTags,
      dueAt,
      status: "open",
      ackedBy: [],
      doneBy: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.directives().insertOne(doc);
    return { ok: true, directive: doc };
  }

  async updateDirective(session: any, directiveId: string, body: any): Promise<any> {
    const g = this.ensureOwner(session);
    const existing: any = await this.directives().findOne({ _id: directiveId as any, academyId: g.academyId });
    if (!existing) return { ok: false, error: "Directive not found." };
    const patch: any = { updatedAt: new Date() };
    if (typeof body?.title === "string") patch.title = body.title.trim().slice(0, 120);
    if (typeof body?.body === "string") patch.body = body.body.trim().slice(0, 2000);
    if (["open", "done"].includes(String(body?.status))) patch.status = String(body.status);
    if (Array.isArray(body?.toCoachIds)) {
      const validCoaches = await this.users().find(
        { academyId: g.academyId, role: { $in: ["coach", "academy_owner"] }, _id: { $in: body.toCoachIds as any } },
        { projection: { _id: 1 } },
      ).toArray();
      patch.toCoachIds = validCoaches.map((u: any) => String(u._id));
    }
    if ("dueAt" in body) {
      const dueRaw = String(body?.dueAt || "").trim();
      patch.dueAt = dueRaw ? new Date(dueRaw) : null;
    }
    await this.directives().updateOne({ _id: existing._id }, { $set: patch });
    return { ok: true };
  }

  async ackDirective(session: any, directiveId: string): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const existing: any = await this.directives().findOne({ _id: directiveId as any, academyId: g.academyId });
    if (!existing) return { ok: false, error: "Directive not found." };
    if (!(existing.toCoachIds || []).includes(g.userId)) return { ok: false, error: "Not addressed to you." };
    const already = (existing.ackedBy || []).some((a: any) => a.coachId === g.userId);
    if (!already) {
      await this.directives().updateOne(
        { _id: existing._id },
        { $push: { ackedBy: { coachId: g.userId, at: new Date() } } as any, $set: { updatedAt: new Date() } },
      );
    }
    return { ok: true };
  }

  async markDirectiveDone(session: any, directiveId: string, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const existing: any = await this.directives().findOne({ _id: directiveId as any, academyId: g.academyId });
    if (!existing) return { ok: false, error: "Directive not found." };
    if (!(existing.toCoachIds || []).includes(g.userId) && g.role !== "academy_owner") {
      return { ok: false, error: "Not addressed to you." };
    }
    const note = String(body?.note || "").trim().slice(0, 500);
    const already = (existing.doneBy || []).some((a: any) => a.coachId === g.userId);
    if (!already) {
      await this.directives().updateOne(
        { _id: existing._id },
        { $push: { doneBy: { coachId: g.userId, at: new Date(), note } } as any, $set: { updatedAt: new Date() } },
      );
    }
    return { ok: true };
  }

  async deleteDirective(session: any, directiveId: string): Promise<any> {
    const g = this.ensureOwner(session);
    await this.directives().deleteOne({ _id: directiveId as any, academyId: g.academyId });
    return { ok: true };
  }

  /** Owner-only: quick-add a coach. Mirrors quickAddStudent (username sanitize,
   *  password = <firstname>@123, bcrypt hash) but role="coach" + no coachId. */
  async quickAddCoach(session: any, body: any): Promise<any> {
    const g = this.ensureOwner(session);
    const displayName = String(body?.displayName || "").trim().slice(0, 60);
    const emailIn = String(body?.email || "").trim().toLowerCase();
    if (emailIn) {
      if (!emailIn.includes("@")) return { ok: false, error: "Email doesn't look right." };
      const existing = await this.users().findOne({ email: emailIn });
      if (existing) return { ok: false, error: "That email already has an account." };
    }
    const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    let baseUid = sanitize(displayName);
    if (baseUid.length < 2 && emailIn) baseUid = sanitize(emailIn.split("@")[0] || "");
    if (baseUid.length < 2) return { ok: false, error: "Enter the coach's name (at least 2 letters)." };
    let uid = baseUid, k = 2;
    while (await this.users().findOne({
      $or: [
        { _id: uid as any },
        { username: { $regex: new RegExp("^" + uid + "$", "i") } },
      ],
    } as any)) {
      uid = `${baseUid}-${k++}`;
      if (k > 999) return { ok: false, error: "Couldn't pick a free username — try a different name." };
    }
    const pwBase = ((displayName.split(/\s+/)[0] || uid).toLowerCase().replace(/[^a-z0-9]/g, "")) || uid.replace(/[^a-z0-9]/g, "") || "coach";
    const password = `${pwBase}@123`;
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash(password, 10);
    const now = new Date();
    const userDoc: any = {
      _id: uid,
      username: uid,
      name: displayName || uid,
      bpass: hash,
      email: emailIn || null,
      academyId: g.academyId,
      role: "coach",
      createdAt: now,
      lastLogin: null,
      createdBy: g.userId,
    };
    await this.users().insertOne(userDoc);
    return {
      ok: true,
      coach: { _id: uid, username: userDoc.username, email: userDoc.email, createdAt: now },
      credentials: { username: uid, password },
    };
  }

  /** Owner-only: reassign a student to a different coach in this academy.
   *  The new coach must be in the same academy and have role coach|owner. */
  async assignStudentCoach(session: any, studentId: string, coachId: string): Promise<any> {
    const g = this.ensureOwner(session);
    const student: any = await this.users().findOne({ _id: studentId as any, academyId: g.academyId, role: "student" });
    if (!student) return { ok: false, error: "That student isn't in this academy." };
    const target = String(coachId || "").trim();
    if (!target) return { ok: false, error: "Pick a coach." };
    const coach: any = await this.users().findOne({ _id: target as any, academyId: g.academyId, role: { $in: ["coach", "academy_owner"] } });
    if (!coach) return { ok: false, error: "That coach isn't in this academy." };
    await this.users().updateOne({ _id: student._id }, { $set: { coachId: coach._id, coachAssignedAt: new Date(), coachAssignedBy: g.userId } });
    return { ok: true };
  }

  /** Owner-only: detach a student from this academy. Preserves the user
   *  account + puzzle history + rating — the person can still log in and
   *  solve puzzles as a non-academy user, and can be re-added to any academy
   *  later. Removes the academy affiliation, coach assignment, and any batch
   *  memberships so scheduling/attendance no longer includes them. */
  async removeStudent(session: any, studentId: string): Promise<any> {
    const g = this.ensureOwner(session);
    const student: any = await this.users().findOne({ _id: studentId as any, academyId: g.academyId, role: "student" });
    if (!student) return { ok: false, error: "That student isn't in this academy." };
    // Owner ask 2026-08-18: "even when students removed from one academy,
    // data should not be lost, move them to chess guru". Instead of
    // unrolling to role:"user" (which was already data-safe — rounds/
    // perfs are keyed by _id), MOVE them to the platform's fallback
    // academy so they keep a valid roster spot + can still be re-attached
    // to any academy later. "chess-guru" is the platform-wide fallback;
    // if that academy doesn't exist, we fall back to the old detach
    // behaviour so removal never fails.
    const FALLBACK_ACADEMY = "chess-guru";
    const fallback = await this.conn.db!.collection("academies").findOne({ _id: FALLBACK_ACADEMY as any });
    const now = new Date();
    if (fallback) {
      await this.users().updateOne(
        { _id: student._id },
        {
          $set: {
            academyId: FALLBACK_ACADEMY,
            role: "student",
            coachId: null,   // no coach in the fallback until re-attached
            academyDetachedFrom: g.academyId,
            academyDetachedAt: now,
            academyDetachedBy: g.userId,
            updatedAt: now,
          },
          $unset: { coachAssignedAt: "", coachAssignedBy: "" },
        },
      );
    } else {
      // Fallback academy missing — legacy detach path.
      await this.users().updateOne(
        { _id: student._id },
        { $set: { role: "user", academyDetachedAt: now, academyDetachedBy: g.userId }, $unset: { academyId: "", coachId: "", coachAssignedAt: "", coachAssignedBy: "" } },
      );
    }
    // Drop from any batches in the ORIGINAL academy so recurring-class
    // scheduling doesn't drag them back.
    await this.batches().updateMany(
      { academyId: g.academyId, studentIds: student._id },
      { $pull: { studentIds: student._id } as any, $set: { updatedAt: now } },
    );
    return { ok: true, movedTo: fallback ? FALLBACK_ACADEMY : null };
  }

  // ═══════════ BATCHES ═══════════
  // A batch is a named group of students within an academy. Coach owns their
  // batches (`coachUserId`); owner can see all batches in the academy. Coaches
  // use batches to schedule classes for a fixed roster without re-selecting
  // students every time.
  private batches() { return this.conn.db!.collection("academyBatches"); }

  async listBatches(session: any): Promise<any[]> {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { academyId: g.academyId };
    if (g.role === "coach") filter.coachUserId = g.userId;
    const rows = await this.batches().find(filter, { sort: { createdAt: -1 } }).limit(200).toArray();
    // Enrich with student mini-profiles so the UI shows names without a separate lookup.
    const allIds = [...new Set(rows.flatMap((r: any) => (r.studentIds || []).map(String)))];
    const students = allIds.length ? await this.users().find({ _id: { $in: allIds as any } }, { projection: { name: 1, username: 1 } }).toArray() : [];
    const byId = new Map(students.map((u: any) => [String(u._id), u]));
    return rows.map((r: any) => ({
      ...r,
      students: (r.studentIds || []).map((id: string) => {
        const u = byId.get(String(id));
        return u ? { _id: u._id, name: u.name || u.username, username: u.username } : { _id: id, name: id, username: id };
      }),
    }));
  }

  async createBatch(session: any, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const name = String(body?.name || "").trim().slice(0, 80);
    if (!name) return { ok: false, error: "Batch name is required." };
    const rawIds = Array.isArray(body?.studentIds) ? body.studentIds : [];
    const coachId = g.role === "coach" ? g.userId : (String(body?.coachUserId || "").trim() || g.userId);
    // Filter studentIds to only those actually in this academy (and if caller
    // is a coach, only their own students).
    const roster = await this.users().find(
      { academyId: g.academyId, role: "student", _id: { $in: rawIds as any } },
      { projection: { _id: 1, coachId: 1 } },
    ).toArray();
    const validIds = roster
      .filter((u: any) => g.role !== "coach" || String(u.coachId || "") === g.userId)
      .map((u: any) => String(u._id));
    if (!validIds.length) return { ok: false, error: "Pick at least one student from your roster." };
    const now = new Date();
    const doc = {
      _id: `batch-${Math.random().toString(36).slice(2, 10)}`,
      academyId: g.academyId,
      coachUserId: coachId,
      name,
      studentIds: validIds,
      createdAt: now,
      updatedAt: now,
      createdBy: g.userId,
    };
    await this.batches().insertOne(doc as any);
    // Every student in the batch gets that coach assigned. Owner ask
    // 2026-08-18: "students under that batch also come under that coach".
    // Skip if coachId is the caller (redundant no-op for the coach-creating-
    // their-own-batch path); still bump updatedAt so anyone watching sees
    // the change fan-out cleanly.
    if (validIds.length) {
      await this.users().updateMany(
        { _id: { $in: validIds as any } },
        { $set: { coachId, updatedAt: now } },
      );
    }
    return { ok: true, batch: doc };
  }

  async updateBatch(session: any, batchId: string, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const existing: any = await this.batches().findOne({ _id: batchId as any, academyId: g.academyId });
    if (!existing) return { ok: false, error: "Batch not found." };
    if (g.role === "coach" && String(existing.coachUserId) !== g.userId) return { ok: false, error: "Not your batch." };
    const patch: any = { updatedAt: new Date() };
    if (typeof body?.name === "string") patch.name = body.name.trim().slice(0, 80);
    // Owner-only: reassign the whole batch (and its students) to a
    // different coach. Coaches can't hand their batch off — that's an
    // owner action.
    if (g.role === "academy_owner" && typeof body?.coachUserId === "string" && body.coachUserId) {
      const nextCoach: any = await this.users().findOne({ _id: body.coachUserId as any, academyId: g.academyId, role: { $in: ["coach", "academy_owner"] } });
      if (!nextCoach) return { ok: false, error: "New coach must be an existing coach in this academy." };
      patch.coachUserId = String(nextCoach._id);
    }
    if (Array.isArray(body?.studentIds)) {
      const roster = await this.users().find(
        { academyId: g.academyId, role: "student", _id: { $in: body.studentIds as any } },
        { projection: { _id: 1, coachId: 1 } },
      ).toArray();
      patch.studentIds = roster
        .filter((u: any) => g.role !== "coach" || String(u.coachId || "") === g.userId)
        .map((u: any) => String(u._id));
    }
    await this.batches().updateOne({ _id: batchId as any }, { $set: patch });
    // Fan-out coach re-assignment to every student in the (possibly new)
    // roster whenever coachUserId OR studentIds changed. Uses the freshest
    // values: patched coachUserId if we changed it, else the existing one;
    // patched studentIds if we changed them, else the existing list.
    const finalCoachId = String(patch.coachUserId ?? existing.coachUserId);
    const finalStudentIds: string[] = patch.studentIds ?? existing.studentIds ?? [];
    if (finalStudentIds.length && (patch.coachUserId || patch.studentIds)) {
      await this.users().updateMany(
        { _id: { $in: finalStudentIds as any } },
        { $set: { coachId: finalCoachId, updatedAt: new Date() } },
      );
    }
    return { ok: true };
  }

  async deleteBatch(session: any, batchId: string): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const existing: any = await this.batches().findOne({ _id: batchId as any, academyId: g.academyId });
    if (!existing) return { ok: false, error: "Batch not found." };
    if (g.role === "coach" && String(existing.coachUserId) !== g.userId) return { ok: false, error: "Not your batch." };
    await this.batches().deleteOne({ _id: batchId as any });
    return { ok: true };
  }

  /** Schedule one or more classes for a batch. Takes the same shape the
   *  class-schedule POST accepts (title, startAt, durationMin, recurrence,
   *  recurrenceCount, recurrenceWeekdays, notes, topics, roomKind) plus the
   *  batchId. Materialises class rows tagged with batchId so the students-of-
   *  a-class lookup is derivable without email invites. */
  async scheduleBatchClasses(session: any, batchId: string, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const batch: any = await this.batches().findOne({ _id: batchId as any, academyId: g.academyId });
    if (!batch) return { ok: false, error: "Batch not found." };
    if (g.role === "coach" && String(batch.coachUserId) !== g.userId) return { ok: false, error: "Not your batch." };
    const title = String(body?.title || "").trim().slice(0, 120);
    if (!title) return { ok: false, error: "Class title is required." };
    const startAtMs = new Date(body?.startAt || "").getTime();
    if (!Number.isFinite(startAtMs)) return { ok: false, error: "Bad startAt." };
    const durationMin = Math.max(5, Math.min(600, Math.floor(Number(body?.durationMin) || 60)));
    const recurrence: "none" | "weekly" = body?.recurrence === "weekly" ? "weekly" : "none";
    const count = recurrence === "weekly" ? Math.max(1, Math.min(52, Math.floor(Number(body?.recurrenceCount) || 1))) : 1;
    const weekdaysRaw = Array.isArray(body?.recurrenceWeekdays) ? body.recurrenceWeekdays : [];
    const weekdays = Array.from(new Set(weekdaysRaw.map((n: any) => Math.floor(Number(n))).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))) as number[];
    const startTimes: number[] = [startAtMs];
    if (recurrence === "weekly" && count > 1) {
      if (weekdays.length === 0) {
        for (let i = 1; i < count; i++) startTimes.push(startAtMs + i * 7 * 24 * 60 * 60 * 1000);
      } else {
        const dayMs = 24 * 60 * 60 * 1000;
        for (let step = 1; startTimes.length < count && step <= count * 14; step++) {
          const next = startAtMs + step * dayMs;
          if (weekdays.includes(new Date(next).getDay())) startTimes.push(next);
        }
      }
    }
    // Look up the coach's display name so the class shows a proper coach label.
    const coachUser: any = await this.users().findOne({ _id: batch.coachUserId as any }, { projection: { name: 1, username: 1 } });
    const coachName = String(body?.coach || coachUser?.name || coachUser?.username || "Coach").slice(0, 80);
    const docs: any[] = [];
    const total = startTimes.length;
    const col = this.conn.db!.collection("classSchedules");
    const newId = () => Math.random().toString(36).slice(2, 8);
    for (let i = 0; i < total; i++) {
      let id = newId();
      for (let r = 0; r < 3; r++) {
        const existing = await col.findOne({ _id: id as any }, { projection: { _id: 1 } });
        if (!existing) break;
        id = newId();
      }
      docs.push({
        _id: id,
        title,
        coach: coachName,
        startAt: new Date(startTimes[i]!),
        durationMin,
        notes: String(body?.notes || "").slice(0, 2000),
        topics: Array.isArray(body?.topics) ? body.topics.map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 8) : [],
        createdAt: new Date(),
        createdByUserId: batch.coachUserId,
        academyId: g.academyId,
        roomKind: body?.roomKind === "meet" ? "meet" : "meet",  // batches default to Dream Meet
        batchId: batch._id,          // ← link
        batchStudentIds: batch.studentIds,   // ← snapshot at create time
        seriesId: total > 1 ? (i === 0 ? id : docs[0]!._id) : null,
        seriesIndex: total > 1 ? i + 1 : undefined,
        seriesTotal: total > 1 ? total : undefined,
      });
    }
    await col.insertMany(docs);
    return { ok: true, count: docs.length, first: docs[0] };
  }

  /** Manually mark a student as attended for a given date (defaults to today).
   *  Coach can only mark their own students; owner can mark any. Writes to the
   *  classAttendance collection with a synthetic classId = "manual-<coachId>-<yyyymmdd>"
   *  so re-marking the same day is idempotent and the rollups in listStudents
   *  (attendedTotal / attendedThisWeek / lastAttendedAt) pick it up. */
  async markStudentAttended(session: any, studentId: string, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const target: any = await this.users().findOne({ _id: studentId as any, academyId: g.academyId, role: "student" });
    if (!target) return { ok: false, error: "That student isn't in this academy." };
    if (g.role === "coach" && String(target.coachId || "") !== g.userId) {
      return { ok: false, error: "That student isn't in your roster." };
    }
    // Normalise date. Accept YYYY-MM-DD from body, default to today.
    const raw = String(body?.date || "").trim();
    const d = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T09:00:00`) : new Date();
    if (isNaN(d.getTime())) return { ok: false, error: "Bad date." };
    const yyyymmdd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    const classId = `manual-${g.userId}-${yyyymmdd}`;
    const col = this.conn.db!.collection("classAttendance");
    await col.updateOne(
      { classId, key: target._id },
      {
        $setOnInsert: { joinedAt: d, classId, key: target._id, userId: target._id, name: target.name || target.username, manual: true, markedByUserId: g.userId },
        $set: { lastSeenAt: new Date() },
      },
      { upsert: true },
    );
    return { ok: true, markedAt: d.toISOString() };
  }

  /** Coach or owner resets a student's password. Coach can only reset students
   *  they own; owner can reset anyone in the academy. Returns the new plain-text
   *  password (single-use display) so the coach can hand it to the student in
   *  person. Body: { newPassword?: string } — if omitted, generate <firstname>@123
   *  like quickAddStudent does. */
  async setStudentPassword(session: any, studentId: string, body: any): Promise<any> {
    const g = this.ensureCoachOrOwner(session);
    const target: any = await this.users().findOne({ _id: studentId as any, academyId: g.academyId, role: "student" });
    if (!target) return { ok: false, error: "That student isn't in this academy." };
    // Coach may only reset their own students; owner can reset any student.
    if (g.role === "coach" && String(target.coachId || "") !== g.userId) {
      return { ok: false, error: "That student isn't in your roster." };
    }
    let password = String(body?.newPassword || "").trim();
    if (!password) {
      const pwBase = ((String(target.name || target.username || "").split(/\s+/)[0] || target._id).toLowerCase().replace(/[^a-z0-9]/g, "")) || "student";
      password = `${pwBase}@123`;
    }
    if (password.length < 4) return { ok: false, error: "Password must be at least 4 characters." };
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.default.hash(password, 10);
    await this.users().updateOne(
      { _id: target._id },
      { $set: { bpass: hash, passwordChangedAt: new Date(), passwordChangedBy: g.userId } },
    );
    return { ok: true, credentials: { username: target.username || target._id, password } };
  }

  /** Attendance sheet for a given date + optional coach + optional batch. Every
   *  student in scope appears, defaulting to status="present" UNLESS the coach
   *  has previously marked them absent/late for that date (idempotent read of
   *  the classAttendance collection). Owner ask 2026-08-23: "default present,
   *  mark absent" — this is the read side that powers that UX.
   *
   *  Response row shape:
   *    { studentId, name, username, avatarKey, status, lateMinutes, reason,
   *      currentAttendanceStreak, lastPresentDate, absentYesterday }
   *
   *  Uses the classId key "manual-<markedBy>-<yyyymmdd>" AS WELL AS ANY
   *  scheduled/live-class attendance for that date — so a student who joined
   *  the /class-v2 video call already shows as "present" without duplicate
   *  marking. Manual marks override auto marks (last write wins).
   */
  async getAttendanceSheet(session: any, dateStr: string, coachIdRaw?: string | null, batchId?: string | null) {
    const g = this.ensureCoachOrOwner(session);
    // Normalise date. Owner sees any coach; coach is pinned to themselves.
    const raw = String(dateStr || "").trim();
    const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59.999`);
    const coachId = g.role === "coach" ? g.userId : (String(coachIdRaw || "").trim() || null);

    // Roster — students in this academy, optionally filtered by coach + batch.
    const studentFilter: any = { academyId: g.academyId, role: "student" };
    if (coachId) studentFilter.coachId = coachId;
    if (batchId) {
      const b: any = await this.batches().findOne({ _id: batchId as any, academyId: g.academyId });
      if (!b) return { ok: false, error: "That batch isn't in this academy." };
      const ids: string[] = (b.studentIds || []).map(String);
      studentFilter._id = { $in: ids as any };
    }
    const students: any[] = await this.users().find(studentFilter, { projection: { _id: 1, username: 1, name: 1, coachId: 1, avatarKey: 1 } }).toArray();
    const ids = students.map((s) => String(s._id));

    // Attendance marks for this date. Rows come from TWO sources:
    //   (a) Manual coach marks — classId "manual-<coachId>-<yyyymmdd>",
    //       explicit `status: "present"|"late"|"absent"`. Coach's ground truth.
    //   (b) Live-class auto-joins — classId = Dream Meet room, no `status`
    //       field. Written by video-signal.ts when a student joins the call.
    //
    // Priority for display: manual (a) always wins over auto (b). Within
    // manual, latest lastSeenAt wins. This prevents a student marked absent
    // by the coach at 14:00 from being auto-flipped to present when they
    // then join the video call at 14:30 (owner ask 2026-08-23).
    const attRows: any[] = ids.length ? await this.conn.db!.collection("classAttendance")
      .find({ key: { $in: ids as any }, joinedAt: { $gte: dayStart, $lte: dayEnd } })
      .sort({ lastSeenAt: 1 })
      .toArray() : [];
    // Per-student best mark: manual > auto, then latest wins within each tier.
    // Also collect the auto-join info (class + timestamp) even when a manual
    // mark exists — the UI can show "You marked absent · joined Live Class 14:30"
    // so the coach can spot conflicts.
    // Three source tiers: manual (coach explicit) > qr (student self-checked-in
    // via QR scan) > live-class (auto Dream Meet join). Manual always wins.
    const byStudent = new Map<string, { manual: any | null; qr: any | null; auto: any | null }>();
    for (const a of attRows) {
      const key = String(a.key);
      const rec = byStudent.get(key) || { manual: null, qr: null, auto: null };
      const cid = typeof a.classId === "string" ? a.classId : "";
      const isQr = cid.startsWith("qrcheckin-") || a.source === "qr";
      const isManual = !isQr && cid.startsWith("manual-");
      if (isManual) {
        if (!rec.manual || (a.lastSeenAt || a.joinedAt) > (rec.manual.lastSeenAt || rec.manual.joinedAt)) rec.manual = a;
      } else if (isQr) {
        if (!rec.qr || (a.lastSeenAt || a.joinedAt) > (rec.qr.lastSeenAt || rec.qr.joinedAt)) rec.qr = a;
      } else {
        if (!rec.auto || (a.lastSeenAt || a.joinedAt) > (rec.auto.lastSeenAt || rec.auto.joinedAt)) rec.auto = a;
      }
      byStudent.set(key, rec);
    }

    // Streak + last-present-date + last-7-day strip — one aggregation covering
    // past 60d. Also captures status per day so the card can render a
    // 7-day mini-strip: green=present, yellow=late, red=absent, grey=unmarked.
    const streakCutoff = new Date(Date.now() - 60 * 86400_000);
    const streakAgg = ids.length ? await this.conn.db!.collection("classAttendance").aggregate([
      { $match: { key: { $in: ids as any }, joinedAt: { $gte: streakCutoff } } },
      { $group: {
          _id: { u: "$key", d: { $dateToString: { format: "%Y-%m-%d", date: "$joinedAt", timezone: "Asia/Kolkata" } } },
          // Last-write-wins per day: prefer the most recent lastSeenAt
          status: { $last: { $ifNull: ["$status", "present"] } },
      } },
      { $group: {
          _id: "$_id.u",
          days: { $push: { day: "$_id.d", status: "$status" } },
      } },
    ]).toArray() : [];
    const streakMap = new Map<string, { current: number; lastPresentDate: string | null; last7: Array<{ day: string; status: string }> }>();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    for (const s of streakAgg) {
      const dayList = (s.days || []) as Array<{ day: string; status: string }>;
      const presentDays = new Set<string>(dayList.filter((d) => d.status !== "absent").map((d) => d.day));
      const sorted = [...presentDays].sort().reverse();
      const lastPresentDate = sorted[0] || null;
      // Current streak = consecutive backward from today/yesterday
      let cur = 0;
      let cursor = new Date();
      if (!presentDays.has(today) && !presentDays.has(yesterday)) {
        cur = 0;
      } else {
        while (!presentDays.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
        while (presentDays.has(cursor.toISOString().slice(0, 10))) { cur++; cursor.setDate(cursor.getDate() - 1); }
      }
      // Last 7 days by date (oldest→newest for consistent left-to-right render).
      const dayStatusMap = new Map(dayList.map((d) => [d.day, d.status]));
      const last7: Array<{ day: string; status: string }> = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
        last7.push({ day: d, status: dayStatusMap.get(d) || "unmarked" });
      }
      streakMap.set(String(s._id), { current: cur, lastPresentDate, last7 });
    }

    const rows = students.map((s: any) => {
      const uid = String(s._id);
      const rec = byStudent.get(uid);
      // Priority: manual mark > qr check-in > live-class auto-join > default.
      // A manual mark ALWAYS wins so a coach's explicit "absent" isn't
      // silently flipped by a later scan/join.
      const mark = rec?.manual || rec?.qr || rec?.auto || null;
      const source: "manual" | "qr" | "live-class" | "default" =
        rec?.manual ? "manual"
        : rec?.qr ? "qr"
        : rec?.auto ? "live-class"
        : "default";
      const status: "present" | "late" | "absent" =
        !mark ? "present"                       // no mark at all = default present
        : mark.status === "absent" ? "absent"
        : mark.status === "late" ? "late"
        : "present";
      const streak = streakMap.get(uid);
      // Auto-join details (for UI badge/conflict display) — even if manual
      // mark is present, surface the join so the coach can spot conflicts.
      // Prefer live-class join over QR when both exist (QR is initiated by
      // coach so it's less "new information").
      const auto = rec?.auto || rec?.qr;
      const autoJoin = auto ? {
        classId: String(auto.classId || ""),
        joinedAt: auto.joinedAt || null,
        lastSeenAt: auto.lastSeenAt || null,
      } : null;
      // Excused flag — check ANY of the tier rows (excuse doc may be uploaded
      // to the row with any source, coach could mark absent + parent later
      // uploads excuse doc to the same row).
      const excusedRow = [rec?.manual, rec?.qr, rec?.auto].find((x) => x?.excused);
      const excused = !!excusedRow;
      return {
        studentId: uid,
        name: s.name || s.username,
        username: s.username,
        avatarKey: s.avatarKey || null,
        coachId: s.coachId || null,
        status,
        lateMinutes: mark?.lateMinutes ?? null,
        reason: mark?.reason ?? null,
        markedAt: mark?.lastSeenAt || mark?.joinedAt || null,
        source,
        autoJoin,
        excused,
        excuseDocUrl: excusedRow?.excuseDocPath ? `/api/academy/attendance/excuse-doc/${excusedRow.excuseDocPath}` : null,
        excuseNote: excusedRow?.excuseNote || null,
        excuseUploadedByRole: excusedRow?.excuseUploadedByRole || null,
        excuseUploadedAt: excusedRow?.excuseUploadedAt || null,
        currentAttendanceStreak: streak?.current ?? 0,
        lastPresentDate: streak?.lastPresentDate ?? null,
        absentYesterday: (streak?.lastPresentDate && streak.lastPresentDate < yesterday) || (!streak?.lastPresentDate && ids.length > 0),
        last7: streak?.last7 ?? [],
      };
    });
    // Owner: "reverse order" — most-recently-registered students first so newest
    // faces the coach checks in each session are up top.
    rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    rows.reverse();

    // Most recent PRIOR class date this coach has marked anyone on. Used for the
    // "Copy from last class" one-click UI so the coach doesn't manually pick a date.
    let lastClassDate: string | null = null;
    if (ids.length) {
      const lookback = new Date(Date.now() - 30 * 86400_000);
      const prior: any = await this.conn.db!.collection("classAttendance").findOne(
        { key: { $in: ids as any }, joinedAt: { $gte: lookback, $lt: dayStart }, manual: true },
        { sort: { joinedAt: -1 }, projection: { joinedAt: 1 } },
      );
      if (prior?.joinedAt) {
        const d = new Date(prior.joinedAt);
        lastClassDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    }

    return { ok: true, date, coachId, batchId: batchId || null, rows, lastClassDate };
  }

  /** Coach + owner attendance dashboard — the "at-a-glance" view above
   *  individual marking. Owner ask 2026-08-23. Returns:
   *
   *    fleet:      overall academy stats for the period
   *    byBatch:    per-batch rate + trend + coach + student count
   *    byCoach:    per-coach summary (owner only; coach sees just self)
   *    watchlist:  students needing attention — absent >=3 in past 7 days,
   *                OR missed last 2 consecutive class days,
   *                OR attendance dropped >=20 pts vs prior period
   *
   *  Period defaults to 30 days; capped 7-365. Single big aggregation over
   *  classAttendance scoped to this academy's students; one round-trip.
   */
  async getAttendanceDashboard(session: any, daysRaw?: number) {
    const g = this.ensureCoachOrOwner(session);
    const days = Math.max(7, Math.min(365, Math.round(Number(daysRaw) || 30)));
    const now = Date.now();
    const cutoff = new Date(now - days * 86400_000);
    const prevCutoff = new Date(now - 2 * days * 86400_000);

    // Roster in scope — coach sees their students; owner sees whole academy.
    const studentFilter: any = { academyId: g.academyId, role: "student" };
    if (g.role === "coach") studentFilter.coachId = g.userId;
    const students: any[] = await this.users().find(studentFilter, { projection: { _id: 1, name: 1, username: 1, coachId: 1 } }).toArray();
    if (!students.length) {
      return { ok: true, period: { days }, fleet: { totalStudents: 0, totalClassDays: 0, overallRate: 0, perfectCount: 0, avgAttended: 0 }, byBatch: [], byCoach: [], watchlist: [] };
    }
    const ids = students.map((s: any) => String(s._id));
    const byStudent = new Map(students.map((s: any) => [String(s._id), s]));

    // Coaches lookup for the byCoach breakdown (owner) + student-row enrichment.
    const coachIds = [...new Set(students.map((s: any) => s.coachId).filter(Boolean).map(String))];
    const coaches: any[] = coachIds.length ? await this.users().find({ _id: { $in: coachIds as any } }, { projection: { _id: 1, name: 1, username: 1 } }).toArray() : [];
    const coachById = new Map(coaches.map((c: any) => [String(c._id), c]));

    // Batches for this academy — used to name-group students.
    const batchFilter: any = { academyId: g.academyId };
    if (g.role === "coach") batchFilter.coachUserId = g.userId;
    const batches: any[] = await this.batches().find(batchFilter, { projection: { _id: 1, name: 1, coachUserId: 1, studentIds: 1 } }).toArray();
    // Reverse index: studentId → [batchIds]
    const batchesByStudent = new Map<string, string[]>();
    for (const b of batches) for (const sid of (b.studentIds || []).map(String)) {
      const arr = batchesByStudent.get(sid) || [];
      arr.push(String(b._id));
      batchesByStudent.set(sid, arr);
    }

    // One big scan of classAttendance — current period + prior period so we
    // can compute per-student rate change in a single query.
    const attRows: any[] = await this.conn.db!.collection("classAttendance").aggregate([
      { $match: { key: { $in: ids as any }, joinedAt: { $gte: prevCutoff } } },
      { $project: {
          u: "$key",
          day: { $dateToString: { format: "%Y-%m-%d", date: "$joinedAt", timezone: "Asia/Kolkata" } },
          status: { $ifNull: ["$status", "present"] },
          excused: { $ifNull: ["$excused", false] },
          classId: 1, joinedAt: 1, lastSeenAt: 1,
      } },
      { $sort: { lastSeenAt: 1 } as any },
    ]).toArray();

    // Per-student per-day winning status (same manual > qr > live-class priority).
    // Group cursors by (student, day).
    const perStudentDay = new Map<string, Map<string, { manual: any | null; qr: any | null; auto: any | null }>>();
    for (const r of attRows) {
      const sid = String(r.u);
      const day = String(r.day);
      let dayMap = perStudentDay.get(sid);
      if (!dayMap) { dayMap = new Map(); perStudentDay.set(sid, dayMap); }
      let rec = dayMap.get(day) || { manual: null, qr: null, auto: null };
      const cid = String(r.classId || "");
      if (cid.startsWith("qrcheckin-")) rec.qr = r;
      else if (cid.startsWith("manual-")) rec.manual = r;
      else rec.auto = r;
      dayMap.set(day, rec);
    }

    // Which days had ANY attendance activity for the academy (roughly = class days).
    const classDaysCurrent = new Set<string>();
    const dayCutoff = cutoff.toISOString().slice(0, 10);
    for (const dayMap of perStudentDay.values()) {
      for (const d of dayMap.keys()) if (d >= dayCutoff) classDaysCurrent.add(d);
    }

    // Roll up per-student current + prior period. Excused absences are
    // EXCLUDED from `absent` count — they're a "legitimate miss" and
    // shouldn't drag down attendance rate or trigger watchlist flags.
    type StatusCounts = { present: number; late: number; absent: number; excused: number };
    const rollup = (period: "current" | "prev"): Map<string, StatusCounts> => {
      const from = period === "current" ? dayCutoff : prevCutoff.toISOString().slice(0, 10);
      const to = period === "current" ? "9999-12-31" : dayCutoff;
      const out = new Map<string, StatusCounts>();
      for (const [sid, dayMap] of perStudentDay.entries()) {
        const counts: StatusCounts = { present: 0, late: 0, absent: 0, excused: 0 };
        for (const [day, rec] of dayMap.entries()) {
          if (day < from || day >= to) continue;
          const mark = rec.manual || rec.qr || rec.auto;
          if (!mark) continue;
          const anyExcused = !!(rec.manual?.excused || rec.qr?.excused || rec.auto?.excused);
          if (mark.status === "absent" && anyExcused) { counts.excused++; continue; }
          const s = mark.status === "absent" ? "absent" : mark.status === "late" ? "late" : "present";
          counts[s]++;
        }
        out.set(sid, counts);
      }
      return out;
    };
    const cur = rollup("current");
    const prev = rollup("prev");

    const rate = (c: StatusCounts | undefined) => {
      if (!c) return null;
      const tot = c.present + c.late + c.absent;
      return tot > 0 ? Math.round(((c.present + c.late) / tot) * 100) : null;
    };

    // Fleet metrics
    let sumAttended = 0, sumTotal = 0, perfectCount = 0;
    for (const s of students) {
      const c = cur.get(String(s._id)) || { present: 0, late: 0, absent: 0, excused: 0 };
      const tot = c.present + c.late + c.absent;
      if (tot > 0) {
        sumAttended += (c.present + c.late);
        sumTotal += tot;
        if (c.absent === 0 && tot >= 4) perfectCount++;   // >=4 classes with no absence
      }
    }
    const overallRate = sumTotal > 0 ? Math.round((sumAttended / sumTotal) * 100) : 0;
    const totalClassDays = classDaysCurrent.size;
    const avgAttended = totalClassDays > 0 ? Math.round(sumAttended / totalClassDays) : 0;

    // Per-batch rollup
    const byBatch = batches.map((b: any) => {
      const bids = (b.studentIds || []).map(String);
      let att = 0, tot = 0;
      for (const sid of bids) {
        const c = cur.get(sid);
        if (!c) continue;
        att += (c.present + c.late);
        tot += (c.present + c.late + c.absent);
      }
      const bRate = tot > 0 ? Math.round((att / tot) * 100) : null;
      // Prev
      let pAtt = 0, pTot = 0;
      for (const sid of bids) {
        const c = prev.get(sid);
        if (!c) continue;
        pAtt += (c.present + c.late);
        pTot += (c.present + c.late + c.absent);
      }
      const pRate = pTot > 0 ? Math.round((pAtt / pTot) * 100) : null;
      const coach = coachById.get(String(b.coachUserId));
      return {
        batchId: String(b._id),
        name: b.name,
        coachId: String(b.coachUserId || ""),
        coachName: coach ? (coach.name || coach.username) : null,
        studentCount: bids.length,
        rate: bRate,
        prevRate: pRate,
        delta: bRate != null && pRate != null ? bRate - pRate : null,
      };
    }).sort((a: any, b: any) => (b.rate ?? -1) - (a.rate ?? -1));

    // Per-coach rollup (owner only)
    const byCoach: any[] = [];
    if (g.role === "academy_owner") {
      const coachStats = new Map<string, { students: number; att: number; tot: number }>();
      for (const s of students) {
        const cid = String(s.coachId || "");
        if (!cid) continue;
        const st = coachStats.get(cid) || { students: 0, att: 0, tot: 0 };
        st.students++;
        const c = cur.get(String(s._id));
        if (c) {
          st.att += (c.present + c.late);
          st.tot += (c.present + c.late + c.absent);
        }
        coachStats.set(cid, st);
      }
      for (const [cid, st] of coachStats.entries()) {
        const coach = coachById.get(cid);
        byCoach.push({
          coachId: cid,
          coachName: coach ? (coach.name || coach.username) : cid,
          studentCount: st.students,
          rate: st.tot > 0 ? Math.round((st.att / st.tot) * 100) : null,
        });
      }
      byCoach.sort((a: any, b: any) => (b.rate ?? -1) - (a.rate ?? -1));
    }

    // Watchlist — kids needing attention. Three criteria:
    //   1. >= 3 absences in the last 7 days (heavy recent)
    //   2. Last 2 marked class-days both absent (consecutive miss)
    //   3. Attendance rate dropped >= 20 pts vs prior period
    const sevenDaysAgo = new Date(now - 7 * 86400_000).toISOString().slice(0, 10);
    const watchlist: any[] = [];
    for (const s of students) {
      const sid = String(s._id);
      const c = cur.get(sid) || { present: 0, late: 0, absent: 0, excused: 0 };
      const p = prev.get(sid);
      const curRate = rate(c);
      const prevRate = rate(p);
      const rateDrop = curRate != null && prevRate != null ? prevRate - curRate : 0;

      // Absences in last 7 days — excused absences DON'T count against the
      // student (parent uploaded doctor's note = legitimate miss).
      let recentAbsent = 0;
      const dayMap = perStudentDay.get(sid);
      const recentDays: Array<{ day: string; status: string }> = [];
      if (dayMap) {
        for (const [day, rec] of dayMap.entries()) {
          if (day < sevenDaysAgo) continue;
          const mark = rec.manual || rec.qr || rec.auto;
          if (!mark) continue;
          const anyExcused = !!(rec.manual?.excused || rec.qr?.excused || rec.auto?.excused);
          const isAbsent = mark.status === "absent" && !anyExcused;
          if (isAbsent) recentAbsent++;
          recentDays.push({
            day,
            status: isAbsent ? "absent"
                  : mark.status === "late" ? "late"
                  : anyExcused && mark.status === "absent" ? "excused"
                  : "present",
          });
        }
      }
      // Consecutive miss — sort desc, check top 2
      recentDays.sort((a, b) => b.day.localeCompare(a.day));
      const consecutiveMiss = recentDays.length >= 2 && recentDays[0]!.status === "absent" && recentDays[1]!.status === "absent";

      const reasons: string[] = [];
      if (recentAbsent >= 3) reasons.push(`${recentAbsent} absences this week`);
      if (consecutiveMiss) reasons.push("2 in a row absent");
      if (rateDrop >= 20) reasons.push(`rate dropped ${rateDrop}pts`);
      if (!reasons.length) continue;

      const coach = coachById.get(String(s.coachId || ""));
      const bIds = batchesByStudent.get(sid) || [];
      const bNames = bIds.map((bid) => {
        const b = batches.find((x: any) => String(x._id) === bid);
        return b ? b.name : null;
      }).filter(Boolean);

      watchlist.push({
        studentId: sid,
        name: s.name || s.username,
        coachName: coach ? (coach.name || coach.username) : null,
        batchNames: bNames,
        currentRate: curRate,
        prevRate,
        rateDelta: curRate != null && prevRate != null ? curRate - prevRate : null,
        recentAbsent,
        consecutiveMiss,
        reasons,
      });
    }
    // Sort watchlist: consecutive-miss first, then most recentAbsent, then biggest drop.
    watchlist.sort((a: any, b: any) => {
      if (a.consecutiveMiss !== b.consecutiveMiss) return a.consecutiveMiss ? -1 : 1;
      if (a.recentAbsent !== b.recentAbsent) return b.recentAbsent - a.recentAbsent;
      return (b.prevRate ?? 0) - (b.currentRate ?? 0) - ((a.prevRate ?? 0) - (a.currentRate ?? 0));
    });

    return {
      ok: true,
      period: { days, from: cutoff.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
      fleet: {
        totalStudents: students.length,
        totalClassDays,
        overallRate,
        perfectCount,
        avgAttended,
      },
      byBatch,
      byCoach,
      watchlist: watchlist.slice(0, 20),
    };
  }

  /** Per-student attendance history — last N days as GitHub-style calendar
   *  input. Returns one entry per calendar day with the winning status
   *  (manual > qr > live-class > unmarked) so the heatmap can render 3-color
   *  cells. Owner ask 2026-08-23. Also returns rollup counts for the header
   *  ("last 30 days: 22 present · 2 late · 6 absent").
   *
   *  Auth: coach can view their own students, owner can view any student in
   *  their academy, student can view themselves, parent can view their kids.
   *
   *  N days capped to 365; default 90 (12-13 weeks).
   */
  async getAttendanceHistory(session: any, studentId: string, daysRaw?: number) {
    const userId: string | null = session?.userId ?? null;
    const role = session?.role;
    if (!userId) return { ok: false, error: "Sign in first." };
    const student: any = await this.users().findOne({ _id: studentId as any, role: "student" });
    if (!student) return { ok: false, error: "Student not found." };
    // Auth check — reuse the same rules as parent-report + performance page.
    let allowed = false;
    if (role === "academy_owner" && String(session.academyId) === String(student.academyId)) allowed = true;
    else if (role === "coach" && String(session.academyId) === String(student.academyId) && String(student.coachId || "") === userId) allowed = true;
    else if (role === "parent" && Array.isArray(student.parentIds) && student.parentIds.includes(userId)) allowed = true;
    else if (userId === String(student._id)) allowed = true;   // student viewing self
    if (!allowed) return { ok: false, error: "Not authorized." };

    const days = Math.max(7, Math.min(365, Math.round(Number(daysRaw) || 90)));
    const cutoff = new Date(Date.now() - days * 86400_000);
    const rows: any[] = await this.conn.db!.collection("classAttendance")
      .find({ key: studentId as any, joinedAt: { $gte: cutoff } })
      .sort({ lastSeenAt: 1 })
      .toArray();

    // Same priority rules as the sheet — manual > qr > live-class.
    // Group by IST day, keep the winning tier.
    const byDay = new Map<string, { manual: any | null; qr: any | null; auto: any | null }>();
    const dayStr = (d: Date) => {
      // IST = UTC+5:30
      const ist = new Date(d.getTime() + 5.5 * 60 * 60_000);
      return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
    };
    for (const r of rows) {
      const day = dayStr(new Date(r.joinedAt));
      const rec = byDay.get(day) || { manual: null, qr: null, auto: null };
      const cid = String(r.classId || "");
      if (cid.startsWith("qrcheckin-") || r.source === "qr") {
        if (!rec.qr || (r.lastSeenAt || r.joinedAt) > (rec.qr.lastSeenAt || rec.qr.joinedAt)) rec.qr = r;
      } else if (cid.startsWith("manual-")) {
        if (!rec.manual || (r.lastSeenAt || r.joinedAt) > (rec.manual.lastSeenAt || rec.manual.joinedAt)) rec.manual = r;
      } else {
        if (!rec.auto || (r.lastSeenAt || r.joinedAt) > (rec.auto.lastSeenAt || rec.auto.joinedAt)) rec.auto = r;
      }
      byDay.set(day, rec);
    }

    // Emit N days ending TODAY. Each day: { day, status, source, reason?, lateMinutes? }.
    const today = dayStr(new Date());
    const outDays: Array<{ day: string; status: "present" | "late" | "absent" | "unmarked"; source: string; reason: string | null; lateMinutes: number | null; excused?: boolean }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const dstr = dayStr(d);
      const rec = byDay.get(dstr);
      if (!rec) {
        outDays.push({ day: dstr, status: "unmarked", source: "none", reason: null, lateMinutes: null });
        continue;
      }
      const mark = rec.manual || rec.qr || rec.auto;
      const src = rec.manual ? "manual" : rec.qr ? "qr" : "live-class";
      const status: "present" | "late" | "absent" =
        mark.status === "absent" ? "absent" : mark.status === "late" ? "late" : "present";
      const excusedRow = [rec.manual, rec.qr, rec.auto].find((x: any) => x?.excused);
      outDays.push({
        day: dstr, status, source: src,
        reason: mark.reason || null, lateMinutes: mark.lateMinutes ?? null,
        excused: !!excusedRow,
      });
    }

    // Rollups
    const last30 = outDays.slice(-30);
    const summary30 = {
      present: last30.filter((d) => d.status === "present").length,
      late: last30.filter((d) => d.status === "late").length,
      absent: last30.filter((d) => d.status === "absent").length,
      unmarked: last30.filter((d) => d.status === "unmarked").length,
    };
    const summaryAll = {
      present: outDays.filter((d) => d.status === "present").length,
      late: outDays.filter((d) => d.status === "late").length,
      absent: outDays.filter((d) => d.status === "absent").length,
      unmarked: outDays.filter((d) => d.status === "unmarked").length,
    };
    // Current attendance streak — walk backward from today across days that
    // are present OR late, stop on absent (unmarked days count as no-class).
    let currentStreak = 0;
    for (let i = outDays.length - 1; i >= 0; i--) {
      const s = outDays[i]!.status;
      if (s === "absent") break;
      if (s === "present" || s === "late") currentStreak++;
      // unmarked → skip (weekends, off days)
    }
    return {
      ok: true,
      studentId,
      name: student.name || student.username,
      days: outDays,
      today,
      summary30,
      summary: summaryAll,
      currentStreak,
    };
  }

  /** Upload an excuse document for a student's absent day. Owner ask
   *  2026-08-23. Marks the student's classAttendance row with
   *  excused=true + a link to the uploaded doc (image or PDF).
   *
   *  Auth: parent (for linked children), coach (own students), owner
   *  (any student in academy). Student can add a note-only excuse for
   *  themselves. Docs stored under EXCUSE_DOCS_DIR served via
   *  /api/academy/attendance/excuse-doc/:excuseId (auth-gated).
   *
   *  Body can be raw Buffer (file upload) OR JSON { note } for a
   *  note-only excuse without doc. Auto-creates the classAttendance
   *  row as absent+excused if it doesn't exist yet — so parent can
   *  submit an excuse in advance of the coach marking. */
  async uploadExcuseDoc(session: any, studentId: string, dateStr: string, buf: Buffer | null, contentType: string, note: string | null) {
    const userId: string | null = session?.userId ?? null;
    const role = session?.role;
    if (!userId) return { ok: false, error: "Sign in first." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: "Bad date." };
    const student: any = await this.users().findOne({ _id: studentId as any, role: "student" });
    if (!student) return { ok: false, error: "Student not found." };
    // Auth
    let allowed = false;
    let uploaderRole = "";
    if (role === "academy_owner" && String(session.academyId) === String(student.academyId)) { allowed = true; uploaderRole = "owner"; }
    else if (role === "coach" && String(session.academyId) === String(student.academyId) && String(student.coachId || "") === userId) { allowed = true; uploaderRole = "coach"; }
    else if (role === "parent" && Array.isArray(student.parentIds) && student.parentIds.includes(userId)) { allowed = true; uploaderRole = "parent"; }
    else if (userId === String(student._id)) { allowed = true; uploaderRole = "self"; }
    if (!allowed) return { ok: false, error: "Not authorized." };

    // Optional file: sniff type + validate
    let docPath: string | null = null;
    let docFilename: string | null = null;
    let docMime: string | null = null;
    let docBytes: number | null = null;
    if (buf && buf.byteLength > 0) {
      if (buf.byteLength > 8 * 1024 * 1024) return { ok: false, error: "File too large (max 8 MB)." };
      const ct = String(contentType || "").toLowerCase().split(";")[0]?.trim() || "";
      const extMap: Record<string, string> = {
        "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
        "image/webp": "webp", "image/gif": "gif",
        "application/pdf": "pdf",
      };
      const ext = extMap[ct];
      if (!ext) return { ok: false, error: "Only images (jpg/png/webp/gif) and PDF accepted." };
      const dir = process.env.CHESSGURU_EXCUSE_DOCS_DIR ?? "/home/ubuntu/chessguru-excuse-docs";
      const fs = await import("fs/promises");
      await fs.mkdir(dir, { recursive: true });
      const id = randomBytes(8).toString("base64url");
      docFilename = `${studentId}-${dateStr.replace(/-/g, "")}-${id}.${ext}`;
      const path = await import("path");
      await fs.writeFile(path.join(dir, docFilename), buf);
      docPath = docFilename;
      docMime = ct;
      docBytes = buf.byteLength;
    }
    if (!docPath && !note) return { ok: false, error: "Provide either a document or a note." };

    // Upsert the classAttendance row. We use a manual-style classId owned by
    // the uploader — the sheet's manual > qr > auto priority still applies,
    // but this row is tagged excused. If the coach had ALREADY marked with a
    // manual classId, we ALSO update that row (best-effort) so the sheet
    // shows excused right away.
    const yyyymmdd = dateStr.replace(/-/g, "");
    const col = this.conn.db!.collection("classAttendance");
    // Try to update ANY existing row for (student, date) with the excused flag
    // + doc info, regardless of source. This preserves the coach's mark chain.
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999`);
    const existing: any = await col.findOne({ key: studentId as any, joinedAt: { $gte: dayStart, $lte: dayEnd } });
    const excusePatch: any = {
      excused: true,
      excuseNote: note ? String(note).slice(0, 500) : null,
      excuseDocPath: docPath,
      excuseDocMime: docMime,
      excuseDocBytes: docBytes,
      excuseUploadedByUserId: userId,
      excuseUploadedByRole: uploaderRole,
      excuseUploadedAt: new Date(),
    };
    if (existing) {
      await col.updateOne({ _id: existing._id }, { $set: { ...excusePatch, lastSeenAt: new Date() } });
    } else {
      // No prior row — create a row as absent+excused so the sheet reflects it.
      const classId = `excuse-${uploaderRole}-${userId}-${yyyymmdd}`;
      const dayAt = new Date(`${dateStr}T09:00:00`);
      await col.updateOne(
        { classId, key: studentId as any },
        {
          $setOnInsert: { joinedAt: dayAt, classId, key: studentId, userId: studentId, name: student.name || student.username, manual: true, markedByUserId: userId },
          $set: { lastSeenAt: new Date(), status: "absent", lateMinutes: null, reason: note || "Excused absence", ...excusePatch },
        },
        { upsert: true },
      );
    }
    return { ok: true, date: dateStr, hasDoc: !!docPath, docFilename: docPath };
  }

  /** Serve an uploaded excuse doc — auth-gated (same rules as upload). */
  async getExcuseDoc(session: any, docFilename: string): Promise<{ ok: boolean; error?: string; path?: string; mime?: string }> {
    const userId: string | null = session?.userId ?? null;
    const role = session?.role;
    if (!userId) return { ok: false, error: "Sign in first." };
    // Sanity: only allow safe filenames matching our upload pattern.
    if (!/^[A-Za-z0-9._-]+$/.test(docFilename)) return { ok: false, error: "Bad filename." };
    // Look up the row that references this doc.
    const row: any = await this.conn.db!.collection("classAttendance").findOne({ excuseDocPath: docFilename });
    if (!row) return { ok: false, error: "Not found." };
    const studentId = String(row.key);
    const student: any = await this.users().findOne({ _id: studentId as any });
    if (!student) return { ok: false, error: "Student not found." };
    // Auth (same as upload)
    let allowed = false;
    if (role === "academy_owner" && String(session.academyId) === String(student.academyId)) allowed = true;
    else if (role === "coach" && String(session.academyId) === String(student.academyId) && String(student.coachId || "") === userId) allowed = true;
    else if (role === "parent" && Array.isArray(student.parentIds) && student.parentIds.includes(userId)) allowed = true;
    else if (userId === String(student._id)) allowed = true;
    if (!allowed) return { ok: false, error: "Not authorized." };
    const dir = process.env.CHESSGURU_EXCUSE_DOCS_DIR ?? "/home/ubuntu/chessguru-excuse-docs";
    const path = await import("path");
    return { ok: true, path: path.join(dir, docFilename), mime: row.excuseDocMime || "application/octet-stream" };
  }

  /** Enroll a student's face for attendance check-in.
   *
   *  Client (student's browser) uses face-api.js to compute a 128-dim
   *  descriptor from 3+ selfies, averages them client-side, then POSTs
   *  the averaged vector here. Owner ask 2026-08-23. We NEVER store the
   *  original photos — only the descriptor (which is not reversible into
   *  a recognizable image). Consent is captured explicitly.
   *
   *  Auth: student enrolls themselves. Coach/owner can trigger a
   *  re-enrollment prompt but not enroll ON someone's behalf.
   */
  async enrollFace(session: any, body: any) {
    const userId: string | null = session?.userId ?? null;
    if (!userId) return { ok: false, error: "Sign in first." };
    // Multi-embedding: accept an array of descriptors (recommended, better
    // recognition across poses/lighting) OR a single descriptor (legacy /
    // simple flow). Server stores as `faceDescriptors: number[][]`.
    const rawDescs = Array.isArray(body?.descriptors) ? body.descriptors
                   : Array.isArray(body?.descriptor) ? [body.descriptor]
                   : null;
    if (!rawDescs || rawDescs.length === 0) {
      return { ok: false, error: "Expected one or more 128-dimensional face descriptors." };
    }
    if (rawDescs.length > 20) return { ok: false, error: "Too many descriptors (max 20)." };
    const clean: number[][] = [];
    for (const d of rawDescs) {
      if (!Array.isArray(d) || d.length !== 128) return { ok: false, error: "Each descriptor must have 128 values." };
      const row: number[] = [];
      for (const v of d) {
        const n = Number(v);
        if (!Number.isFinite(n)) return { ok: false, error: "Descriptor contains invalid numbers." };
        row.push(n);
      }
      clean.push(row);
    }
    // Liveness signal — client attests it passed at least one challenge
    // (blink / smile / head-turn). Not cryptographically enforced (a
    // determined attacker could bypass) but adds real friction against
    // "hold up a photo" spoofs. Recorded for audit.
    const livenessPassed = !!body?.livenessPassed;
    const livenessMethod = typeof body?.livenessMethod === "string" ? body.livenessMethod.slice(0, 40) : null;
    const consent = !!body?.consent;
    if (!consent) return { ok: false, error: "Please accept the consent notice to enroll." };
    await this.users().updateOne(
      { _id: userId as any },
      { $set: {
          faceDescriptors: clean,
          faceEnrolledAt: new Date(),
          faceConsent: true,
          faceConsentAt: new Date(),
          faceLivenessPassed: livenessPassed,
          faceLivenessMethod: livenessMethod,
      },
      // Cleanup legacy single-descriptor field so match logic doesn't hit
      // two paths for the same user.
      $unset: { faceDescriptor: "" } },
    );
    return { ok: true, enrolledAt: new Date().toISOString(), enrolledCount: clean.length };
  }

  /** Delete a student's face enrollment. Student can delete their own; coach
   *  can delete for their students; owner for any. */
  async deleteFaceEnrollment(session: any, studentIdRaw?: string) {
    const userId: string | null = session?.userId ?? null;
    if (!userId) return { ok: false, error: "Sign in first." };
    const targetId = studentIdRaw && studentIdRaw !== userId ? studentIdRaw : userId;
    if (targetId !== userId) {
      const g = this.ensureCoachOrOwner(session);
      const student: any = await this.users().findOne({ _id: targetId as any, academyId: g.academyId, role: "student" });
      if (!student) return { ok: false, error: "Not found in your academy." };
      if (g.role === "coach" && String(student.coachId || "") !== g.userId) return { ok: false, error: "Not your student." };
    }
    await this.users().updateOne(
      { _id: targetId as any },
      {
        $unset: { faceDescriptor: "", faceDescriptors: "", faceEnrolledAt: "", faceLivenessMethod: "", faceLivenessPassed: "" },
        $set: { faceConsent: false, faceUnenrolledAt: new Date() },
      },
    );
    return { ok: true };
  }

  /** Coach's face-check-in mode calls this per detected face. Body:
   *  { descriptor: number[128], date?, coachId?, batchId?, threshold? }.
   *  Returns the best match (studentId + distance) if under threshold,
   *  or { ok: true, match: null } if no confident match.
   *
   *  Nearest-neighbor Euclidean over enrolled students in scope. Roster
   *  sizes are small (usually <200/academy), so linear scan is fine —
   *  optimize when > 1000. Threshold default 0.55 (face-api.js recommends
   *  0.6; we're a bit stricter to reduce false positives).
   *
   *  Auto-marks the matched student PRESENT for the given date. Idempotent
   *  via classId "facein-<coachId>-<yyyymmdd>". */
  async matchFaceCheckin(session: any, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const descriptor = Array.isArray(body?.descriptor) ? body.descriptor : null;
    if (!descriptor || descriptor.length !== 128) return { ok: false, error: "Bad descriptor." };
    const query: number[] = descriptor.map((n: any) => Number(n));
    const threshold = Math.max(0.3, Math.min(0.8, Number(body?.threshold) || 0.55));
    const dateRaw = String(body?.date || "").trim();
    const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10);
    const coachId = g.role === "coach" ? g.userId : (String(body?.coachId || "").trim() || null);
    const batchId = String(body?.batchId || "").trim() || null;

    // Roster in scope — enrolled students only. Match either multi-embedding
    // (faceDescriptors: number[][]) or legacy single (faceDescriptor: number[]).
    const filter: any = {
      academyId: g.academyId,
      role: "student",
      $or: [{ faceDescriptors: { $exists: true } }, { faceDescriptor: { $exists: true } }],
    };
    if (coachId) filter.coachId = coachId;
    if (batchId) {
      const b: any = await this.batches().findOne({ _id: batchId as any, academyId: g.academyId });
      if (!b) return { ok: false, error: "That batch isn't in this academy." };
      filter._id = { $in: (b.studentIds || []).map(String) as any };
    }
    const enrolled: any[] = await this.users().find(filter, { projection: { _id: 1, name: 1, username: 1, faceDescriptors: 1, faceDescriptor: 1 } }).toArray();
    if (!enrolled.length) return { ok: true, match: null, message: "No enrolled students in scope." };

    // Nearest-neighbor Euclidean. For multi-embedding users, take the MIN
    // distance across all their stored descriptors — this handles pose/
    // lighting variation better than averaging.
    let best: { studentId: string; name: string; distance: number } | null = null;
    for (const s of enrolled) {
      const descs: number[][] = Array.isArray(s.faceDescriptors) ? s.faceDescriptors
                              : Array.isArray(s.faceDescriptor) ? [s.faceDescriptor]
                              : [];
      let minDist = Infinity;
      for (const d of descs) {
        if (!Array.isArray(d) || d.length !== 128) continue;
        let sum = 0;
        for (let i = 0; i < 128; i++) { const diff = query[i]! - d[i]!; sum += diff * diff; }
        const dist = Math.sqrt(sum);
        if (dist < minDist) minDist = dist;
      }
      if (minDist !== Infinity && (!best || minDist < best.distance)) {
        best = { studentId: String(s._id), name: s.name || s.username, distance: minDist };
      }
    }
    if (!best || best.distance > threshold) return { ok: true, match: null, best };

    // Auto-mark present. Idempotent via classId "facein-...".
    const yyyymmdd = date.replace(/-/g, "");
    const classId = `facein-${coachId || g.academyId}-${yyyymmdd}`;
    const dayAt = new Date(`${date}T09:00:00`);
    await this.conn.db!.collection("classAttendance").updateOne(
      { classId, key: best.studentId },
      {
        $setOnInsert: { joinedAt: new Date(), classId, key: best.studentId, userId: best.studentId, name: best.name, manual: true, markedByUserId: g.userId },
        $set: { lastSeenAt: new Date(), status: "present", lateMinutes: null, reason: null, source: "face" },
      },
      { upsert: true },
    );
    return { ok: true, match: best, date };
  }

  /** List which students in scope have face enrollment. Used by the enrollment
   *  panel on coach's academy page + the face check-in modal ("N of M
   *  enrolled"). */
  async listFaceEnrollment(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const filter: any = { academyId: g.academyId, role: "student" };
    if (g.role === "coach") filter.coachId = g.userId;
    const students: any[] = await this.users().find(filter, { projection: { _id: 1, name: 1, username: 1, faceEnrolledAt: 1 } }).toArray();
    return {
      ok: true,
      total: students.length,
      enrolled: students.filter((s) => !!s.faceEnrolledAt).length,
      rows: students.map((s) => ({
        studentId: String(s._id), name: s.name || s.username, username: s.username,
        enrolledAt: s.faceEnrolledAt || null,
      })),
    };
  }

  /** Auto-send absent notification via Meta WhatsApp Cloud API.
   *
   *  Owner ask 2026-08-23. Uses the same WHATSAPP_TOKEN +
   *  WHATSAPP_PHONE_NUMBER_ID that DWP outreach already reuses; needs a
   *  UTILITY-category template WA_TPL_ABSENT_NOTICE approved by Meta.
   *
   *  Template (owner submits to Business Manager, category UTILITY):
   *    Name: attendance_absent_notice   Language: en_US
   *    Body:
   *      Hello, this is a message from {{1}} (via ChessGuru).
   *      {{2}} was marked ABSENT from today's chess class on {{3}}.
   *      If this was unexpected, please reach out to their coach.
   *      Thank you!
   *    Variables: {{1}}=academy name, {{2}}=student name, {{3}}=pretty date
   *
   *  While template pending approval: set OUTREACH_DRY_RUN=1 to log intent
   *  without sending. Endpoint returns per-recipient status so the coach's
   *  modal can render green ✓ / amber ⚠ / red ✗ inline.
   *
   *  Dedupe: attendanceNotifyLog collection keyed by (studentId, date,
   *  parentUserId). Re-sending the same absence is a no-op unless
   *  ?force=1 is set.
   */
  async autoSendAbsentNotifications(session: any, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const dateRaw = String(body?.date || "").trim();
    const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10);
    const studentIds: string[] = Array.isArray(body?.studentIds) ? body.studentIds.map(String) : [];
    const force = !!body?.force;
    if (!studentIds.length) return { ok: false, error: "No students to notify." };

    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const tpl = process.env.WA_TPL_ABSENT_NOTICE;
    const lang = process.env.WHATSAPP_LANG || "en_US";
    const ver = process.env.WHATSAPP_API_VERSION || "v21.0";
    const dryRun = process.env.OUTREACH_DRY_RUN === "1";
    if (!token || !phoneId) {
      return { ok: false, error: "Meta WhatsApp not configured. Set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID in apps/api/.env." };
    }
    if (!tpl) {
      return { ok: false, error: "Template not configured. Submit 'attendance_absent_notice' to Meta Business Manager, wait for approval (24-72h), then set WA_TPL_ABSENT_NOTICE=<name> in apps/api/.env + pm2 restart. Meanwhile, use the manual WhatsApp buttons — they work today." };
    }

    // Guard — only allow notifying students in this coach/owner's scope.
    const students: any[] = await this.users().find({
      _id: { $in: studentIds as any },
      academyId: g.academyId,
      role: "student",
      ...(g.role === "coach" ? { coachId: g.userId } : {}),
    }, { projection: { _id: 1, name: 1, username: 1, parentIds: 1, mobile: 1 } }).toArray();
    if (!students.length) return { ok: false, error: "None of those students are in your scope." };

    const academy: any = await this.academies().findOne({ _id: g.academyId as any }, { projection: { name: 1 } });
    const academyName = academy?.name || "the academy";
    const dParts = date.split("-").map(Number);
    const prettyDate = new Date(dParts[0]!, (dParts[1]! - 1), dParts[2]!)
      .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

    // Collect parent contacts across all selected students.
    const parentIdSet = new Set<string>();
    for (const s of students) for (const pid of (s.parentIds || []).map(String)) parentIdSet.add(pid);
    const parents: any[] = parentIdSet.size
      ? await this.users().find({ _id: { $in: [...parentIdSet] as any } }, { projection: { _id: 1, username: 1, name: 1, mobile: 1, mobileConsent: 1 } }).toArray()
      : [];
    const parentById = new Map(parents.map((p: any) => [String(p._id), p]));

    const normPhone = (m: string | null | undefined): string | null => {
      if (!m) return null;
      const digits = String(m).replace(/\D/g, "");
      if (!digits) return null;
      return digits.length === 10 ? "91" + digits : digits;   // India default
    };
    const notifyCol = this.conn.db!.collection("attendanceNotifyLog");
    try { await notifyCol.createIndex({ studentId: 1, date: 1, parentUserId: 1 }, { unique: true }); } catch {}

    const results: Array<{
      studentId: string; studentName: string;
      parentId: string | null; parentName: string | null; phone: string | null;
      ok: boolean; status: "sent" | "dry-run" | "skipped" | "no-phone" | "error";
      providerId?: string; error?: string;
    }> = [];

    for (const s of students) {
      const sid = String(s._id);
      const sName = s.name || s.username;
      const parentIds: string[] = (s.parentIds || []).map(String);
      const targets: any[] = parentIds.length
        ? parentIds.map((pid) => parentById.get(pid)).filter(Boolean)
        : (s.mobile ? [{ _id: `self:${sid}`, name: sName, mobile: s.mobile }] : []);
      if (!targets.length) {
        results.push({ studentId: sid, studentName: sName, parentId: null, parentName: null, phone: null, ok: false, status: "no-phone", error: "No parent linked or no mobile on file." });
        continue;
      }
      for (const p of targets) {
        const pid = String(p._id);
        const pName = p.name || p.username || null;
        const phone = normPhone(p.mobile);
        if (!phone) {
          results.push({ studentId: sid, studentName: sName, parentId: pid, parentName: pName, phone: null, ok: false, status: "no-phone", error: "Parent has no mobile on file." });
          continue;
        }
        // Dedup unless force
        if (!force) {
          const prior = await notifyCol.findOne({ studentId: sid, date, parentUserId: pid });
          if (prior?.status === "sent" || prior?.status === "dry-run") {
            results.push({ studentId: sid, studentName: sName, parentId: pid, parentName: pName, phone, ok: true, status: "skipped", providerId: prior.providerId });
            continue;
          }
        }
        // Fire Meta template send
        try {
          if (dryRun) {
            await notifyCol.updateOne(
              { studentId: sid, date, parentUserId: pid },
              { $set: { studentId: sid, date, parentUserId: pid, phone, status: "dry-run", providerId: "dry-run", sentAt: new Date(), template: tpl, vars: [academyName, sName, prettyDate] } },
              { upsert: true },
            );
            results.push({ studentId: sid, studentName: sName, parentId: pid, parentName: pName, phone, ok: true, status: "dry-run", providerId: "dry-run" });
            continue;
          }
          const reqBody = {
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: {
              name: tpl,
              language: { code: lang },
              components: [{ type: "body", parameters: [
                { type: "text", text: String(academyName).slice(0, 200) },
                { type: "text", text: String(sName).slice(0, 200) },
                { type: "text", text: String(prettyDate).slice(0, 60) },
              ] }],
            },
          };
          const res = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(reqBody),
          });
          const j: any = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = j?.error?.message || JSON.stringify(j).slice(0, 200);
            const code = j?.error?.code;
            const hint = code === 132001 ? " — template not approved for your WABA. Check Meta Business Manager → Message Templates."
                       : code === 131047 ? " — 24h re-engagement rule; parent hasn't messaged you recently. Only templates work here."
                       : "";
            await notifyCol.updateOne(
              { studentId: sid, date, parentUserId: pid },
              { $set: { studentId: sid, date, parentUserId: pid, phone, status: "error", error: msg + hint, sentAt: new Date() } },
              { upsert: true },
            );
            results.push({ studentId: sid, studentName: sName, parentId: pid, parentName: pName, phone, ok: false, status: "error", error: `Meta ${res.status}: ${msg}${hint}` });
            continue;
          }
          const providerId = j?.messages?.[0]?.id || "queued";
          await notifyCol.updateOne(
            { studentId: sid, date, parentUserId: pid },
            { $set: { studentId: sid, date, parentUserId: pid, phone, status: "sent", providerId, sentAt: new Date(), template: tpl, vars: [academyName, sName, prettyDate] } },
            { upsert: true },
          );
          results.push({ studentId: sid, studentName: sName, parentId: pid, parentName: pName, phone, ok: true, status: "sent", providerId });
        } catch (e: any) {
          results.push({ studentId: sid, studentName: sName, parentId: pid, parentName: pName, phone, ok: false, status: "error", error: String(e?.message || e).slice(0, 300) });
        }
      }
    }

    const sent = results.filter((r) => r.status === "sent" || r.status === "dry-run").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => !r.ok).length;
    return { ok: true, date, dryRun, sent, skipped, failed, results };
  }

  /** Read the auto-send status for a student+date so the coach's UI can
   *  show green ✓ next to already-notified parents (avoids re-sending). */
  async getAbsentNotifyStatus(session: any, studentId: string, dateStr?: string) {
    const g = this.ensureCoachOrOwner(session);
    const student: any = await this.users().findOne({ _id: studentId as any, academyId: g.academyId, role: "student" });
    if (!student) return { ok: false, error: "Not found." };
    if (g.role === "coach" && String(student.coachId || "") !== g.userId) return { ok: false, error: "Not yours." };
    const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
    const rows: any[] = await this.conn.db!.collection("attendanceNotifyLog")
      .find({ studentId, date }, { projection: { parentUserId: 1, phone: 1, status: 1, sentAt: 1, providerId: 1, error: 1 } })
      .toArray();
    return { ok: true, date, sent: rows };
  }

  /** Parent contact info for a student — used by the Attendance page to show
   *  a "📱 WhatsApp parent" button on absent cards. Returns pre-formatted
   *  wa.me click-to-chat links (works today, no Meta template needed) plus
   *  the raw phone/message so a future auto-send path can reuse it.
   *
   *  Auth: coach can only fetch for their own students; owner for anyone in
   *  the academy. Owner ask 2026-08-23. Message copy is friendly + neutral
   *  so it works whether the parent English is comfortable or not.
   */
  async getParentContact(session: any, studentId: string, dateStr?: string) {
    const g = this.ensureCoachOrOwner(session);
    const student: any = await this.users().findOne({ _id: studentId as any, academyId: g.academyId, role: "student" });
    if (!student) return { ok: false, error: "Student not found in your academy." };
    if (g.role === "coach" && String(student.coachId || "") !== g.userId) {
      return { ok: false, error: "That student isn't assigned to you." };
    }
    const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
    const parentIds: string[] = (student.parentIds || []).map(String);
    // Also fall back to the student's own mobile (some kids have their own
    // phone but no linked parent yet — the message is still useful even if
    // it reaches the kid directly for now).
    const parents: any[] = parentIds.length
      ? await this.users().find({ _id: { $in: parentIds as any } }, { projection: { _id: 1, username: 1, name: 1, mobile: 1, mobileConsent: 1, email: 1 } }).toArray()
      : [];
    const academy: any = await this.academies().findOne({ _id: g.academyId as any }, { projection: { name: 1 } });
    const academyName = academy?.name || "the academy";
    const studentName = student.name || student.username;
    // Pretty date — "Sat, Aug 23" — parents scan a message faster than a raw ISO date.
    const dParts = date.split("-").map(Number);
    const prettyDate = new Date(dParts[0]!, (dParts[1]! - 1), dParts[2]!)
      .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const message =
`Hello,

This is a message from ${academyName} (via ChessGuru).

${studentName} was marked ABSENT from today's chess class on ${prettyDate}.

If this was unexpected, please reach out to their coach.

Thank you!`;
    // Normalize a mobile to India-91 assumption if it's a bare 10-digit local.
    const norm = (m: string | null | undefined): string | null => {
      if (!m) return null;
      const digits = String(m).replace(/\D/g, "");
      if (!digits) return null;
      if (digits.length === 10) return "91" + digits;    // India default
      return digits;
    };
    const contactRows = parents.map((p) => {
      const phone = norm(p.mobile);
      return {
        parentId: String(p._id),
        name: p.name || p.username,
        email: p.email || null,
        mobile: p.mobile || null,
        mobileConsent: !!p.mobileConsent,
        phoneE164: phone,
        waLink: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
      };
    });
    // Student's own mobile fallback (only if no parent contacts exist).
    if (contactRows.length === 0 && student.mobile) {
      const phone = norm(student.mobile);
      contactRows.push({
        parentId: `self:${studentId}`,
        name: `${studentName} (student's own phone)`,
        email: student.email || null,
        mobile: student.mobile,
        mobileConsent: !!student.mobileConsent,
        phoneE164: phone,
        waLink: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
      });
    }
    return { ok: true, studentName, date, prettyDate, message, contacts: contactRows };
  }

  /** Create a QR check-in session — coach shows the QR on their tablet at
   *  class start; students scan with their phone and get marked present
   *  automatically. Owner ask 2026-08-23. Token is short-lived (~2h),
   *  scoped to a specific date + coach + batch (optional).
   *
   *  Storage: attendanceQrSessions collection with a TTL index on expiresAt
   *  (auto-cleanup — no cron job needed). Coach owns the session; only
   *  students in scope can redeem it.
   *
   *  Returns { token, expiresAt, checkinUrl } — the URL is what the QR
   *  encodes (SPA route `/checkin/:token`). */
  async createQrCheckinSession(session: any, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const dateStr = String(body?.date || "").trim();
    const date = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
    const coachId = g.role === "coach" ? g.userId : (String(body?.coachId || "").trim() || null);
    const batchId = String(body?.batchId || "").trim() || null;
    // Validate batch belongs to this academy if specified.
    if (batchId) {
      const b: any = await this.batches().findOne({ _id: batchId as any, academyId: g.academyId });
      if (!b) return { ok: false, error: "That batch isn't in this academy." };
    }
    const token = randomBytes(6).toString("base64url");   // ~8 char URL-safe, easy to type as fallback
    const expiresAt = new Date(Date.now() + 2 * 60 * 60_000);   // 2h window
    await this.conn.db!.collection("attendanceQrSessions").updateOne(
      { token },
      { $set: { token, academyId: g.academyId, coachId, batchId, date, createdByUserId: g.userId, createdAt: new Date(), expiresAt } },
      { upsert: true },
    );
    // Ensure TTL index (idempotent). expireAfterSeconds: 0 means Mongo respects
    // the exact expiresAt date field.
    try { await this.conn.db!.collection("attendanceQrSessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); } catch {}
    const base = process.env.PUBLIC_URL || "https://chessguru.cc";
    return { ok: true, token, expiresAt: expiresAt.toISOString(), checkinUrl: `${base}/checkin/${token}` };
  }

  /** Student scans the QR → this endpoint runs. Auth: student must be signed
   *  in (redirect from checkin page if not). Validates: token exists + not
   *  expired + student is in the scope (right academy; if batch scoped,
   *  student is in that batch; if coach scoped, student's coach matches).
   *  On success, marks student present for the session's date. */
  async redeemQrCheckin(session: any, token: string) {
    const userId: string | null = session?.userId ?? null;
    if (!userId) return { ok: false, error: "Sign in first." };
    const sess: any = await this.conn.db!.collection("attendanceQrSessions").findOne({ token });
    if (!sess) return { ok: false, error: "Invalid or expired check-in code." };
    if (new Date(sess.expiresAt).getTime() < Date.now()) return { ok: false, error: "This check-in code has expired." };
    const student: any = await this.users().findOne({ _id: userId as any, academyId: sess.academyId, role: "student" });
    if (!student) return { ok: false, error: "You are not a student in this academy." };
    if (sess.coachId && String(student.coachId || "") !== sess.coachId) return { ok: false, error: "This QR is for another coach's class." };
    if (sess.batchId) {
      const b: any = await this.batches().findOne({ _id: sess.batchId as any });
      if (!b || !(b.studentIds || []).map(String).includes(String(userId))) {
        return { ok: false, error: "This QR is for a specific batch you're not part of." };
      }
    }
    // Write the attendance row directly — bypasses the coach-only mark
    // guard since the student is marking THEMSELVES via a valid token.
    const dayAt = new Date(`${sess.date}T09:00:00`);
    const yyyymmdd = String(sess.date).replace(/-/g, "");
    const classId = `qrcheckin-${sess.coachId || sess.academyId}-${yyyymmdd}`;
    await this.conn.db!.collection("classAttendance").updateOne(
      { classId, key: student._id },
      {
        $setOnInsert: { joinedAt: new Date(), classId, key: student._id, userId: student._id, name: student.name || student.username, manual: true, markedByUserId: userId },
        $set: { lastSeenAt: new Date(), status: "present", lateMinutes: null, reason: null, source: "qr" },
      },
      { upsert: true },
    );
    return { ok: true, date: sess.date, name: student.name || student.username };
  }

  /** Poll endpoint — coach's QR modal calls this every few seconds to show
   *  live "N students checked in" counter. Cheap: one query on classAttendance
   *  filtered to the QR-session's classId. */
  async getQrCheckinStatus(session: any, token: string) {
    const g = this.ensureCoachOrOwner(session);
    const sess: any = await this.conn.db!.collection("attendanceQrSessions").findOne({ token, academyId: g.academyId });
    if (!sess) return { ok: false, error: "Session not found." };
    const yyyymmdd = String(sess.date).replace(/-/g, "");
    const classId = `qrcheckin-${sess.coachId || sess.academyId}-${yyyymmdd}`;
    const checked: any[] = await this.conn.db!.collection("classAttendance")
      .find({ classId, source: "qr" }, { projection: { key: 1, name: 1, lastSeenAt: 1 } })
      .sort({ lastSeenAt: -1 })
      .limit(200)
      .toArray();
    return {
      ok: true,
      date: sess.date,
      coachId: sess.coachId,
      batchId: sess.batchId,
      expiresAt: sess.expiresAt,
      count: checked.length,
      recent: checked.slice(0, 20).map((c: any) => ({ studentId: String(c.key), name: c.name, at: c.lastSeenAt })),
    };
  }

  /** Copy the attendance marks from `fromDate` to `toDate` for the same
   *  coach+batch scope. Owner ask 2026-08-23: one-click "same as last class"
   *  when 90% of the roster shows up consistently. Only re-marks students
   *  who WERE marked non-present on the source date; leaves everyone else at
   *  default present on target date. */
  async copyAttendance(session: any, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const fromRaw = String(body?.fromDate || "").trim();
    const toRaw = String(body?.toDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
      return { ok: false, error: "Bad date." };
    }
    if (fromRaw === toRaw) return { ok: false, error: "Source and target dates are the same." };
    const source = await this.getAttendanceSheet(session, fromRaw, body?.coachId || null, body?.batchId || null);
    if (!source.ok || !source.rows) return { ok: false, error: (source as any).error || "Source date has no data." };
    const marks = source.rows
      .filter((r: any) => r.status !== "present")   // only carry non-default statuses
      .map((r: any) => ({ studentId: r.studentId, status: r.status as "late" | "absent", lateMinutes: r.lateMinutes, reason: r.reason }));
    if (!marks.length) return { ok: true, date: toRaw, marked: 0, note: "Everyone was Present on the source date — nothing to copy." };
    return this.markAttendanceBulk(session, { date: toRaw, entries: marks });
  }

  /** Auto-assign a catch-up homework when a student is marked absent.
   *  Idempotent per (studentId, absentDate) via the catchupForDate marker —
   *  re-marking the same absence, or a coach flipping present→absent later,
   *  will not create duplicate homework. Owner ask 2026-08-23.
   *
   *  Tasks: 3 puzzle packs from the student's weakest themes (≥3 solves).
   *  Falls back to a curated tactical mix (pin/fork/skewer) for brand-new
   *  students. 5 puzzles per pack. Due in 7 days.
   *
   *  Idempotent + best-effort — swallows all errors so an insert failure
   *  never breaks the underlying attendance mark. Logged on failure.
   */
  private async autoAssignCatchupHomework(academyId: string, coachId: string, studentId: string, absentDate: string): Promise<void> {
    try {
      const hwCol = this.conn.db!.collection("homework");
      // Dedupe — bail if we've already assigned a catch-up for this student+date.
      const existing = await hwCol.findOne({ studentId, catchupForDate: absentDate });
      if (existing) return;
      // Pick 3 weakest themes with ≥3 solves; fallback to defaults.
      const perf: any = await this.conn.db!.collection("userperfs").findOne(
        { _id: studentId as any }, { projection: { themes: 1, puzzle: 1 } },
      );
      const overallR = perf?.puzzle?.gl?.r ? Math.round(perf.puzzle.gl.r) : 1500;
      const themes = perf?.themes || {};
      const rated: Array<{ theme: string; rating: number; nb: number }> = [];
      for (const [k, v] of Object.entries<any>(themes)) {
        if (!v?.gl?.r || !v?.nb || v.nb < 3) continue;
        rated.push({ theme: k, rating: Math.round(v.gl.r), nb: v.nb });
      }
      rated.sort((a, b) => a.rating - b.rating);   // weakest first
      const picks = rated.length >= 3
        ? rated.slice(0, 3).map((r) => ({ theme: r.theme, targetRating: r.rating }))
        : ["pin", "fork", "skewer"].map((t) => ({ theme: t, targetRating: overallR }));
      const tasks = picks.map((p) => ({
        kind: "puzzle_pack" as const,
        theme: p.theme,
        targetCount: 5,
        targetRating: p.targetRating,
      }));
      const now = new Date();
      const dParts = absentDate.split("-").map(Number);
      const pretty = new Date(dParts[0]!, (dParts[1]! - 1), dParts[2]!)
        .toLocaleDateString(undefined, { day: "2-digit", month: "short" });
      await hwCol.insertOne({
        academyId, coachId, studentId,
        title: `Catch-up · ${pretty}`,
        tasks,
        dueAt: new Date(now.getTime() + 7 * 86_400_000),
        assignedAt: now,
        status: "assigned",
        progress: {},
        completedAt: null,
        // Markers so the homework list can show a "catch-up" badge and dedup
        // key so we never assign twice for the same missed day.
        catchupForDate: absentDate,
        catchupSource: "absent",
      });
    } catch { /* best-effort — never let this break the attendance mark */ }
  }

  /** Bulk mark attendance. Body: { date, entries: [{ studentId, status,
   *  lateMinutes?, reason? }] }. Coach can only touch their own students;
   *  owner can touch any in the academy. Uses classId
   *  "manual-<coachOrOwner>-<yyyymmdd>" so re-marking is idempotent (updateOne
   *  per student). Auto-sets timestamps + captures who marked.
   *
   *  A status of "present" writes the same row as the old markStudentAttended;
   *  "late" adds lateMinutes; "absent" writes a row with status="absent" so the
   *  read side knows to display red instead of treating "no row" as absent
   *  (older data has no rows for absent kids, so we default-present on read). */
  async markAttendanceBulk(session: any, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const raw = String(body?.date || "").trim();
    const dateStr = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
    const dayAt = new Date(`${dateStr}T09:00:00`);
    if (isNaN(dayAt.getTime())) return { ok: false, error: "Bad date." };
    const yyyymmdd = dateStr.replace(/-/g, "");
    const classId = `manual-${g.userId}-${yyyymmdd}`;
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    if (!entries.length) return { ok: false, error: "No entries to mark." };

    // Guard — only touch students in this academy (and if coach, only their own).
    const idsRequested = entries.map((e: any) => String(e?.studentId || "")).filter(Boolean);
    const targets: any[] = idsRequested.length ? await this.users().find({
      _id: { $in: idsRequested as any },
      academyId: g.academyId,
      role: "student",
      ...(g.role === "coach" ? { coachId: g.userId } : {}),
    }, { projection: { _id: 1, name: 1, username: 1, coachId: 1 } }).toArray() : [];
    const allowed = new Map(targets.map((t: any) => [String(t._id), t]));

    const col = this.conn.db!.collection("classAttendance");
    let marked = 0, skipped = 0;
    for (const e of entries) {
      const uid = String(e?.studentId || "");
      const target = allowed.get(uid);
      if (!target) { skipped++; continue; }
      const status: "present" | "late" | "absent" =
        e?.status === "late" ? "late"
        : e?.status === "absent" ? "absent"
        : "present";
      const lateMinutes = status === "late" && typeof e?.lateMinutes === "number"
        ? Math.max(0, Math.min(300, Math.round(e.lateMinutes)))
        : null;
      const reason = typeof e?.reason === "string" ? e.reason.slice(0, 200) : null;
      await col.updateOne(
        { classId, key: target._id },
        {
          $setOnInsert: { joinedAt: dayAt, classId, key: target._id, userId: target._id, name: target.name || target.username, manual: true, markedByUserId: g.userId },
          $set: { lastSeenAt: new Date(), status, lateMinutes, reason },
        },
        { upsert: true },
      );
      // Phase 4d: auto-assign catch-up homework for absentees. Idempotent per
      // (student, date) so re-marking or oscillating doesn't dupe. Runs
      // sequentially inside the loop; fast (one indexed findOne + one insert)
      // and best-effort — errors swallowed so an insert failure never breaks
      // the attendance mark itself.
      if (status === "absent") {
        await this.autoAssignCatchupHomework(g.academyId, g.userId, String(target._id), dateStr);
      }
      marked++;
    }
    return { ok: true, date: dateStr, marked, skipped };
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
      .find(filter, { projection: { _id: 1, username: 1, name: 1, email: 1, coachId: 1, createdAt: 1, lastLogin: 1, dailyPuzzleStreak: 1 } })
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
      .find({ academyId, role: { $in: ["academy_owner", "coach"] } }, { projection: { _id: 1, username: 1, email: 1, role: 1, createdAt: 1, lastLogin: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    // The academy owner also coaches — include them in the roster (flagged isOwner so the UI
    // can label "You · Owner") and float them to the top. Owner is assignable like any coach.
    return rows
      .map((r: any) => ({ ...r, isOwner: r.role === "academy_owner" }))
      .sort((a: any, b: any) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0));
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
    // Dry-run: compute everything except sendMail. Coach's UI uses this to
    // show a preview modal (recipient count, whether a recording was found,
    // how many snap items will appear) before committing.
    const dryRun = !!body?.dryRun;

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

    // Positions the coach flagged during the class -- students get direct
    // links back to /board-editor so they can review the exact position
    // (with arrows the coach drew, if any). Starred snaps float to the
    // top; capped at 6 to keep the email compact.
    const rawSnaps: any[] = await this.conn.db!.collection("classSnaps")
      .find({ classId, at: { $gte: winStart, $lte: new Date(end.getTime() + 30 * 60_000) } })
      .sort({ at: -1 }).limit(24).toArray();
    const snaps = rawSnaps
      .sort((a: any, b: any) => Number(!!b.starred) - Number(!!a.starred))
      .slice(0, 6);
    const encodeShapes = (shapes: any[]): string =>
      Buffer.from(JSON.stringify(shapes)).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const snapLink = (s: any): string => {
      const fenParam = encodeURIComponent(String(s.fen));
      const shapes = Array.isArray(s.shapes) ? s.shapes : [];
      return shapes.length > 0
        ? `https://harinitharanjith.com/board-editor?fen=${fenParam}&shapes=${encodeShapes(shapes)}`
        : `https://harinitharanjith.com/board-editor?fen=${fenParam}`;
    };

    // Latest recording for this class, if any. Coaches often finish class
    // and stop the recorder just as they hit Summary, so the freshest .webm
    // in the class dir is almost always the one they meant. Missing dir /
    // empty class = no recording link in the email.
    const recDir = process.env.CLASS_RECORDINGS_DIR ?? "/home/ubuntu/chessguru-recordings";
    const fsp = await import("fs/promises");
    const path = await import("path");
    let recordingUrl: string | null = null;
    try {
      const entries = await fsp.readdir(path.join(recDir, classId));
      const webms = entries.filter((e) => /\.webm$/.test(e));
      if (webms.length > 0) {
        const withMtime = await Promise.all(webms.map(async (f) => {
          try { const st = await fsp.stat(path.join(recDir, classId, f)); return { f, m: st.mtimeMs }; }
          catch { return null; }
        }));
        const alive = withMtime.filter((x): x is { f: string; m: number } => !!x);
        alive.sort((a, b) => b.m - a.m);
        const latest = alive[0]?.f;
        if (latest) {
          recordingUrl = `https://harinitharanjith.com/class/${encodeURIComponent(classId)}/replay/${encodeURIComponent(latest)}`;
        }
      }
    } catch { /* no recording dir */ }

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
      const recordingHtml = recordingUrl ? `
          <p style="margin:16px 0 8px"><a href="${recordingUrl}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-weight:600">▶ Watch the recording</a></p>` : "";
      const recordingText = recordingUrl ? `\nWatch the recording: ${recordingUrl}\n` : "";
      const snapListHtml = snaps.length === 0 ? "" : `
          <h3 style="color:#111;margin:20px 0 8px">📸 Positions to review</h3>
          <ol style="line-height:1.6;padding-left:20px;color:#333">${snaps.map((s: any) => `
            <li style="margin-bottom:6px">
              <a href="${snapLink(s)}" style="color:#2563eb;text-decoration:none;font-weight:600">Open position${s.starred ? " ★" : ""}</a>
              ${s.note ? ` — ${escHtml(String(s.note))}` : ""}
              ${Array.isArray(s.shapes) && s.shapes.length > 0 ? ` <span style="color:#b45309;font-size:12px">(with ${s.shapes.length} arrow${s.shapes.length === 1 ? "" : "s"})</span>` : ""}
              ${s.hasAudio ? ` <span style="color:#7c3aed;font-size:12px">(🎙 voice note)</span>` : ""}
            </li>`).join("")}
          </ol>`;
      const snapListText = snaps.length === 0 ? "" : "\nPositions to review:\n" + snaps.map((s: any, i: number) =>
        `${i + 1}. ${snapLink(s)}${s.note ? ` — ${String(s.note)}` : ""}${Array.isArray(s.shapes) && s.shapes.length > 0 ? ` (${s.shapes.length} arrow${s.shapes.length === 1 ? "" : "s"})` : ""}${s.hasAudio ? " (voice note)" : ""}`
      ).join("\n") + "\n";
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
          ${recordingHtml}
          ${snapListHtml}
          <p style="color:#666;font-size:13px">Keep it up! Log in at <a href="https://harinitharanjith.com">ChessGuru</a> to see your full history.</p>
        </div>`;
      const text = [
        `${acadName} — ${dateStr}`, "",
        `Hi ${u.username} — here's your recap.`, "",
        `- Class duration: ${sched.durationMin || 60}m`,
        `- Puzzles solved during class: ${p.total}${winRate !== null ? ` (win rate ${winRate}%)` : ""}`,
        note ? `\nNote from your coach: ${note}` : "",
        recordingText,
        snapListText,
        "",
        "Keep it up! https://harinitharanjith.com",
      ].join("\n");
      if (dryRun) { sent++; continue; }   // simulate a successful send for the caller's counter
      const r = await sendMail({ to: u.email, subject, html, text });
      if (r.ok) sent++; else failed++;
    }
    // On a real send with at least one email out, timestamp the class so the
    // dashboard can show a "📧 sent Xh ago" chip. Failed-only runs don't stamp
    // (coach can retry cleanly).
    if (!dryRun && sent > 0) {
      // Clear any prior auto-failure stamp so the coach's dashboard drops
      // the "⚠️ auto failed" chip -- the manual send (or later successful
      // auto retry) is now the source of truth.
      await this.conn.db!.collection("classSchedules").updateOne(
        { _id: classId as any },
        {
          $set: { summarySentAt: new Date() },
          $unset: { autoSummaryFailedAt: "", autoSummaryFailedCount: "", autoSummaryFailedError: "" },
        }
      );
    }
    if (!dryRun && body?._autoSummarySystem) {
      // Stamp autoSummarySentAt regardless of `sent` so the worker doesn't
      // retry the same zero-recipient class every 5 min forever.
      await this.conn.db!.collection("classSchedules").updateOne(
        { _id: classId as any }, { $set: { autoSummarySentAt: new Date() } }
      );
    }
    return {
      ok: true, dryRun, sent, failed, attendees: attendees.length,
      // Extras used by the coach's preview modal.
      snapCount: snaps.length,
      hasRecording: !!recordingUrl,
      recordingUrl: recordingUrl || null,
    };
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
      audioBytes: typeof r.audioBytes === "number" ? r.audioBytes : undefined,
      transcript: typeof r.transcript === "string" ? r.transcript : undefined,
      reviewedAt: r.reviewedAt ?? null,
      byUserId: String(r.byUserId), byName: r.byName || r.byUserId,
      at: r.at,
    }));
  }

  /** System entry-point for the auto-summary cron. Synthesises a session
   *  from the class doc (as if the coach who scheduled it triggered the
   *  send), then delegates to the existing sendClassSummary flow. Returns
   *  { skipped: reason } when the class doesn't qualify (guardrails so
   *  the caller can log without needing to duplicate the check). */
  async runAutoSummaryFor(classId: string) {
    const sched: any = await this.conn.db!.collection("classSchedules").findOne({ _id: classId as any });
    if (!sched) return { skipped: "not-found" };
    if (!sched.autoSummary) return { skipped: "not-opted-in" };
    if (sched.summarySentAt) return { skipped: "already-sent-manual" };
    if (sched.autoSummarySentAt) return { skipped: "already-sent-auto" };
    if (!sched.createdByUserId) return { skipped: "no-coach" };
    const session = {
      userId: sched.createdByUserId,
      username: sched.coach || "",
      academyId: sched.academyId || null,
      role: "academy_owner" as const,   // owner passes every ensure check
    };
    const note = typeof sched.autoSummaryNote === "string" ? sched.autoSummaryNote : "";
    return this.sendClassSummary(session, classId, { note, _autoSummarySystem: true });
  }

  /** Set the current user's coach-starred-digest cadence. Unknown values are
   *  rejected so a client-side typo can't wedge the field into garbage. */
  async setCoachStarredDigestCadence(userId: string, cadence: unknown) {
    const allowed = ["weekly", "biweekly", "monthly"] as const;
    if (typeof cadence !== "string" || !(allowed as readonly string[]).includes(cadence)) {
      return { ok: false, error: "cadence must be one of weekly / biweekly / monthly" };
    }
    await this.users().updateOne({ _id: userId as any }, { $set: { coachStarredDigestCadence: cadence } });
    return { ok: true, cadence };
  }

  /** Coach sends a single snap to one of their students via email. Authz:
   *  the caller must be the snap author AND the target must be a member of
   *  the same academy (owner) or attached to the caller as coach (coachId).
   *  Records the send in coachSnapSends for audit. */
  async sendSnapToStudent(session: any, snapId: string, targetUserId: string, message: string) {
    const g = this.ensureCoachOrOwner(session);
    if (!/^sn_[A-Za-z0-9_-]{6,32}$/.test(snapId)) return { ok: false, error: "bad snap id" };
    const snap: any = await this.conn.db!.collection("classSnaps").findOne({ _id: snapId as any });
    if (!snap) return { ok: false, error: "snap not found" };
    if (String(snap.byUserId) !== g.userId) return { ok: false, error: "you can only send your own snaps" };
    const student: any = await this.users().findOne({ _id: targetUserId as any },
      { projection: { _id: 1, username: 1, email: 1, academyId: 1, coachId: 1 } });
    if (!student) return { ok: false, error: "student not found" };
    if (!student.email) return { ok: false, error: "no email on file for this student" };
    if (g.role === "coach" && student.coachId !== g.userId) return { ok: false, error: "student is not attached to you" };
    if (g.role === "academy_owner" && student.academyId !== g.academyId) return { ok: false, error: "student is not in your academy" };
    // Build the board-editor link with arrows preserved.
    const shapes = Array.isArray(snap.shapes) ? snap.shapes : [];
    const fenParam = encodeURIComponent(String(snap.fen));
    const shapesParam = shapes.length > 0
      ? "&shapes=" + Buffer.from(JSON.stringify(shapes)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
      : "";
    const link = `https://harinitharanjith.com/board-editor?fen=${fenParam}${shapesParam}`;
    const noteTrim = String(message || "").slice(0, 500);
    const subject = `Coach ${g.username || "your coach"} shared a position with you`;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px">
        <h2 style="color:#111;margin-bottom:4px">A position to study</h2>
        <p style="color:#666;margin-top:0">Hi ${escHtml(student.username || targetUserId)} — your coach shared this position from a recent class.</p>
        ${noteTrim ? `<div style="border-left:3px solid #2563eb;padding:8px 12px;background:#f0f7ff;margin:16px 0"><b>Coach:</b><br/>${escHtml(noteTrim)}</div>` : ""}
        ${snap.note ? `<p style="color:#374151;margin:8px 0"><i>Original note:</i> ${escHtml(String(snap.note))}</p>` : ""}
        <p style="margin:16px 0"><a href="${link}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-weight:600">▶ Open the position</a></p>
        ${shapes.length > 0 ? `<p style="color:#b45309;font-size:12px">Your coach drew ${shapes.length} arrow${shapes.length === 1 ? "" : "s"} — they'll show up when you open the board.</p>` : ""}
        <p style="color:#9ca3af;font-size:11px;margin-top:24px">Sent via ChessGuru academy dashboard.</p>
      </div>`;
    const text = [
      `A position to study`, "",
      `Hi ${student.username || targetUserId} — your coach shared this position from a recent class.`, "",
      noteTrim ? `Coach: ${noteTrim}\n` : "",
      snap.note ? `Original note: ${snap.note}\n` : "",
      `Open the position: ${link}`,
      shapes.length > 0 ? `(${shapes.length} coach arrows will show)` : "",
    ].filter(Boolean).join("\n");
    const r = await sendMail({ to: student.email, subject, html, text });
    if (!r.ok) return { ok: false, error: "email transport failed" };
    // Audit log for coach → student sends. Cheap append-only doc.
    await this.conn.db!.collection("coachSnapSends").insertOne({
      snapId, byUserId: g.userId, byName: g.username,
      toUserId: targetUserId, toUsername: student.username, toEmail: student.email,
      note: noteTrim, at: new Date(),
    } as any);
    return { ok: true, to: student.username, email: student.email };
  }

  /** Aggregate counts of the coach's outbound snap shares. Powers the
   *  today-ribbon "📤 Shares" tile so the coach sees at a glance how
   *  many positions they've sent out this week. */
  async snapShareStatsFor(userId: string) {
    const sends = this.conn.db!.collection("coachSnapSends");
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [total, thisWeek, recent]: [number, number, any[]] = await Promise.all([
      sends.countDocuments({ byUserId: String(userId) }),
      sends.countDocuments({ byUserId: String(userId), at: { $gte: weekAgo } }),
      sends.find({ byUserId: String(userId) },
        { projection: { snapId: 1, toUsername: 1, toEmail: 1, note: 1, at: 1 } as any })
        .sort({ at: -1 }).limit(20).toArray(),
    ]);
    return {
      total,
      thisWeek,
      recent: recent.map((r) => ({
        snapId: r.snapId,
        toUsername: r.toUsername || "",
        toEmail: r.toEmail || "",
        note: r.note || "",
        at: r.at,
      })),
    };
  }

  /** Aggregation of the coach's outbound shares grouped by snapId, so the
   *  client can add a ShareCount column to CSV exports and (later) badge
   *  cards with a "sent 3×" chip. Returns a plain { snapId: count } map. */
  async snapShareTallyFor(userId: string): Promise<Record<string, number>> {
    const rows = await this.conn.db!.collection("coachSnapSends").aggregate([
      { $match: { byUserId: String(userId) } },
      { $group: { _id: "$snapId", n: { $sum: 1 } } },
    ]).toArray();
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r._id)] = Number(r.n);
    return out;
  }

  /** Academy leaderboard — visible to any academy member (students too, so
   *  they can see themselves ranked). Percentile-based ChessGuru Score keeps
   *  it fair inside the academy (relative, not absolute). Six dimensions:
   *    - Rating percentile        25%   long-term skill
   *    - Puzzles solved (period)  25%   log-scaled recent effort
   *    - Accuracy % (period)      15%   quality
   *    - Streak                   15%   consistency (sqrt of current, cap 60)
   *    - Theme diversity          10%   breadth (period distinct themes / 20)
   *    - Attendance (30d)         10%   class engagement
   *
   *  Period options: today | 7d | 30d | 180d | 365d | lifetime. Some
   *  columns (current rating, peak rating, streak, longestStreak) are
   *  period-independent; the rest are windowed. */
  async buildLeaderboard(session: any, periodRaw: string, opts: { bucket?: string; withDelta?: boolean; sortBy?: "score" | "consistency"; academy?: string } = {}) {
    const userId = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    // Super-admin cross-academy override (owner ask 2026-08-27, ranjith.vsk):
    // when the signed-in user is in ADMIN_USERS AND passes ?academy=<slug>,
    // scope the leaderboard to THAT academy instead of the caller's own.
    // Non-admins ignore the param — session.academyId still wins.
    //
    // Sentinel `__platform__` = the "no-academy" bucket: standalone users
    // who signed up on chessguru.cc without an academy invite. Only admins
    // can see this bucket (also visible on the picker as "ChessGuru (no
    // academy)").
    const isAdminUser = isAdmin(userId);
    const isPlatformBucket = isAdminUser && opts.academy === "__platform__";
    const isAllBucket = isAdminUser && opts.academy === "__all__";
    const academyId: string | undefined = (isPlatformBucket || isAllBucket)
      ? String(opts.academy)                                              // sentinel — resolved in the roster filter below
      : (isAdminUser && opts.academy ? String(opts.academy) : session?.academyId);
    if (!academyId) throw new ForbiddenException("sign in first");

    const period = ["today", "7d", "30d", "180d", "365d", "lifetime"].includes(periodRaw) ? periodRaw : "7d";
    // Rating buckets — uniform 200-point intervals, keyed by the lower
    // bound (`u800` = under 800, `r800`..`r1800` = 200-wide bands, `r2000` = 2000+).
    const bucket = opts.bucket && ["u800", "r800", "r1000", "r1200", "r1400", "r1600", "r1800", "r2000"].includes(opts.bucket) ? opts.bucket : null;
    const now = Date.now();
    const IST_OFFSET_MIN = 330;
    const nowIst = new Date(now + IST_OFFSET_MIN * 60_000);
    const todayIstStartUtc = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate())
      - IST_OFFSET_MIN * 60_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff: Date | null =
      period === "lifetime" ? null :
      period === "today"    ? new Date(todayIstStartUtc) :
      period === "7d"       ? new Date(now -  7 * dayMs) :
      period === "30d"      ? new Date(now - 30 * dayMs) :
      period === "180d"     ? new Date(now - 180 * dayMs) :
                              new Date(now - 365 * dayMs);

    // Roster — every student in the academy. Special buckets:
    //   __platform__ = self-signup users with no academyId (role optional)
    //   __all__      = every ChessGuru user (across all academies + standalone)
    //                  — the fleet-wide leaderboard view for super-admins.
    const rosterFilter: any = isAllBucket
      ? { $or: [
          { role: "student" },
          { role: { $exists: false } },
          { role: null },
        ] }
      : isPlatformBucket
        ? { $and: [
            { $or: [{ academyId: null }, { academyId: { $exists: false } }] },
            { $or: [{ role: "student" }, { role: { $exists: false } }, { role: null }] },
          ] }
        : { academyId, role: "student" };
    let students: any[] = await this.users()
      .find(rosterFilter, { projection: { _id: 1, username: 1, name: 1, coachId: 1, dailyPuzzleStreak: 1 } })
      .toArray();
    // Active boost — 1.5× multiplier on puzzles solved that match the theme
    // (or `k=blindfold` special case) for the current period ONLY. So a coach
    // saying "this week is endgame week" actually re-shuffles the ranking
    // toward students who did endgame puzzles.
    const activeBoost = await this.getActiveBoost(academyId);
    if (students.length === 0) {
      return { period, computedAt: new Date().toISOString(), academyId, studentCount: 0, weights: WEIGHTS, rows: [], champions: {} };
    }
    const ids = students.map((s) => String(s._id));

    // Current + blindfold ratings (from userperfs) + a best-effort peak
    // = max of the last-N history in `re[]`. True lifetime peak would need
    // per-round scanning; peak-from-history covers 12 most-recent solves
    // which is what the coach cards already show.
    const perfs: any[] = await this.conn.db!.collection("userperfs")
      .find({ _id: { $in: ids as any } }, { projection: { _id: 1, puzzle: 1, blindfold: 1 } })
      .toArray();
    const perfMap = new Map<string, any>();
    for (const p of perfs) perfMap.set(String(p._id), p);

    // Puzzles + blindfold aggregation — one scan with a $facet: period counts,
    // period accuracy, period avg solve time, period distinct themes, plus
    // lifetime totals and peak `pr` (user rating at time of solve).
    // Rounds `_id` is `userId:puzzleId`; split to bucket by user.
    const roundMatch: any = { };
    if (cutoff) roundMatch.d = { $gte: cutoff };
    // We aggregate ALL rounds (periods + lifetime) in a single pipeline so
    // we don't scan the collection multiple times.
    const scanMatch = { d: { $gte: cutoff ?? new Date(0) } };

    const boostTheme = activeBoost?.theme || null;
    const boostIsBlindfold = boostTheme === "blindfold";
    const roundAgg = await this.conn.db!.collection("rounds").aggregate([
      // Fast pre-filter on date if we have a cutoff (index-friendly).
      ...(cutoff ? [{ $match: scanMatch }] : []),
      { $project: {
          u: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] },
          w: 1, ms: 1, th: 1, k: 1, d: 1,
      } },
      { $match: { u: { $in: ids as any } } },
      { $group: {
          _id: "$u",
          puzzles: { $sum: 1 },
          wins: { $sum: { $cond: ["$w", 1, 0] } },
          blindfoldPuzzles: { $sum: { $cond: [{ $eq: ["$k", "blindfold"] }, 1, 0] } },
          // Count puzzles that match the active boost — theme or blindfold-mode.
          boostedPuzzles: {
            $sum: {
              $cond: [
                boostTheme
                  ? (boostIsBlindfold
                      ? { $eq: ["$k", "blindfold"] }
                      : { $in: [boostTheme, { $ifNull: ["$th", []] }] })
                  : false,
                1, 0,
              ],
            },
          },
          themes: { $addToSet: { $cond: [{ $isArray: "$th" }, "$th", []] } }, // array of arrays
          totalMs: { $sum: { $ifNull: ["$ms", 0] } },
          timedCount: { $sum: { $cond: [{ $gt: ["$ms", 0] }, 1, 0] } },
      } },
    ]).toArray();
    const roundMap = new Map<string, any>();
    for (const r of roundAgg) {
      const themeFlat = new Set<string>();
      for (const arr of (r.themes || [])) for (const t of arr) if (typeof t === "string") themeFlat.add(t);
      roundMap.set(String(r._id), {
        puzzles: r.puzzles ?? 0,
        wins: r.wins ?? 0,
        blindfoldPuzzles: r.blindfoldPuzzles ?? 0,
        boostedPuzzles: r.boostedPuzzles ?? 0,
        themesCount: themeFlat.size,
        themes: [...themeFlat].slice(0, 12),
        avgSolveMs: r.timedCount > 0 ? Math.round(r.totalMs / r.timedCount) : null,
      });
    }

    // Lifetime totals + peak rating — separate no-date-filter aggregation.
    // Skip it if the period is already lifetime (roundMap = lifetime already).
    let lifetimeMap = new Map<string, { puzzlesLifetime: number; peakRating: number | null }>();
    if (period !== "lifetime") {
      const life = await this.conn.db!.collection("rounds").aggregate([
        { $project: {
            u: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] },
            r: 1,
        } },
        { $match: { u: { $in: ids }, r: { $type: "number" } } },
        { $group: {
            _id: "$u",
            puzzlesLifetime: { $sum: 1 },
            peakRating: { $max: "$r" },
        } },
      ]).toArray();
      for (const l of life) lifetimeMap.set(String(l._id), {
        puzzlesLifetime: l.puzzlesLifetime ?? 0,
        peakRating: l.peakRating ?? null,
      });
    } else {
      // Lifetime IS the period — reuse counts, still need peakRating.
      // Owner report 2026-08-24: previous code used $max: "$pr" which is
      // the HIGHEST PUZZLE RATING the user has solved — not the user's own
      // peak rating. Fixed to $max: "$r" (user rating after solve).
      const life = await this.conn.db!.collection("rounds").aggregate([
        { $project: { u: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, r: 1 } },
        { $match: { u: { $in: ids }, r: { $type: "number" } } },
        { $group: { _id: "$u", peakRating: { $max: "$r" } } },
      ]).toArray();
      for (const l of life) lifetimeMap.set(String(l._id), {
        puzzlesLifetime: roundMap.get(String(l._id))?.puzzles ?? 0,
        peakRating: l.peakRating ?? null,
      });
    }

    // Consistency signals (owner 2026-08-23 rebalance): active-days-in-past-30
    // (unique IST-day count from rounds) + weekly cadence (weeks in past 8 with
    // >= 3 active days). Always spans 30/56 days regardless of the leaderboard
    // period the user is viewing — consistency IS a rolling-recent-habit
    // metric, not "in the selected period".
    const consistCutoff = new Date(now - 56 * dayMs);
    const consistAgg = await this.conn.db!.collection("rounds").aggregate([
      { $match: { d: { $gte: consistCutoff } } },
      { $project: {
          u: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] },
          day: { $dateToString: { format: "%Y-%m-%d", date: "$d", timezone: "Asia/Kolkata" } },
          week: { $dateToString: { format: "%G-%V", date: "$d", timezone: "Asia/Kolkata" } },
          d: 1,
      } },
      { $match: { u: { $in: ids as any } } },
      { $group: {
          _id: { u: "$u", day: "$day", week: "$week" },
          n: { $sum: 1 },
          maxDate: { $max: "$d" },
      } },
      { $group: {
          _id: "$_id.u",
          days: { $addToSet: {
            day: "$_id.day",
            week: "$_id.week",
            n: "$n",
            recent30: { $gte: ["$maxDate", new Date(now - 30 * dayMs)] },
          } },
      } },
    ]).toArray();
    const consistMap = new Map<string, { activeDays30: number; weeklyCadence8: number }>();
    for (const c of consistAgg) {
      const days = c.days as Array<{ day: string; week: string; n: number; recent30: boolean }>;
      const activeDays30 = days.filter((d) => d.recent30).length;
      // Weeks with >= 3 active days. consistCutoff = 56 days = 8 weeks, so
      // every week key in `days` is already within the 8-week window.
      const weekDayCount = new Map<string, number>();
      for (const d of days) weekDayCount.set(d.week, (weekDayCount.get(d.week) || 0) + 1);
      const weeklyCadence8 = [...weekDayCount.values()].filter((n) => n >= 3).length;
      consistMap.set(String(c._id), { activeDays30, weeklyCadence8 });
    }

    // Attendance signals — Phase 5b (owner ask 2026-08-23): feed attendance
    // streaks into the Consistency Score. Two metrics per student:
    //   attendance30d  — count of distinct days present/late in past 30d
    //   attendanceStreak — consecutive days back from today (or yesterday)
    //                      where student was present/late. Absent days break;
    //                      unmarked / no-class days count as "no signal" and
    //                      don't extend but don't break either — we just
    //                      count DAYS THE STUDENT WAS PRESENT.
    // Both use classAttendance (any source: manual, qr, live-class), skipping
    // rows with status:"absent". Window is 60d so long streaks can be shown.
    const heatStart = new Date(now - 59 * dayMs);
    heatStart.setUTCHours(0, 0, 0, 0);
    const attRows: any[] = await this.conn.db!.collection("classAttendance").aggregate([
      { $match: { userId: { $in: ids }, joinedAt: { $gte: heatStart } } },
      { $project: {
          userId: 1,
          day: { $dateToString: { format: "%Y-%m-%d", date: "$joinedAt", timezone: "Asia/Kolkata" } },
          status: { $ifNull: ["$status", "present"] },
      } },
      { $match: { status: { $ne: "absent" } } },
      { $group: { _id: "$userId", days: { $addToSet: "$day" } } },
    ]).toArray();
    // Legacy shape: `attMap` = attended-days count in past 30d (for scoring
    // + display). Also compute `attStreakMap` = alive consecutive streak.
    const attMap = new Map<string, number>();
    const attStreakMap = new Map<string, number>();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = iso(new Date());
    const yesterday = iso(new Date(Date.now() - dayMs));
    for (const a of attRows) {
      const daySet = new Set<string>(a.days || []);
      // 30d attended count
      let count30 = 0;
      for (let i = 0; i < 30; i++) if (daySet.has(iso(new Date(Date.now() - i * dayMs)))) count30++;
      attMap.set(String(a._id), count30);
      // Live streak — walk backward from today or (fallback) yesterday.
      let cursor = daySet.has(today) ? new Date() : daySet.has(yesterday) ? new Date(Date.now() - dayMs) : null;
      let streak = 0;
      while (cursor && daySet.has(iso(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
      attStreakMap.set(String(a._id), streak);
    }

    // Streak — from users.dailyPuzzleStreak. Alive iff lastDate is today or
    // yesterday (matches the rule in listStudents).
    const todayIst = nowIst.toISOString().slice(0, 10);
    const yestIst = new Date(nowIst.getTime() - dayMs).toISOString().slice(0, 10);
    const aliveStreak = (s: any): { current: number; longest: number } => {
      const st = s?.dailyPuzzleStreak;
      if (!st) return { current: 0, longest: 0 };
      const alive = st.lastDate === todayIst || st.lastDate === yestIst;
      return { current: alive ? (st.current || 0) : 0, longest: st.longest || 0 };
    };

    // Assemble raw rows (no rank/score yet).
    const boostMul = activeBoost?.multiplier ?? 1;
    let raw = students.map((s: any) => {
      const p = perfMap.get(String(s._id));
      const r = roundMap.get(String(s._id));
      const l = lifetimeMap.get(String(s._id));
      const streak = aliveStreak(s);
      const puzzles = r?.puzzles ?? 0;
      const wins = r?.wins ?? 0;
      const accuracy = puzzles > 0 ? wins / puzzles : 0;
      const boostedPuzzles = r?.boostedPuzzles ?? 0;
      // Boost-adjusted puzzle count feeds the scoring dimension. Original
      // `puzzles` stays honest for display.
      const puzzlesForScore = puzzles + Math.max(0, boostMul - 1) * boostedPuzzles;
      return {
        studentId: String(s._id),
        username: s.username,
        name: s.name || null,
        coachId: s.coachId || null,
        currentRating: Math.round(p?.puzzle?.gl?.r ?? 1500),
        blindfoldRating: p?.blindfold?.gl?.r ? Math.round(p.blindfold.gl.r) : null,
        peakRating: l?.peakRating ?? Math.round(p?.puzzle?.gl?.r ?? 1500),
        puzzles,
        boostedPuzzles,
        puzzlesForScore,
        blindfoldPuzzles: r?.blindfoldPuzzles ?? 0,
        puzzlesLifetime: l?.puzzlesLifetime ?? puzzles,
        accuracy,
        mistakesRatio: puzzles > 0 ? 1 - accuracy : 0,
        avgSolveMs: r?.avgSolveMs ?? null,
        themesCount: r?.themesCount ?? 0,
        themes: r?.themes ?? [],
        streak: streak.current,
        longestStreak: streak.longest,
        attendance30d: attMap.get(String(s._id)) ?? 0,
        attendanceStreak: attStreakMap.get(String(s._id)) ?? 0,
        activeDays30: consistMap.get(String(s._id))?.activeDays30 ?? 0,
        weeklyCadence8: consistMap.get(String(s._id))?.weeklyCadence8 ?? 0,
      };
    });

    // Rating-bucket filter — uniform 200-point intervals so buckets are
    // fair peer groups. Applied here so score percentiles below are
    // computed WITHIN the bucket.
    if (bucket) {
      const inBucket = (r: number) =>
        bucket === "u800"  ? r < 800 :
        bucket === "r800"  ? r >= 800  && r < 1000 :
        bucket === "r1000" ? r >= 1000 && r < 1200 :
        bucket === "r1200" ? r >= 1200 && r < 1400 :
        bucket === "r1400" ? r >= 1400 && r < 1600 :
        bucket === "r1600" ? r >= 1600 && r < 1800 :
        bucket === "r1800" ? r >= 1800 && r < 2000 :
        bucket === "r2000" ? r >= 2000 : true;
      raw = raw.filter((r) => inBucket(r.currentRating));
    }

    // ── Score & rank ──
    // Each dimension normalized to 0..1 within THIS academy (percentile-ish).
    // Then weighted sum × 100 for the ChessGuru Score.
    const norm = (val: number, min: number, max: number) => max <= min ? 0 : Math.max(0, Math.min(1, (val - min) / (max - min)));
    const ratings = raw.map((r) => r.currentRating);
    const minR = Math.min(...ratings), maxR = Math.max(...ratings);
    const puzzlesArr = raw.map((r) => Math.log1p(r.puzzlesForScore));
    const minP = 0, maxP = Math.max(...puzzlesArr, 0.1);
    // Streak scaling — sqrt & cap so a 300-day streak isn't 10× a 30-day.
    const streakScore = (n: number) => Math.min(1, Math.sqrt(Math.min(n, 60)) / Math.sqrt(60));
    // Consistency composite (see WEIGHTS comment). Missing a day no longer
    // resets your rank; showing up 5 days/week for months beats sprinters.
    //
    // Phase 5b (owner 2026-08-23): attendance is now half of consistency,
    // matching the intuition "showing up matters as much as solving alone".
    //   Puzzle side (kept from earlier):
    //     0.35 × active days in past 30 (puzzles-solved days)
    //     0.20 × puzzle daily-streak (sqrt-capped)
    //     0.10 × weekly cadence (weeks with >= 3 active days)
    //   Attendance side (new):
    //     0.20 × attendance days in past 30 (physical class-attended days)
    //     0.15 × attendance streak (sqrt-capped)
    //
    // Together, a student who both practices AND shows up dominates. A
    // grinder who never attends class + a passive kid who only attends
    // both fall short of a balanced learner.
    const consistencyScore = (
      activeDays30: number, streak: number, weeklyCadence8: number,
      attendance30d: number, attendanceStreak: number,
    ) => {
      const puzzleDayP  = Math.min(1, activeDays30 / 30);
      const puzzleStrP  = streakScore(streak);
      const puzzleWeekP = Math.min(1, weeklyCadence8 / 8);
      const attDayP     = Math.min(1, attendance30d / 30);
      const attStrP     = streakScore(attendanceStreak);
      return 0.35 * puzzleDayP + 0.20 * puzzleStrP + 0.10 * puzzleWeekP
           + 0.20 * attDayP    + 0.15 * attStrP;
    };
    const rows = raw.map((r) => {
      const parts = {
        rating:      norm(r.currentRating, minR, maxR),
        puzzles:     norm(Math.log1p(r.puzzlesForScore), minP, maxP),
        accuracy:    r.puzzles >= 5 ? r.accuracy : 0, // <5 rounds = not enough signal
        consistency: consistencyScore(r.activeDays30, r.streak, r.weeklyCadence8, r.attendance30d, r.attendanceStreak),
        themes:      Math.min(1, r.themesCount / 20),
        attendance:  Math.min(1, r.attendance30d / 30),
      };
      const score =
        parts.rating      * WEIGHTS.rating +
        parts.puzzles     * WEIGHTS.puzzles +
        parts.accuracy    * WEIGHTS.accuracy +
        parts.consistency * WEIGHTS.consistency +
        parts.themes      * WEIGHTS.themes +
        parts.attendance  * WEIGHTS.attendance;
      return { ...r, score: Math.round(score * 10) / 10, scoreParts: parts };
    });
    // Owner ask 2026-08-23 "Most Consistent" tab: sortBy=consistency ranks
    // purely on the consistency composite (100% weight, ignore everything
    // else). Default sortBy=score keeps the all-rounder ChessGuru Score.
    // Same row shape either way — coach sees which kids showed up regardless
    // of their raw talent.
    if (opts.sortBy === "consistency") {
      rows.sort((a, b) => b.scoreParts.consistency - a.scoreParts.consistency);
    } else {
      rows.sort((a, b) => b.score - a.score);
    }
    rows.forEach((r: any, i) => { r.rank = i + 1; });

    // ── Rank delta — compare current-period rank against the previous
    // period of the same length (7d → previous 7d, lifetime = skip).
    // Only for non-lifetime periods; opts.withDelta gates the extra scan.
    if (opts.withDelta !== false && period !== "lifetime" && cutoff) {
      const prevEnd = cutoff;
      const windowMs = now - cutoff.getTime();
      const prevStart = new Date(prevEnd.getTime() - windowMs);
      const prevRoundAgg = await this.conn.db!.collection("rounds").aggregate([
        { $match: { d: { $gte: prevStart, $lt: prevEnd } } },
        { $project: { u: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, w: 1 } },
        { $match: { u: { $in: ids as any } } },
        { $group: { _id: "$u", puzzles: { $sum: 1 }, wins: { $sum: { $cond: ["$w", 1, 0] } } } },
      ]).toArray();
      const prevMap = new Map<string, { puzzles: number; wins: number }>();
      for (const r of prevRoundAgg) prevMap.set(String(r._id), { puzzles: r.puzzles ?? 0, wins: r.wins ?? 0 });
      // Prev-period score uses SAME weights but with prev-period puzzle+accuracy;
      // rating/streak/themes/attendance are current (approximation — good enough
      // to detect week-over-week movement).
      const prevRaw = raw.map((r: any) => {
        const p = prevMap.get(r.studentId);
        const puzzles = p?.puzzles ?? 0;
        const accuracy = puzzles > 0 ? (p?.wins ?? 0) / puzzles : 0;
        const parts = {
          rating:      norm(r.currentRating, minR, maxR),
          puzzles:     norm(Math.log1p(puzzles), 0, Math.max(...raw.map((rr: any) => Math.log1p(prevMap.get(rr.studentId)?.puzzles ?? 0)), 0.1)),
          accuracy:    puzzles >= 5 ? accuracy : 0,
          consistency: consistencyScore(r.activeDays30, r.streak, r.weeklyCadence8, r.attendance30d, r.attendanceStreak),
          themes:      Math.min(1, r.themesCount / 20),
          attendance:  Math.min(1, r.attendance30d / 30),
        };
        const score =
          parts.rating * WEIGHTS.rating + parts.puzzles * WEIGHTS.puzzles +
          parts.accuracy * WEIGHTS.accuracy + parts.consistency * WEIGHTS.consistency +
          parts.themes * WEIGHTS.themes + parts.attendance * WEIGHTS.attendance;
        return { studentId: r.studentId, score };
      });
      prevRaw.sort((a, b) => b.score - a.score);
      const prevRankMap = new Map<string, number>();
      prevRaw.forEach((r, i) => prevRankMap.set(r.studentId, i + 1));
      for (const r of rows as any[]) {
        const pr = prevRankMap.get(r.studentId);
        r.prevRank = pr ?? null;
        r.deltaRank = pr ? pr - r.rank : null; // positive = moved UP
      }
    }

    // ── Badges — count per student, cheap join against the roster ids.
    const badgeRows: any[] = await this.badges().aggregate([
      { $match: { academyId, userId: { $in: ids } } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]).toArray();
    const badgeMap = new Map<string, number>();
    for (const b of badgeRows) badgeMap.set(String(b._id), b.count);
    for (const r of rows as any[]) r.badgesUnlocked = badgeMap.get(r.studentId) ?? 0;

    // Micro-champions — highest achiever in each dimension for the header.
    const champion = (fn: (r: any) => number, minVal = 1) => {
      const winner = [...rows].sort((a, b) => fn(b) - fn(a))[0];
      if (!winner || fn(winner) < minVal) return null;
      return { studentId: winner.studentId, username: winner.username, name: winner.name, value: fn(winner) };
    };
    const champions = {
      overall:      rows[0] ? { studentId: rows[0].studentId, username: rows[0].username, name: rows[0].name, value: rows[0].score } : null,
      mostPuzzles:  champion((r) => r.puzzles),
      bestAccuracy: rows.some((r) => r.puzzles >= 5) ? champion((r) => Math.round(r.accuracy * 1000) / 10, 1) : null,
      // Fastest — lowest avgSolveMs (invert). Require ≥5 timed solves.
      fastest: (() => {
        const timed = rows.filter((r) => r.avgSolveMs && r.puzzles >= 5);
        if (timed.length === 0) return null;
        timed.sort((a, b) => (a.avgSolveMs || 0) - (b.avgSolveMs || 0));
        const w = timed[0]!;
        return { studentId: w.studentId, username: w.username, name: w.name, value: w.avgSolveMs! };
      })(),
      longestStreak: champion((r) => r.streak),
      mostThemes:    champion((r) => r.themesCount),
      blindfoldKing: champion((r) => r.blindfoldPuzzles),
      // Owner ask 2026-08-23: "reward consistent players". Micro-champion
      // celebrated in the leaderboard header alongside overall winner.
      // Phase 5b: champion is picked by the composite consistency (both
      // puzzles + attendance). Uses the same score the leaderboard sorts by
      // when sortBy=consistency — one source of truth.
      mostConsistent: champion((r) => Math.round((r.scoreParts?.consistency ?? 0) * 100), 5),
      // Longest attendance streak — dedicated award for physical showing-up.
      attendanceChampion: champion((r) => r.attendanceStreak, 3),
    };

    // Comeback of the period — biggest positive deltaRank.
    let comeback: any = null;
    if (opts.withDelta !== false && period !== "lifetime") {
      const withDelta = (rows as any[]).filter((r) => typeof r.deltaRank === "number" && r.deltaRank > 0);
      withDelta.sort((a, b) => (b.deltaRank || 0) - (a.deltaRank || 0));
      const c = withDelta[0];
      if (c) comeback = { studentId: c.studentId, username: c.username, name: c.name, value: c.deltaRank };
    }

    return {
      period,
      bucket,
      computedAt: new Date().toISOString(),
      academyId,
      studentCount: rows.length,
      weights: WEIGHTS,
      rows,
      champions: { ...champions, comeback },
      activeBoost: activeBoost ? {
        theme: activeBoost.theme,
        multiplier: activeBoost.multiplier,
        startAt: activeBoost.startAt,
        endAt: activeBoost.endAt,
        byName: activeBoost.byName,
        note: activeBoost.note || "",
      } : null,
    };
  }

  /** Owner-or-coach: per-student activity counts scoped to a rolling window
   *  (days). Returns puzzles solved (rounds in the window) and opening/
   *  study cards revised (revision docs whose lastReviewedAt lands in the
   *  window) — the two engagement metrics the coach uses on
   *  /academy/performance to see "who's actually training". Two small
   *  aggregations, both scoped to this academy's students. */
  async listStudentActivity(session: any, days: number) {
    const g = this.ensureCoachOrOwner(session);
    const d = Math.max(1, Math.min(3650, Math.floor(Number(days) || 7)));
    const filter: any = { academyId: g.academyId, role: "student" };
    if (g.role === "coach") filter.coachId = g.userId;
    const rows = await this.users().find(filter, { projection: { _id: 1 } }).toArray();
    const ids = rows.map((r: any) => String(r._id));
    if (ids.length === 0) return { days: d, activity: [] as any[] };
    const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

    const puzzleRows: any[] = await this.conn.db!.collection("rounds").aggregate([
      { $match: { d: { $gte: cutoff } } },
      { $project: { u: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] } } },
      { $match: { u: { $in: ids } } },
      { $group: { _id: "$u", puzzles: { $sum: 1 } } },
    ]).toArray();
    const pmap: Record<string, number> = {};
    for (const p of puzzleRows) pmap[String(p._id)] = p.puzzles ?? 0;

    // Cards touched (reviewed) in the window — a revision doc's
    // lastReviewedAt is bumped every time the student reviews the card,
    // so "cards reviewed in period" is a proxy for revision activity.
    const revRows: any[] = await this.conn.db!.collection("revisions").aggregate([
      { $match: { userId: { $in: ids }, lastReviewedAt: { $gte: cutoff } } },
      { $group: { _id: "$userId", openings: { $sum: 1 } } },
    ]).toArray();
    const rmap: Record<string, number> = {};
    for (const r of revRows) rmap[String(r._id)] = r.openings ?? 0;

    return {
      days: d,
      activity: ids.map((id) => ({
        studentId: id,
        puzzles: pmap[id] ?? 0,
        openings: rmap[id] ?? 0,
      })),
    };
  }

  /** Presence heartbeat — any signed-in user pings this every ~60s (and on
   *  route change) so coaches can see "who's online right now, and what are
   *  they doing". Stored inline on the user doc: cheap to write, cheap to
   *  read alongside the roster. No new collection. Path is capped at 200
   *  chars and stripped of query strings to avoid leaking hash-only state
   *  like `?back=…&token=…`. */
  async heartbeat(userId: string, rawPath: string) {
    if (!userId) return { ok: false };
    const clean = String(rawPath || "/").split("?", 1)[0] ?? "/";
    const path = (clean.split("#", 1)[0] ?? "/").slice(0, 200) || "/";
    await this.users().updateOne(
      { _id: userId as any },
      { $set: { lastSeen: new Date(), currentPath: path } },
    );
    return { ok: true };
  }

  /** Owner-or-coach: presence buckets for the coach's roster.
   *   - `now`       : lastSeen within 3 min (actually online)
   *   - `recent`    : lastSeen 3–60 min (was here recently, may be back)
   *   - `todayCount`: unique students seen since 00:00 IST today
   *  Grouping by role scope (owner=all, coach=own students) matches
   *  listStudents. One collection scan, in-memory bucketing. */
  async listLivePresence(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const now = Date.now();
    const nowCutoff = new Date(now - 3 * 60_000);
    const recentCutoff = new Date(now - 60 * 60_000);
    // "Today" is India Standard Time (UTC+5:30) — the audience is Indian
    // academies, so the boundary that matches their "today" is IST midnight,
    // not UTC midnight. Compute the current IST calendar date's 00:00 as a
    // UTC instant.
    const IST_OFFSET_MIN = 330;
    const nowIst = new Date(now + IST_OFFSET_MIN * 60_000);
    const todayIstStart = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate())
      - IST_OFFSET_MIN * 60_000;
    const todayCutoff = new Date(todayIstStart);

    const filter: any = { academyId: g.academyId, role: "student", lastSeen: { $gte: todayCutoff } };
    if (g.role === "coach") filter.coachId = g.userId;
    const rows = await this.users()
      .find(filter, { projection: { _id: 1, username: 1, name: 1, lastSeen: 1, currentPath: 1 } })
      .sort({ lastSeen: -1 })
      .limit(500)
      .toArray();

    const shape = (r: any) => ({
      _id: r._id,
      username: r.username,
      name: r.name || null,
      lastSeen: r.lastSeen,
      currentPath: r.currentPath || "/",
    });
    const nowList: any[] = [];
    const recentList: any[] = [];
    for (const r of rows) {
      const t = new Date(r.lastSeen).getTime();
      if (t >= nowCutoff.getTime()) nowList.push(shape(r));
      else if (t >= recentCutoff.getTime()) recentList.push(shape(r));
    }

    // Streak-at-risk — students whose streak is still alive but they haven't
    // solved TODAY yet. lastDate === yesterday means one more no-solve day
    // resets the streak to 0. Coach can DM them before midnight IST.
    // ISO day is the same YYYY-MM-DD format the puzzles service writes.
    const todayIst = nowIst.toISOString().slice(0, 10);
    const yestIst = new Date(nowIst.getTime() - 24 * 60 * 60_000).toISOString().slice(0, 10);
    const streakFilter: any = {
      academyId: g.academyId,
      role: "student",
      "dailyPuzzleStreak.current": { $gt: 0 },
      "dailyPuzzleStreak.lastDate": yestIst,
    };
    if (g.role === "coach") streakFilter.coachId = g.userId;
    const streakRows = await this.users()
      .find(streakFilter, { projection: { _id: 1, username: 1, name: 1, dailyPuzzleStreak: 1 } })
      .sort({ "dailyPuzzleStreak.current": -1 })
      .limit(200)
      .toArray();
    const streakAtRisk = streakRows.map((r: any) => ({
      _id: r._id,
      username: r.username,
      name: r.name || null,
      streakDays: r.dailyPuzzleStreak?.current || 0,
      lastDate: r.dailyPuzzleStreak?.lastDate || null,
    }));

    return {
      now: nowList,
      recent: recentList,
      todayCount: rows.length,
      streakAtRisk,
      todayIst,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  //  ACHIEVEMENTS
  // ─────────────────────────────────────────────────────────────────────

  /** Evaluate a student's raw activity against the achievement catalog and
   *  return `{ unlocked, progress }`. Idempotent — the actual persistence
   *  (writing to `academyBadges`) happens in a separate step so this can
   *  also be called for preview (before persistence). */
  async evaluateAchievements(studentId: string): Promise<Array<Achievement & { unlocked: boolean; progress: number; progressLabel: string }>> {
    if (!studentId) return [];
    const [user, perf, roundAgg, themeAgg, weekAgg] = await Promise.all([
      this.users().findOne({ _id: studentId as any }, { projection: { dailyPuzzleStreak: 1 } }),
      this.conn.db!.collection("userperfs").findOne({ _id: studentId as any }, { projection: { puzzle: 1, blindfold: 1 } }),
      // Overall counts + peak rating
      this.conn.db!.collection("rounds").aggregate([
        { $match: { _id: { $regex: `^${studentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` } as any } },
        { $group: {
            _id: null,
            total: { $sum: 1 },
            blindfold: { $sum: { $cond: [{ $eq: ["$k", "blindfold"] }, 1, 0] } },
            // Peak = user's highest personal rating ever (from rounds.r).
            // Fixed 2026-08-24: was $max: "$pr" (puzzle rating) which showed
            // "hardest puzzle solved" not "your peak rating".
            peakPr: { $max: "$r" },
            themes: { $addToSet: "$th" },
        } },
      ]).toArray().then((rows) => rows[0] || null),
      // Theme mastery — per-theme count + accuracy (lifetime).
      this.conn.db!.collection("rounds").aggregate([
        { $match: { _id: { $regex: `^${studentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` } as any } },
        { $project: { th: 1, w: 1 } },
        { $unwind: { path: "$th", preserveNullAndEmptyArrays: false } },
        { $group: {
            _id: "$th",
            n: { $sum: 1 },
            wins: { $sum: { $cond: ["$w", 1, 0] } },
        } },
      ]).toArray(),
      // Speed + accuracy for special badges — last 7d only.
      this.conn.db!.collection("rounds").aggregate([
        { $match: {
            _id: { $regex: `^${studentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` } as any,
            d: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
        } },
        { $group: {
            _id: null,
            n: { $sum: 1 },
            wins: { $sum: { $cond: ["$w", 1, 0] } },
            fast: { $sum: { $cond: [{ $and: [{ $gt: ["$ms", 0] }, { $lt: ["$ms", 10_000] }] }, 1, 0] } },
        } },
      ]).toArray().then((rows) => rows[0] || null),
    ]);

    const themeMap = new Map<string, { n: number; wins: number }>();
    for (const t of themeAgg) themeMap.set(String(t._id), { n: t.n, wins: t.wins });
    // Distinct-themes count = flatten th sets from roundAgg.
    const distinctThemes = new Set<string>();
    for (const arr of (roundAgg?.themes || [])) for (const t of (arr || [])) if (typeof t === "string") distinctThemes.add(t);

    const totalRounds     = roundAgg?.total ?? 0;
    const blindRounds     = roundAgg?.blindfold ?? 0;
    const peakRating      = roundAgg?.peakPr ?? Math.round(perf?.puzzle?.gl?.r ?? 1500);
    const currentRating   = Math.round(perf?.puzzle?.gl?.r ?? 1500);
    const streakCurrent   = user?.dailyPuzzleStreak?.current ?? 0;
    const streakLongest   = user?.dailyPuzzleStreak?.longest ?? 0;
    const week            = weekAgg;

    return ACHIEVEMENTS.map((a) => {
      let unlocked = false, progress = 0, target = a.n ?? 1;
      let progressLabel = "";
      switch (a.kind) {
        case "count-rounds": {
          progress = totalRounds;
          unlocked = totalRounds >= target;
          progressLabel = `${totalRounds}/${target} puzzles`;
          break;
        }
        case "count-blindfold": {
          progress = blindRounds;
          unlocked = blindRounds >= target;
          progressLabel = `${blindRounds}/${target} blindfold puzzles`;
          break;
        }
        case "current-rating": {
          progress = currentRating;
          unlocked = currentRating >= target;
          progressLabel = `${currentRating} / ${target} rating`;
          break;
        }
        case "peak-rating": {
          progress = peakRating;
          unlocked = peakRating >= target;
          progressLabel = `peak ${peakRating} / ${target}`;
          break;
        }
        case "theme-mastery": {
          const t = themeMap.get(a.theme || "");
          const n = t?.n ?? 0;
          const acc = t && t.n > 0 ? (t.wins / t.n) : 0;
          progress = n;
          unlocked = n >= (a.n || 0) && acc >= (a.accuracy || 0);
          progressLabel = `${n}/${a.n} ${a.theme} @ ${Math.round(acc*100)}% (need ${Math.round((a.accuracy||0)*100)}%)`;
          break;
        }
        case "current-streak": {
          progress = streakCurrent;
          unlocked = streakCurrent >= target;
          progressLabel = `${streakCurrent}/${target}d streak`;
          break;
        }
        case "longest-streak": {
          progress = streakLongest;
          unlocked = streakLongest >= target;
          progressLabel = `longest ${streakLongest}/${target}d`;
          break;
        }
        case "speed-week": {
          progress = week?.fast ?? 0;
          unlocked = (week?.fast ?? 0) >= target;
          progressLabel = `${week?.fast ?? 0}/${target} fast solves in 7d`;
          break;
        }
        case "accuracy-week": {
          const n = week?.n ?? 0;
          const acc = n > 0 ? ((week?.wins ?? 0) / n) : 0;
          progress = n;
          unlocked = n >= target && acc >= (a.accuracy || 0);
          progressLabel = `${n}/${target} solves in 7d @ ${Math.round(acc*100)}% (need ${Math.round((a.accuracy||0)*100)}%)`;
          break;
        }
        case "theme-variety": {
          progress = distinctThemes.size;
          unlocked = distinctThemes.size >= target;
          progressLabel = `${distinctThemes.size}/${target} distinct themes`;
          break;
        }
      }
      return { ...a, unlocked, progress, progressLabel };
    });
  }

  /** Persist newly-unlocked badges for a student and return the list of
   *  newly-awarded ids (so a "just unlocked" toast can fire). */
  async awardAchievements(academyId: string, studentId: string): Promise<string[]> {
    const results = await this.evaluateAchievements(studentId);
    const unlocked = results.filter((r) => r.unlocked).map((r) => r.id);
    if (unlocked.length === 0) return [];
    const existing = await this.badges().find(
      { userId: studentId, academyId, achievementId: { $in: unlocked } },
      { projection: { achievementId: 1 } },
    ).toArray();
    const existingIds = new Set(existing.map((r: any) => r.achievementId));
    const toInsert = unlocked.filter((id) => !existingIds.has(id));
    if (toInsert.length === 0) return [];
    const now = new Date();
    await this.badges().insertMany(toInsert.map((id) => ({
      userId: studentId, academyId, achievementId: id, unlockedAt: now,
    })));
    return toInsert;
  }

  /** Public read for the achievement gallery. Any academy member can see
   *  any other member's achievements — public wall of fame within the
   *  academy. Also auto-awards on read so the DB stays fresh. */
  async listAchievementsFor(session: any, studentId: string) {
    if (!session?.userId || !session?.academyId) throw new ForbiddenException("sign in first");
    const student: any = await this.users().findOne({ _id: studentId as any, academyId: session.academyId }, { projection: { _id: 1, username: 1, name: 1 } });
    if (!student) throw new BadRequestException("no such student in your academy");
    const newly = await this.awardAchievements(session.academyId, studentId);
    const catalog = await this.evaluateAchievements(studentId);
    const persisted: any[] = await this.badges().find({ userId: studentId, academyId: session.academyId }).toArray();
    const persistedMap = new Map<string, Date>();
    for (const p of persisted) persistedMap.set(p.achievementId, p.unlockedAt);
    const rows = catalog.map((a) => ({
      ...a,
      unlockedAt: persistedMap.get(a.id) || null,
    }));
    return {
      student: { _id: student._id, username: student.username, name: student.name || null },
      newly,
      unlockedCount: rows.filter((r) => r.unlocked).length,
      total: rows.length,
      achievements: rows,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  //  COACH BOOSTS — "Endgame Week" style training focus
  // ─────────────────────────────────────────────────────────────────────

  /** Coach/owner starts a boost — 1.5× (or custom) multiplier on puzzles
   *  matching a theme (or `k=blindfold` mode) for a bounded window. Only
   *  one active boost per academy at a time; creating a new one supersedes
   *  the previous. */
  async createBoost(session: any, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const theme = String(body?.theme || "").trim().slice(0, 40);
    const multiplier = Math.max(1, Math.min(3, Number(body?.multiplier) || 1.5));
    const days = Math.max(1, Math.min(30, Math.floor(Number(body?.days) || 7)));
    const note = String(body?.note || "").slice(0, 140);
    if (!theme) throw new BadRequestException("theme required");
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + days * 24 * 60 * 60_000);
    // Deactivate any active boost first (endAt <= now).
    await this.boosts().updateMany(
      { academyId: g.academyId, endAt: { $gt: startAt } },
      { $set: { endAt: startAt } },
    );
    const doc = {
      academyId: g.academyId,
      theme, multiplier, note,
      startAt, endAt,
      byUserId: g.userId, byName: g.username,
      createdAt: startAt,
    };
    const r = await this.boosts().insertOne(doc);
    return { ok: true, id: String(r.insertedId), boost: { ...doc, _id: r.insertedId } };
  }

  /** Active boost for a session's academy (if any). */
  async getActiveBoost(academyId: string) {
    const now = new Date();
    return await this.boosts().findOne({ academyId, startAt: { $lte: now }, endAt: { $gt: now } });
  }

  /** End the current boost immediately. Owner/coach only. */
  async endActiveBoost(session: any) {
    const g = this.ensureCoachOrOwner(session);
    await this.boosts().updateMany(
      { academyId: g.academyId, endAt: { $gt: new Date() } },
      { $set: { endAt: new Date() } },
    );
    return { ok: true };
  }

  /** Flat list of the coach's outbound snap-shares for CSV export. Newest
   *  first, capped at 500 rows so the response stays lean. */
  async snapShareListFor(userId: string) {
    const rows: any[] = await this.conn.db!.collection("coachSnapSends").find(
      { byUserId: String(userId) },
      { projection: { snapId: 1, toUserId: 1, toUsername: 1, toEmail: 1, note: 1, at: 1 } as any },
    ).sort({ at: -1 }).limit(500).toArray();
    return rows.map((r) => ({
      snapId: r.snapId,
      toUserId: r.toUserId,
      toUsername: r.toUsername || "",
      toEmail: r.toEmail || "",
      note: r.note || "",
      at: r.at,
    }));
  }
}
