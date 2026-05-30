// Shared PGN helpers for the opening-book ingesters. CommonJS, run from apps/api.
const { Chess } = require("chess.js");

/** Position key = first 4 FEN fields (placement, side, castling, en passant). */
function epdOf(chess) {
  return chess.fen().split(" ").slice(0, 4).join(" ");
}

/** Strip comments / variations / NAGs / move numbers / result; return SAN tokens. */
function sanTokens(movetext) {
  let s = movetext.replace(/\{[^}]*\}/g, " ");      // comments
  let prev;
  do { prev = s; s = s.replace(/\([^()]*\)/g, " "); } while (s !== prev); // nested variations
  s = s.replace(/\$\d+/g, " ");                      // NAGs
  s = s.replace(/\d+\.(\.\.)?/g, " ");               // move numbers (incl. "12...")
  s = s.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, " "); // results
  return s.split(/\s+/).filter(Boolean);
}

const RESULT_BUCKET = { "1-0": "w", "0-1": "b", "1/2-1/2": "d" };

/** Iterate games in a PGN string → { result, moves:[san] }. Splits on the [Event tag. */
function* iterGames(text) {
  // normalise newlines, split into per-game chunks at each [Event at line start
  const chunks = text.replace(/\r\n?/g, "\n").split(/\n(?=\[Event )/);
  for (const chunk of chunks) {
    if (!/\[Event /.test(chunk)) continue;
    const rm = chunk.match(/\[Result\s+"([^"]*)"\]/);
    const result = rm ? rm[1] : "*";
    // movetext = lines after the header block (lines not starting with '[')
    const lines = chunk.split("\n");
    const moveLines = lines.filter((l) => !/^\s*\[/.test(l));
    const moves = sanTokens(moveLines.join(" "));
    yield { result, moves };
  }
}

/**
 * Replay a game's mainline up to maxPly, calling visit(epd, uci, san) for each ply
 * BEFORE the move is applied (epd = position the move is played from).
 * Returns false if the game was unusable (illegal move / unknown result).
 */
function walkGame(result, moves, maxPly, visit) {
  if (!RESULT_BUCKET[result]) return false; // skip '*' / unrated
  const c = new Chess();
  const n = Math.min(moves.length, maxPly);
  for (let i = 0; i < n; i++) {
    const epd = epdOf(c);
    let mv;
    try { mv = c.move(moves[i]); } catch { return i > 0; } // tolerate truncation
    if (!mv) return i > 0;
    const uci = mv.from + mv.to + (mv.promotion || "");
    visit(epd, uci, mv.san);
  }
  return true;
}

module.exports = { Chess, epdOf, sanTokens, iterGames, walkGame, RESULT_BUCKET };
