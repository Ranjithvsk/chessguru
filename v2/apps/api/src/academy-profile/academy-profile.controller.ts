// Academy public-profile routes.
//
// Public read:  GET /api/academy-page/:slug
//               GET /api/academy-page/by-domain/:host
// Self admin :  GET  /api/me/academy-profile
//               POST /api/me/academy-profile
//               POST /api/me/academy-profile/upload/:kind[/:subId]
//               POST /api/me/academy-profile/gen-image
//               POST /api/me/academy-profile/domain/{set,verify,remove}
//               GET  /api/me/academy-profile/domain/status

import {
  BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Post, Req, Res,
} from "@nestjs/common";
import { AcademyProfileService } from "./academy-profile.service";
import { AcademyDomainService } from "./academy-domain.service";

/** Build a monogram SVG icon (first letter over the tenant accent gradient)
 *  and return it as a `data:image/svg+xml;utf8,...` URI. Used by the PWA
 *  manifest endpoint when a tenant has no logo uploaded — beats falling
 *  through to the ChessGuru knight on their students' home screens.
 *  Chrome, Firefox, Safari all accept SVG data URIs as manifest icons. */
function monogramDataUri(name: string, color: string): string {
  const letter = (name.trim().charAt(0) || "?").toUpperCase()
    .replace(/[<>&"']/g, "?");     // strip anything that would break the SVG
  const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : "#14a2b8";
  // Simple two-stop gradient + centered letter. 512×512 renders crisply at
  // both PWA install sizes (Android uses 192/512, iOS falls back to 180).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
      `<defs>` +
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0%" stop-color="${safeColor}"/>` +
          `<stop offset="100%" stop-color="#0b3e47"/>` +
        `</linearGradient>` +
      `</defs>` +
      `<rect width="512" height="512" rx="96" fill="url(#g)"/>` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="'Inter','Helvetica Neue',Arial,sans-serif" font-weight="700" ` +
        `font-size="300" fill="#ffffff">${letter}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

@Controller("academy-page")
export class AcademyPublicController {
  constructor(
    private readonly svc: AcademyProfileService,
    private readonly domainSvc: AcademyDomainService,
  ) {}

  @Get("by-domain/:domain")
  async byDomain(@Param("domain") domain: string) {
    const hit = await this.domainSvc.lookupByDomain(domain);
    if (!hit) throw new NotFoundException("no academy with that domain");
    return hit;
  }

  /** Per-tenant PWA manifest — dynamically generated from academy profile.
   *  Called via `<link rel="manifest">` on tenant custom domains. Falls back to
   *  the default ChessGuru manifest if the host isn't a known tenant.
   *  URL: GET /api/academy-page/manifest?host=<hostname>
   *  Query param used because manifest fetches don't send session cookies. */
  @Get("manifest")
  @Header("Content-Type", "application/manifest+json")
  @Header("Cache-Control", "public, max-age=300")
  async manifest(@Req() req: any) {
    // Two ways to identify the tenant: (a) ?slug=<academyId> — used by the
    // index.html session-fallback branch when a signed-in student is on the
    // apex chessguru.cc; (b) ?host=<hostname> — used on tenant custom
    // domains (gunachess.com) where the slug is derivable from the URL.
    const slugParam = String(req.query?.slug || "").toLowerCase().trim();
    const host = String(req.query?.host || req.headers?.host || "").toLowerCase().split(":")[0];
    if (!slugParam && !host) throw new BadRequestException("bad host or slug");
    let hit: any = null;
    if (slugParam) {
      try { hit = { slug: slugParam, data: await this.svc.getBySlug(slugParam) }; } catch { hit = null; }
    }
    if (!hit && host) {
      // Look up the tenant academy by custom domain OR by hostname first-label as
      // fallback (gunachess.com → academy where ownerId="gunachess").
      try { hit = await this.domainSvc.lookupByDomain(host); } catch {}
      if (!hit) {
        const slug = String(host.split(".")[0] || "");
        if (slug) {
          try { hit = { slug, data: await this.svc.getBySlug(slug) }; } catch { hit = null; }
        }
      }
    }
    let name = "ChessGuru";
    let logoUrl: string | null = null;
    let color = "#7c3aed";
    let isTenant = false;
    if (hit) {
      const data = hit.data || (await this.svc.getBySlug(hit.slug).catch(() => null));
      if (data) {
        name = data.profile?.displayName || data.academy?.name || name;
        logoUrl = data.profile?.logoUrl || null;
        color = "#14a2b8"; // tenant theme accent
        isTenant = true;
      }
    }
    const short = name.length > 12 ? name.split(/\s+/).slice(0, 2).join(" ") : name;

    // Icon resolution — three tiers, in order:
    //   1. Tenant with a proper sized upload → serve /academy/<slug>-192.webp
    //      etc. (the uploadImage pipeline sharp-generates these).
    //   2. Tenant with only a single-file logoUrl (no sized derivatives) →
    //      serve that one file at both sizes (Chrome may complain about
    //      dim mismatch but the icon still shows).
    //   3. Tenant without ANY logo → auto-generate an SVG monogram of the
    //      tenant's initial letter, embedded as a data URI in the manifest.
    //      Owner ask 2026-08-25: never fall through to ChessGuru's knight
    //      just because a tenant hasn't uploaded a logo yet.
    //   Canonical host (no tenant) → ChessGuru icons untouched.
    let icons: any[];
    if (isTenant && logoUrl) {
      const sizedPrefix = logoUrl.match(/^(.+?)-logo\.[a-z0-9]+$/i)?.[1];
      if (sizedPrefix) {
        icons = [
          { src: `${sizedPrefix}-192.webp`,           sizes: "192x192", type: "image/webp", purpose: "any" },
          { src: `${sizedPrefix}-512.webp`,           sizes: "512x512", type: "image/webp", purpose: "any" },
          { src: `${sizedPrefix}-maskable-512.webp`,  sizes: "512x512", type: "image/webp", purpose: "maskable" },
        ];
      } else {
        const ext = (logoUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "png").toLowerCase();
        const iconType = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/webp";
        icons = [
          { src: logoUrl, sizes: "512x512", type: iconType, purpose: "any" },
          { src: logoUrl, sizes: "512x512", type: iconType, purpose: "maskable" },
        ];
      }
    } else if (isTenant) {
      // Fallback monogram — SVG with tenant initial over the tenant accent
      // gradient. Encoded once, served at both sizes (SVG scales natively).
      const dataUri = monogramDataUri(name, color);
      icons = [
        { src: dataUri, sizes: "192x192", type: "image/svg+xml", purpose: "any" },
        { src: dataUri, sizes: "512x512", type: "image/svg+xml", purpose: "any" },
        { src: dataUri, sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
      ];
    } else {
      icons = [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ];
    }
    return {
      name,
      short_name: short,
      description: `${name} — chess training platform.`,
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#c7edf5",
      theme_color: color,
      icons,
    };
  }

  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.svc.getBySlug(slug);
  }
}

@Controller("me/academy-profile")
export class MyAcademyProfileController {
  constructor(
    private readonly svc: AcademyProfileService,
    private readonly domainSvc: AcademyDomainService,
  ) {}

  @Post("domain/set")
  domainSet(@Req() req: any, @Body() body: any) {
    return this.domainSvc.setDomain(req.session, body || {});
  }

  @Post("domain/verify")
  domainVerify(@Req() req: any) {
    return this.domainSvc.verify(req.session);
  }

  @Get("domain/status")
  domainStatus(@Req() req: any) {
    return this.domainSvc.status(req.session);
  }

  @Post("domain/remove")
  domainRemove(@Req() req: any) {
    return this.domainSvc.remove(req.session);
  }

  @Get()
  getMine(@Req() req: any) {
    return this.svc.getMine(req.session);
  }

  @Post()
  upsert(@Req() req: any, @Body() body: any) {
    return this.svc.upsertMine(req.session, body || {});
  }

  /** Nested image (achievement / testimonial) — /upload/:kind/:subId */
  @Post("upload/:kind/:subId")
  async uploadNested(
    @Param("kind") kind: string,
    @Param("subId") subId: string,
    @Body() body: Buffer,
    @Req() req: any,
  ) {
    if (kind !== "achievement" && kind !== "testimonial") {
      throw new BadRequestException("bad nested kind");
    }
    const ct = String(req?.headers?.["content-type"] || "");
    return this.svc.uploadImage(req.session, `${kind}:${subId}`, subId, body, ct);
  }

  /** Top-level image (logo | cover) — /upload/:kind */
  @Post("upload/:kind")
  async uploadTop(
    @Param("kind") kind: string,
    @Body() body: Buffer,
    @Req() req: any,
  ) {
    if (kind !== "logo" && kind !== "cover") throw new BadRequestException("bad kind");
    const ct = String(req?.headers?.["content-type"] || "");
    return this.svc.uploadImage(req.session, kind, null, body, ct);
  }

  /** Gemini text→image generation for logo/cover/achievement/testimonial. */
  @Post("gen-image")
  gen(@Req() req: any, @Body() body: any) {
    return this.svc.genImage(req.session, body || {});
  }
}
