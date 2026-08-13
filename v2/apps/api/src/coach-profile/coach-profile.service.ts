// Coach public profile — one doc per coach user in `coachProfiles`.
//
// Enables a chessiverse-style landing page per coach: hero, bio, playing
// styles, achievements, top students, trophies. Also carries a
// customDomain field (Phase 2 DNS + SSL automation deferred).
//
// Storage: /home/ubuntu/chessguru-coach-images (nginx serves at /coach-img/*).
// Files named {userId}-{kind}-{timestamp}.{ext}.
//
// Auth model: PUBLIC read via GET /api/coach/:username. Coach + owner self-
// service via /api/me/coach-profile*.

import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  UnauthorizedException, HttpException, HttpStatus,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { promises as fs } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

export const COACH_IMAGES_DIR =
  process.env.CHESSGURU_COACH_IMAGES_DIR ?? "/home/ubuntu/chessguru-coach-images";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BIO = 3000;
const MAX_LIST = 40;

// content-type sniff → extension (aligned with the allowlist we serve back).
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type ImageKindTop = "photo" | "cover" | "theme";
export type ImageKindNested = "achievement" | "trophy" | "topStudent";
export type ImageKind = ImageKindTop | `${ImageKindNested}:${string}`;

export interface CoachAchievement {
  id: string; title: string; description?: string; year?: number; imageUrl?: string;
}
export interface CoachTopStudent {
  id: string; name: string; peakRating?: number; note?: string; imageUrl?: string;
}
export interface CoachTrophy {
  id: string; name: string; year?: number; imageUrl?: string;
}
export interface CoachTestimonial {
  id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string;
}
export interface CoachSocials {
  website?: string; twitter?: string; youtube?: string; instagram?: string;
  lichess?: string; chesscom?: string; whatsapp?: string; email?: string;
}
export interface CoachProfile {
  _id: string;
  displayName?: string;
  tagline?: string;
  bio?: string;
  country?: string;
  city?: string;
  titleClass?: string;
  elo?: number;
  federation?: string;
  yearsTeaching?: number;
  playingStyles?: string[];
  photoUrl?: string;
  coverUrl?: string;
  themeUrl?: string;
  achievements?: CoachAchievement[];
  topStudents?: CoachTopStudent[];
  trophies?: CoachTrophy[];
  testimonials?: CoachTestimonial[];
  socials?: CoachSocials;
  customDomain?: string;
  customDomainStatus?: "pending_dns" | "verifying" | "active" | "failed";
  updatedAt: Date;
}

const TITLE_ALLOWED = new Set(["", "CM", "NM", "FM", "IM", "GM", "WCM", "WNM", "WFM", "WIM", "WGM"]);
const STATUS_ALLOWED = new Set(["pending_dns", "verifying", "active", "failed"]);
const STYLES_ALLOWED = new Set(["Aggressive", "Positional", "Tactical", "Solid", "Universal"]);

function shortId(): string { return randomBytes(6).toString("base64url"); }

@Injectable()
export class CoachProfileService {
  private dirEnsured = false;

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection("coachProfiles"); }
  private users() { return this.conn.db!.collection("users"); }

  private async ensureDir() {
    if (this.dirEnsured) return;
    await fs.mkdir(COACH_IMAGES_DIR, { recursive: true });
    this.dirEnsured = true;
  }

  /** Auth guard — coach or academy_owner only. Returns identity. */
  ensureCoachOrOwner(session: any): { userId: string; role: "coach" | "academy_owner"; academyId?: string } {
    const role = session?.role;
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    if (role !== "coach" && role !== "academy_owner") {
      throw new ForbiddenException("coach or owner only");
    }
    return { userId, role, academyId: session?.academyId };
  }

  /** PUBLIC read — join user (by username) with their coachProfile. */
  async getByUsername(username: string) {
    const uname = String(username || "").trim().toLowerCase();
    if (!uname) throw new NotFoundException("no such coach");
    const user: any = await this.users().findOne(
      { username: uname },
      { projection: { _id: 1, username: 1, role: 1, academyId: 1, name: 1 } },
    );
    if (!user) throw new NotFoundException("no such coach");
    if (user.role !== "coach" && user.role !== "academy_owner") {
      throw new NotFoundException("not a coach");
    }
    const profile: any = (await this.col().findOne({ _id: String(user._id) as any })) || {};
    let academyName: string | null = null;
    if (user.academyId) {
      const acad: any = await this.conn.db!.collection("academies").findOne(
        { _id: user.academyId as any },
        { projection: { name: 1 } },
      );
      academyName = acad?.name || null;
    }
    return {
      userId: String(user._id),
      username: user.username,
      role: user.role,
      academyId: user.academyId || null,
      academyName,
      fullName: user.name || null,
      profile: this.scrub(profile, String(user._id)),
    };
  }

  /** Own profile — returns an empty-shaped template if not yet created. */
  async getMine(session: any) {
    const g = this.ensureCoachOrOwner(session);
    const doc: any = (await this.col().findOne({ _id: g.userId as any })) || null;
    const user: any = await this.users().findOne(
      { _id: g.userId as any },
      { projection: { username: 1, name: 1 } },
    );
    return {
      userId: g.userId,
      username: user?.username || null,
      fullName: user?.name || null,
      profile: this.scrub(doc || {}, g.userId),
    };
  }

  /** Upsert partial profile — only whitelisted fields are written. */
  async upsertMine(session: any, body: any) {
    const g = this.ensureCoachOrOwner(session);
    const $set: any = { updatedAt: new Date() };
    const $setOnInsert: any = { _id: g.userId };

    const strTrim = (v: any, max: number) => String(v ?? "").trim().slice(0, max);

    if ("displayName" in body) $set.displayName = strTrim(body.displayName, 120);
    if ("tagline" in body) $set.tagline = strTrim(body.tagline, 240);
    if ("bio" in body) $set.bio = String(body.bio ?? "").slice(0, MAX_BIO);
    if ("country" in body) {
      const c = String(body.country ?? "").trim().toUpperCase().slice(0, 2);
      $set.country = /^[A-Z]{2}$/.test(c) ? c : "";
    }
    if ("city" in body) $set.city = strTrim(body.city, 80);
    if ("titleClass" in body) {
      const t = String(body.titleClass ?? "").trim().toUpperCase();
      $set.titleClass = TITLE_ALLOWED.has(t) ? t : "";
    }
    if ("elo" in body) {
      const n = Number(body.elo);
      $set.elo = Number.isFinite(n) && n > 0 && n < 4000 ? Math.round(n) : undefined;
    }
    if ("federation" in body) $set.federation = strTrim(body.federation, 20);
    if ("yearsTeaching" in body) {
      const n = Number(body.yearsTeaching);
      $set.yearsTeaching = Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n) : undefined;
    }
    if ("playingStyles" in body) {
      const raw = Array.isArray(body.playingStyles) ? body.playingStyles : [];
      const cleaned: string[] = Array.from(new Set<string>(
        raw.map((s: any) => String(s || "").trim()),
      )).filter((s: string) => STYLES_ALLOWED.has(s)).slice(0, 5);
      $set.playingStyles = cleaned;
    }
    if ("achievements" in body) $set.achievements = this.normalizeAchievements(body.achievements);
    if ("topStudents" in body) $set.topStudents = this.normalizeTopStudents(body.topStudents);
    if ("trophies" in body) $set.trophies = this.normalizeTrophies(body.trophies);
    if ("testimonials" in body) $set.testimonials = this.normalizeTestimonials(body.testimonials);
    if ("socials" in body) $set.socials = this.normalizeSocials(body.socials);
    if ("customDomain" in body) {
      const d = String(body.customDomain ?? "").trim().toLowerCase().slice(0, 240);
      // Loose sanity — must look like a hostname; store raw, no verify yet.
      $set.customDomain = /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d) ? d : "";
      if (!$set.customDomain) $set.customDomainStatus = "";
      else if (!("customDomainStatus" in body)) $set.customDomainStatus = "pending_dns";
    }
    if ("customDomainStatus" in body) {
      const s = String(body.customDomainStatus ?? "");
      $set.customDomainStatus = STATUS_ALLOWED.has(s) ? s : "";
    }

    await this.col().updateOne(
      { _id: g.userId as any },
      { $set, $setOnInsert },
      { upsert: true },
    );
    return this.getMine(session);
  }

  /** Upload raw image bytes; url stored at photo/cover/nested slot. */
  async uploadImage(session: any, kind: string, subId: string | null, buf: Buffer, contentType: string) {
    const g = this.ensureCoachOrOwner(session);
    if (!Buffer.isBuffer(buf) || buf.byteLength === 0) throw new BadRequestException("empty body");
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new HttpException("image too large (max 8 MB)", HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const ctHead = String(contentType || "").toLowerCase().split(";")[0]?.trim() || "";
    const ext = MIME_EXT[ctHead];
    if (!ext) throw new BadRequestException("unsupported image type (jpg/png/webp/gif only)");
    if (!this.isKnownKind(kind)) throw new BadRequestException("bad kind");

    await this.ensureDir();
    const stamp = Date.now();
    const safeSub = subId ? subId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) : "";
    const filename = `${g.userId}-${kind}${safeSub ? `-${safeSub}` : ""}-${stamp}.${ext}`;
    await fs.writeFile(join(COACH_IMAGES_DIR, filename), buf);
    const url = `/coach-img/${filename}`;
    await this.applyImageUrl(g.userId, kind, subId, url);
    return { ok: true, url };
  }

  /** Text→image gen — supports Gemini 2.5-flash-image OR OpenAI gpt-image-1
   *  (DALL-E successor). Owner-selectable via body.provider. Falls back to
   *  Gemini when unspecified. Never throws when the relevant key is unset;
   *  returns {ok:false,error} so the editor can show the error inline. */
  async genImage(session: any, body: { target?: string; prompt?: string; subId?: string | null; provider?: string }) {
    const g = this.ensureCoachOrOwner(session);
    const provider = String(body?.provider || "gemini").toLowerCase();
    const target = String(body?.target || "").trim();
    const prompt = String(body?.prompt || "").trim().slice(0, 2000);
    if (!prompt) throw new BadRequestException("prompt required");
    // Map "target" to storage kind. Nested targets require a subId.
    let kind: string;
    let subId: string | null = null;
    if (target === "photo" || target === "cover" || target === "theme") {
      // theme = page-wide painterly background layer (subtle, low-opacity in UI)
      kind = target;
    } else if (target === "achievement" || target === "trophy" || target === "topStudent") {
      subId = String(body?.subId || "").trim() || null;
      if (!subId) throw new BadRequestException("subId required for nested target");
      kind = `${target}:${subId}`;
    } else {
      throw new BadRequestException("bad target");
    }

    let png: Buffer;
    if (provider === "openai" || provider === "chatgpt" || provider === "dalle") {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { ok: false, error: "OPENAI_API_KEY not set — ask owner to configure" };
      const size = kind === "cover" || kind === "theme" ? "1536x1024" : "1024x1024";
      try {
        const r = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model: "gpt-image-1", prompt, size, n: 1 }),
        });
        if (!r.ok) {
          const t = await r.text();
          return { ok: false, error: `OpenAI HTTP ${r.status}: ${t.slice(0, 280)}` };
        }
        const j = (await r.json()) as any;
        const b64 = j?.data?.[0]?.b64_json;
        if (!b64) return { ok: false, error: "no image in OpenAI response (try a different prompt)" };
        png = Buffer.from(b64, "base64");
      } catch (e: any) {
        return { ok: false, error: `OpenAI call failed: ${String(e?.message || e).slice(0, 200)}` };
      }
    } else {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { ok: false, error: "GEMINI_API_KEY not set — ask owner to configure" };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`;
      const reqBody = { contents: [{ parts: [{ text: prompt }] }] };
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        if (!r.ok) {
          const t = await r.text();
          return { ok: false, error: `Gemini HTTP ${r.status}: ${t.slice(0, 240)}` };
        }
        const j = (await r.json()) as any;
        const parts = j?.candidates?.[0]?.content?.parts ?? [];
        let data: string | undefined;
        for (const p of parts) {
          const inline = p.inlineData ?? p.inline_data;
          if (inline?.data) { data = inline.data; break; }
        }
        if (!data) return { ok: false, error: "no image in Gemini response (try a different prompt)" };
        png = Buffer.from(data, "base64");
      } catch (e: any) {
        return { ok: false, error: `Gemini call failed: ${String(e?.message || e).slice(0, 200)}` };
      }
    }

    await this.ensureDir();
    const stamp = Date.now();
    const safeSub = subId ? subId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) : "";
    const filenameKind = subId ? kind.split(":")[0] : kind;
    const filename = `${g.userId}-${filenameKind}${safeSub ? `-${safeSub}` : ""}-${stamp}.png`;
    await fs.writeFile(join(COACH_IMAGES_DIR, filename), png);
    const publicUrl = `/coach-img/${filename}`;
    await this.applyImageUrl(g.userId, kind, subId, publicUrl);
    return { ok: true, url: publicUrl };
  }

  /* ---------- helpers ---------- */

  private isKnownKind(kind: string): boolean {
    if (kind === "photo" || kind === "cover" || kind === "theme") return true;
    const [top] = kind.split(":");
    return top === "achievement" || top === "trophy" || top === "topStudent";
  }

  private async applyImageUrl(userId: string, kind: string, subId: string | null, url: string) {
    if (kind === "photo") {
      await this.col().updateOne(
        { _id: userId as any },
        { $set: { photoUrl: url, updatedAt: new Date() }, $setOnInsert: { _id: userId } },
        { upsert: true },
      );
      return;
    }
    if (kind === "cover") {
      await this.col().updateOne(
        { _id: userId as any },
        { $set: { coverUrl: url, updatedAt: new Date() }, $setOnInsert: { _id: userId } },
        { upsert: true },
      );
      return;
    }
    if (kind === "theme") {
      // Full-viewport painterly background layer — rendered by CoachPublic.tsx
      // as a fixed low-opacity div behind everything else, gracefully falling
      // back to the SVG chessboard when unset.
      await this.col().updateOne(
        { _id: userId as any },
        { $set: { themeUrl: url, updatedAt: new Date() }, $setOnInsert: { _id: userId } },
        { upsert: true },
      );
      return;
    }
    if (!subId) return;
    const [top] = kind.split(":");
    const arrName = top === "achievement" ? "achievements"
                  : top === "trophy" ? "trophies"
                  : top === "topStudent" ? "topStudents" : null;
    if (!arrName) return;
    // Positional update on the matching row; if the row doesn't exist yet
    // (edit UI creates rows client-side then uploads), append a stub row.
    const upd = await this.col().updateOne(
      { _id: userId as any, [`${arrName}.id`]: subId },
      { $set: { [`${arrName}.$.imageUrl`]: url, updatedAt: new Date() } },
    );
    if (upd.matchedCount === 0) {
      const stub: any = { id: subId, imageUrl: url };
      if (arrName === "achievements") stub.title = "";
      if (arrName === "trophies") stub.name = "";
      if (arrName === "topStudents") stub.name = "";
      await this.col().updateOne(
        { _id: userId as any },
        {
          $push: { [arrName]: stub } as any,
          $set: { updatedAt: new Date() },
          $setOnInsert: { _id: userId },
        },
        { upsert: true },
      );
    }
  }

  private normalizeAchievements(raw: any): CoachAchievement[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_LIST).map((r: any) => ({
      id: String(r?.id || shortId()).slice(0, 24),
      title: String(r?.title || "").trim().slice(0, 200),
      description: String(r?.description || "").slice(0, 800),
      year: cleanYear(r?.year),
      imageUrl: cleanImageUrl(r?.imageUrl),
    })).filter((r: CoachAchievement) => r.title.length > 0 || r.imageUrl);
  }
  private normalizeTopStudents(raw: any): CoachTopStudent[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_LIST).map((r: any) => ({
      id: String(r?.id || shortId()).slice(0, 24),
      name: String(r?.name || "").trim().slice(0, 120),
      peakRating: Number.isFinite(Number(r?.peakRating)) && Number(r?.peakRating) > 0 && Number(r?.peakRating) < 4000
        ? Math.round(Number(r.peakRating)) : undefined,
      note: String(r?.note || "").slice(0, 300),
      imageUrl: cleanImageUrl(r?.imageUrl),
    })).filter((r: CoachTopStudent) => r.name.length > 0 || r.imageUrl);
  }
  private normalizeTrophies(raw: any): CoachTrophy[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_LIST).map((r: any) => ({
      id: String(r?.id || shortId()).slice(0, 24),
      name: String(r?.name || "").trim().slice(0, 160),
      year: cleanYear(r?.year),
      imageUrl: cleanImageUrl(r?.imageUrl),
    })).filter((r: CoachTrophy) => r.name.length > 0 || r.imageUrl);
  }
  private normalizeTestimonials(raw: any): CoachTestimonial[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_LIST).map((r: any) => ({
      id: String(r?.id || shortId()).slice(0, 24),
      author: String(r?.author || "").trim().slice(0, 120),
      role: String(r?.role || "").trim().slice(0, 120),
      quote: String(r?.quote || "").slice(0, 800),
      rating: cleanRating(r?.rating),
      imageUrl: cleanImageUrl(r?.imageUrl),
    })).filter((r: CoachTestimonial) => r.author.length > 0 || r.quote.length > 0 || r.imageUrl);
  }
  private normalizeSocials(raw: any): CoachSocials {
    if (!raw || typeof raw !== "object") return {};
    const s: CoachSocials = {};
    const fields: (keyof CoachSocials)[] = ["website", "twitter", "youtube", "instagram", "lichess", "chesscom", "whatsapp", "email"];
    for (const k of fields) {
      const v = String(raw[k] ?? "").trim().slice(0, 240);
      if (v) s[k] = v;
    }
    return s;
  }

  /** Strip mongo-only fields; ensure sensible defaults. */
  private scrub(doc: any, userId: string) {
    return {
      userId,
      displayName: String(doc?.displayName || ""),
      tagline: String(doc?.tagline || ""),
      bio: String(doc?.bio || ""),
      country: String(doc?.country || ""),
      city: String(doc?.city || ""),
      titleClass: String(doc?.titleClass || ""),
      elo: typeof doc?.elo === "number" ? doc.elo : undefined,
      federation: String(doc?.federation || ""),
      yearsTeaching: typeof doc?.yearsTeaching === "number" ? doc.yearsTeaching : undefined,
      playingStyles: Array.isArray(doc?.playingStyles) ? doc.playingStyles : [],
      photoUrl: String(doc?.photoUrl || ""),
      coverUrl: String(doc?.coverUrl || ""),
      themeUrl: String(doc?.themeUrl || ""),
      achievements: Array.isArray(doc?.achievements) ? doc.achievements : [],
      topStudents: Array.isArray(doc?.topStudents) ? doc.topStudents : [],
      trophies: Array.isArray(doc?.trophies) ? doc.trophies : [],
      testimonials: Array.isArray(doc?.testimonials) ? doc.testimonials : [],
      socials: doc?.socials && typeof doc.socials === "object" ? doc.socials : {},
      customDomain: String(doc?.customDomain || ""),
      customDomainStatus: String(doc?.customDomainStatus || ""),
      // undefined defaults to enabled (grandfathered). Only explicit false
      // signals a superadmin lock — the editor uses this to hide the domain UI.
      customDomainEnabled: doc?.customDomainEnabled !== false,
      updatedAt: doc?.updatedAt || null,
    };
  }
}

function cleanYear(v: any): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const y = Math.round(n);
  return y >= 1900 && y <= 2100 ? y : undefined;
}
function cleanRating(v: any): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : undefined;
}
function cleanImageUrl(v: any): string | undefined {
  const s = String(v ?? "").trim().slice(0, 500);
  if (!s) return undefined;
  // Only accept our own path or an https URL; blocks javascript:/data: xss.
  if (s.startsWith("/coach-img/") || /^https:\/\/[^\s"'<>]+$/.test(s)) return s;
  return undefined;
}
