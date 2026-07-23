// Promote One Pawn — a guided lesson course (not a rated grinder): five chapters that
// teach K+P vs K from zero — the goal of promotion, the Rule of the Square, the Key
// Squares concept, Draw-or-Win verdicts, then a final play-it-out exam vs the exact
// KPK oracle. Every position below was verified against the oracle before shipping;
// quiz answers are still computed from the oracle at runtime, so they cannot drift.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board, { destsFromChess } from "../components/Board";
import { ensureOracle, evaluateKPK, squareRule, keySquares, resultAfter } from "../lib/endgame/oracle";
import { createEngine, type Engine } from "../lib/engine";

const PROGRESS_KEY = "cg_promote_lesson_v1";
const FILES = "abcdefgh";
const setEq = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

// ── the course ────────────────────────────────────────────────────────────────
interface StepDef {
  id: string;
  chapter: number;
  kind: "quiz" | "tap" | "verdict" | "play";
  fen: string;
  title: string;
  text: string;                       // teaching text shown with the task
  explain: string;                    // shown on reveal / after finishing
  userPlays?: "white" | "black";      // play steps
  showSquare?: boolean;               // draw the pawn's square on reveal (quiz steps do by default)
  showKeys?: boolean;                 // draw the key squares on reveal
  // Two-pawn (floating square) steps: outside the KPK oracle's domain, so the verdict
  // is tablebase-verified STATIC data and play-it-out runs against client Stockfish.
  twoPawn?: boolean;
  answer?: "win" | "draw";            // objective result (white's perspective), tablebase-verified
}

// ── floating square (rule of the common square) for TWO white pawns ───────────
// Side = the file distance including both pawns; base = the rank of the rear pawn.
// If the square reaches the 8th rank, the pawns promote by themselves.
function floatingSquare(fen: string): { cells: string[]; pawns: string[]; reaches: boolean } {
  const rows = (fen.split(/\s+/)[0] ?? "").split("/");
  const ps: { f: number; r: number }[] = [];
  for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[7 - r] ?? "") { if (/\d/.test(ch)) { f += +ch; continue; } if (ch === "P") ps.push({ f, r: r + 1 }); f++; } }
  if (ps.length !== 2) return { cells: [], pawns: [], reaches: false };
  ps.sort((a, b) => a.f - b.f);
  const [p1, p2] = ps as [typeof ps[0], typeof ps[0]];
  const base = Math.min(p1.r, p2.r);
  const side = p2.f - p1.f + 1;
  const top = base + side - 1;
  const cells: string[] = [];
  for (let f = p1.f; f <= p2.f; f++) for (let r = base; r <= Math.min(8, top); r++) cells.push(FILES[f]! + r);
  return { cells, pawns: ps.map((p) => FILES[p.f]! + p.r), reaches: top >= 8 };
}

const CHAPTERS = [
  { n: 1, icon: "👑", name: "The goal: promote" },
  { n: 2, icon: "📐", name: "Rule of the Square" },
  { n: 3, icon: "🔑", name: "Key squares" },
  { n: 4, icon: "⚖️", name: "Draw or win?" },
  { n: 5, icon: "🏆", name: "Final: promote one pawn" },
  { n: 6, icon: "🪁", name: "Two pawns · floating square" },
];

const STEPS: StepDef[] = [
  // ── Chapter 1 · the goal ──
  {
    id: "goal", chapter: 1, kind: "play", fen: "7k/8/8/8/1P6/8/8/6K1 w - - 0 1", userPlays: "white",
    title: "March the pawn home",
    text: "Everything in a pawn ending comes down to one thing: walk your pawn to the last rank and it becomes a QUEEN. Here the black king is far too slow. You are White — push the pawn to b8.",
    explain: "That's promotion — one humble pawn became a queen, and the game is won. The whole lesson is about when this is possible and when the defender stops it.",
  },
  // ── Chapter 2 · rule of the square ──
  {
    id: "sq-out", chapter: 2, kind: "quiz", fen: "8/8/8/8/2P4k/8/8/K7 w - - 0 1",
    title: "Can the king catch it?",
    text: "The Rule of the Square: draw a square from the pawn to its promotion rank, as wide as it is tall. If the defending king can step INSIDE that square on its move, it catches the pawn. If not, the pawn queens. White to move — will the c-pawn promote?",
    explain: "The black king on h4 is outside the pawn's square (drawn in yellow) and can never get in — the pawn runs home. No counting needed: the square answers it at a glance.",
  },
  {
    id: "sq-in", chapter: 2, kind: "quiz", fen: "8/8/8/5k2/2P5/8/8/K7 w - - 0 1",
    title: "Now the king is closer",
    text: "Same pawn, but the defending king stands on f5. Check the square: is it inside? White to move — will the pawn promote?",
    explain: "From f5 the king is inside the square — every pawn push is matched by a king step, and it lands on c8 in time. Caught: draw.",
  },
  {
    id: "sq-double", chapter: 2, kind: "quiz", fen: "8/8/8/8/8/8/4P2k/K7 w - - 0 1",
    title: "The double-step trap",
    text: "Careful — a pawn on its starting rank moves TWO squares at once, so you must draw the square from the 3rd rank, not the 2nd. White to move — will the e-pawn promote?",
    explain: "Counting from e2 the king looks inside — but 1.e4! makes the true square start at e3, and h2 is outside it. The double step is the classic trap: always draw the square one rank ahead for an unmoved pawn.",
  },
  // ── Chapter 3 · key squares ──
  {
    id: "keys-teach", chapter: 3, kind: "verdict", fen: "8/8/8/8/4P3/8/8/K6k w - - 0 1", showKeys: true,
    title: "The flip side: key squares",
    text: "The square rule asks if the DEFENDER catches the pawn. Key squares are the attacker's version: for every non-rook pawn there are squares where, if YOUR king reaches one, the pawn promotes no matter whose move it is. For a pawn on e4 they are d6, e6 and f6 — two ranks ahead. Is this position, with the defender hopelessly far away, a win or a draw?",
    explain: "A win, of course — and the violet squares are the ones to remember. With kings close together, reaching d6/e6/f6 with your king GUARANTEES the e-pawn queens, regardless of tempo.",
  },
  {
    id: "keys-tap6", chapter: 3, kind: "tap", fen: "8/8/8/3P4/8/8/8/K6k w - - 0 1",
    title: "Tap the key squares",
    text: "A pawn that has crossed the middle gets stronger: on the 5th or 6th rank it has SIX key squares — one and two ranks ahead. Tap every key square of the d5-pawn, then Check.",
    explain: "c6, d6, e6 and c7, d7, e7 — six of them. The further the pawn, the easier the win: your king has twice the targets.",
  },
  {
    id: "keys-rook", chapter: 3, kind: "tap", fen: "8/8/8/8/P7/8/8/K6k w - - 0 1",
    title: "The rook-pawn exception",
    text: "One family of pawns breaks the rule. Tap the key squares of the a4-pawn — or press “No key squares” if you think it has none.",
    explain: "A rook's pawn has NO key squares — the defending king plants itself in the corner and there is no way to evict it: stalemate saves the defence every time. Remember: a-pawns and h-pawns are drawing pawns.",
  },
  // ── Chapter 4 · draw or win? ──
  {
    id: "v-front6", chapter: 4, kind: "verdict", fen: "4k3/8/3K4/4P3/8/8/8/8 w - - 0 1",
    title: "King in front, 6th rank",
    text: "Now the kings fight. Golden rule #1: if the attacking king stands on the 6th rank IN FRONT of its pawn, it is always a win — no matter whose move it is. White to move: win or draw?",
    explain: "A win, always. The king on d6 already owns the key squares; the pawn strolls in behind it. This is the position you steer for.",
  },
  {
    id: "v-opp", chapter: 4, kind: "verdict", fen: "8/4k3/8/4K3/4P3/8/8/8 w - - 0 1",
    title: "The defender takes the opposition",
    text: "Here the black king stands directly in the pawn's path and takes the OPPOSITION — the kings face off and White must give way. White to move: win or draw?",
    explain: "A draw. Whatever White tries, Black keeps the opposition and never lets the king onto a key square; push the pawn too soon and it ends in stalemate. King in front + opposition = the defender holds.",
  },
  {
    id: "v-corner", chapter: 4, kind: "verdict", fen: "7k/8/5K1P/8/8/8/8/8 w - - 0 1",
    title: "Rook pawn, king in the corner",
    text: "White's king even leads the pawn — but it's an h-pawn and the black king has reached the corner. White to move: win or draw?",
    explain: "A draw — the rook-pawn curse from chapter 3 in action. Black shuffles between h8 and g8; White can only deliver stalemate. Even a huge advantage can't fix the wrong pawn.",
  },
  {
    id: "v-race", chapter: 4, kind: "verdict", fen: "8/8/2k5/8/3KP3/8/8/8 w - - 0 1",
    title: "Race to the key squares",
    text: "Both kings hover near the pawn. Count it out with everything you've learned — who controls d6/e6/f6 first? White to move: win or draw?",
    explain: "A win: with the move, the white king shoulders its way to the key squares (1.Ke5! heading for d6/e6) and the black king can't hold the line. One tempo decides — that's why 'whose move is it?' matters so much.",
  },
  // ── Chapter 5 · final exam ──
  {
    id: "final-win", chapter: 5, kind: "play", fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", userPlays: "white",
    title: "Final I — promote one pawn",
    text: "From the very start: king e1, pawn e2, the defender right in your path. Use everything — king in FRONT of the pawn, grab the key squares, win the opposition, and only then push. The oracle defends perfectly; one wrong step and the win is gone.",
    explain: "You promoted the pawn against perfect defence — the full technique: king first, opposition, key squares, then the pawn. That is the whole K+P vs K endgame.",
  },
  {
    id: "final-draw", chapter: 5, kind: "play", fen: "8/8/6k1/8/7P/5K2/8/8 b - - 0 1", userPlays: "black",
    title: "Final II — hold the draw",
    text: "Now defend. You are BLACK against an h-pawn. Remember the rook-pawn exception: get in front of the pawn or into the corner and nothing can dig you out. The oracle plays the best winning tries.",
    explain: "Draw held! You used both defensive ideas — the square, and the corner fortress against the rook pawn. One more idea awaits: what happens when there are TWO pawns?",
  },
  // ── Chapter 6 · two pawns & the floating square (tablebase-verified verdicts) ──
  {
    id: "float-teach", chapter: 6, kind: "verdict", fen: "8/8/8/4k3/1P4P1/8/8/K7 b - - 0 1", twoPawn: true, answer: "win",
    title: "One king, two pawns",
    text: "A king can chase one pawn — but TWO? The FLOATING SQUARE decides: stand a square on the two pawns, as wide as the files between them (here b4–g4, six files). If that square reaches the 8th rank, the pawns beat the king all by themselves — chase one and the other runs home. Black to move: win or draw?",
    explain: "A win for the pawns — no white king needed! The b4–g4 square is six files wide, so it sails past the 8th rank. Whichever pawn the king hunts, the other simply outruns it (each is outside the king's reach once it commits).",
  },
  {
    id: "float-attack", chapter: 6, kind: "play", fen: "8/8/8/4k3/1P4P1/8/8/K7 w - - 0 1", twoPawn: true, answer: "win", userPlays: "white",
    title: "Prove it — promote one of them",
    text: "Now do it yourself. Your king stays home on a1 — the pawns must win alone. Watch which pawn the black king leans toward, and push the OTHER one. Stockfish defends.",
    explain: "That's the floating square in action: two wide-apart pawns are a self-playing machine — the defender can never cover both.",
  },
  {
    id: "float-hold", chapter: 6, kind: "verdict", fen: "8/8/8/2k5/2P1P3/8/8/K7 b - - 0 1", twoPawn: true, answer: "draw",
    title: "When the king DOES hold them",
    text: "Same idea, closer pawns: c4 and e4 are three files apart, so the floating square (c4–e6) stops two ranks short of the 8th. The black king stands right beside a pawn. Black to move: win or draw?",
    explain: "A draw. Short of the 8th rank the pawns can't promote alone — and this king sits inside BOTH pawns' squares, so it may even eat one: after Kxc4 the e-pawn runs, but c4 is still inside its square and the king strolls over to catch it. Two pawns without their king win nothing here.",
  },
  {
    id: "float-defend", chapter: 6, kind: "play", fen: "8/8/3k4/2P1P3/8/8/8/K7 b - - 0 1", twoPawn: true, answer: "draw", userPlays: "black",
    title: "Hold two pawns with one king",
    text: "One rank further — c5 and e5, your king on d6 — and it is STILL a draw, but now only just: you must stay IN FRONT of the pawns. Sidestep to c6 or e6 and the other pawn darts through. Stockfish will push and bring its king over; shadow from d6 and d5 (capture only when you can still catch the other pawn) and the draw is yours.",
    explain: "Held! In front of the pawns your king controls both promotion paths; one step aside and the floating square snaps shut on you. And one rank further still there would be no defence at all — see the next step.",
  },
  {
    id: "float-flip", chapter: 6, kind: "verdict", fen: "3k4/8/2P1P3/8/8/8/8/K7 b - - 0 1", twoPawn: true, answer: "win",
    title: "Slide the square forward",
    text: "The very same c/e pawn pair — but two ranks further, on c6 and e6. Slide the floating square forward with them and look where its top edge lands now. Black to move: win or draw?",
    explain: "Now it's a win: from the 6th rank the square (c6–e8) touches the promotion rank, so the pawns win by themselves — 1…Kc7 2.e7! (the far pawn darts) or 1…Ke7 2.c7. The whole course in one picture: squares decide pawn endings — the pawn's square, the king's key squares, and the floating square of two.",
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────
function loadDone(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveDone(done: Set<string>) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done])); } catch { /* */ }
}

type Phase = "task" | "revealed" | "playing" | "playdone";

export default function PromoteLesson() {
  const [ready, setReady] = useState(false);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [phase, setPhase] = useState<Phase>("task");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [finished, setFinished] = useState(false);

  const step = STEPS[idx]!;
  // oracle facts for the current step (exact, computed on demand once the table is ready).
  // Two-pawn steps live outside the KPK oracle's domain — verdicts there are static
  // tablebase-verified data on the step itself.
  const facts = useMemo(() => {
    if (!ready || step.twoPawn) return null;
    const e = evaluateKPK(step.fen);
    const s = squareRule(step.fen);
    const k = keySquares(step.fen);
    return { e, s, k };
  }, [ready, step]);
  const floatSq = useMemo(() => (step.twoPawn ? floatingSquare(step.fen) : null), [step]);
  // objective verdict for the current position (white's perspective)
  const verdict: "win" | "draw" = step.twoPawn ? step.answer! : facts?.e.promotes ? "win" : "draw";

  // client Stockfish — only needed for two-pawn play-it-out; created lazily, kept for the session
  const engineRef = useRef<Engine | null>(null);
  const getEngine = useCallback((): Engine => {
    if (!engineRef.current) engineRef.current = createEngine();
    return engineRef.current;
  }, []);
  useEffect(() => () => { engineRef.current?.quit(); }, []);

  // tap-quiz selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // play-it-out state
  const game = useRef(new Chess());
  const [fen, setFen] = useState(step.fen);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [boardKey, setBoardKey] = useState(0);

  useEffect(() => {
    ensureOracle().then(() => setReady(true)).catch(() => setMsg("Couldn't load the endgame tablebase."));
  }, []);

  // reset per step
  useEffect(() => {
    setPhase("task"); setCorrect(null); setMsg(""); setSelected(new Set());
    game.current = new Chess(step.fen);
    setFen(step.fen); setLastMove(undefined);
    setBoardKey((k) => k + 1);
  }, [idx, step]);

  const markDone = useCallback(() => {
    setDone((prev) => { const n = new Set(prev); n.add(step.id); saveDone(n); return n; });
  }, [step]);

  const advance = useCallback(() => {
    if (idx + 1 < STEPS.length) setIdx(idx + 1);
    else setFinished(true);
  }, [idx]);

  // ── quiz (will it promote?) & verdict (win or draw?) ──
  const answerQuiz = useCallback((yes: boolean) => {
    if (!facts || phase !== "task") return;
    const right = yes === !!facts.e.promotes;
    setCorrect(right); setPhase("revealed"); markDone();
  }, [facts, phase, markDone]);

  const answerVerdict = useCallback((win: boolean) => {
    if (phase !== "task" || (!facts && !step.twoPawn)) return;
    const truth = step.twoPawn ? step.answer : facts!.e.result;
    const right = (win ? "win" : "draw") === truth;
    setCorrect(right); setPhase("revealed"); markDone();
  }, [facts, step, phase, markDone]);

  // ── tap quiz ──
  const toggleTap = useCallback((sqName: string) => {
    if (phase !== "task") return;
    setSelected((prev) => { const n = new Set(prev); if (n.has(sqName)) n.delete(sqName); else n.add(sqName); return n; });
  }, [phase]);

  const checkTap = useCallback((assertNone = false) => {
    if (!facts || phase !== "task") return;
    const sel = assertNone ? new Set<string>() : selected;
    if (assertNone) setSelected(new Set());
    const right = setEq(sel, facts.k.squares);
    setCorrect(right); setPhase("revealed"); markDone();
  }, [facts, phase, selected, markDone]);

  // ── play it out vs the oracle ──
  const finishPlay = useCallback((won: boolean, text: string) => {
    setPhase("playdone"); setCorrect(won); setMsg(text);
    if (won) markDone();
  }, [markDone]);

  const goal: "win" | "draw" = verdict;

  const checkTerminal = useCallback((): boolean => {
    const f = game.current.fen();
    const pl = f.split(/\s+/)[0] ?? "";
    const queened = /[QqRrBbNn]/.test(pl), noPawn = !/[Pp]/.test(pl);
    if (queened) {
      // Two-pawn steps: a spite-promotion into an immediate recapture decides nothing —
      // play on and let the recapture happen (the standoff draw often ends exactly so).
      if (step.twoPawn && game.current.moves({ verbose: true }).some((m) => m.captured && m.captured !== "p")) return false;
      finishPlay(goal === "win", goal === "win" ? "The pawn queens — promoted! 🎉" : "The pawn queened — the defence broke. Try again ↻"); return true;
    }
    if (noPawn) { finishPlay(goal === "draw", goal === "draw" ? "Pawn caught — draw held! 🛡️" : "You lost the pawn — no win left. Try again ↻"); return true; }
    if (game.current.isCheckmate()) { finishPlay(goal === "win", "Checkmate! 🎉"); return true; }
    if (game.current.isStalemate() || game.current.isDraw()) {
      const how = game.current.isStalemate() ? "Stalemate" : "Draw";
      finishPlay(goal === "draw", goal === "draw" ? `${how} — draw held! 🛡️` : `${how} — the win slipped. Try again ↻`); return true;
    }
    // KPK only: the oracle flags a thrown result instantly (illegal domain for two pawns)
    if (!step.twoPawn) {
      const r = resultAfter(f);
      if (r && ((goal === "win" && r === "draw") || (goal === "draw" && r === "win"))) {
        finishPlay(false, goal === "win" ? "That throws the win — the defence escapes. Try again ↻" : "That lets the pawn through — try again ↻");
        return true;
      }
    }
    return false;
  }, [goal, step, finishPlay]);

  const oracleMove = useCallback(async () => {
    let from = "", to = "", promo = "q";
    if (step.twoPawn) {
      // two-pawn steps: Stockfish is the opponent
      let best = "";
      try { best = await getEngine().bestMove(game.current.fen(), 400); } catch { /* */ }
      if (!best || best === "(none)" || best.length < 4) { checkTerminal(); return; }
      from = best.slice(0, 2); to = best.slice(2, 4); promo = best[4] ?? "q";
    } else {
      const e = evaluateKPK(game.current.fen());
      if (!e.legal || !e.bestMove) { checkTerminal(); return; }
      from = e.bestMove.from; to = e.bestMove.to; promo = (e.bestMove.promotion as string) || "q";
    }
    try {
      game.current.move({ from, to, promotion: promo as "q" });
      setLastMove([from as Key, to as Key]); setFen(game.current.fen());
    } catch { /* */ }
    checkTerminal();
  }, [step, getEngine, checkTerminal]);

  const startPlay = useCallback(() => {
    game.current = new Chess(step.fen);
    setFen(step.fen); setLastMove(undefined); setMsg("");
    setPhase("playing"); setBoardKey((k) => k + 1);
    const stm = step.fen.includes(" w ") ? "white" : "black";
    if (stm !== step.userPlays) setTimeout(() => oracleMove(), 300);
  }, [step, oracleMove]);

  const onMove = useCallback((from: Key, to: Key) => {
    if (phase !== "playing") return;
    let mv: unknown = null;
    try { mv = game.current.move({ from, to, promotion: "q" }); } catch { mv = null; }
    if (!mv) { setFen(game.current.fen()); return; }
    setLastMove([from, to]); setFen(game.current.fen());
    if (checkTerminal()) return;
    setTimeout(() => oracleMove(), 300);
  }, [phase, checkTerminal, oracleMove]);

  const myTurn = phase === "playing" && !game.current.isGameOver() &&
    ((game.current.turn() === "w" ? "white" : "black") === step.userPlays);
  const dests = useMemo(() => (myTurn ? destsFromChess(game.current as never) : new Map()), [fen, myTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── overlay shapes ──
  const shapes: DrawShape[] = useMemo(() => {
    // two-pawn steps: overlay the FLOATING square on reveal (+ each pawn's run)
    if (step.twoPawn) {
      if (phase !== "revealed" || !floatSq) return [];
      const s: DrawShape[] = floatSq.cells.map((c) => ({ orig: c as Key, brush: "yellow" }));
      for (const p of floatSq.pawns) s.push({ orig: p as Key, dest: (p[0]! + "8") as Key, brush: "green" });
      return s;
    }
    if (!facts) return [];
    const s: DrawShape[] = [];
    if (step.kind === "tap") {
      if (phase === "task") return [...selected].map((c) => ({ orig: c as Key, brush: "blue" }));
      const corr = new Set(facts.k.squares);
      for (const c of facts.k.squares) s.push({ orig: c as Key, brush: selected.has(c) ? "green" : "purple" });
      for (const c of selected) if (!corr.has(c)) s.push({ orig: c as Key, brush: "red" });
      return s;
    }
    if (phase === "revealed") {
      if ((step.kind === "quiz" || step.showSquare) && facts.s.squareCells) {
        for (const c of facts.s.squareCells) s.push({ orig: c as Key, brush: "yellow" });
        if (facts.s.pawn && facts.s.promotionSquare) s.push({ orig: facts.s.pawn as Key, dest: facts.s.promotionSquare as Key, brush: "green" });
      }
      if (step.showKeys) for (const c of facts.k.squares) s.push({ orig: c as Key, brush: "purple" });
    }
    return s;
  }, [facts, floatSq, step, phase, selected]);

  // 8×8 tap overlay (white orientation), identical geometry to the board wrap
  const overlay = useMemo(() => Array.from({ length: 64 }, (_, i) => FILES[i % 8]! + (8 - Math.floor(i / 8))), []);

  const chDone = (n: number) => STEPS.filter((s) => s.chapter === n).every((s) => done.has(s.id));

  if (!ready) return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="text-lg font-semibold text-ink-200">Preparing the endgame tablebase…</div>
      <div className="mt-2 text-sm text-ink-400">Computing every King + Pawn vs King position (once — then it's cached & offline).</div>
    </div>
  );

  if (finished) return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="text-5xl">🏆</div>
      <h1 className="mt-4 text-2xl font-bold text-white">Course complete!</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-300">
        You promoted a pawn, mastered the Rule of the Square, found the key squares, judged draw-vs-win, beat a perfect defender —
        and learned the floating square: when two pawns beat a king alone, and when one king holds them both.
        Keep the skills sharp in the rated trainers:
      </p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <a href="/study/pawn-endgames" className="rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">♟ Rated Pawn Endgames →</a>
        <a href="/study/endgame" className="rounded-lg border border-ink-700 px-4 py-2.5 font-semibold text-ink-200 hover:bg-ink-800">🏁 Rule of the Square</a>
        <a href="/study/key-squares" className="rounded-lg border border-ink-700 px-4 py-2.5 font-semibold text-ink-200 hover:bg-ink-800">🔑 Key Squares</a>
      </div>
      <button onClick={() => { setFinished(false); setIdx(0); }} className="mt-4 text-sm text-ink-400 hover:text-ink-200">↻ Restart the course</button>
    </div>
  );

  const chapter = CHAPTERS[step.chapter - 1]!;
  const stepInCh = STEPS.filter((s) => s.chapter === step.chapter);
  const stepNo = stepInCh.findIndex((s) => s.id === step.id) + 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">👑 Promote One Pawn · guided course</h1>
        <p className="mt-1 text-sm text-ink-400">
          Six short chapters — from “what is promotion?” to one king holding two pawns.
          Already know the theory? <a href="/study/pawn-endgames" className="font-semibold text-brand-400 hover:text-brand-300">Jump to rated practice →</a>
        </p>
      </div>

      {/* chapter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {CHAPTERS.map((c) => (
          <button
            key={c.n}
            onClick={() => setIdx(STEPS.findIndex((s) => s.chapter === c.n))}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              c.n === step.chapter ? "border-brand-500 bg-brand-500/15 text-brand-300"
              : chDone(c.n) ? "border-emerald-700 bg-emerald-500/10 text-emerald-300"
              : "border-ink-700 bg-ink-900 text-ink-400 hover:text-ink-200"}`}
          >
            {chDone(c.n) ? "✓" : c.icon} {c.n}. {c.name}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative cg-board-host">
          <Board
            key={boardKey}
            fen={fen}
            orientation={step.userPlays ?? "white"}
            turnColor={game.current.turn() === "w" ? "white" : "black"}
            movableColor={myTurn ? step.userPlays : undefined}
            dests={dests}
            lastMove={lastMove}
            shapes={shapes}
            onMove={onMove}
            coordinates
          />
          {step.kind === "tap" && phase === "task" && (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
              <div className="pointer-events-auto grid aspect-square w-full grid-cols-8 grid-rows-8" style={{ maxWidth: "min(100%, calc(100dvh - 10.5rem))" }}>
                {overlay.map((sq) => (
                  <button key={sq} onClick={() => toggleTap(sq)} aria-label={sq}
                    className={`h-full w-full transition ${selected.has(sq) ? "bg-sky-400/25 shadow-[inset_0_0_0_3px_rgba(56,189,248,0.9)]" : "hover:bg-white/10"}`} />
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
            <div className="text-xs uppercase tracking-wide text-ink-500">{chapter.icon} Chapter {step.chapter} · {chapter.name}{stepInCh.length > 1 ? ` · ${stepNo}/${stepInCh.length}` : ""}</div>
            <div className="mt-1 text-lg font-semibold text-white">{step.title}</div>
            <p className="mt-2 text-sm leading-relaxed text-ink-300">{step.text}</p>

            {phase === "task" && step.kind === "quiz" && (
              <div className="mt-4 flex gap-2">
                <button onClick={() => answerQuiz(true)} className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-500">Promotes</button>
                <button onClick={() => answerQuiz(false)} className="flex-1 rounded-lg bg-rose-600 px-4 py-3 font-bold text-white hover:bg-rose-500">Caught</button>
              </div>
            )}

            {phase === "task" && step.kind === "verdict" && (
              <div className="mt-4 flex gap-2">
                <button onClick={() => answerVerdict(true)} className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-500">Win</button>
                <button onClick={() => answerVerdict(false)} className="flex-1 rounded-lg bg-sky-600 px-4 py-3 font-bold text-white hover:bg-sky-500">Draw</button>
              </div>
            )}

            {phase === "task" && step.kind === "tap" && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="text-sm text-ink-300">Selected: <b className="text-sky-300">{selected.size}</b></div>
                <button onClick={() => checkTap(false)} className="rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Check</button>
                <div className="flex gap-2">
                  <button onClick={() => setSelected(new Set())} className="flex-1 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Clear</button>
                  <button onClick={() => checkTap(true)} className="flex-1 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">No key squares</button>
                </div>
              </div>
            )}

            {phase === "task" && step.kind === "play" && (
              <button onClick={startPlay} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">
                ▶ Play ({step.userPlays} · {verdict === "win" ? "promote a pawn" : "hold the draw"})
              </button>
            )}

            {phase === "revealed" && (
              <div className="mt-4">
                <div className={`text-lg font-bold ${correct ? "text-emerald-400" : "text-rose-400"}`}>{correct ? "Correct! ✓" : "Not quite —"}</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-300">{step.explain}</p>
                <button onClick={advance} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Continue →</button>
              </div>
            )}

            {phase === "playing" && (
              <div className="mt-4">
                <div className="text-sm font-semibold text-white">You are {step.userPlays}. Goal: {goal === "win" ? "promote the pawn." : "catch the pawn / hold the draw."}</div>
                <div className="mt-2 text-sm text-ink-400">{msg || "Your move."}</div>
                <button onClick={() => { game.current = new Chess(step.fen); setFen(step.fen); setLastMove(undefined); setPhase("task"); setBoardKey((k) => k + 1); }}
                  className="mt-4 w-full rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:bg-ink-800">↺ Reset</button>
              </div>
            )}

            {phase === "playdone" && (
              <div className="mt-4">
                <div className={`text-lg font-bold ${correct ? "text-emerald-400" : "text-rose-400"}`}>{msg}</div>
                {correct ? (
                  <>
                    <p className="mt-2 text-sm leading-relaxed text-ink-300">{step.explain}</p>
                    <button onClick={advance} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Continue →</button>
                  </>
                ) : (
                  <button onClick={startPlay} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">↻ Try again</button>
                )}
              </div>
            )}
          </div>

          {/* step navigation */}
          <div className="flex items-center justify-between text-xs text-ink-500">
            <button onClick={() => idx > 0 && setIdx(idx - 1)} disabled={idx === 0} className="rounded px-2 py-1 hover:text-ink-200 disabled:opacity-40">← Back</button>
            <span>Step {idx + 1} / {STEPS.length}</span>
            <button onClick={() => (done.has(step.id) || phase === "revealed" || phase === "playdone") && advance()}
              disabled={!(done.has(step.id) || phase === "revealed")} className="rounded px-2 py-1 hover:text-ink-200 disabled:opacity-40"
              title={done.has(step.id) ? "" : "Finish this step first"}>Skip →</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
