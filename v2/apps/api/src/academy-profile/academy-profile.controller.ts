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
    const host = String(req.query?.host || req.headers?.host || "").toLowerCase().split(":")[0];
    if (!host) throw new BadRequestException("bad host");
    // Look up the tenant academy by custom domain OR by hostname first-label as
    // fallback (gunachess.com → academy where ownerId="gunachess").
    let hit: any = null;
    try { hit = await this.domainSvc.lookupByDomain(host); } catch {}
    if (!hit) {
      // Fallback: hostname first-label as slug (works for tenant-native domains).
      const slug = String(host.split(".")[0] || "");
      if (slug) {
        try { hit = { slug, data: await this.svc.getBySlug(slug) }; } catch { hit = null; }
      }
    }
    let name = "ChessGuru";
    let logoUrl = "/icons/icon-192.png";
    let color = "#7c3aed";
    if (hit) {
      const data = hit.data || (await this.svc.getBySlug(hit.slug).catch(() => null));
      if (data) {
        name = data.profile?.displayName || data.academy?.name || name;
        logoUrl = data.profile?.logoUrl || logoUrl;
        color = "#14a2b8"; // tenant theme accent
      }
    }
    const short = name.length > 12 ? name.split(/\s+/).slice(0, 2).join(" ") : name;
    const ext = (logoUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "png").toLowerCase();
    const iconType = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/webp";
    // Prefer per-tenant sized icons if the logo follows the "<prefix>-logo.<ext>"
    // convention (deployer generates <prefix>-192, <prefix>-512, <prefix>-maskable-512).
    // Chrome validates declared sizes against real pixel dims — using one 512
    // logo for both 192+512 slots causes it to silently drop the 192 icon.
    const sizedPrefix = logoUrl.match(/^(.+?)-logo\.[a-z0-9]+$/i)?.[1];
    const icons = sizedPrefix ? [
      { src: `${sizedPrefix}-192.${ext}`,           sizes: "192x192", type: iconType, purpose: "any" },
      { src: `${sizedPrefix}-512.${ext}`,           sizes: "512x512", type: iconType, purpose: "any" },
      { src: `${sizedPrefix}-maskable-512.${ext}`,  sizes: "512x512", type: iconType, purpose: "maskable" },
    ] : [
      { src: logoUrl, sizes: "512x512", type: iconType, purpose: "any" },
      { src: logoUrl, sizes: "512x512", type: iconType, purpose: "maskable" },
    ];
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
