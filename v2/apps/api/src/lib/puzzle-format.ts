import { Chess } from "chess.js";

/** DB puzzle → API wire shape (matches the original Express fmtPuzzle). */
export function fmtPuzzle(p: any) {
  const { _id, line, glicko, ...rest } = p;
  const solution: string[] = Array.isArray(p.solution)
    ? p.solution
    : (line ? String(line).trim().split(" ").filter(Boolean) : []);
  return {
    ...rest,
    id: _id,
    rating: Math.round(glicko?.r ?? p.rating ?? 1500),
    ratingDeviation: Math.round(glicko?.d ?? 500),
    solution,
    glicko,
  };
}

/** Lichess convention: first solution move is the opponent's setup move → expose as lastMove. */
export function applyLastMove(p: any) {
  try {
    const sol: string[] = p.solution ?? [];
    if (!sol.length) return p;
    const c = new Chess(p.fen);
    const m = sol[0];
    if (!m) return p;
    c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: (m[4] as any) || "q" });
    return { ...p, preFen: p.fen, lastMove: m, fen: c.fen(), solution: sol.slice(1) };
  } catch {
    return p;
  }
}
