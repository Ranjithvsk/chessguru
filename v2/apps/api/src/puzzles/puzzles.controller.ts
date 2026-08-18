import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { PuzzlesService } from "./puzzles.service";
import { resolveViewedUser } from "../admin/view-as";

@Controller("puzzles")
export class PuzzlesController {
  constructor(
    private readonly svc: PuzzlesService,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  @Get("random")
  async random(
    @Query("theme") theme = "mix",
    @Query("difficulty") difficulty = "normal",
    @Query("rating") rating = "1500",
    @Query("maxPc") maxPc?: string,
    @Query("userId") userId?: string,
    @Query("section") section?: string,
    @Query("player") player?: string,
    @Query("mode") mode?: string,
    // Curriculum override — when set, the picker uses this exact target
    // rating and bypasses both the userperfs live-rating override AND the
    // difficulty offset. Powers the weakness-curriculum ratchet where each
    // step in the course targets a specific rating.
    @Query("exactRating") exactRating?: string,
  ) {
    const p = await this.svc.random(theme, difficulty, Number(rating) || 1500, maxPc ? Number(maxPc) : undefined, userId || null, section || undefined, player || undefined, mode || undefined, exactRating ? Number(exactRating) : undefined);
    if (!p) throw new NotFoundException("no puzzle");
    return p;
  }

  @Get("dashboard")
  async dashboard(@Req() req: any, @Query("as") asRaw?: string) {
    // Session is the identity source; admins may pass ?as=<username> to view
    // another user's dashboard. Guests get { loggedIn: false }.
    const uid = await resolveViewedUser(this.conn, req.session, asRaw);
    return this.svc.dashboard(uid);
  }

  @Get("master-players")
  async masterPlayers() {
    return this.svc.masterPlayers();
  }

  // "Suggested for you" theme chips on the trainer — weakness/strength/new
  // mix, based on the caller's per-theme Glicko ratings.
  @Get("suggested-themes")
  async suggestedThemes(@Req() req: any) {
    const uid: string | null = req?.session?.userId ?? null;
    return this.svc.suggestedThemes(uid);
  }

  @Get("daily")
  async daily(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    return this.svc.daily(userId);
  }

  @Get("daily/history")
  async dailyHistory(@Req() req: any, @Query("days") daysRaw = "7") {
    const userId: string | null = req?.session?.userId ?? null;
    return this.svc.dailyHistory(userId, parseInt(daysRaw, 10) || 7);
  }

  @Post(":id/complete")
  async complete(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    // Trust the session for identity, not the request body (secure + survives a
    // stale cached /auth/me on the client). Guests have no session userId.
    const userId = req?.session?.userId ?? null;
    const r = await this.svc.complete(id, { ...(body ?? {}), userId });
    if (!r) throw new NotFoundException("puzzle not found");
    return r;
  }

  @Get(":id")
  async byId(@Param("id") id: string) {
    const p = await this.svc.byId(id);
    if (!p) throw new NotFoundException("puzzle not found");
    return p;
  }
}
