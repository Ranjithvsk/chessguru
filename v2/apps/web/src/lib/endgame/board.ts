// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Tiny 0..63 board helpers for the KPK oracle. a1=0, h1=7, a8=56, h8=63.
export const file = (sq: number) => sq & 7;
export const rank = (sq: number) => sq >> 3;
export const sq = (f: number, r: number) => r * 8 + f;
export const onBoard = (f: number, r: number) => f >= 0 && f <= 7 && r >= 0 && r <= 7;
export const cheby = (a: number, b: number) => Math.max(Math.abs(file(a) - file(b)), Math.abs(rank(a) - rank(b)));
export const SQ_NAME = (s: number) => "abcdefgh"[file(s)] + (rank(s) + 1);

export const KING_MOVES: number[][] = (() => {
  const t: number[][] = [];
  for (let s = 0; s < 64; s++) {
    const f = file(s), r = rank(s), m: number[] = [];
    for (const [df, dr] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]])
      if (onBoard(f + df, r + dr)) m.push(sq(f + df, r + dr));
    t.push(m);
  }
  return t;
})();

export const whitePawnAttacks = (p: number): number[] => {
  const f = file(p), r = rank(p), a: number[] = [];
  if (onBoard(f - 1, r + 1)) a.push(sq(f - 1, r + 1));
  if (onBoard(f + 1, r + 1)) a.push(sq(f + 1, r + 1));
  return a;
};
