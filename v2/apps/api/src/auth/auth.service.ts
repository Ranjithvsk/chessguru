import { Injectable } from "@nestjs/common";
import { isAdmin } from "../admin/admins";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { sendMail } from "../lib/mail";
import { AcademyService } from "../academy/academy.service";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const RESET_TTL_MIN = 60;   // password-reset link is valid 1h
const OTP_TTL_MIN   = 10;   // OTP sign-in code is valid 10 min
const OTP_MAX_TRIES = 5;    // wrong-code attempts per issued OTP

@Injectable()
export class AuthService {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly academy: AcademyService,
  ) {}
  private users() { return this.conn.db!.collection("users"); }

  /* ================================================================
   * Coach / student invites — peek (public read of one) + accept.
   * The actual invite machinery lives in AcademyService; we just wrap
   * consumeInvite() here so we can set the session on success.
   * ================================================================ */
  peekInvite(token: string) { return this.academy.peekInvite(token); }

  async acceptInvite(body: any, session: any) {
    const token = String(body?.token || "");
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    const r = await this.academy.consumeInvite(token, username, password);
    if (!r.ok) return r;
    session.userId = r.user._id;
    session.username = r.user.username;
    session.academyId = r.user.academyId;
    session.role = r.user.role;
    if (session.cookie) session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    return { ok: true, academyId: r.user.academyId, role: r.user.role };
  }

  async register(body: any, session: any) {
    const { username, password, email } = body ?? {};
    if (!username || !password) return { ok: false, error: "Username and password required." };
    if (!/^[a-zA-Z0-9_-]{2,20}$/.test(username)) return { ok: false, error: "Invalid username format." };
    if (String(password).length < 6) return { ok: false, error: "Password too short (min 6 chars)." };
    const col = this.users();
    const existing = await col.findOne({ username: { $regex: new RegExp("^" + esc(username) + "$", "i") } });
    if (existing) return { ok: false, error: "Username already taken." };
    const hash = await bcrypt.hash(password, 10);
    const doc = { _id: username.toLowerCase(), username, bpass: hash, email: email || null, createdAt: new Date(), lastLogin: new Date() };
    await col.insertOne(doc as any);
    session.userId = doc._id;
    session.username = username;
    return { ok: true };
  }

  async signin(body: any, session: any) {
    const { username, password, keep } = body ?? {};
    if (!username || !password) return { ok: false, error: "Please fill in all fields." };
    const col = this.users();
    const user: any = await col.findOne({
      $or: [
        { username: { $regex: new RegExp("^" + esc(username) + "$", "i") } },
        { email: String(username).toLowerCase() },
      ],
    });
    if (!user) return { ok: false, error: "Invalid username or password." };
    let hash: any = user.bpass;
    if (hash && typeof hash === "object") {
      if (hash.buffer) hash = Buffer.from(hash.buffer).toString("utf8");
      else if (Buffer.isBuffer(hash)) hash = hash.toString("utf8");
      else hash = String(hash);
    }
    if (!hash || typeof hash !== "string") return { ok: false, error: "Invalid username or password." };
    const ok = await bcrypt.compare(password, hash);
    if (!ok) return { ok: false, error: "Invalid username or password." };
    session.userId = user._id;
    session.username = user.username;
    // Populate multi-tenant context on the session so /academy/* endpoints work
    // for signed-in owners/coaches (fresh login previously left these null and
    // the role gate rejected everything with 403 "owner or coach only").
    session.academyId = user.academyId ?? null;
    session.role = user.role ?? null;
    if (keep && session.cookie) session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    await col.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });
    return { ok: true };
  }

  me(session: any) {
    if (!session?.userId) return { loggedIn: false };
    return {
      loggedIn: true,
      username: session.username,
      userId: session.userId,
      admin: isAdmin(session.userId),
      academyId: session.academyId ?? null,
      role: session.role ?? null,
    };
  }

  /* ================================================================
   * Academy signup (multi-tenant SaaS).
   * Creates: academies doc + owner user doc (role: 'academy_owner'),
   * then logs the owner in. Slug is derived from academyName and made
   * globally unique (append -2, -3, ... on collision).
   * ================================================================ */
  async signupAcademy(body: any, session: any) {
    const academyName = String(body?.academyName || "").trim();
    const ownerEmail  = String(body?.ownerEmail || "").trim().toLowerCase();
    const password    = String(body?.password || "");
    // Owner username is optional now (email-only signup). If provided we validate;
    // otherwise we derive it from the email local-part so login by username still
    // works (the user can also always sign in via email + password).
    const providedName = String(body?.ownerName || "").trim();

    if (!academyName || academyName.length < 2) return { ok: false, error: "Academy name is required." };
    if (!ownerEmail  || !ownerEmail.includes("@")) return { ok: false, error: "Valid email is required." };
    if (password.length < 6) return { ok: false, error: "Password too short (min 6 chars)." };
    if (providedName && !/^[a-zA-Z0-9_-]{2,30}$/.test(providedName)) {
      return { ok: false, error: "Username must be 2-30 chars (letters, numbers, _ or -)." };
    }

    const academies = this.conn.db!.collection("academies");
    const users = this.users();

    // Slug: lowercase, alphanumerics + dashes; append -N if taken
    const base = academyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "academy";
    let slug = base; let n = 2;
    while (await academies.findOne({ _id: slug as any })) { slug = `${base}-${n++}`; if (n > 999) break; }

    // Username auto-derivation: prefer provided, else sanitize email local-part.
    // Sanitize keeps [a-z0-9_-]; strips dots and other chars. Enforce 2-30 length.
    // On collision, append -2, -3, ...
    const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30) || "user";
    const rawUid = providedName ? providedName.toLowerCase() : sanitize(ownerEmail.split("@")[0]!);
    const baseUid = rawUid.length >= 2 ? rawUid : (rawUid + "1");
    let uid = baseUid, k = 2;
    while (await users.findOne({ _id: uid as any })) { uid = `${baseUid}-${k++}`; if (k > 999) break; }
    const ownerName = providedName || uid;

    // Email collision — one email = one account (prevents double-signup)
    if (await users.findOne({ email: ownerEmail })) {
      return { ok: false, error: "This email already has an account — sign in first." };
    }

    const hash = await bcrypt.hash(password, 10);
    const now = new Date();
    // 90-day free trial → then ₹1000/month unlimited. Stored so the app can
    // decide when to nag / lock down; enforcement is a separate follow-up.
    const trialEndsAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const academyDoc = {
      _id: slug,
      name: academyName,
      ownerId: uid,
      plan: "trial",
      trialStartsAt: now,
      trialEndsAt,
      monthlyPricePaise: 100000,    // ₹1000 = 100000 paise
      subscriptionStatus: "trialing",
      createdAt: now,
    };
    const userDoc = {
      _id: uid,
      username: ownerName,
      bpass: hash,
      email: ownerEmail,
      academyId: slug,
      role: "academy_owner",
      createdAt: now,
      lastLogin: now,
    };
    await academies.insertOne(academyDoc as any);
    await users.insertOne(userDoc as any);

    session.userId = uid;
    session.username = ownerName;
    session.academyId = slug;
    session.role = "academy_owner";
    if (session.cookie) session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    return { ok: true, academyId: slug, academyName };
  }

  logout(session: any): Promise<{ ok: boolean }> {
    return new Promise((resolve) => session.destroy(() => resolve({ ok: true })));
  }

  async myRating(session: any) {
    if (!session?.userId) return { rating: 1500, loggedIn: false };
    const doc: any = await this.conn.db!.collection("userperfs").findOne({ _id: session.userId });
    return { rating: Math.round(doc?.puzzle?.gl?.r ?? 1500), loggedIn: true, userId: session.userId };
  }

  /* ================================================================
   * Password reset via email link.
   * requestReset: any email → generate token, store hash+expiry, mail link.
   *   Always returns ok:true (don't leak which emails are registered).
   * resetPassword: token + newPassword → verify, rotate bpass, kill token.
   * ================================================================ */
  async requestReset(body: any) {
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return { ok: true };  // silently no-op on bad input
    const user: any = await this.users().findOne({ email });
    if (!user) return { ok: true };                            // don't disclose account existence

    const token = randomBytes(24).toString("base64url");       // ~192-bit URL-safe token
    const expiresAt = new Date(Date.now() + RESET_TTL_MIN * 60_000);
    await this.users().updateOne(
      { _id: user._id },
      { $set: { resetTokenHash: sha256(token), resetExpiresAt: expiresAt } },
    );

    const base = process.env.PUBLIC_URL || "https://harinitharanjith.com";
    const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
    await sendMail({
      to: email,
      subject: "Reset your ChessGuru password",
      html:
        `<p>Hi ${escapeHtml(user.username)},</p>` +
        `<p>Someone (hopefully you) asked to reset the password for your ChessGuru account.</p>` +
        `<p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Reset password</a></p>` +
        `<p style="color:#666;font-size:12px">Or paste this into your browser: ${link}<br>The link is valid for ${RESET_TTL_MIN} minutes.<br>If you didn't ask for this, you can safely ignore this email.</p>`,
      text: `Reset your ChessGuru password: ${link}\nValid for ${RESET_TTL_MIN} minutes.`,
    });
    return { ok: true };
  }

  async resetPassword(body: any) {
    const token = String(body?.token || "");
    const newPassword = String(body?.newPassword || "");
    if (!token || !newPassword) return { ok: false, error: "Missing token or password." };
    if (newPassword.length < 6)  return { ok: false, error: "Password too short (min 6 chars)." };
    const user: any = await this.users().findOne({ resetTokenHash: sha256(token) });
    if (!user) return { ok: false, error: "This reset link is invalid or already used." };
    if (!user.resetExpiresAt || new Date(user.resetExpiresAt) < new Date()) {
      return { ok: false, error: "This reset link has expired — request a new one." };
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await this.users().updateOne(
      { _id: user._id },
      { $set: { bpass: hash }, $unset: { resetTokenHash: "", resetExpiresAt: "" } },
    );
    return { ok: true, username: user.username };
  }

  /* ================================================================
   * OTP sign-in via email.
   * requestOtp: email → issue 6-digit code, mail it, store hash+expiry.
   * otpSignin:  email + code → verify (constant-time-ish), sign in.
   * ================================================================ */
  async requestOtp(body: any) {
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return { ok: true };
    const user: any = await this.users().findOne({ email });
    if (!user) return { ok: true };
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);
    await this.users().updateOne(
      { _id: user._id },
      { $set: { otpHash: sha256(code), otpExpiresAt: expiresAt, otpTries: 0 } },
    );
    await sendMail({
      to: email,
      subject: `Your ChessGuru sign-in code: ${code}`,
      html:
        `<p>Hi ${escapeHtml(user.username)},</p>` +
        `<p>Your one-time sign-in code:</p>` +
        `<p style="font-family:monospace;font-size:32px;letter-spacing:4px;background:#f4f4f5;padding:14px;border-radius:8px;text-align:center;font-weight:bold">${code}</p>` +
        `<p style="color:#666;font-size:12px">Enter this on the ChessGuru sign-in page. Valid for ${OTP_TTL_MIN} minutes.<br>If you didn't ask for this, ignore this email.</p>`,
      text: `Your ChessGuru sign-in code: ${code}\nValid for ${OTP_TTL_MIN} minutes.`,
    });
    return { ok: true };
  }

  async otpSignin(body: any, session: any) {
    const email = String(body?.email || "").trim().toLowerCase();
    const code  = String(body?.code || "").trim();
    if (!email || !code) return { ok: false, error: "Please enter your email and code." };
    if (!/^\d{6}$/.test(code)) return { ok: false, error: "The code should be 6 digits." };
    const user: any = await this.users().findOne({ email });
    // Give a uniform error to avoid disclosing account existence / code correctness.
    const genericErr = { ok: false as const, error: "That code is invalid or has expired." };
    if (!user || !user.otpHash) return genericErr;
    if (!user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) return genericErr;
    const tries = Number(user.otpTries ?? 0);
    if (tries >= OTP_MAX_TRIES) return { ok: false, error: "Too many tries — please request a new code." };

    if (sha256(code) !== user.otpHash) {
      await this.users().updateOne({ _id: user._id }, { $inc: { otpTries: 1 } });
      return genericErr;
    }
    // Success — burn the OTP and sign in.
    await this.users().updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() }, $unset: { otpHash: "", otpExpiresAt: "", otpTries: "" } },
    );
    session.userId = user._id;
    session.username = user.username;
    session.academyId = user.academyId ?? null;   // same multi-tenant fix as signin()
    session.role = user.role ?? null;
    if (session.cookie) session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // OTP flow = keep me signed in
    return { ok: true };
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
