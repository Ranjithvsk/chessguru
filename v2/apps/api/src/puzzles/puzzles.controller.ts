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
  ) {
    const p = await this.svc.random(theme, difficulty, Number(rating) || 1500, maxPc ? Number(maxPc) : undefined, userId || null, section || undefined, player || undefined, mode || undefined);
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

  @Get("daily")
  async daily(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    return this.svc.daily(userId);
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
