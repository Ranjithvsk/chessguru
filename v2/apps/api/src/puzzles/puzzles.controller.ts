import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
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
  ) {
    const p = await this.svc.random(theme, difficulty, Number(rating) || 1500, maxPc ? Number(maxPc) : undefined);
    if (!p) throw new NotFoundException("no puzzle");
    return p;
  }

  @Post(":id/complete")
  async complete(@Param("id") id: string, @Body() body: any) {
    const r = await this.svc.complete(id, body ?? {});
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
