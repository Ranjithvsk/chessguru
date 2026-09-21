import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number | null;
  game: null;
}
export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  topGames: unknown[];
  opening: { eco: string; name: string } | null;
}

/**
 * Opening explorer. Primary source: new chessdb API on Vinayaka (24M master games,
 * 41M+ positions), tunneled to France at http://127.0.0.1:8790. Falls back to the
 * legacy local `openingpositions` collection if the remote API is down or empty.
 * ECO name still comes from local `openingnames`.
 */
@Injectable()
export class ExplorerService {
  private readonly log = new Logger("ExplorerService");
  private readonly CHESSDB_URL = process.env.CHESSDB_URL || "http://127.0.0.1:8790";
  private readonly CHESSDB_TOKEN = process.env.CHESSDB_TOKEN || "cg_v_2026_c9r7";

  constructor(@InjectConnection() private readonly conn: Connection) {}
  private positions() { return this.conn.db!.collection("openingpositions"); }
  private names() { return this.conn.db!.collection("openingnames"); }

  private epd(fen: string) { return fen.trim().split(/\s+/).slice(0, 4).join(" "); }

  private async fetchRemote(fen: string) {
    try {
      const url = `${this.CHESSDB_URL}/explorer?fen=${encodeURIComponent(fen)}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${this.CHESSDB_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return null;
      return (await r.json()) as {
        games: number; w: number; d: number; b: number;
        moves: Array<{ uci: string; san: string; count: number; w: number; d: number; b: number }>;
      };
    } catch (e) {
      this.log.warn(`chessdb API fetch failed: ${(e as Error).message}`);
      return null;
    }
  }

  async explore(fen: string, db = "masters", movesLimit = 12, _topGames = 0): Promise<ExplorerResult> {
    const epd = this.epd(fen);
    const [remote, name] = await Promise.all([
      this.fetchRemote(fen),
      this.names().findOne({ _id: epd } as any),
    ]);
    const opening = name ? { eco: name.eco as string, name: name.name as string } : null;

    if (remote && remote.games > 0) {
      const moves = (remote.moves || []).slice(0, movesLimit).map((m) => ({
        uci: m.uci, san: m.san,
        white: m.w || 0, draws: m.d || 0, black: m.b || 0,
        averageRating: null, game: null,
      }));
      return { white: remote.w || 0, draws: remote.d || 0, black: remote.b || 0, moves, topGames: [], opening };
    }

    // Fallback: legacy local ingest
    const doc = await this.positions().findOne({ _id: `${db}|${epd}` } as any);
    if (!doc) return { white: 0, draws: 0, black: 0, moves: [], topGames: [], opening };
    const moves: ExplorerMove[] = Object.entries((doc.moves as Record<string, any>) || {}).map(
      ([uci, m]) => ({
        uci, san: m.san,
        white: m.w || 0, draws: m.d || 0, black: m.b || 0,
        averageRating: null, game: null,
      }),
    );
    moves.sort((a, b) => b.white + b.draws + b.black - (a.white + a.draws + a.black));
    return {
      white: doc.w || 0, draws: doc.d || 0, black: doc.b || 0,
      moves: moves.slice(0, movesLimit),
      topGames: [],
      opening,
    };
  }
}
