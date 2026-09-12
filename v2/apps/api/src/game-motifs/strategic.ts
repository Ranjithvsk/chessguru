// Positional / strategic concepts (owner 2026-09-12: "for high-rated players: good positional moves,
// attack, defence, prophylaxis, endgame technique, knight outposts, good-for-bad exchanges, creating
// pawn weaknesses, weak squares, space, colour complexes, zugzwang…"). Pure board heuristics over
// chess.js; the engine decides whether the move was right (best move / loss), these functions say
// WHAT KIND of good move it was. Two of them need an extra "what if the mover passed" engine eval
// (null-move), supplied by the caller: prophylaxis / good defence and zugzwang.
import { Chess, type Square, type Color, type Piece } from "chess.js";

export type StrategicTag =
  | "prophylaxis" | "goodDefence" | "goodAttack" | "knightOutpost" | "weakSquare" | "pawnWeakness" | "spaceGain"
  | "goodForBad" | "kingActivity" | "passedPawn" | "rookSeventh" | "zugzwangCreated" | "endgameTechnique" | "positional";

export const STRATEGIC_POINTS: Record<StrategicTag, number> = {
  prophylaxis: 3, goodDefence: 3, goodAttack: 2, knightOutpost: 2, weakSquare: 2, pawnWeakness: 2, spaceGain: 1,
  goodForBad: 2, kingActivity: 2, passedPawn: 2, rookSeventh: 2, zugzwangCreated: 4, endgameTechnique: 2, positional: 1,
};
export const STRATEGIC_LABEL: Record<StrategicTag, string> = {
  prophylaxis: "Prophylaxis", goodDefence: "Good defence", goodAttack: "Attack build-up", knightOutpost: "Knight outpost", weakSquare: "Weak-square occupation",
  pawnWeakness: "Creating pawn weakness", spaceGain: "Space gain", goodForBad: "Good piece for bad", kingActivity: "King activity", passedPawn: "Passed pawn",
  rookSeventh: "Rook on the 7th", zugzwangCreated: "Zugzwang", endgameTechnique: "Endgame technique", positional: "Positional move",
};
// Most specific first — one primary per moment, same as the tactical order.
export const STRATEGIC_ORDER: StrategicTag[] = ["zugzwangCreated", "prophylaxis", "goodDefence", "goodForBad", "knightOutpost", "rookSeventh", "passedPawn", "pawnWeakness", "weakSquare", "goodAttack", "kingActivity", "endgameTechnique", "spaceGain", "positional"];

const FILES = "abcdefgh";
const sq = (f: number, r: number): Square | null => (f < 0 || f > 7 || r < 1 || r > 8 ? null : (`${FILES[f]}${r}` as Square));
const fileOf = (s: string) => FILES.indexOf(s[0]!);
const rankOf = (s: string) => Number(s[1]);
const relRank = (s: string, c: Color) => (c === "w" ? rankOf(s) : 9 - rankOf(s));
const PV: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function pieces(b: Chess, color: Color, type?: string): Array<{ square: Square; type: string }> {
  const out: Array<{ square: Square; type: string }> = [];
  for (const row of b.board()) for (const p of row) if (p && p.color === color && (!type || p.type === type)) out.push({ square: p.square, type: p.type });
  return out;
}
/** Squares attacked by `color`'s pawns. */
function pawnAttackSet(b: Chess, color: Color): Set<string> {
  const s = new Set<string>();
  for (const p of pieces(b, color, "p")) {
    const f = fileOf(p.square), r = rankOf(p.square) + (color === "w" ? 1 : -1);
    for (const df of [-1, 1]) { const t = sq(f + df, r); if (t) s.add(t); }
  }
  return s;
}
/** Can an enemy pawn EVER attack this square (a pawn on an adjacent file still in front of it)? */
function enemyPawnCanReach(b: Chess, square: string, color: Color): boolean {
  const enemy: Color = color === "w" ? "b" : "w";
  const f = fileOf(square), r = rankOf(square);
  for (const p of pieces(b, enemy, "p")) {
    const pf = fileOf(p.square), pr = rankOf(p.square);
    if (Math.abs(pf - f) !== 1) continue;
    if (color === "w" ? pr > r : pr < r) return true;
  }
  return false;
}
function nonPawnMaterial(b: Chess, color: Color): number { return pieces(b, color).reduce((s, p) => s + (p.type === "p" || p.type === "k" ? 0 : PV[p.type]!), 0); }
export function isEndgame(b: Chess): boolean { return nonPawnMaterial(b, "w") <= 13 && nonPawnMaterial(b, "b") <= 13 && !pieces(b, "w", "q").length && !pieces(b, "b", "q").length || nonPawnMaterial(b, "w") + nonPawnMaterial(b, "b") <= 14; }

type PawnStructure = { isolated: number; doubled: number; backward: number };
function pawnStructure(b: Chess, color: Color): PawnStructure {
  const ps = pieces(b, color, "p");
  const byFile = new Map<number, number[]>();
  for (const p of ps) { const f = fileOf(p.square); byFile.set(f, [...(byFile.get(f) ?? []), rankOf(p.square)]); }
  let isolated = 0, doubled = 0, backward = 0;
  const enemyPA = pawnAttackSet(b, color === "w" ? "b" : "w");
  for (const [f, ranks] of byFile) {
    if (!byFile.has(f - 1) && !byFile.has(f + 1)) isolated += ranks.length;
    if (ranks.length > 1) doubled += ranks.length - 1;
    for (const r of ranks) {
      // backward: no friendly pawn beside or behind on adjacent files, and the square in front is pawn-attacked
      const behind = [f - 1, f + 1].some((af) => (byFile.get(af) ?? []).some((ar) => (color === "w" ? ar <= r : ar >= r)));
      const front = sq(f, r + (color === "w" ? 1 : -1));
      if (!behind && front && enemyPA.has(front)) backward++;
    }
  }
  return { isolated, doubled, backward };
}
function weaknessScore(s: PawnStructure) { return s.isolated + s.doubled + s.backward; }
function isPassed(b: Chess, square: string, color: Color): boolean {
  const enemy: Color = color === "w" ? "b" : "w";
  const f = fileOf(square), r = rankOf(square);
  for (const p of pieces(b, enemy, "p")) {
    const pf = fileOf(p.square), pr = rankOf(p.square);
    if (Math.abs(pf - f) <= 1 && (color === "w" ? pr > r : pr < r)) return false;
  }
  return true;
}
function spaceCount(b: Chess, color: Color): number {
  // squares in the opponent's half that `color` attacks or occupies
  let n = 0;
  for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) {
    const s = sq(f, r)!; if (color === "w" ? r < 5 : r > 4) continue;
    const p = b.get(s);
    if ((p && p.color === color) || b.isAttacked(s, color)) n++;
  }
  return n;
}
function kingZone(b: Chess, color: Color): Square[] {
  const k = pieces(b, color, "k")[0]; if (!k) return [];
  const f = fileOf(k.square), r = rankOf(k.square); const out: Square[] = [];
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) { const s = sq(f + df, r + dr); if (s) out.push(s); }
  return out;
}
function kingZonePressure(b: Chess, attacker: Color): number {
  const zone = kingZone(b, attacker === "w" ? "b" : "w");
  let n = 0; for (const s of zone) n += b.attackers(s, attacker).length; return n;
}
function centerDist(square: string): number { const f = fileOf(square), r = rankOf(square); return Math.max(Math.abs(f - 3.5), Math.abs(r - 4.5)); }
/** A bishop is "bad" when most of its own pawns sit on its colour. */
function badBishop(b: Chess, square: string, color: Color): boolean {
  const light = b.squareColor(square as Square) === "light";
  const own = pieces(b, color, "p");
  if (own.length < 4) return false;
  const same = own.filter((p) => (b.squareColor(p.square) === "light") === light).length;
  return same >= Math.ceil(own.length * 0.6);
}

export type StrategicInput = {
  fenBefore: string; uci: string; color: Color;
  // engine, mover POV (cp): the position before, the position after this move, and — if the caller
  // ran them — what the opponent could do if the mover PASSED (null move) before and after.
  beforeMover: number; afterMover: number; threatBefore?: number | null; threatAfter?: number | null;
  // after the move, from the OPPONENT's point of view: their best continuation vs passing (zugzwang)
  oppBestAfter?: number | null; oppPassAfter?: number | null;
};

/** Which strategic ideas this move carries. Empty when it is just a move. */
export function strategicTags(inp: StrategicInput): StrategicTag[] {
  const tags = new Set<StrategicTag>();
  let before: Chess, after: Chess;
  try { before = new Chess(inp.fenBefore); after = new Chess(inp.fenBefore); } catch { return []; }
  const mv = after.move({ from: inp.uci.slice(0, 2), to: inp.uci.slice(2, 4), promotion: inp.uci.slice(4) || undefined } as never);
  if (!mv) return [];
  const me = inp.color, opp: Color = me === "w" ? "b" : "w";
  const to = mv.to as string, piece = mv.piece as string;
  const quiet = !mv.captured && !after.isCheck();
  const endgame = isEndgame(before);

  // Prophylaxis / defence: the opponent had a real idea if we passed; after our quiet move it is gone.
  if (inp.threatBefore != null && inp.threatAfter != null) {
    const swingBefore = inp.beforeMover - inp.threatBefore;   // how much passing would have cost
    const swingAfter = inp.afterMover - inp.threatAfter;
    // (first pass tagged 1.e4 as prophylaxis: passing the first move "costs" the move advantage.
    //  A threat must be worth a real pawn and the position must not already be decided.)
    const balanced = Math.abs(inp.beforeMover) <= 300;
    if (swingBefore >= 150 && swingAfter <= 40 && balanced) tags.add("goodDefence");
    else if (swingBefore >= 90 && swingAfter <= 25 && quiet && piece !== "p" && balanced && Math.abs(inp.afterMover - inp.beforeMover) <= 40) tags.add("prophylaxis");
  }
  // Zugzwang created: after our move the opponent would rather pass than play their best move.
  if (inp.oppBestAfter != null && inp.oppPassAfter != null && inp.oppPassAfter - inp.oppBestAfter >= 100 && endgame) tags.add("zugzwangCreated");

  // Knight outpost: knight lands in the enemy half, pawn-protected, unreachable by enemy pawns.
  if (piece === "n" && relRank(to, me) >= 4 && pawnAttackSet(after, me).has(to) && !enemyPawnCanReach(after, to, me)) tags.add("knightOutpost");
  // Weak-square occupation: any piece settles on a hole in the enemy camp (rank 5-6) that no enemy pawn can ever challenge, and it is defended.
  else if (piece !== "p" && piece !== "k" && relRank(to, me) >= 5 && !enemyPawnCanReach(after, to, me) && after.attackers(to as Square, me).length > 0) tags.add("weakSquare");

  // Creating a pawn weakness for the opponent (their structure got worse by this move — a capture, a push forcing a recapture, etc.)
  const wBefore = weaknessScore(pawnStructure(before, opp)), wAfter = weaknessScore(pawnStructure(after, opp));
  if (wAfter > wBefore) tags.add("pawnWeakness");

  // Good piece for bad: we gave a bad bishop for a knight or a good bishop (equal nominal value).
  if (mv.captured && PV[mv.captured] === PV[piece] && piece === "b" && badBishop(before, mv.from as string, me) && (mv.captured === "n" || (mv.captured === "b" && !badBishop(before, to, opp)))) tags.add("goodForBad");

  // Passed pawn: created or advanced to the 5th rank or beyond.
  if (piece === "p" && isPassed(after, to, me) && relRank(to, me) >= 5) tags.add("passedPawn");
  // Rook to the 7th with something to eat or a boxed-in king.
  if (piece === "r" && relRank(to, me) === 7) {
    const ek = pieces(after, opp, "k")[0];
    const pawnsOn7 = pieces(after, opp, "p").some((p) => relRank(p.square, me) === 7);
    if (pawnsOn7 || (ek && relRank(ek.square, me) === 8)) tags.add("rookSeventh");
  }
  // Endgame: the king walks toward the centre / the action; or the pawn majority moves.
  if (endgame && piece === "k" && quiet && centerDist(to) < centerDist(mv.from as string)) tags.add("kingActivity");
  if (endgame && (piece === "k" || piece === "p") && !tags.has("kingActivity") && !tags.has("passedPawn") && inp.afterMover >= inp.beforeMover - 15) tags.add("endgameTechnique");

  // Attack build-up: more of our pieces bear on the enemy king's zone after a quiet move.
  if (!endgame && quiet && kingZonePressure(after, me) - kingZonePressure(before, me) >= 2) tags.add("goodAttack");
  // Space: our footprint in their half grows by a clear margin with a pawn move.
  if (!endgame && piece === "p" && quiet && spaceCount(after, me) - spaceCount(before, me) >= 3) tags.add("spaceGain");

  return STRATEGIC_ORDER.filter((t) => tags.has(t));
}

/** A FEN with the side to move flipped (the "pass" position). null when the flipped side would be in check (illegal). */
export function nullMoveFen(fen: string): string | null {
  const parts = fen.split(" ");
  if (parts.length < 4) return null;
  parts[1] = parts[1] === "w" ? "b" : "w"; parts[3] = "-";
  try { const c = new Chess(parts.join(" ")); if (c.isCheck()) return null; return c.fen(); } catch { return null; }
}

/** Per-game character from the moments: what kind of game the student played. */
export function gameCharacter(stats: { sacrifices: number; captures: number; plies: number; attackMoments: number; quietBest: number }): string[] {
  const out: string[] = [];
  if (stats.plies >= 20) {
    if (stats.attackMoments >= 3 || stats.sacrifices >= 1) out.push("aggressive");
    if (stats.captures / Math.max(1, stats.plies) >= 0.35) out.push("dynamic");
    if (stats.quietBest >= 4 && stats.sacrifices === 0) out.push("positional");
  }
  return out;
}
