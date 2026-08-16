// Rule-based mistake classifier — inspects the position and the "played vs
// best" moves to give the mistake a human-readable label. Cheap and local
// (no LLM). Coverage isn't complete, but every classified mistake feeds
// Slice 4's weakness map, and unclassified mistakes still show up as
// generic "eval swing" — the student still sees them, just without a tag.
//
// Detection order matters — first match wins. Missed-mate is checked before
// hung-piece etc. because the surface concept is more important than the
// board-value delta.

import { Chess } from "chess.js";

export type MistakeTag =
  | "missed_mate"
  | "hung_piece"
  | "missed_capture"
  | "missed_knight_fork"
  | "missed_check"
  | "missed_promotion"
  | "opening_deviation"
  | "positional";

const PIECE_VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export interface ClassifyInput {
  fenBefore: string;
  playedUci: string;
  bestUci: string;
  fenAfterPlayed: string;
  fenAfterBest: string;
  mateInBest?: number | undefined;   // positive = mating in N
  ply: number;
}

export interface ClassifyResult {
  tag: MistakeTag;
  explanation: string;
}

export function classify(input: ClassifyInput): ClassifyResult {
  const { fenBefore, playedUci, bestUci, fenAfterPlayed, mateInBest, ply } = input;

  // 1. Missed mate — the engine has a forced mate the student didn't play.
  if (mateInBest !== undefined && mateInBest > 0 && mateInBest <= 8) {
    return { tag: "missed_mate", explanation: `Best move was #M${mateInBest} — you played a slower line.` };
  }

  const boardBefore = new Chess(fenBefore);
  const boardBest = tryMove(fenBefore, bestUci);
  const boardPlayed = tryMove(fenBefore, playedUci);

  // 2. Missed promotion → didn't promote to queen when you could.
  if (bestUci.length === 5 && bestUci[4] === "q" && !playedUci.endsWith("q")) {
    return { tag: "missed_promotion", explanation: "Best move was a queen promotion." };
  }

  // 3. Missed check — the best move gives check but you didn't play a check.
  if (boardBest && boardBest.inCheck() && (!boardPlayed || !boardPlayed.inCheck())) {
    return { tag: "missed_check", explanation: `Best move (${moveSan(fenBefore, bestUci)}) delivers check.` };
  }

  // 4. Missed knight fork — the best move is a knight jumping to attack ≥ 2
  //    valuable pieces from one square.
  if (bestUci.length >= 4) {
    const bestFrom = bestUci.slice(0, 2);
    const bestTo = bestUci.slice(2, 4);
    const mover = boardBefore.get(bestFrom as any);
    if (mover?.type === "n" && boardBest) {
      const attacksFromKnight = knightAttacks(bestTo);
      const opponent = mover.color === "w" ? "b" : "w";
      let forkedCount = 0;
      let forkedValue = 0;
      for (const sq of attacksFromKnight) {
        const p = boardBest.get(sq as any);
        if (p && p.color === opponent) {
          forkedCount += 1;
          forkedValue += PIECE_VAL[p.type] ?? 0;
        }
      }
      if (forkedCount >= 2 && forkedValue >= 6) {
        return { tag: "missed_knight_fork", explanation: `Nxxx forks ${forkedCount} pieces at once.` };
      }
    }
  }

  // 5. Hung piece — the move you played leaves a piece under-defended by
  //    a lower-value attacker.
  if (boardPlayed && playedUci.length >= 4) {
    const playedTo = playedUci.slice(2, 4);
    const movedPiece = boardPlayed.get(playedTo as any);
    if (movedPiece) {
      const opponent = movedPiece.color === "w" ? "b" : "w";
      const attackers = attackersOfSquare(boardPlayed, playedTo, opponent);
      const defenders = attackersOfSquare(boardPlayed, playedTo, movedPiece.color);
      if (attackers.length > 0) {
        // find cheapest attacker
        const cheapestAtk = Math.min(...attackers.map((a) => PIECE_VAL[a.type] ?? 0));
        const cheapestDef = defenders.length ? Math.min(...defenders.map((d) => PIECE_VAL[d.type] ?? 0)) : Infinity;
        const myVal = PIECE_VAL[movedPiece.type] ?? 0;
        // Hung = attacker is cheaper than piece AND undefended-or-defender-costly
        if (cheapestAtk < myVal && (defenders.length === 0 || cheapestAtk < cheapestDef)) {
          return { tag: "hung_piece", explanation: `You hung your ${pieceName(movedPiece.type)} — it can be captured by a ${pieceName(attackersLetter(attackers, cheapestAtk))}.` };
        }
      }
    }
  }

  // 6. Missed capture — the best move is a capture; yours isn't.
  if (boardBest) {
    const bestSan = moveSan(fenBefore, bestUci);
    const playedSan = moveSan(fenBefore, playedUci);
    if (bestSan && bestSan.includes("x") && playedSan && !playedSan.includes("x")) {
      return { tag: "missed_capture", explanation: `Best was ${bestSan} — you missed a capture.` };
    }
  }

  // 7. Opening deviation — very early in the game (ply < 12), moves that don't
  //    match a common line often eval-drop. We don't have masters DB here in
  //    Slice 3, so we just tag by ply.
  if (ply <= 12) {
    return { tag: "opening_deviation", explanation: `Opening deviation — best was ${moveSan(fenBefore, bestUci)}.` };
  }

  // Fallback bucket for anything else.
  return { tag: "positional", explanation: `Best was ${moveSan(fenBefore, bestUci)}.` };
}

function tryMove(fen: string, uci: string): Chess | null {
  const g = new Chess(fen);
  const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined } as any);
  return m ? g : null;
}

function moveSan(fen: string, uci: string): string {
  const g = new Chess(fen);
  const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined } as any);
  return m ? m.san : uci;
}

function knightAttacks(square: string): string[] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const deltas: [number, number][] = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const out: string[] = [];
  for (const [df, dr] of deltas) {
    const nf = file + df, nr = rank + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(String.fromCharCode(97 + nf) + (nr + 1));
  }
  return out;
}

/** All pieces of `color` that attack `square` in the given position. */
function attackersOfSquare(g: Chess, square: string, color: "w" | "b"): { type: string; from: string }[] {
  // chess.js has attackers() in newer versions — safely try, else use isAttacked + scan.
  try {
    const arr = (g as any).attackers?.(square, color);
    if (Array.isArray(arr) && arr.length && typeof arr[0] === "string") {
      // returns list of squares
      return arr.map((from: string) => {
        const p = g.get(from as any);
        return { type: p?.type || "?", from };
      });
    }
  } catch { /* fall through */ }
  // Fallback: scan every square, check if it can move to target (as capture or empty).
  const squares = ["a", "b", "c", "d", "e", "f", "g", "h"].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => f + r));
  const out: { type: string; from: string }[] = [];
  for (const from of squares) {
    const p = g.get(from as any);
    if (!p || p.color !== color) continue;
    // Try moves from this square; if any lands on `square`, it's an attacker.
    const moves = (g.moves({ square: from as any, verbose: true }) as any[]) || [];
    if (moves.some((m) => m.to === square)) out.push({ type: p.type, from });
  }
  return out;
}

function attackersLetter(atk: { type: string; from: string }[], cheapestVal: number): string {
  const cheapest = atk.find((a) => (PIECE_VAL[a.type] ?? 0) === cheapestVal);
  return cheapest?.type ?? "?";
}

function pieceName(letter: string): string {
  return { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[letter] ?? letter;
}
