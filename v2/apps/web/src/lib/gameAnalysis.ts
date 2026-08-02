// Memory Master 500 — real-game import + book-theory analysis.
//
// Input: a PGN string of a game the user actually played (from Lichess,
// Chess.com, over-the-board notation — chess.js handles the parsing).
//
// Output: which opening from the 500-corpus was played (the DEEPEST corpus
// entry whose pgnStart matches the game's move prefix), how many book moves
// followed the mainline, the first deviation (theory vs played), and — if
// the deviating side matches the user's colour — a suggestion to activate
// that opening's cards so the corrected move enters the daily queue.

import { Chess } from "chess.js";
import { OPENINGS, openingBySlug } from "./openings";
import type { Opening } from "./openings/types";

export type Side = "white" | "black";

export interface GameAnalysis {
  ok: true;
  totalPlies: number;
  headers: Record<string, string>;
  playedByWhite: string[];       // SAN moves indexed [0, 2, 4, …]
  playedByBlack: string[];       // SAN moves indexed [1, 3, 5, …]
  identified: Opening | null;    // deepest corpus match (or null)
  identifiedPly: number;         // number of plies of the game that match identified.pgnStart
  bookPly: number;               // number of plies matching identified.mainlinePgn from the start (>= identifiedPly)
  deviation: {
    ply: number;                 // 1-based ply where game diverged from mainline
    side: Side;                  // whose move deviated
    played: string;              // SAN they played
    theory: string;              // SAN mainline recommends
    fenBefore: string;
  } | null;
}
export interface AnalysisError { ok: false; error: string; }

export function analyseGame(pgn: string): GameAnalysis | AnalysisError {
  const g = new Chess();
  let loaded = false;
  try { g.loadPgn(pgn, { strict: false }); loaded = true; } catch { /* fall through */ }
  if (!loaded) return { ok: false, error: "Couldn't parse PGN. Paste the whole game including move numbers." };

  const history = g.history({ verbose: true });
  if (history.length === 0) return { ok: false, error: "PGN had no moves." };

  const playedSans = history.map((h) => h.san);
  const playedByWhite: string[] = [];
  const playedByBlack: string[] = [];
  playedSans.forEach((san, i) => (i % 2 === 0 ? playedByWhite : playedByBlack).push(san));

  // Identify opening: for every corpus entry, check whether its pgnStart is a
  // prefix of playedSans. Keep the LONGEST match — that's the most specific
  // variation the game reached.
  let identified: Opening | null = null;
  let identifiedPly = 0;
  for (const o of OPENINGS) {
    const start = o.pgnStart;
    if (!start?.length) continue;
    if (start.length > playedSans.length) continue;
    let match = true;
    for (let i = 0; i < start.length; i++) {
      if (start[i] !== playedSans[i]) { match = false; break; }
    }
    if (!match) continue;
    if (start.length > identifiedPly) {
      identified = o;
      identifiedPly = start.length;
    }
  }

  // Book-depth + deviation: replay the identified opening's MAINLINE ply-by-ply
  // against the game. First mismatched ply is the deviation.
  let bookPly = 0;
  let deviation: GameAnalysis["deviation"] = null;
  if (identified?.mainlinePgn?.length) {
    const line = identified.mainlinePgn;
    const cmp = Math.min(line.length, playedSans.length);
    // FEN-before is needed for the review card — replay a fresh chess.js.
    const gg = new Chess();
    for (let i = 0; i < cmp; i++) {
      if (line[i] === playedSans[i]) {
        bookPly = i + 1;
        try { gg.move(line[i]!); } catch { break; }
      } else {
        deviation = {
          ply: i + 1,
          side: i % 2 === 0 ? "white" : "black",
          played: playedSans[i]!,
          theory: line[i]!,
          fenBefore: gg.fen(),
        };
        break;
      }
    }
  } else if (identified) {
    bookPly = identifiedPly;   // we don't have a mainline; identification depth is our best guess
  }

  return {
    ok: true,
    totalPlies: playedSans.length,
    headers: g.header() as Record<string, string>,
    playedByWhite,
    playedByBlack,
    identified,
    identifiedPly,
    bookPly,
    deviation,
  };
}

/** For the "review the deviation" button: reconstruct the card id that
 *  represents the theory move at the deviation ply. Matches the id scheme
 *  in lib/cards.ts (`<slug>:nm:<ply>`). */
export function deviationCardId(a: GameAnalysis): string | null {
  if (!a.identified || !a.deviation) return null;
  return `${a.identified.slug}:nm:${a.deviation.ply}`;
}

/** Opening-detail slug for the "read theory" link. */
export function identifiedSlug(a: GameAnalysis): string | null {
  return a.identified?.slug ?? null;
}

/** Convenience: friendly summary text ("You played the Italian Giuoco Piano
 *  and stayed in book for 12 plies before deviating on move 7…"). */
export function summarise(a: GameAnalysis): string {
  if (!a.identified) return `Your ${a.totalPlies}-ply game didn't match any of the 500 corpus openings.`;
  const o = openingBySlug.get(a.identified.slug)!;
  const bookMoves = Math.floor(a.bookPly / 2);
  const rest = a.bookPly % 2 ? " + Black's reply" : "";
  const dev = a.deviation
    ? ` First deviation on move ${Math.ceil(a.deviation.ply / 2)}${a.deviation.side === "black" ? "…" : "."} — you played ${a.deviation.played}, theory says ${a.deviation.theory}.`
    : " You played the full mainline!";
  return `You played the ${o.name}. Book depth: ${bookMoves} full move${bookMoves === 1 ? "" : "s"}${rest}.${dev}`;
}
