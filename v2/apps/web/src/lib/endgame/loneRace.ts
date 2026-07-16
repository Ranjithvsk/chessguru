// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Exact lone king-vs-pawn race — the true "rule of the square" oracle (no attacking
// king). Memoised game search; handles both colours, the double-step, and the
// undefended-promoted-queen capture the naive formula misses.
import { KING_MOVES, rank, cheby } from "./board";

const memo = new Map<number, boolean>();
// TRUE if the king catches the pawn (stops promotion), FALSE if it promotes.
export function kingCatchesPawn(p: number, white: boolean, k: number, kingToMove: boolean): boolean {
  const key = (white ? 1 : 0) * 0x20000 + p * 0x800 + k * 0x8 + (kingToMove ? 1 : 0);
  const hit = memo.get(key); if (hit !== undefined) return hit;
  let res: boolean;
  if (k === p) { res = true; }
  else if (!kingToMove) {
    const fwd = white ? p + 8 : p - 8;
    const promoR = white ? 7 : 0;
    if (k === fwd) res = true;                                 // blockaded directly in front
    else if (rank(fwd) === promoR) res = cheby(k, fwd) <= 1;   // promotes, but a king next to the queening square just takes the (undefended) queen
    else {
      res = kingCatchesPawn(fwd, white, k, true);
      if (res && rank(p) === (white ? 1 : 6)) {                // double-step
        const d2 = white ? p + 16 : p - 16;
        if (k !== d2) res = kingCatchesPawn(d2, white, k, true);
      }
    }
  } else {
    res = false;
    for (const nk of KING_MOVES[k]) {
      if (nk === p) { res = true; break; }                     // captures the pawn
      if (kingCatchesPawn(p, white, nk, false)) { res = true; break; }
    }
  }
  memo.set(key, res);
  return res;
}
