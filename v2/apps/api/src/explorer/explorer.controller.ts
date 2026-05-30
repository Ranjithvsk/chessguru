import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { ExplorerService } from "./explorer.service";

@Controller("explorer")
export class ExplorerController {
  constructor(private readonly svc: ExplorerService) {}

  @Get()
  async explore(
    @Query("fen") fen?: string,
    @Query("db") db = "masters",
    @Query("moves") moves = "12",
    @Query("topGames") topGames = "0",
  ) {
    if (!fen) throw new BadRequestException("fen required");
    return this.svc.explore(fen, db || "masters", Number(moves) || 12, Number(topGames) || 0);
  }
}
