import { Controller, Get, Param, Post, Query, Req, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "./admins";
import { AdminService } from "./admin.service";
import { AdminAcademiesService } from "./admin-academies.service";

@Controller()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly academies_: AdminAcademiesService,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  private requireAuth(req: any) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
  }

  private requireAdmin(req: any) {
    if (!isAdmin(req.session?.userId)) throw new ForbiddenException("admin only");
  }

  @Get("admin/overview")
  overviewDash(@Req() req: any) { this.requireAdmin(req); return this.admin.overviewDash(); }

  @Get("admin/users")
  users(@Req() req: any) { this.requireAdmin(req); return this.admin.listUsers(); }

  @Get("admin/users/:username")
  userDetail(@Param("username") username: string, @Req() req: any) { this.requireAdmin(req); return this.admin.userDetail(username); }

  /** GET /api/admin/academies — per-academy adoption roll-up (2026-09-11).
   *
   *  "Which academies are actually using ChessGuru, and which signed up and
   *   went quiet." One row per academy + a synthetic "(no academy)" row for the
   *  standalone signups, each carrying people / activity / a features-adopted
   *  checklist / a health verdict with a one-line reason. Read-only.
   *
   *  STILL a bare array of rows carrying { id, name, studentCount } including
   *  the "__all__" and "__platform__" sentinels, because this same endpoint is
   *  the super-admin leaderboard picker (2026-08-27) that
   *  apps/web/src/pages/Leaderboard.tsx:391 reads. Every adoption field is
   *  additive — do not switch this to an envelope object. */
  @Get("admin/academies")
  academies(@Req() req: any, @Query("limit") limit?: string, @Query("offset") offset?: string, @Query("slim") slim?: string) {
    this.requireAdmin(req);
    // ?slim=1 -> the cheap {id,name,studentCount} list the Leaderboard picker
    // needs. Without it a dropdown pays for the whole adoption build.
    if (slim === "1" || slim === "true") return this.academies_.pickerList();
    return this.academies_.rollup({ limit: Number(limit), offset: Number(offset) });
  }

  /** GET /api/admin/academies/:id — drill-down for one academy: the roll-up row,
   *  per-person rows, a 30-day daily series, and what has actually been created
   *  recently (study titles with author + date, classes held, homework assigned).
   *  Pass "__platform__" for the standalone-signups bucket. Read-only. */
  @Get("admin/academies/:id")
  academyAdoptionDetail(
    @Param("id") id: string,
    @Req() req: any,
    @Query("peopleLimit") peopleLimit?: string,
    @Query("peopleOffset") peopleOffset?: string,
    @Query("recentLimit") recentLimit?: string,
  ) {
    this.requireAdmin(req);
    return this.academies_.detail(id, {
      peopleLimit: Number(peopleLimit),
      peopleOffset: Number(peopleOffset),
      recentLimit: Number(recentLimit),
    });
  }

  @Get("status/overview")
  overview(@Req() req: any) { this.requireAdmin(req); return this.admin.overview(); }

  @Get("status/distribution")
  distribution(@Req() req: any) { this.requireAdmin(req); return this.admin.distribution(); }

  @Get("generated/puzzles")
  generated(@Query("limit") limit = "24", @Req() req: any) { this.requireAdmin(req); return this.admin.generated(Math.min(Number(limit) || 24, 100)); }

  @Get("generated/stats")
  generatedStats(@Req() req: any) { this.requireAdmin(req); return this.admin.generatedStats(); }

  @Post("generated/puzzles/:id/approve")
  approve(@Param("id") id: string, @Req() req: any) { this.requireAdmin(req); return this.admin.approve(id); }

  @Post("generated/puzzles/:id/reject")
  reject(@Param("id") id: string, @Req() req: any) { this.requireAdmin(req); return this.admin.reject(id); }

  /** GET /api/admin/mail-log?channel=digest|streak&limit=200
   *  Phase 7l — most recent transactional-email sends for the digest + streak
   *  channels. Includes an aggregate summary (sent/failed counts + unique
   *  recipients) so the top of the page has at-a-glance delivery health. */
  @Get("admin/mail-log")
  async mailLog(
    @Req() req: any,
    @Query("channel") channel?: string,
    @Query("limit") limitRaw?: string,
  ) {
    this.requireAdmin(req);
    const limit = Math.min(500, Math.max(1, parseInt(String(limitRaw ?? "200"), 10) || 200));
    const q: any = {};
    if (channel === "digest" || channel === "streak") q.channel = channel;

    const rows = await this.conn.db!.collection("mailLog")
      .find(q, { projection: { userId: 1, channel: 1, email: 1, subject: 1, status: 1, messageId: 1, error: 1, sentAt: 1 } as any })
      .sort({ sentAt: -1 })
      .limit(limit)
      .toArray();

    // 24h + 7d aggregates over the SAME channel filter (or all, when omitted).
    const now = Date.now();
    const day  = new Date(now - 86_400_000);
    const week = new Date(now - 7 * 86_400_000);
    const summary = await this.conn.db!.collection("mailLog").aggregate([
      { $match: { ...q, sentAt: { $gte: week } } },
      { $group: {
          _id: { channel: "$channel", status: "$status", window: { $cond: [{ $gte: ["$sentAt", day] }, "24h", "7d"] } },
          n: { $sum: 1 },
          users: { $addToSet: "$userId" },
      } },
    ]).toArray();

    return { rows, summary };
  }
}
