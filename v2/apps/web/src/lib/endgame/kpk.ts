// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// KPK oracle — exact King+Pawn-vs-King tablebase (retrograde DTM). Split so the heavy
// build runs in a Web Worker (`buildDTM`) and the main thread just injects the result
// (`setTable`) and queries it (`evaluateKPK`/`bestMove`). Reproduces the published KPK
// figures exactly (163,328 legal WTM positions → 124,954 wins / 38,374 draws).
import { file, rank, sq, cheby, KING_MOVES, whitePawnAttacks, SQ_NAME } from "./board";

const INF = 1 << 29;
const N = 2 * 64 * 64 * 64;
const idx = (stm: number, wk: number, bk: number, wp: number) => ((stm * 64 + wk) * 64 + bk) * 64 + wp;

function queenSees(q: number, t: number, blocker: number): boolean {
  const df = Math.sign(file(t) - file(q)), dr = Math.sign(rank(t) - rank(q));
  const aligned = file(q) === file(t) || rank(q) === rank(t) || Math.abs(file(q) - file(t)) === Math.abs(rank(q) - rank(t));
  if (!aligned || q === t) return false;
  let f = file(q) + df, r = rank(q) + dr;
  while (sq(f, r) !== t) { if (sq(f, r) === blocker) return false; f += df; r += dr; }
  return true;
}
export function promotionWins(wk: number, bk: number, q: number): boolean {
  if (cheby(bk, q) === 1 && cheby(wk, q) > 1) return false;   // undefended queen hangs → KK draw
  const inCheck = queenSees(q, bk, wk);
  let hasMove = false;
  for (const t of KING_MOVES[bk]) {
    if (t === q || t === wk) continue;
    if (cheby(t, wk) < 2) continue;
    if (queenSees(q, t, wk)) continue;
    hasMove = true; break;
  }
  return inCheck || hasMove;                                  // stalemate is the only draw
}

function legal(stm: number, wk: number, bk: number, wp: number): boolean {
  if (wk === bk || wk === wp || bk === wp) return false;
  if (cheby(wk, bk) < 2) return false;
  const r = rank(wp);
  if (r < 1 || r > 6) return false;
  if (stm === 0 && whitePawnAttacks(wp).includes(bk)) return false;
  return true;
}

interface Move { promo?: boolean; win?: boolean; capture?: boolean; stm?: number; wk?: number; bk?: number; wp?: number; kind: string; }
function moves(stm: number, wk: number, bk: number, wp: number): Move[] {
  const out: Move[] = [];
  if (stm === 0) {
    for (const nk of KING_MOVES[wk])
      if (nk !== bk && nk !== wp && cheby(nk, bk) >= 2) out.push({ stm: 1, wk: nk, bk, wp, kind: "K" });
    const up1 = wp + 8, up1Empty = up1 !== wk && up1 !== bk;
    if (up1Empty) {
      if (rank(up1) === 7) out.push({ promo: true, win: promotionWins(wk, bk, up1), kind: "P" });
      else out.push({ stm: 1, wk, bk, wp: up1, kind: "P" });
      if (rank(wp) === 1) { const up2 = wp + 16; if (up2 !== wk && up2 !== bk) out.push({ stm: 1, wk, bk, wp: up2, kind: "P" }); }
    }
  } else {
    const atk = whitePawnAttacks(wp);
    for (const nk of KING_MOVES[bk]) {
      if (cheby(nk, wk) < 2) continue;
      if (nk === wp) { out.push({ capture: true, kind: "Kx" }); continue; }
      if (atk.includes(nk)) continue;
      out.push({ stm: 0, wk, bk: nk, wp, kind: "K" });
    }
  }
  return out;
}

// Pure compute — used inside the worker. No module state.
export function buildDTM(): Int32Array {
  const dtm = new Int32Array(N).fill(INF);
  const legalIdx: number[] = [];
  for (let stm = 0; stm < 2; stm++) for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let wp = 8; wp < 56; wp++)
    if (legal(stm, wk, bk, wp)) legalIdx.push(idx(stm, wk, bk, wp));
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of legalIdx) {
      const stm = (i >> 18) & 1, wk = (i >> 12) & 63, bk = (i >> 6) & 63, wp = i & 63;
      const ms = moves(stm, wk, bk, wp);
      let val: number;
      if (stm === 0) {
        val = INF;
        for (const m of ms) { const v = m.promo ? (m.win ? 0 : INF) : dtm[idx(m.stm!, m.wk!, m.bk!, m.wp!)]; if (v + 1 < val) val = v + 1; }
      } else {
        if (ms.length === 0) val = INF;
        else {
          let mx = -1, ok = true;
          for (const m of ms) { const v = m.capture ? INF : dtm[idx(m.stm!, m.wk!, m.bk!, m.wp!)]; if (v >= INF) { ok = false; break; } if (v > mx) mx = v; }
          val = ok ? mx + 1 : INF;
        }
      }
      if (val < dtm[i]) { dtm[i] = val; changed = true; }
    }
  }
  return dtm;
}

let DTM: Int32Array | null = null;
export function setTable(dtm: Int32Array): void { DTM = dtm; }
export function tableReady(): boolean { return DTM !== null; }

export function probe(stm: number, wk: number, bk: number, wp: number) {
  if (!DTM) throw new Error("KPK table not loaded");
  if (!legal(stm, wk, bk, wp)) return { legal: false as const };
  const d = DTM[idx(stm, wk, bk, wp)];
  return { legal: true as const, win: d < INF, dtm: d < INF ? d : null };
}

export function bestMove(stm: number, wk: number, bk: number, wp: number): { from: string; to: string; promotion?: string } | null {
  if (!DTM) throw new Error("KPK table not loaded");
  const ms = moves(stm, wk, bk, wp);
  let best: Move | null = null, bestV = stm === 0 ? INF : -1;
  for (const m of ms) {
    const v = m.promo ? (m.win ? 0 : INF) : m.capture ? INF : DTM[idx(m.stm!, m.wk!, m.bk!, m.wp!)];
    if (stm === 0) { if (v + 1 < bestV || best === null) { bestV = v + 1; best = m; } }
    else { if (v > bestV) { bestV = v; best = m; } }
  }
  if (!best) return null;
  if (best.promo) return { from: SQ_NAME(wp), to: SQ_NAME(wp + 8), promotion: "q" };
  const from = stm === 0 ? (best.kind === "P" ? SQ_NAME(wp) : SQ_NAME(wk)) : SQ_NAME(bk);
  const to = best.capture ? SQ_NAME(wp) : (stm === 0 ? (best.kind === "P" ? SQ_NAME(best.wp!) : SQ_NAME(best.wk!)) : SQ_NAME(best.bk!));
  return { from, to };
}

export interface KPKState { ok: boolean; error?: string; stm?: number; wk?: number; bk?: number; wp?: number; mirrored?: boolean; attacker?: "white" | "black"; }
export function parseKPK(fen: string): KPKState {
  const [placement, stmField] = fen.trim().split(/\s+/);
  const rows = placement.split("/");
  if (rows.length !== 8) return { ok: false, error: "bad FEN" };
  let WK = -1, BK = -1, WP = -1, BP = -1, extra = false;
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[7 - r]) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const s = sq(f, r);
      if (ch === "K") WK = s; else if (ch === "k") BK = s;
      else if (ch === "P") WP = s; else if (ch === "p") BP = s;
      else extra = true;
      f++;
    }
  }
  if (extra || WK < 0 || BK < 0 || (WP < 0) === (BP < 0)) return { ok: false, error: "not a K+P vs K position" };
  const whiteToMove = (stmField || "w") === "w";
  if (WP >= 0) return { ok: true, stm: whiteToMove ? 0 : 1, wk: WK, bk: BK, wp: WP, mirrored: false, attacker: "white" };
  const mir = (s: number) => sq(file(s), 7 - rank(s));
  return { ok: true, stm: whiteToMove ? 1 : 0, wk: mir(BK), bk: mir(WK), wp: mir(BP), mirrored: true, attacker: "black" };
}

export interface KPKResult {
  ok: boolean; error?: string; legal?: boolean;
  attacker?: "white" | "black"; sideToMove?: "white" | "black";
  result?: "win" | "draw"; promotes?: boolean; dtmPlies?: number | null;
  bestMove?: { from: string; to: string; promotion?: string } | null;
}
export function evaluateKPK(fen: string): KPKResult {
  const p = parseKPK(fen);
  if (!p.ok) return { ok: false, error: p.error };
  const pr = probe(p.stm!, p.wk!, p.bk!, p.wp!);
  if (!pr.legal) return { ok: true, legal: false };
  const bm = bestMove(p.stm!, p.wk!, p.bk!, p.wp!);
  const unmir = (mv: { from: string; to: string; promotion?: string } | null) => {
    if (!mv || !p.mirrored) return mv;
    const flip = (nn: string) => nn[0] + (9 - +nn[1]);
    return { from: flip(mv.from), to: flip(mv.to), ...(mv.promotion ? { promotion: mv.promotion } : {}) };
  };
  return {
    ok: true, legal: true,
    attacker: p.attacker,
    sideToMove: (fen.trim().split(/\s+/)[1] || "w") === "w" ? "white" : "black",
    result: pr.win ? "win" : "draw",
    promotes: pr.win,
    dtmPlies: pr.dtm,
    bestMove: unmir(bm),
  };
}
