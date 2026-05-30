import { Injectable } from "@nestjs/common";
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
 * Our own opening explorer. Reads the position tree ingested by
 * apps/api/scripts/ingest-pgn.js (collection `openingpositions`, keyed by
 * "<db>|<epd>") and the ECO names from `openingnames` (keyed by epd).
 * Shaped to match the Lichess explorer response so the frontend reads 1:1.
 */
@Injectable()
export class ExplorerService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private positions() { return this.conn.db!.collection("openingpositions"); }
  private names() { return this.conn.db!.collection("openingnames"); }

  /** Position key = first 4 FEN fields (placement, side, castling, en passant). */
  private epd(fen: string) { return fen.trim().split(/\s+/).slice(0, 4).join(" "); }

  async explore(fen: string, db = "masters", movesLimit = 12, _topGames = 0): Promise<ExplorerResult> {
    const epd = this.epd(fen);
    const [doc, name] = await Promise.all([
      this.positions().findOne({ _id: `${db}|${epd}` } as any),
      this.names().findOne({ _id: epd } as any),
    ]);
    const opening = name ? { eco: name.eco as string, name: name.name as string } : null;
    if (!doc) return { white: 0, draws: 0, black: 0, moves: [], topGames: [], opening };

    const moves: ExplorerMove[] = Object.entries((doc.moves as Record<string, any>) || {}).map(
      ([uci, m]) => ({
        uci,
        san: m.san,
        white: m.w || 0,
        draws: m.d || 0,
        black: m.b || 0,
        averageRating: null,
        game: null,
      }),
    );
    moves.sort((a, b) => b.white + b.draws + b.black - (a.white + a.draws + a.black));

    return {
      white: doc.w || 0,
      draws: doc.d || 0,
      black: doc.b || 0,
      moves: moves.slice(0, movesLimit),
      topGames: [],
      opening,
    };
  }
}
