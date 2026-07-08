import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { PuzzlesService } from "./puzzles.service";

@Controller("puzzles")
export class PuzzlesController {
  constructor(private readonly svc: PuzzlesService) {}

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
  dashboard(@Req() req: any) {
    // Session is the identity source; guests get { loggedIn: false }.
    return this.svc.dashboard(req?.session?.userId ?? null);
  }

  @Get("master-players")
  async masterPlayers() {
    return this.svc.masterPlayers();
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
