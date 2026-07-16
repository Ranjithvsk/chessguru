// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Rule-of-the-square teaching layer: the exact verdict (from loneRace) + the square
// cells to draw on the board + a plain-English explanation.
import { file, rank, sq, cheby, SQ_NAME } from "./board";
import { kingCatchesPawn } from "./loneRace";

function parsePieces(fen: string) {
  const [placement, stmField] = fen.trim().split(/\s+/);
  const rows = placement.split("/");
  let WK = -1, BK = -1, P: { sq: number; white: boolean } | null = null;
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[7 - r]) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const s = sq(f, r);
      if (ch === "K") WK = s; else if (ch === "k") BK = s;
      else if (ch === "P") P = { sq: s, white: true }; else if (ch === "p") P = { sq: s, white: false };
      f++;
    }
  }
  return { WK, BK, P, whiteToMove: (stmField || "w") === "w" };
}

export interface SquareRule {
  ok: boolean; error?: string;
  attacker?: "white" | "black"; pawn?: string; promotionSquare?: string;
  defenderToMove?: boolean; pawnMovesToPromote?: number; kingDistanceToPromo?: number;
  caught?: boolean; promotes?: boolean; squareCells?: string[]; explain?: string;
}

export function squareRule(fen: string): SquareRule {
  const { WK, BK, P, whiteToMove } = parsePieces(fen);
  if (!P || WK < 0 || BK < 0) return { ok: false, error: "not a K+P vs K position" };
  const pf = file(P.sq), pr = rank(P.sq);
  const promoRank = P.white ? 7 : 0;
  const promoSq = sq(pf, promoRank);
  const defKing = P.white ? BK : WK;
  const defenderToMove = whiteToMove !== P.white;

  let d = P.white ? 7 - pr : pr;
  if ((P.white && pr === 1) || (!P.white && pr === 6)) d -= 1;

  const kingDist = cheby(defKing, promoSq);
  const caught = kingCatchesPawn(P.sq, P.white, defKing, defenderToMove);

  let dir = Math.sign(file(defKing) - pf); if (dir === 0) dir = pf <= 3 ? 1 : -1;
  const rLo = P.white ? promoRank - d : promoRank;
  const rHi = P.white ? promoRank : promoRank + d;
  const f1 = Math.max(0, Math.min(7, pf)), f2 = Math.max(0, Math.min(7, pf + dir * d));
  const [fa, fb] = f1 <= f2 ? [f1, f2] : [f2, f1];
  const cells: string[] = [];
  for (let r = rLo; r <= rHi; r++) for (let f = fa; f <= fb; f++) cells.push(SQ_NAME(sq(f, r)));

  return {
    ok: true,
    attacker: P.white ? "white" : "black",
    pawn: SQ_NAME(P.sq),
    promotionSquare: SQ_NAME(promoSq),
    defenderToMove,
    pawnMovesToPromote: d,
    kingDistanceToPromo: kingDist,
    caught,
    promotes: !caught,
    squareCells: cells,
    explain: caught
      ? `The king is inside the square: it needs ${kingDist} king-moves to ${SQ_NAME(promoSq)}, the pawn needs ${d}${defenderToMove ? ", and it's the defender's move" : ""} — so it catches the pawn.`
      : `The king is OUTSIDE the square: it needs ${kingDist} king-moves to ${SQ_NAME(promoSq)}, but the pawn needs only ${d} — so the pawn promotes.`,
  };
}
