// Static FEN → SVG mini board — for gallery views (mistakes panel, reteach
// grid) where we render dozens of boards at once and can't afford
// Chessground's ~50ms-per-mount cost. Renders a single inline <svg>: 64
// coloured squares + one Unicode piece glyph per occupied square + optional
// highlight fill on the "last move" squares.
//
// Trade-off vs <Board className="mini">: no cburnett SVG pieces (Unicode
// only), no animations, no coordinates, no interactivity. That's exactly
// what we want for a read-only tile — first paint is a single React render
// instead of Chessground init + layout.
//
// Owner ask 2026-08-18: "still loading so much time even with 2 puzzles" —
// the bottleneck was Chessground mount cost, not the API. This component
// cuts ~50ms/board to ~1ms/board.

import { CBURNETT_PIECES } from "./cburnett-pieces";

const LIGHT = "#ffffff";
const DARK = "#668cb2";
const HIGHLIGHT = "rgba(255, 235, 59, 0.55)";

/** FEN piece-placement (rank 8→1) → per-square array indexed 0..63,
 *  starting a8 = 0 (from white's perspective, a-file on the left). */
function parseFen(fen: string): (string | null)[] {
  const board = new Array<string | null>(64).fill(null);
  const placement = fen.split(" ")[0] || "";
  let i = 0;
  for (const c of placement) {
    if (c === "/") continue;
    if (c >= "1" && c <= "8") { i += Number(c); continue; }
    if (i < 64) board[i++] = c;
  }
  return board;
}

/** Chess square name (e.g. "e4") → 0..63 index from white's perspective. */
function squareIndex(sq: string): number | null {
  if (!sq || sq.length < 2) return null;
  const file = sq.charCodeAt(0) - 97;   // a=0
  const rank = Number(sq[1]) - 1;       // rank 1 = 0
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (7 - rank) * 8 + file;
}

export function MiniFenBoard({
  fen,
  orientation = "white",
  highlight,
}: {
  fen: string;
  orientation?: "white" | "black";
  /** Two square names ("e2", "e4") — rendered as yellow-tinted squares. */
  highlight?: [string, string];
}) {
  const cells = parseFen(fen);
  const flip = orientation === "black";
  const highlightIdxs = new Set<number>();
  if (highlight) {
    for (const sq of highlight) {
      const i = squareIndex(sq);
      if (i != null) highlightIdxs.add(i);
    }
  }
  return (
    <svg viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg"
      className="aspect-square w-full block" preserveAspectRatio="xMidYMid meet">
      {cells.map((piece, idx) => {
        // idx is a8=0..h1=63 (white view). Flip means we transpose the
        // grid so black's back rank sits at the top of the render.
        const rendered = flip ? 63 - idx : idx;
        const row = Math.floor(rendered / 8);
        const col = rendered % 8;
        const isLight = (row + col) % 2 === 0;
        const isHighlight = highlightIdxs.has(idx);
        // cburnett SVG data URI — same piece design as the full <Board> so
        // the mini tiles are visually identical to what the coach sees on
        // /history or the puzzle trainer.
        const pieceHref = piece ? CBURNETT_PIECES[piece] : null;
        return (
          <g key={idx}>
            <rect x={col} y={row} width={1} height={1} fill={isLight ? LIGHT : DARK} />
            {isHighlight && <rect x={col} y={row} width={1} height={1} fill={HIGHLIGHT} />}
            {pieceHref && (
              <image href={pieceHref} x={col} y={row} width={1} height={1} preserveAspectRatio="xMidYMid meet" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
