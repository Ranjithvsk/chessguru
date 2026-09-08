// Online-play history.
//
//   GET /api/live-games            — my finished games (newest first); ?speed= ?outcome=win|loss|draw ?rated=1|0 ?offset= ?limit=
//   GET /api/live-games/stats      — totals, win rate, streaks, per-speed rating + history, form
//   GET /api/live-games/:id        — one game with SAN/FEN per ply, clocks, PGN (owner-only)
import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import { LiveGamesService } from "./live-games.service";

@Controller("live-games")
export class LiveGamesController {
  constructor(private readonly svc: LiveGamesService) {}

  @Get()
  list(@Req() req: any, @Query() q: Record<string, string>) { return this.svc.list(req?.session, q); }

  @Get("stats")
  stats(@Req() req: any) { return this.svc.stats(req?.session); }

  @Get(":id")
  get(@Req() req: any, @Param("id") id: string) { return this.svc.get(req?.session, id); }
}
