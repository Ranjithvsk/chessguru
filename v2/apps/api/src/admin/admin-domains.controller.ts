// Superadmin custom-domain panel (2026-08-13).
//
// Feature-gate + on-behalf-of admin actions for the per-academy and per-coach
// custom-domain flow. Composes AcademyDomainService + CoachDomainService so
// certbot/nginx logic stays in one place.
//
// Guard: every route re-checks isAdmin(session.userId). No client trust; even
// the SPA route redirect on the frontend is a UX shortcut, not the gate.

import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Param,
  Post, Req, UnauthorizedException,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "./admins";
import { AcademyDomainService } from "../academy-profile/academy-domain.service";
import { CoachDomainService } from "../coach-profile/coach-domain.service";

@Controller("admin")
export class AdminDomainsController {
  constructor(
    private readonly academyDomain: AcademyDomainService,
    private readonly coachDomain: CoachDomainService,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  private requireAdmin(req: any) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    if (!isAdmin(req.session?.userId)) throw new ForbiddenException("admin only");
  }

  /** Sort weight: active first, then failed, then pending/provisioning, then
   *  unset. Keeps the "needs attention" rows near the top of the tables. */
  private rank(status: string): number {
    switch (status) {
      case "active": return 0;
      case "failed": return 1;
      case "pending_dns":
      case "verifying":
      case "provisioning": return 2;
      default: return 3;
    }
  }

  /* ================================================================
   * Platform overview — every academy + every coach + every current
   * custom-domain state. Rows with no domain set are included so the
   * admin can flip customDomainEnabled on the full roster.
   * ================================================================ */
  @Get("domains")
  async list(@Req() req: any) {
    this.requireAdmin(req);
    const db = this.conn.db!;

    // Academies — left-join on academyProfiles for domain fields.
    const academies: any[] = await db.collection("academies")
      .find({}, { projection: { _id: 1, name: 1, ownerId: 1 } })
      .toArray();
    const academyIds = academies.map((a) => a._id);
    const academyProfiles: any[] = await db.collection("academyProfiles")
      .find({ _id: { $in: academyIds as any } })
      .toArray();
    const acadProfById = new Map(academyProfiles.map((p) => [String(p._id), p]));
    const academyRows = academies.map((a) => {
      const p: any = acadProfById.get(String(a._id)) || {};
      return {
        slug: String(a._id),
        academyId: String(a._id),
        displayName: String(p.displayName || a.name || a._id),
        customDomain: String(p.customDomain || ""),
        customDomainStatus: String(p.customDomainStatus || ""),
        customDomainEnabled: p.customDomainEnabled !== false,
        customDomainAddedAt: p.customDomainAddedAt || null,
        customDomainActivatedAt: p.customDomainActivatedAt || null,
        customDomainLastError: String(p.customDomainError || ""),
      };
    }).sort((a, b) => {
      const r = this.rank(a.customDomainStatus) - this.rank(b.customDomainStatus);
      return r !== 0 ? r : a.slug.localeCompare(b.slug);
    });

    // Coaches — include every user with role coach OR academy_owner (owners
    // can also publish a personal coach page).
    const coachUsers: any[] = await db.collection("users")
      .find(
        { role: { $in: ["coach", "academy_owner"] } },
        { projection: { _id: 1, username: 1, name: 1, role: 1, academyId: 1 } },
      )
      .toArray();
    const coachIds = coachUsers.map((u) => String(u._id));
    const coachProfiles: any[] = await db.collection("coachProfiles")
      .find({ _id: { $in: coachIds as any } })
      .toArray();
    const coachProfById = new Map(coachProfiles.map((p) => [String(p._id), p]));
    const coachRows = coachUsers.map((u) => {
      const p: any = coachProfById.get(String(u._id)) || {};
      return {
        username: String(u.username || u._id),
        userId: String(u._id),
        role: String(u.role || ""),
        academyId: u.academyId || null,
        displayName: String(p.displayName || u.name || u.username || u._id),
        customDomain: String(p.customDomain || ""),
        customDomainStatus: String(p.customDomainStatus || ""),
        customDomainEnabled: p.customDomainEnabled !== false,
        customDomainAddedAt: p.customDomainAddedAt || null,
        customDomainActivatedAt: p.customDomainActivatedAt || null,
        customDomainLastError: String(p.customDomainError || ""),
      };
    }).sort((a, b) => {
      const r = this.rank(a.customDomainStatus) - this.rank(b.customDomainStatus);
      return r !== 0 ? r : a.username.localeCompare(b.username);
    });

    return { academies: academyRows, coaches: coachRows };
  }

  /* ============================================ academy actions === */

  @Post("academy/:academyId/enable-domain")
  academyEnable(@Param("academyId") academyId: string, @Body() body: any, @Req() req: any) {
    this.requireAdmin(req);
    if (typeof body?.enabled !== "boolean") throw new BadRequestException("body.enabled must be boolean");
    return this.academyDomain.adminSetEnabled(academyId, !!body.enabled);
  }

  @Post("academy/:academyId/set-domain")
  academySet(@Param("academyId") academyId: string, @Body() body: any, @Req() req: any) {
    this.requireAdmin(req);
    return this.academyDomain.adminSetDomainFor(academyId, String(body?.domain || ""));
  }

  @Post("academy/:academyId/verify-domain")
  academyVerify(@Param("academyId") academyId: string, @Req() req: any) {
    this.requireAdmin(req);
    return this.academyDomain.adminVerifyFor(academyId);
  }

  @Post("academy/:academyId/remove-domain")
  academyRemove(@Param("academyId") academyId: string, @Req() req: any) {
    this.requireAdmin(req);
    return this.academyDomain.adminRemoveFor(academyId);
  }

  /* ============================================ coach actions ====== */

  /** Resolve `:username` → users._id (which is username.toLowerCase()). We
   *  accept either form to be forgiving of admin typing. */
  private async userIdForUsername(username: string): Promise<string> {
    const u = String(username || "").trim().toLowerCase();
    if (!u) throw new BadRequestException("missing username");
    const user: any = await this.conn.db!.collection("users").findOne(
      { $or: [{ _id: u as any }, { username: u }] },
      { projection: { _id: 1 } },
    );
    if (!user) throw new BadRequestException("no such user");
    return String(user._id);
  }

  @Post("coach/:username/enable-domain")
  async coachEnable(@Param("username") username: string, @Body() body: any, @Req() req: any) {
    this.requireAdmin(req);
    if (typeof body?.enabled !== "boolean") throw new BadRequestException("body.enabled must be boolean");
    const id = await this.userIdForUsername(username);
    return this.coachDomain.adminSetEnabled(id, !!body.enabled);
  }

  @Post("coach/:username/set-domain")
  async coachSet(@Param("username") username: string, @Body() body: any, @Req() req: any) {
    this.requireAdmin(req);
    const id = await this.userIdForUsername(username);
    return this.coachDomain.adminSetDomainFor(id, String(body?.domain || ""));
  }

  @Post("coach/:username/verify-domain")
  async coachVerify(@Param("username") username: string, @Req() req: any) {
    this.requireAdmin(req);
    const id = await this.userIdForUsername(username);
    return this.coachDomain.adminVerifyFor(id);
  }

  @Post("coach/:username/remove-domain")
  async coachRemove(@Param("username") username: string, @Req() req: any) {
    this.requireAdmin(req);
    const id = await this.userIdForUsername(username);
    return this.coachDomain.adminRemoveFor(id);
  }
}
