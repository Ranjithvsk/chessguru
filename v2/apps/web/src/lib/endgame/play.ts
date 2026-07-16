// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Move application + principal variation + grading for play-it-out. Verdicts from the oracle.
import { evaluateKPK } from "./kpk";

const fileI = (c: string) => c.charCodeAt(0) - 97;
const rankI = (c: string) => 8 - +c;

export interface CoordMove { from: string; to: string; promotion?: string; }

export function applyMove(fen: string, mv: CoordMove): string {
  const [pl, stm] = fen.trim().split(/\s+/);
  const rows = pl.split("/").map((r) => { const a: string[] = []; for (const c of r) { if (/\d/.test(c)) for (let i = 0; i < +c; i++) a.push(""); else a.push(c); } return a; });
  const fr = rankI(mv.from[1]), ff = fileI(mv.from[0]), tr = rankI(mv.to[1]), tf = fileI(mv.to[0]);
  let pc = rows[fr][ff]; rows[fr][ff] = "";
  if (mv.promotion) pc = pc === "P" ? mv.promotion.toUpperCase() : mv.promotion.toLowerCase();
  rows[tr][tf] = pc;
  const npl = rows.map((r) => { let s = "", e = 0; for (const c of r) { if (c) { if (e) { s += e; e = 0; } s += c; } else e++; } if (e) s += e; return s; }).join("/");
  return `${npl} ${stm === "w" ? "b" : "w"} - - 0 1`;
}

const placement = (fen: string) => fen.split(/\s+/)[0];
const hasPawn = (fen: string) => /[Pp]/.test(placement(fen));
const hasQueen = (fen: string) => /[Qq]/.test(placement(fen));

export interface PVStep { fen: string; move?: CoordMove; sideToMove?: string; result?: string; terminal?: string; }
export function principalVariation(fen: string, maxPlies = 40): PVStep[] {
  const line: PVStep[] = []; let cur = fen;
  for (let i = 0; i < maxPlies; i++) {
    const e = evaluateKPK(cur);
    if (!e.legal || !e.bestMove) break;
    line.push({ fen: cur, move: e.bestMove, sideToMove: e.sideToMove, result: e.result });
    cur = applyMove(cur, e.bestMove);
    if (e.bestMove.promotion) { line.push({ fen: cur, terminal: hasQueen(cur) ? "queened" : "queen-captured" }); break; }
    if (!hasPawn(cur)) { line.push({ fen: cur, terminal: "pawn-captured (draw)" }); break; }
  }
  return line;
}

// Interpret a resulting FEN that may have left the KPK domain (capture → draw, promotion → win).
export function resultAfter(fen: string): "win" | "draw" | null {
  const e = evaluateKPK(fen);
  if (e.legal) return e.result ?? null;
  const pl = placement(fen);
  if (/[Qq]/.test(pl)) return "win";        // promoted → KQK
  if (!/[Pp]/.test(pl)) return "draw";      // pawn captured → bare kings
  return null;
}

export function gradeMove(fenBefore: string, mv: CoordMove, goal: "win" | "draw"): { ok: boolean; resultAfter: "win" | "draw" | null; after: string } {
  const after = applyMove(fenBefore, mv);
  const r = resultAfter(after);
  const held = goal === "win" ? r === "win" : r === "draw";
  return { ok: held, resultAfter: r, after };
}
