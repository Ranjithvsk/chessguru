// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Puzzle builder — turns a position into a ready-to-render trainer puzzle: the Yes/No
// question + correct answer, the square overlay + explanation, the proof line, and the
// play-it-out setup. Framework-agnostic.
import { evaluateKPK } from "./kpk";
import { squareRule } from "./square";
import { principalVariation, type PVStep } from "./play";

export interface EndgamePuzzle {
  ok: boolean; error?: string;
  fen: string; tier: string | null;
  sideToMove: "white" | "black"; attacker: "white" | "black"; defender: "white" | "black";
  question: string; answer: boolean;
  verdict: "win" | "draw"; promotes: boolean; dtmPlies: number | null;
  overlay: { squareCells: string[]; promotionSquare: string; pawn: string };
  explanation: string; kingMatters: boolean;
  proofLine: PVStep[];
  playItOut: { userPlays: "white" | "black"; goal: "win" | "draw"; opponentBestMove: { from: string; to: string; promotion?: string } | null };
}

export function buildPuzzle(fen: string, opts: { tier?: string | null; style?: "promote" | "catch" } = {}): EndgamePuzzle {
  const { tier = null, style = "promote" } = opts;
  const e = evaluateKPK(fen);
  if (!e.legal) return emptyBad(fen, "illegal position");
  const s = squareRule(fen);
  const stm = e.sideToMove!;
  const attacker = e.attacker!;
  const defender = attacker === "white" ? "black" : "white";
  const kingMatters = e.promotes !== s.promotes;

  let question: string, answer: boolean;
  if (style === "catch") { question = `${cap(stm)} to move. Can the ${defender} king catch the pawn?`; answer = !e.promotes; }
  else { question = `${cap(stm)} to move. Will the pawn promote?`; answer = !!e.promotes; }

  const explanation = kingMatters
    ? `${s.explain}  But the ${attacker} king is close enough to help — so the rule of the square alone doesn't decide it here. In truth the pawn ${e.promotes ? "queens" : "is stopped"}.`
    : s.explain!;

  return {
    ok: true, fen, tier,
    sideToMove: stm, attacker, defender,
    question, answer,
    verdict: e.result!, promotes: !!e.promotes, dtmPlies: e.dtmPlies ?? null,
    overlay: { squareCells: s.squareCells!, promotionSquare: s.promotionSquare!, pawn: s.pawn! },
    explanation, kingMatters,
    proofLine: principalVariation(fen),
    playItOut: { userPlays: e.promotes ? attacker : defender, goal: e.promotes ? "win" : "draw", opponentBestMove: e.bestMove ?? null },
  };
}

function emptyBad(fen: string, error: string): EndgamePuzzle {
  return { ok: false, error, fen, tier: null, sideToMove: "white", attacker: "white", defender: "black", question: "", answer: false, verdict: "draw", promotes: false, dtmPlies: null, overlay: { squareCells: [], promotionSquare: "", pawn: "" }, explanation: "", kingMatters: false, proofLine: [], playItOut: { userPlays: "white", goal: "draw", opponentBestMove: null } };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
