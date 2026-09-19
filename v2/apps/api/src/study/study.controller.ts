import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { StudyService } from "./study.service";
import { DefenderService, type DefenceLevel } from "./defender.service";

@Controller("study")
export class StudyController {
  constructor(private readonly study: StudyService, private readonly defender: DefenderService) {}

  @Get("levels")
  levels() { return this.study.levels(); }

  @Get("me")
  me(@Query("type") type: string, @Req() req: any) { return this.study.me(req?.session?.userId ?? null, type); }

  @Get("puzzle")
  puzzle(@Query("type") type: string, @Query("level") level?: string, @Query("pawns") pawns?: string, @Query("book") book?: string) {
    return this.study.puzzle(type, Number(level) || 1200, pawns ? Number(pawns) : undefined, book || undefined);
  }

  @Get("books")
  books(@Query("type") type: string) { return this.study.books(type); }

  /** POST /study/defend { fen, level: "hard" | "best" } — the trainer's opponent move. "easy" is
   *  played in the browser. Returns { move, mateIn, source } — mateIn (full moves, from the
   *  side that is winning) is exact when it comes from the tablebase oracle. */
  @Post("defend")
  defend(@Body() body: any) {
    const fen = typeof body?.fen === "string" ? body.fen.trim() : "";
    if (!/^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+ [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d+ \d+$/.test(fen)) return { ok: false, reason: "bad-fen" };
    const level: DefenceLevel = body?.level === "hard" ? "hard" : "best";
    return this.defender.defend(fen, level).then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
  }

  @Post(":id/complete")
  complete(@Param("id") id: string, @Body() body: any, @Req() req: any) {
    return this.study.complete(id, { ...(body ?? {}), userId: req?.session?.userId ?? null });
  }
}
