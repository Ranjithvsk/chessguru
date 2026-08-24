import { Injectable, Logger } from "@nestjs/common";

/**
 * Proxy to the local chessdb API on Vinayaka (via France:8790 autossh tunnel).
 * Backs the coach "Load Game from ChessDB" search UI + the Gameplay Revise
 * game picker. Bearer token auth to the remote API.
 *
 * Env vars:
 *   CHESSDB_URL   - default http://127.0.0.1:8790
 *   CHESSDB_TOKEN - default cg_v_2026_c9r7
 */
@Injectable()
export class ChessdbService {
  private readonly log = new Logger("ChessdbService");
  private readonly URL = process.env.CHESSDB_URL || "http://127.0.0.1:8790";
  private readonly TOKEN = process.env.CHESSDB_TOKEN || "cg_v_2026_c9r7";

  private async get(path: string, params?: Record<string, string | number | undefined>) {
    const url = new URL(path, this.URL);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    try {
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.TOKEN}` },
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) {
        this.log.warn(`chessdb ${path} → HTTP ${r.status}`);
        return null;
      }
      return await r.json();
    } catch (e) {
      this.log.warn(`chessdb ${path} error: ${(e as Error).message}`);
      return null;
    }
  }

  async search(opts: {
    white?: string; black?: string; event?: string;
    eco?: string; year?: number;
    yearFrom?: number; yearTo?: number;
    source?: string;
    limit?: number; skip?: number;
  }) {
    const res = await this.get("/games", {
      white: opts.white, black: opts.black, event: opts.event,
      eco: opts.eco, year: opts.year,
      year_from: opts.yearFrom, year_to: opts.yearTo,
      source: opts.source,
      only_canonical: 1 as any,
      limit: Math.min(opts.limit ?? 50, 200),
      skip: opts.skip ?? 0,
    });
    // Distinguish "backend timeout/unreachable" from "no matches"
    return res || { count: 0, items: [], error: "backend_timeout" };
  }

  async game(id: string) {
    return await this.get(`/games/${encodeURIComponent(id)}`);
  }

  /** Unified explorer: UCI-prefix + text/meta filters (all optional).
   *
   *  When the caller has NO position (empty moves) but has text/meta
   *  filters, the Vinayaka backend's /games/by-position path falls to a
   *  $text query that requires an index missing from mastergames — returns
   *  "text index required" error and no results (owner report 2026-08-24
   *  searching "Carlsen" in /coach-board/chessdb). Route those queries
   *  through /games (the plain search endpoint that uses ordinary
   *  regex/exact matches) instead. When moves ARE present we stay on
   *  by-position because that's optimized for prefix matching.
   */
  async byPosition(opts: {
    moves?: string;
    white?: string; black?: string; event?: string;
    eco?: string;
    yearFrom?: number; yearTo?: number;
    limit?: number;
  }) {
    const moves = opts.moves ?? "";
    if (!moves.trim()) {
      // No position — use the search endpoint instead.
      const res = await this.search({
        white: opts.white, black: opts.black, event: opts.event,
        eco: opts.eco, yearFrom: opts.yearFrom, yearTo: opts.yearTo,
        limit: opts.limit,
      });
      // by-position response shape includes `moves` field; add it back for compat.
      return { ...(res || {}), moves: "" };
    }
    const res = await this.get("/games/by-position", {
      moves,
      white: opts.white, black: opts.black, event: opts.event,
      eco: opts.eco,
      yearFrom: opts.yearFrom, yearTo: opts.yearTo,
      limit: Math.min(opts.limit ?? 50, 200),
      only_canonical: 1 as any,
    });
    return res || { count: 0, items: [], moves, error: "backend_timeout" };
  }

  async stats() {
    return await this.get("/stats");
  }

  /** Player autocomplete/typo-tolerance. Proxies to Vinayaka's
   *  /players/suggest endpoint. Owner ask 2026-08-24. */
  async playersSuggest(opts: { q: string; limit?: number }) {
    const res = await this.get("/players/suggest", { q: opts.q, limit: Math.min(opts.limit ?? 10, 50) });
    return res || { items: [] };
  }
}
