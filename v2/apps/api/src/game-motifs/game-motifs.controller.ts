import { Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { GameMotifsService } from "./game-motifs.service";

// GET  /api/game-motifs/leaderboard?period=7d|30d|90d|all   — any academy member
// GET  /api/game-motifs/student/:id?period=                 — the student's found / missed list
// POST /api/game-motifs/analyze/:gameId                    — coach / owner: run the engine on one game now
@Controller("game-motifs")
export class GameMotifsController {
  constructor(private readonly svc: GameMotifsService) {}
  @Get("leaderboard") leaderboard(@Req() req: any, @Query("period") period?: string) { return this.svc.leaderboard(req.session, period || "30d"); }
  @Get("student/:id") student(@Req() req: any, @Param("id") id: string, @Query("period") period?: string) { return this.svc.studentEvents(req.session, id, period || "30d"); }
  @Post("analyze/:gameId") analyze(@Req() req: any, @Param("gameId") gameId: string) { return this.svc.analyzeNow(req.session, gameId); }
}
