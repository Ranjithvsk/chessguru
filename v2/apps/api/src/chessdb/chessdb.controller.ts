/**
 * Coach-facing chessdb search API (proxy to Vinayaka corpus).
 *
 *   GET  /api/chessdb/search?white=&black=&event=&eco=&year=&yearFrom=&yearTo=&source=&limit=&skip=
 *   GET  /api/chessdb/game/:id
 *   GET  /api/chessdb/stats
 */
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ChessdbService } from "./chessdb.service";

@Controller("chessdb")
export class ChessdbController {
  constructor(private readonly svc: ChessdbService) {}

  @Get("search")
  search(
    @Query("white") white?: string,
    @Query("black") black?: string,
    @Query("event") event?: string,
    @Query("eco") eco?: string,
    @Query("year") year?: string,
    @Query("yearFrom") yearFrom?: string,
    @Query("yearTo") yearTo?: string,
    @Query("source") source?: string,
    @Query("limit") limit = "50",
    @Query("skip") skip = "0",
  ) {
    return this.svc.search({
      white, black, event, eco, source,
      year: year ? Number(year) : undefined,
      yearFrom: yearFrom ? Number(yearFrom) : undefined,
      yearTo: yearTo ? Number(yearTo) : undefined,
      limit: Number(limit) || 50,
      skip: Number(skip) || 0,
    });
  }

  @Get("game/:id")
  game(@Param("id") id: string) {
    return this.svc.game(id);
  }

  @Get("by-position")
  byPosition(
    @Query("moves") moves = "",
    @Query("white") white?: string,
    @Query("black") black?: string,
    @Query("event") event?: string,
    @Query("eco") eco?: string,
    @Query("yearFrom") yearFrom?: string,
    @Query("yearTo") yearTo?: string,
    @Query("limit") limit = "50",
  ) {
    return this.svc.byPosition({
      moves, white, black, event, eco,
      yearFrom: yearFrom ? Number(yearFrom) : undefined,
      yearTo: yearTo ? Number(yearTo) : undefined,
      limit: Number(limit) || 50,
    });
  }

  @Get("stats")
  stats() {
    return this.svc.stats();
  }

  /** Autocomplete + typo-tolerant player search — proxies to Vinayaka
   *  /players/suggest which searches a precomputed players collection. */
  @Get("players/suggest")
  playersSuggest(@Query("q") q = "", @Query("limit") limit = "10") {
    return this.svc.playersSuggest({ q, limit: Number(limit) || 10 });
  }
}
