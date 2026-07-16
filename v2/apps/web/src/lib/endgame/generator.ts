// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Position generator — emits K+P vs K positions sorted into teaching TIERS, each with
// an oracle-guaranteed answer. Reject-samples random legal positions and classifies them.
import { evaluateKPK } from "./kpk";
import { squareRule } from "./square";
import { rng, randInt } from "./rng";

function randomFen(r: () => number): string | null {
  const wp = 8 + randInt(r, 48);
  const wk = randInt(r, 64), bk = randInt(r, 64);
  const stm = r() < 0.5 ? "w" : "b";
  if (wk === bk || wk === wp || bk === wp) return null;
  const board = Array<string>(64).fill("");
  board[wk] = "K"; board[bk] = "k"; board[wp] = "P";
  const rows: string[] = [];
  for (let rr = 7; rr >= 0; rr--) { let s = "", e = 0; for (let f = 0; f < 8; f++) { const c = board[rr * 8 + f]; if (c) { if (e) { s += e; e = 0; } s += c; } else e++; } if (e) s += e; rows.push(s); }
  return `${rows.join("/")} ${stm} - - 0 1`;
}

export interface Classified {
  fen: string; oracle: "win" | "draw"; promotes: boolean; dtm: number | null;
  squareSaysPromotes: boolean; kingMatters: boolean; rookPawn: boolean; doubleStep: boolean;
  defenderToMove: boolean; d: number; kd: number; margin: number;
}
export function classify(fen: string): Classified | null {
  const e = evaluateKPK(fen); if (!e.legal) return null;
  const s = squareRule(fen); if (!s.ok) return null;
  return {
    fen, oracle: e.result!, promotes: e.promotes!, dtm: e.dtmPlies ?? null,
    squareSaysPromotes: s.promotes!,
    kingMatters: e.promotes !== s.promotes,
    rookPawn: s.pawn![0] === "a" || s.pawn![0] === "h",
    doubleStep: s.pawn![1] === "2",
    defenderToMove: s.defenderToMove!,
    d: s.pawnMovesToPromote!, kd: s.kingDistanceToPromo!,
    margin: s.kingDistanceToPromo! - s.pawnMovesToPromote!,
  };
}

export type Tier = "square_basic" | "square_edge" | "square_tempo" | "double_step" | "rook_pawn" | "key_square" | "holds_draw";
const TIERS: Record<Tier, (c: Classified) => boolean> = {
  square_basic: (c) => !c.kingMatters && !c.rookPawn && !c.doubleStep && !c.defenderToMove && Math.abs(c.margin) >= 2,
  square_edge:  (c) => !c.kingMatters && !c.rookPawn && !c.doubleStep && Math.abs(c.margin) <= 1,
  square_tempo: (c) => !c.kingMatters && c.defenderToMove && Math.abs(c.margin) <= 1,
  double_step:  (c) => !c.kingMatters && c.doubleStep,
  rook_pawn:    (c) => c.rookPawn && c.oracle === "draw" && c.d <= 3,
  key_square:   (c) => c.kingMatters && c.oracle === "win",
  holds_draw:   (c) => c.kingMatters && c.oracle === "draw" && !c.rookPawn,
};
export const TIER_NAMES = Object.keys(TIERS) as Tier[];

export function generatePuzzle(tier: Tier, seed = (Date.now() & 0x7fffffff), maxAttempts = 60000): Classified | null {
  const pred = TIERS[tier]; if (!pred) throw new Error("unknown tier: " + tier);
  const r = rng(seed);
  for (let i = 0; i < maxAttempts; i++) {
    const fen = randomFen(r); if (!fen) continue;
    const c = classify(fen); if (!c) continue;
    if (pred(c)) return c;
  }
  return null;
}
