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

  /** Create + email an invite for a coach to join the caller's academy. */
  async createInvite(session: any, body: any) {
    const { academyId, userId, username } = this.ensureOwner(session);
    const email = String(body?.email || "").trim().toLowerCase();
    const displayName = String(body?.displayName || "").trim().slice(0, 60);
    const role = body?.role === "coach" ? "coach" : "coach";  // students later; owner-created coaches only for now
    if (!email || !email.includes("@")) return { ok: false, error: "Valid email required." };

    // No duplicate active invite for the same (email, academy). Consumed ones don't count.
    const existing = await this.invites().findOne({ academyId, email, consumedAt: { $exists: false } });
    if (existing) return { ok: false, error: "That email already has a pending invite for this academy." };
    // If the email already belongs to a user in this academy, no need to invite.
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
      email, displayName, role,
      createdAt: now, expiresAt,
    });

    const publicUrl = (process.env.PUBLIC_URL || "https://harinitharanjith.com").replace(/\/+$/, "");
    const link = `${publicUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    const subject = `You're invited to ${academyName} on ChessGuru`;
    const text = [
      `${username} invited you to join ${academyName} as a coach on ChessGuru.`,
      "",
      `Accept the invitation and set your password: ${link}`,
      "",
      `This link is valid for ${INVITE_TTL_DAYS} days. If you didn't expect this email, you can ignore it.`,
    ].join("\n");
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px">
        <h2 style="color:#111">You're invited to <b>${escHtml(academyName)}</b> on ChessGuru</h2>
        <p><b>${escHtml(username)}</b> invited you to join as a <b>coach</b>.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">Accept & set your password</a></p>
        <p style="color:#666;font-size:13px">Or paste this link in your browser:<br/><a href="${link}">${escHtml(link)}</a></p>
        <p style="color:#999;font-size:12px">This link is valid for ${INVITE_TTL_DAYS} days. If you didn't expect this, just ignore it.</p>
      </div>`;

    const mailRes = await sendMail({ to: email, subject, html, text });
    return { ok: true, invite: { token, email, displayName, expiresAt, mail: mailRes.ok ? "sent" : "failed" } };
  }

  /** Owner-only listing of pending invites (not consumed, not expired). */
  async listInvites(session: any) {
    const { academyId } = this.ensureOwner(session);
    const now = new Date();
    const rows = await this.invites()
      .find({ academyId, consumedAt: { $exists: false }, expiresAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .toArray();
    return rows.map((r: any) => ({
      token: r._id, email: r.email, displayName: r.displayName,
      role: r.role, createdAt: r.createdAt, expiresAt: r.expiresAt,
      invitedByName: r.invitedByName,
    }));
  }

  /** Owner-only revoke of a pending invite. Deletes the row so the token dies. */
  async revokeInvite(session: any, token: string) {
    const { academyId } = this.ensureOwner(session);
    const r = await this.invites().deleteOne({ _id: token as any, academyId, consumedAt: { $exists: false } });
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
    const userDoc = {
      _id: uid,
      username,
      bpass: hash,
      email: inv.email,
      academyId: inv.academyId,
      role: inv.role,
      createdAt: now, lastLogin: now,
    };
    await this.users().insertOne(userDoc as any);
    await this.invites().updateOne(
      { _id: token as any },
      { $set: { consumedAt: now, consumedByUserId: uid } },
    );
    return { ok: true, user: { _id: uid, username, academyId: inv.academyId, role: inv.role } };
  }
}
