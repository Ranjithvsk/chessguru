// Academy public-profile service — one doc per academy in `academyProfiles`.
//
// Powers the chessiverse-style landing page at /academy-page/:slug. The
// academy _id doubles as its URL slug (already unique, lowercase-kebab,
// derived from name at signup). Optional customDomain field wires into
// the same DNS + SSL automation coaches use.
//
// Storage: /home/ubuntu/chessguru-academy-images (nginx serves /academy-img/*).
//
// Auth model: PUBLIC read via /academy-page/:slug. Owner self-service via
// /me/academy-profile*.

import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  UnauthorizedException, HttpException, HttpStatus,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { promises as fs } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import sharp from "sharp";

export const ACADEMY_IMAGES_DIR =
  process.env.CHESSGURU_ACADEMY_IMAGES_DIR ?? "/home/ubuntu/chessguru-academy-images";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DESC = 5000;
const MAX_LIST = 40;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif",
};

const STATUS_ALLOWED = new Set(["pending_dns", "verifying", "provisioning", "active", "failed"]);

function shortId(): string { return randomBytes(6).toString("base64url"); }

export interface AcademyAchievement {
  id: string; title: string; description?: string; year?: number; imageUrl?: string;
}
export interface AcademyTestimonial {
  id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string;
}

@Injectable()
export class AcademyProfileService {
  private dirEnsured = false;

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col()     { return this.conn.db!.collection("academyProfiles"); }
  private academies(){return this.conn.db!.collection("academies"); }
  private users()   { return this.conn.db!.collection("users"); }
  private coachProfiles(){return this.conn.db!.collection("coachProfiles"); }
  private schedules(){ return this.conn.db!.collection("classSchedules"); }

  private async ensureDir() {
    if (this.dirEnsured) return;
    await fs.mkdir(ACADEMY_IMAGES_DIR, { recursive: true });
    this.dirEnsured = true;
  }

  /** Owner-only guard — session must have role=academy_owner + academyId. */
  ensureOwner(session: any): { userId: string; academyId: string } {
    const role = session?.role;
    const userId = session?.userId;
    const academyId = session?.academyId;
    if (!userId) throw new UnauthorizedException("sign in first");
    if (role !== "academy_owner" || !academyId) {
      throw new ForbiddenException("academy owner only");
    }
    return { userId, academyId };
  }

  /** PUBLIC read — one call returns every piece the landing page needs.
   *  Falls back gracefully when the profile doc doesn't exist (empty template)
   *  but still enumerates the academy's coaches so a fresh academy shows the
   *  roster grid on day one. */
  async getBySlug(slug: string) {
    const s = String(slug || "").trim().toLowerCase();
    if (!s) throw new NotFoundException("no such academy");
    // Accept slug|_id|ownerId — tenant custom domains (gunachess.com) hit us with
    // the domain first-label ("gunachess") which matches ownerId, not _id.
    const academy: any = await this.academies().findOne({
      $or: [{ _id: s as any }, { ownerId: s }, { slug: s }],
    });
    if (!academy) throw new NotFoundException("no such academy");

    const profile: any = (await this.col().findOne({ _id: academy._id as any })) || {};

    // Enumerate every coach in the academy, then hydrate each with their
    // coachProfile in one $in query — cheaper than N round-trips.
    const coachUsers: any[] = await this.users().find(
      { academyId: s, role: { $in: ["coach", "academy_owner"] } },
      { projection: { _id: 1, username: 1, role: 1, name: 1 } },
    ).toArray();
    const coachIds = coachUsers.map((u) => String(u._id));
    const coachProfiles: any[] = coachIds.length
      ? await this.coachProfiles().find({ _id: { $in: coachIds as any } }).toArray()
      : [];
    const profByUser = new Map(coachProfiles.map((p) => [String(p._id), p]));

    // Order coaches: featured list first (in its declared order), then the
    // rest alphabetically by displayName / username. `featuredCoachIds` may
    // be empty, in which case we simply alphabetize everyone.
    const featured: string[] = Array.isArray(profile.featuredCoachIds)
      ? profile.featuredCoachIds.filter((id: any) => typeof id === "string")
      : [];
    const featuredSet = new Set(featured);
    const rest = coachUsers
      .filter((u) => !featuredSet.has(String(u._id)))
      .sort((a, b) => {
        const an = String(profByUser.get(String(a._id))?.displayName || a.name || a.username || "").toLowerCase();
        const bn = String(profByUser.get(String(b._id))?.displayName || b.name || b.username || "").toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
    const orderedIds = [
      ...featured.filter((id) => coachIds.includes(id)),
      ...rest.map((u) => String(u._id)),
    ];
    const coachById = new Map(coachUsers.map((u) => [String(u._id), u]));
    const coaches = orderedIds.map((id) => {
      const u = coachById.get(id)!;
      const p = profByUser.get(id) || {};
      return {
        userId: id,
        username: u.username,
        fullName: u.name || null,
        role: u.role,
        isOwner: u._id === academy.ownerId,
        coachProfile: {
          displayName: String(p.displayName || u.name || u.username || ""),
          tagline: String(p.tagline || ""),
          country: String(p.country || ""),
          titleClass: String(p.titleClass || ""),
          elo: typeof p.elo === "number" ? p.elo : undefined,
          federation: String(p.federation || ""),
          yearsTeaching: typeof p.yearsTeaching === "number" ? p.yearsTeaching : undefined,
          playingStyles: Array.isArray(p.playingStyles) ? p.playingStyles : [],
          photoUrl: String(p.photoUrl || ""),
        },
      };
    });

    // Upcoming classes for THIS academy — nearest 3 future ones. Bundle
    // straight into the response so the landing page never makes a second
    // authenticated call (guest browsers wouldn't get anything anyway).
    const now = new Date();
    const upcoming: any[] = await this.schedules().find(
      { academyId: s, startAt: { $gte: now } },
      { sort: { startAt: 1 }, limit: 3, projection: {
        _id: 1, title: 1, coach: 1, startAt: 1, durationMin: 1,
        createdByUserId: 1, topics: 1,
      } },
    ).toArray();

    return {
      academy: {
        _id: academy._id,
        slug: academy._id,
        name: academy.name,
        ownerId: academy.ownerId,
      },
      profile: this.scrub(profile, s),
      coaches,
      upcomingClasses: upcoming.map((r) => ({
        _id: String(r._id),
        title: String(r.title || ""),
        coach: String(r.coach || ""),
        startAt: r.startAt,
        durationMin: Number(r.durationMin) || 60,
        coachUserId: r.createdByUserId || null,
        topics: Array.isArray(r.topics) ? r.topics : [],
      })),
    };
  }

  /** Own academy profile — empty-shaped template on first hit. */
  async getMine(session: any) {
    const g = this.ensureOwner(session);
    const doc: any = (await this.col().findOne({ _id: g.academyId as any })) || null;
    const academy: any = await this.academies().findOne({ _id: g.academyId as any });
    return {
      academyId: g.academyId,
      slug: g.academyId,
      name: academy?.name || null,
      profile: this.scrub(doc || {}, g.academyId),
    };
  }

  /** Upsert partial profile — only whitelisted fields are written. */
  async upsertMine(session: any, body: any) {
    const g = this.ensureOwner(session);
    const $set: any = { updatedAt: new Date() };
    const $setOnInsert: any = { _id: g.academyId };

    const strTrim = (v: any, max: number) => String(v ?? "").trim().slice(0, max);

    if ("displayName" in body) $set.displayName = strTrim(body.displayName, 120);
    if ("tagline" in body) $set.tagline = strTrim(body.tagline, 240);
    if ("description" in body) $set.description = String(body.description ?? "").slice(0, MAX_DESC);
    if ("country" in body) {
      const c = String(body.country ?? "").trim().toUpperCase().slice(0, 2);
      $set.country = /^[A-Z]{2}$/.test(c) ? c : "";
    }
    if ("city" in body) $set.city = strTrim(body.city, 80);
    if ("foundedYear" in body) {
      const n = Number(body.foundedYear);
      $set.foundedYear = Number.isFinite(n) && n >= 1900 && n <= 2100 ? Math.round(n) : undefined;
    }
    if ("achievements" in body) $set.achievements = this.normalizeAchievements(body.achievements);
    if ("testimonials" in body) $set.testimonials = this.normalizeTestimonials(body.testimonials);
    if ("socials" in body) $set.socials = this.normalizeSocials(body.socials);
    if ("featuredCoachIds" in body) {
      const raw = Array.isArray(body.featuredCoachIds) ? body.featuredCoachIds : [];
      const cleaned = Array.from(new Set(raw
        .map((x: any) => String(x || "").trim())
        .filter((s: string) => /^[a-z0-9_-]{1,64}$/i.test(s))
      )).slice(0, 40);
      $set.featuredCoachIds = cleaned;
    }
    if ("customDomain" in body) {
      const d = String(body.customDomain ?? "").trim().toLowerCase().slice(0, 240);
      $set.customDomain = /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d) ? d : "";
      if (!$set.customDomain) $set.customDomainStatus = "";
      else if (!("customDomainStatus" in body)) $set.customDomainStatus = "pending_dns";
    }
    if ("customDomainStatus" in body) {
      const s = String(body.customDomainStatus ?? "");
      $set.customDomainStatus = STATUS_ALLOWED.has(s) ? s : "";
    }

    await this.col().updateOne(
      { _id: g.academyId as any },
      { $set, $setOnInsert },
      { upsert: true },
    );
    return this.getMine(session);
  }

  /** Upload raw image bytes; url stored at logo/cover/nested slot. */
  async uploadImage(session: any, kind: string, subId: string | null, buf: Buffer, contentType: string) {
    const g = this.ensureOwner(session);
    if (!Buffer.isBuffer(buf) || buf.byteLength === 0) throw new BadRequestException("empty body");
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new HttpException("image too large (max 8 MB)", HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const ctHead = String(contentType || "").toLowerCase().split(";")[0]?.trim() || "";
    const ext = MIME_EXT[ctHead];
    if (!ext) throw new BadRequestException("unsupported image type (jpg/png/webp/gif only)");
    if (!this.isKnownKind(kind)) throw new BadRequestException("bad kind");

    await this.ensureDir();
    // Logo uses a STABLE filename so the manifest endpoint's `<prefix>-logo.<ext>`
    // convention can locate the PWA-sized siblings. Other kinds keep the
    // timestamped filename (cache-buster on re-upload).
    const stamp = Date.now();
    const safeSub = subId ? subId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) : "";
    let filename: string;
    if (kind === "logo") {
      filename = `${g.academyId}-logo.${ext}`;
      await fs.writeFile(join(ACADEMY_IMAGES_DIR, filename), buf);
      await this.generatePwaIcons(g.academyId, buf);
    } else {
      filename = `${g.academyId}-${kind}${safeSub ? `-${safeSub}` : ""}-${stamp}.${ext}`;
      await fs.writeFile(join(ACADEMY_IMAGES_DIR, filename), buf);
    }
    const url = `/academy-img/${filename}`;
    await this.applyImageUrl(g.academyId, kind, subId, url);
    return { ok: true, url };
  }

  /** Generate 192/512/maskable-512 WebP siblings next to <academyId>-logo.<ext>
   *  so the PWA manifest can serve correctly-sized icons for every tenant.
   *  Maskable variant pads the logo to 70% of the frame on solid tenant-teal
   *  so adaptive-icon cropping (Android/iOS) doesn't chop wordmark rings. */
  private async generatePwaIcons(academyId: string, buf: Buffer): Promise<void> {
    try {
      const dir = ACADEMY_IMAGES_DIR;
      const base = sharp(buf, { failOn: "none" });
      await base.clone().resize(192, 192, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .webp({ quality: 90 }).toFile(join(dir, `${academyId}-192.webp`));
      await base.clone().resize(512, 512, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .webp({ quality: 90 }).toFile(join(dir, `${academyId}-512.webp`));
      // Maskable: inner 358x358 (~70% of 512) centered on solid teal frame.
      const inner = await base.clone().resize(358, 358, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
      await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 20, g: 162, b: 184, alpha: 1 } } })
        .composite([{ input: inner, gravity: "center" }])
        .webp({ quality: 90 }).toFile(join(dir, `${academyId}-maskable-512.webp`));
    } catch { /* logo save still succeeds; manifest falls back to single-file */ }
  }

  /** Text→image gen — supports Gemini 2.5-flash-image OR OpenAI gpt-image-1
   *  (DALL-E successor). Owner-selectable via body.provider. Falls back to
   *  Gemini when unspecified. Never throws when the relevant key is unset;
   *  returns {ok:false,error} instead so the editor can show it inline. */
  async genImage(session: any, body: { target?: string; prompt?: string; subId?: string | null; provider?: string }) {
    const g = this.ensureOwner(session);
    const provider = String(body?.provider || "gemini").toLowerCase();
    const target = String(body?.target || "").trim();
    const prompt = String(body?.prompt || "").trim().slice(0, 2000);
    if (!prompt) throw new BadRequestException("prompt required");

    let kind: string;
    let subId: string | null = null;
    if (target === "logo" || target === "cover" || target === "theme") {
      // theme = page-wide painterly background layer (subtle, low-opacity in UI)
      kind = target;
    } else if (target === "achievement" || target === "testimonial") {
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
      // gpt-image-1 (currently OpenAI's flagship image model — DALL-E-3 successor).
      // 1536x1024 for hero-ish covers, 1024x1024 for square logos/achievements.
      const size = kind === "cover" ? "1536x1024" : "1024x1024";
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
      // Gemini path (default)
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
    let filename: string;
    if (kind === "logo") {
      filename = `${g.academyId}-logo.png`;
      await fs.writeFile(join(ACADEMY_IMAGES_DIR, filename), png);
      await this.generatePwaIcons(g.academyId, png);
    } else {
      filename = `${g.academyId}-${filenameKind}${safeSub ? `-${safeSub}` : ""}-${stamp}.png`;
      await fs.writeFile(join(ACADEMY_IMAGES_DIR, filename), png);
    }
    const publicUrl = `/academy-img/${filename}`;
    await this.applyImageUrl(g.academyId, kind, subId, publicUrl);
    return { ok: true, url: publicUrl };
  }

  /* ---------- helpers ---------- */

  private isKnownKind(kind: string): boolean {
    if (kind === "logo" || kind === "cover" || kind === "theme") return true;
    const [top] = kind.split(":");
    return top === "achievement" || top === "testimonial";
  }

  private async applyImageUrl(academyId: string, kind: string, subId: string | null, url: string) {
    if (kind === "logo") {
      await this.col().updateOne(
        { _id: academyId as any },
        { $set: { logoUrl: url, updatedAt: new Date() }, $setOnInsert: { _id: academyId } },
        { upsert: true },
      );
      return;
    }
    if (kind === "cover") {
      await this.col().updateOne(
        { _id: academyId as any },
        { $set: { coverUrl: url, updatedAt: new Date() }, $setOnInsert: { _id: academyId } },
        { upsert: true },
      );
      return;
    }
    if (kind === "theme") {
      // Full-viewport painterly background layer — rendered by AcademyPublic.tsx
      // as a fixed low-opacity div behind everything else, gracefully falling
      // back to the SVG chessboard when unset.
      await this.col().updateOne(
        { _id: academyId as any },
        { $set: { themeUrl: url, updatedAt: new Date() }, $setOnInsert: { _id: academyId } },
        { upsert: true },
      );
      return;
    }
    if (!subId) return;
    const [top] = kind.split(":");
    const arrName = top === "achievement" ? "achievements"
                  : top === "testimonial" ? "testimonials" : null;
    if (!arrName) return;
    const upd = await this.col().updateOne(
      { _id: academyId as any, [`${arrName}.id`]: subId },
      { $set: { [`${arrName}.$.imageUrl`]: url, updatedAt: new Date() } },
    );
    if (upd.matchedCount === 0) {
      const stub: any = { id: subId, imageUrl: url };
      if (arrName === "achievements") stub.title = "";
      if (arrName === "testimonials") { stub.author = ""; stub.quote = ""; }
      await this.col().updateOne(
        { _id: academyId as any },
        {
          $push: { [arrName]: stub } as any,
          $set: { updatedAt: new Date() },
          $setOnInsert: { _id: academyId },
        },
        { upsert: true },
      );
    }
  }

  private normalizeAchievements(raw: any): AcademyAchievement[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_LIST).map((r: any) => ({
      id: String(r?.id || shortId()).slice(0, 24),
      title: String(r?.title || "").trim().slice(0, 200),
      description: String(r?.description || "").slice(0, 800),
      year: cleanYear(r?.year),
      imageUrl: cleanImageUrl(r?.imageUrl),
    })).filter((r) => r.title.length > 0 || r.imageUrl);
  }
  private normalizeTestimonials(raw: any): AcademyTestimonial[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_LIST).map((r: any) => ({
      id: String(r?.id || shortId()).slice(0, 24),
      author: String(r?.author || "").trim().slice(0, 120),
      role: String(r?.role || "").trim().slice(0, 120),
      quote: String(r?.quote || "").slice(0, 800),
      rating: cleanRating(r?.rating),
      imageUrl: cleanImageUrl(r?.imageUrl),
    })).filter((r) => r.author.length > 0 || r.quote.length > 0 || r.imageUrl);
  }
  private normalizeSocials(raw: any) {
    if (!raw || typeof raw !== "object") return {};
    const s: Record<string, string> = {};
    const fields = ["website", "twitter", "youtube", "instagram", "whatsapp"];
    for (const k of fields) {
      const v = String(raw[k] ?? "").trim().slice(0, 240);
      if (v) s[k] = v;
    }
    return s;
  }

  private scrub(doc: any, academyId: string) {
    return {
      academyId,
      slug: academyId,
      displayName: String(doc?.displayName || ""),
      tagline: String(doc?.tagline || ""),
      description: String(doc?.description || ""),
      logoUrl: String(doc?.logoUrl || ""),
      coverUrl: String(doc?.coverUrl || ""),
      themeUrl: String(doc?.themeUrl || ""),
      country: String(doc?.country || ""),
      city: String(doc?.city || ""),
      foundedYear: typeof doc?.foundedYear === "number" ? doc.foundedYear : undefined,
      socials: doc?.socials && typeof doc.socials === "object" ? doc.socials : {},
      achievements: Array.isArray(doc?.achievements) ? doc.achievements : [],
      testimonials: Array.isArray(doc?.testimonials) ? doc.testimonials : [],
      featuredCoachIds: Array.isArray(doc?.featuredCoachIds) ? doc.featuredCoachIds : [],
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
  if (s.startsWith("/academy-img/") || s.startsWith("/coach-img/") || /^https:\/\/[^\s"'<>]+$/.test(s)) return s;
  return undefined;
}
