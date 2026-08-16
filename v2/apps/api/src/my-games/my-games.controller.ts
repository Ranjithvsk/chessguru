// My Games API.
//
//   GET    /api/my-games                — my imported games (no pgn body, no plies)
//   POST   /api/my-games/import/pgn     — paste PGN blob (one or many games)
//   POST   /api/my-games/import/lichess — { username, max=10 }
//   POST   /api/my-games/import/chesscom — { username, max=10 }
//   GET    /api/my-games/:id            — full game + analysis (plies + mistakes)
//   DELETE /api/my-games/:id            — remove
//   GET    /api/my-games/me/weaknesses  — aggregate tag counts across all games

import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";
import { MyGamesService } from "./my-games.service";

@Controller("my-games")
export class MyGamesController {
  constructor(private readonly svc: MyGamesService) {}

  @Get()
  list(@Req() req: any) { return this.svc.list(req?.session); }

  @Post("import/pgn")
  importPgn(@Body() body: any, @Req() req: any) { return this.svc.importPgn(req?.session, body); }

  @Post("import/lichess")
  importLichess(@Body() body: any, @Req() req: any) { return this.svc.importLichess(req?.session, body); }

  @Post("import/chesscom")
  importChesscom(@Body() body: any, @Req() req: any) { return this.svc.importChesscom(req?.session, body); }

  @Get("me/weaknesses")
  weaknesses(@Req() req: any) { return this.svc.weaknessSummary(req?.session); }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: any) { return this.svc.get(req?.session, id); }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: any) { return this.svc.remove(req?.session, id); }
}
