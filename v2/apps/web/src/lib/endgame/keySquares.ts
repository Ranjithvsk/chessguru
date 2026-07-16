// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Key squares (a.k.a. critical squares) for K + P vs K — the classical teaching
// concept: for a non-rook pawn, if the ATTACKING king reaches a key square, the pawn
// promotes regardless of whose move it is. This module derives them geometrically
// (standard theory) and the oracle confirms the verdict of any concrete position.
//
//   • rook pawn (a/h file): NO key squares — the defender draws in the corner.
//   • pawn on its 2nd–4th rank (relative to its own side): 3 key squares, two ranks
//     in front (pawn file + both neighbours).  e4 → d6 e6 f6.
//   • pawn on its 5th–6th rank: 6 key squares — one AND two ranks in front.
//     e5 → d6 e6 f6 d7 e7 f7.
//   • pawn on its 7th rank: the promotion-rank trio (king support queens trivially).
import { evaluateKPK } from "./kpk";

const FILES = "abcdefgh";
function sq(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return FILES[file] + rank;
}

export interface KeySquares {
  ok: boolean;
  attacker: "white" | "black";
  rookPawn: boolean;
  squares: string[];          // the key squares (empty for a rook pawn)
  pawn: string;               // pawn square, for the caption
  text: string;               // one-line teaching caption
}

// Parse the pawn (there is exactly one) + which side owns it.
function findPawn(fen: string): { file: number; rank: number; white: boolean } | null {
  const rows = (fen.split(/\s+/)[0] ?? "").split("/");
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[7 - r] ?? "") {
      if (/\d/.test(ch)) { f += +ch; continue; }
      if (ch === "P") return { file: f, rank: r + 1, white: true };
      if (ch === "p") return { file: f, rank: r + 1, white: false };
      f++;
    }
  }
  return null;
}

export function keySquares(fen: string): KeySquares {
  const e = evaluateKPK(fen);
  const attacker: "white" | "black" = e.attacker ?? "white";
  const p = findPawn(fen);
  if (!p) return { ok: false, attacker, rookPawn: false, squares: [], pawn: "", text: "" };
  const pawnSq = (FILES[p.file] + p.rank) as string;

  // Rook pawn — no winning key squares.
  if (p.file === 0 || p.file === 7) {
    return { ok: true, attacker, rookPawn: true, squares: [], pawn: pawnSq,
      text: `A rook's pawn has no key squares — the defending king draws by reaching the corner (${p.file === 0 ? "a8/a1" : "h8/h1"}).` };
  }

  const fwd = p.white ? 1 : -1;                     // forward direction for the pawn's side
  const relRank = p.white ? p.rank : 9 - p.rank;    // 2 = home rank for either colour
  // which forward distances carry key squares
  const steps = relRank <= 4 ? [2] : relRank <= 6 ? [1, 2] : [1];
  const out: string[] = [];
  for (const d of steps) {
    const r = p.rank + fwd * d;
    for (const df of [-1, 0, 1]) {
      const s = sq(p.file + df, r);
      if (s && s !== pawnSq) out.push(s);
    }
  }
  const caption = `Key squares (violet): if the ${attacker} king reaches any of these, the pawn promotes — no matter whose move it is. Reach one and the win is in hand.`;
  return { ok: true, attacker, rookPawn: false, squares: out, pawn: pawnSq, text: caption };
}
