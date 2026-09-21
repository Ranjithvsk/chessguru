// Fingerprint of a game's MOVES, used to find a pasted PGN in the
// broadcastgames library (1.09M games) with one indexed lookup instead of a
// collection scan. Must stay byte-identical to the backfill that stamped the
// `mh` field, or nothing will ever match.
//
// 64-bit FNV-1a, as two 32-bit halves walking the string from opposite ends.
// A 32-bit hash collides constantly at a million games (birthday bound ~65k);
// 64 bits makes that vanishingly unlikely. Callers MUST still compare the full
// move list before treating a hit as the same game — the hash narrows, it does
// not prove.
export function movesHash(moves: string[]): string {
  const s = (moves || []).join(" ");
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    // NOT Math.imul, deliberately. The backfill that stamped `mh` across the
    // 1.09M existing games used a plain float multiply, whose result above
    // 2^53 loses low bits — so it is a weaker mixer than textbook FNV, but a
    // perfectly deterministic one (IEEE754 multiply and >>> are both exactly
    // specified, so node and mongosh agree to the bit). Switching to
    // Math.imul here would silently change every hash and nothing would ever
    // match again. Verified: the two forms DO differ, e.g. "d4 Nf6 c4 e6"
    // gives 67ad4248... this way and 2c1a2819... with imul.
    a ^= s.charCodeAt(i); a = (a * 0x01000193) >>> 0;
    b ^= s.charCodeAt(s.length - 1 - i); b = (b * 0x01000193) >>> 0;
  }
  return ("00000000" + a.toString(16)).slice(-8) + ("00000000" + b.toString(16)).slice(-8);
}

export function sameMoves(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
