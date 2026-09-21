// PGN → the bits the board editor needs, with every failure named.
//
// Split out of BoardEditor so the parsing rules are testable on their own:
// they have real edge cases (headers vs a bare move list, a game that starts
// from a custom position, an illegal move partway, outright garbage) and the
// component cannot be unit-tested cheaply.
//
// chess.js 1.4.0 notes, all verified against the installed version:
//   - loadPgn THROWS on malformed input rather than returning false.
//   - header() fills unset tags with null, and Site/Date/Round/White/Black
//     with "?", so a missing name arrives as "?" and not undefined.
//   - a PGN carrying several games does NOT parse to the first game, it THROWS
//     outright. Downloaded collections are usually multi-game, so we cut to the
//     first game ourselves before handing it over (see firstGame).
import { Chess } from "chess.js";

export type PgnRead =
  | { ok: true; sans: string[]; setupFen: string | null; white: string | null; black: string | null;
      event: string | null; date: string | null; result: string | null }
  | { ok: false; reason: "empty" | "unparsable" | "no-moves" };

/** Split a PGN file into its separate games. A header line appearing AFTER
 *  moves have started is the next game beginning. */
export function splitPgnGames(raw: string): string[] {
  const games: string[] = [];
  let cur: string[] = [];
  let seenMoves = false;
  const flush = () => {
    const t = cur.join("\n").trim();
    if (t) games.push(t);
    cur = []; seenMoves = false;
  };
  for (const line of (raw || "").split(/\r?\n/)) {
    const isHeader = /^\s*\[/.test(line);
    if (isHeader && seenMoves) flush();
    if (!isHeader && line.trim()) seenMoves = true;
    cur.push(line);
  }
  flush();
  return games;
}

function firstGame(raw: string): string {
  return splitPgnGames(raw)[0] ?? raw;
}

export type PgnGameInfo = {
  index: number;
  white: string | null;
  black: string | null;
  event: string | null;
  date: string | null;
  result: string | null;
  moves: number;          // full moves, for the picker line
  text: string;           // this game alone, ready for readPgn
};

/** Enumerate the games in a file so the caller can offer a choice. Games that
 *  fail to parse are still listed, with moves: 0 — hiding them would make a
 *  file look shorter than it is and shift every number the user sees. */
export function listPgnGames(raw: string): PgnGameInfo[] {
  return splitPgnGames(raw).map((text, index) => {
    const r = readPgn(text);
    if (r.ok) {
      return { index, white: r.white, black: r.black, event: r.event, date: r.date,
               result: r.result, moves: Math.ceil(r.sans.length / 2), text };
    }
    return { index, white: null, black: null, event: null, date: null, result: null, moves: 0, text };
  });
}

export function readPgn(text: string): PgnRead {
  const raw = (text || "").trim();
  if (!raw) return { ok: false, reason: "empty" };

  const g = new Chess();
  try {
    g.loadPgn(firstGame(raw));
  } catch {
    return { ok: false, reason: "unparsable" };
  }

  const sans = g.history();
  // Parsed but empty: headers with no moves, or a move list we could not play.
  if (!sans.length) return { ok: false, reason: "no-moves" };

  let hdr: Record<string, unknown> = {};
  try { hdr = (g.header?.() ?? {}) as Record<string, unknown>; } catch { /* headerless */ }
  const tag = (k: string): string | null => {
    const v = hdr[k];
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t && t !== "?" ? t : null;      // "?" is chess.js's placeholder, not a value
  };

  const date = tag("Date");
  return {
    ok: true, sans, setupFen: tag("FEN"), white: tag("White"), black: tag("Black"),
    event: tag("Event"),
    // chess.js pads an unknown date as "????.??.??"; keep only a real one.
    date: date && !date.startsWith("????") ? date : null,
    result: tag("Result"),
  };
}

/** "Loaded 24 moves — Carlsen vs Nakamura." */
export function describePgn(r: Extract<PgnRead, { ok: true }>): string {
  const moves = Math.ceil(r.sans.length / 2);
  const names = r.white || r.black ? ` — ${r.white ?? "?"} vs ${r.black ?? "?"}` : "";
  return `Loaded ${moves} move${moves === 1 ? "" : "s"}${names}.`;
}
