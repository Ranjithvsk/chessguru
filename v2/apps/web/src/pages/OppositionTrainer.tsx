// Opposition — a guided study course: direct opposition, DISTANT opposition and VERY
// distant opposition, finishing with famous positions from the endgame books
// (Dvoretsky's Endgame Manual, Flear) played out on the board. Every verdict below is
// static VERIFIED data (KPK oracle / lichess tablebase, checked before shipping).
// K+P vs K play-outs are refereed by the exact KPK oracle (instant "you threw it"
// feedback); multi-pawn book positions are played against client Stockfish.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board, { destsFromChess } from "../components/Board";
import { ensureOracle, evaluateKPK, resultAfter } from "../lib/endgame/oracle";
import { createEngine, type Engine } from "../lib/engine";

const PROGRESS_KEY = "cg_opposition_course_v1";
const FILES = "abcdefgh";
const setEq = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

function kingSquares(fen: string): { K: string; k: string } {
  const rows = (fen.split(/\s+/)[0] ?? "").split("/");
  let K = "", kk = "";
  for (let r = 0; r < 8; r++) { let f = 0; for (const ch of (rows[7 - r] ?? "")) { if (/\d/.test(ch)) { f += +ch; continue; } const nm = (FILES[f] ?? "?") + (r + 1); if (ch === "K") K = nm; else if (ch === "k") kk = nm; f++; } }
  return { K, k: kk };
}

interface StepDef {
  id: string;
  chapter: number;
  kind: "verdict" | "tap" | "play";
  fen: string;
  title: string;
  text: string;
  explain: string;
  answer: "win" | "draw";             // objective result — oracle/tablebase-verified static data
  userPlays?: "white" | "black";      // play steps: the side that achieves `answer`
  engine?: boolean;                   // play steps: true = Stockfish opponent (multi-pawn), else KPK oracle
  targets?: string[];                 // tap steps: the correct square(s)
  quote?: { q: string; a: string };   // book citation shown on reveal
}

const CHAPTERS = [
  { n: 1, icon: "🤝", name: "Direct opposition" },
  { n: 2, icon: "📏", name: "Distant opposition" },
  { n: 3, icon: "🔭", name: "Very distant opposition" },
  { n: 4, icon: "📖", name: "From the books" },
];

const STEPS: StepDef[] = [
  // ── Chapter 1 · direct opposition ──
  {
    id: "opp-teach", chapter: 1, kind: "verdict", fen: "8/3k4/8/3K4/3P4/8/8/8 w - - 0 1", answer: "draw",
    title: "Kings face to face",
    text: "When the kings stand on the same line with ONE square between them, they are in OPPOSITION — and whoever must move, loses the argument: the mover has to give way, the other king steps forward. Here it is WHITE to move, so BLACK holds the opposition. Win or draw?",
    explain: "A draw — Dvoretsky's very first diagram. 1.Kc5 Kc7 or 1.Ke5 Ke7: whichever side White walks, Black mirrors and blocks. The white king never reaches a key square of the d4-pawn.",
    quote: { q: "Diagram 1-1 — the king on d5 does not stand on a key square, so with White to move it is only a draw.", a: "Dvoretsky's Endgame Manual" },
  },
  {
    id: "opp-flip", chapter: 1, kind: "verdict", fen: "8/3k4/8/3K4/3P4/8/8/8 b - - 0 1", answer: "win",
    title: "Same position — Black to move",
    text: "Nothing has moved — but now it is BLACK's turn, so WHITE holds the opposition. Win or draw?",
    explain: "A win. Black must give way (1…Kc7 2.Ke6! or 1…Ke7 2.Kc6!) and the white king outflanks to a key square — c6, d6 or e6 — after which the pawn strolls home. One tempo turned a draw into a win: that is the opposition.",
  },
  {
    id: "opp-tap-hold", chapter: 1, kind: "tap", fen: "8/8/8/k7/8/1KP5/8/8 b - - 0 1", answer: "draw", targets: ["b5"],
    title: "Defend with the opposition",
    text: "Now use it to survive. Black to move — exactly ONE square holds the draw against the c-pawn. Tap it.",
    explain: "1…Kb5! — direct opposition. The white king can never step forward (b4/a4/c4 are all barred or mirrored), and without the king in front the pawn goes nowhere. Every other retreat lets Kb4 break in and escort the pawn.",
  },
  {
    id: "opp-play", chapter: 1, kind: "play", fen: "8/4k3/8/3K4/4P3/8/8/8 w - - 0 1", answer: "win", userPlays: "white",
    title: "Win with the opposition",
    text: "Your turn. Only ONE first move wins here: seize the direct opposition, force the defender to yield, outflank to a key square, and promote. The oracle defends perfectly — a single slip and it's a book draw.",
    explain: "1.Ke5! — opposition. Then outflank around the yielding king, plant your own on the 6th in front of the pawn, and it's over. Opposition → outflank → key square → promote: the whole winning method in one line.",
  },
  // ── Chapter 2 · distant opposition ──
  {
    id: "dist-teach", chapter: 2, kind: "tap", fen: "8/1k6/8/8/8/8/K3P3/8 w - - 0 1", answer: "win", targets: ["b3"],
    title: "Opposition at a distance",
    text: "Opposition works ACROSS the board: kings on the same line with THREE squares between them hold the DISTANT opposition — as they close in, it converts into the direct kind. White to move — exactly one move wins. Tap the square.",
    explain: "1.Kb3!! — the distant opposition (b3 against b7, three squares between). Black steps forward, White mirrors, and every conversion ends with White holding the DIRECT opposition at the critical moment. Any other first move and Black slips into opposition himself — draw.",
  },
  {
    id: "dist-tap-hold", chapter: 2, kind: "tap", fen: "8/k7/8/8/8/1KP5/8/8 b - - 0 1", answer: "draw", targets: ["b7"],
    title: "Defend from afar",
    text: "The defender's version. Black to move — only ONE square draws. Tap it. (Count the squares between the kings.)",
    explain: "1…Kb7!! — the distant opposition, three squares between the kings on the b-file. Black simply mirrors every advance (Kb4 → Kb6, Kc4 → Kc6…) and arrives in DIRECT opposition exactly when it matters. Rush toward the pawn instead and White's king slides past.",
  },
  {
    id: "dist-book-play", chapter: 2, kind: "play", fen: "8/8/8/4p1p1/8/5P2/6K1/3k4 w - - 0 1", answer: "draw", userPlays: "white", engine: true,
    title: "Neustadtl 1890 — the only move",
    text: "A classic. White's position looks lost — Black's king is in, the pawns are falling. ONE move saves it: grab the distant opposition and mirror the black king along the rank. You are White; Stockfish attacks. Find it and hold.",
    explain: "1.Kh1!! — the only saving move; everything else loses. White mirrors the black king along the first rank (…Kd2 2.Kh2 Kd3 3.Kh3) — d-file king against h-file king, always the same rank. Black can never convert the extra pawn.",
    quote: { q: "Diagram 1-8, H. Neustadtl 1890 — White is lost unless he grabs the distant opposition: 1.Kh1!! is the only move.", a: "Dvoretsky's Endgame Manual" },
  },
  // ── Chapter 3 · very distant opposition ──
  {
    id: "vdist-teach", chapter: 3, kind: "tap", fen: "1k6/8/8/8/8/8/4P3/K7 w - - 0 1", answer: "win", targets: ["b2"],
    title: "Across the whole board",
    text: "The full rule: kings on the same line with an ODD number of squares between them — 1, 3 or FIVE — and the opponent to move: you hold the opposition. Five squares is the VERY DISTANT opposition. White to move — one single move wins, from corner to corner. Tap it.",
    explain: "1.Kb2!! — very distant opposition: b2 against b8, five squares between. As the kings walk in, 5 becomes 3 becomes 1 — and White holds the direct opposition at the moment of contact. Everything else lets Black seize it and draw. Count the gap: odd + opponent to move = yours.",
  },
  {
    id: "vdist-play", chapter: 3, kind: "play", fen: "1k6/8/8/8/8/8/4P3/K7 w - - 0 1", answer: "win", userPlays: "white",
    title: "Prove it over the board",
    text: "Now convert it. Keep the opposition through every stage — very distant → distant → direct — then outflank and queen the e-pawn. The oracle defends perfectly and will punish a single wasted tempo.",
    explain: "From corner to queening — one unbroken chain of oppositions. If you felt the rhythm (mirror, mirror, outflank), you own this concept now.",
  },
  // ── Chapter 4 · from the books ──
  {
    id: "bk-flear", chapter: 4, kind: "verdict", fen: "3k4/8/3K4/3P4/8/8/8/8 b - - 0 1", answer: "win",
    title: "Flear: the argument",
    text: "Black to move, kings eye to eye. Win or draw?",
    explain: "A win — and effortlessly so: Black must step aside, and the white king already stands on the 6th rank in front of its pawn (always winning). The opposition just removes every last drop of resistance.",
    quote: { q: "It's as if the kings face each other off — the first to move losing the argument.", a: "Glenn Flear, Starting Out: Pawn Endgames" },
  },
  {
    id: "bk-dv12", chapter: 4, kind: "play", fen: "1k6/8/1K6/1P6/8/8/8/8 w - - 0 1", answer: "win", userPlays: "white",
    title: "Dvoretsky 1-2 — seize it, don't push",
    text: "White to move and win — but the obvious king move throws it away. Play it out against the oracle.",
    explain: "1.Ka6! seizes the key square. After 1…Ka8 2.b6 Kb8 3.b7 the pawn queens. The tempting 1.Kc6? runs into 1…Ka7! and White has to start all over again.",
    quote: { q: "Diagram 1-2 — 1.Ka6! wins; 1.Kc6? Ka7! and White must start over.", a: "Dvoretsky's Endgame Manual" },
  },
  {
    id: "bk-coull", chapter: 4, kind: "play", fen: "8/8/3p4/3P4/5k2/3K4/8/8 w - - 0 1", answer: "draw", userPlays: "white", engine: true,
    title: "Coull–Stanciu 1988 — don't resign!",
    text: "In this position White RESIGNED, fearing the loss of the d5-pawn. It's a dead draw. You are White — prove it against Stockfish: let the pawn go if you must, then hold the lone d-pawn with the opposition.",
    explain: "1.Ke2 Ke4 2.Kd2 Kxd5 3.Kd3! — the white king takes the opposition and the single d-pawn never gets through. Dvoretsky's verdict on the resignation: “No comment needed!”",
    quote: { q: "Diagram 1-5, Coull–Stanciu, Saloniki ol 1988 — White resigned… but it is a draw. No comment needed!", a: "Dvoretsky's Endgame Manual" },
  },
  {
    id: "bk-dv17", chapter: 4, kind: "play", fen: "8/1k6/1p6/1K6/P1P5/8/8/8 b - - 0 1", answer: "draw", userPlays: "black", engine: true,
    title: "Dvoretsky 1-7 — horizontal opposition",
    text: "Opposition also works SIDEWAYS. White holds the vertical opposition and has two extra pawns — yet Black draws with exact king moves along the rank. You are Black; be careful with your very first move.",
    explain: "1…Kc7! (1…Ka7? loses to 2.a5! bxa5 3.Kxa5, when White gets the opposition). Then 2.Ka6 Kc6 3.Ka7 Kc7! 4.Ka8 Kc8! — Black keeps the HORIZONTAL opposition forever and the pawns never advance.",
    quote: { q: "Diagram 1-7 — White has the opposition, but it is not enough to win: 1…Kc7! holds.", a: "Dvoretsky's Endgame Manual" },
  },
  {
    id: "bk-mattison", chapter: 4, kind: "play", fen: "8/5p2/8/6Pk/5P2/8/8/7K w - - 0 1", answer: "draw", userPlays: "white", engine: true,
    title: "Mattison 1918 — sacrifice into opposition",
    text: "White's pawns are falling — but two pawn SACRIFICES clear the way to a drawn distant-opposition duel. You are White: give up both pawns the right way, then mirror the king.",
    explain: "1.g6! fxg6 2.f5! gxf5 3.Kg1! — and although Black holds the distant opposition for a moment, he can never convert it into the close opposition. The h-file corner and the f/g pawns' geometry save White.",
    quote: { q: "Diagram 1-9, H. Mattison 1918 — White saves himself with the distant opposition.", a: "Dvoretsky's Endgame Manual" },
  },
  {
    id: "bk-drtina", chapter: 4, kind: "play", fen: "8/4k3/3p4/3P4/2P5/8/8/5K2 w - - 0 1", answer: "win", userPlays: "white", engine: true,
    title: "Drtina 1907 — beyond the opposition",
    text: "The final exam (Expert level). Merely TAKING the opposition only draws here — White must win by OUTFLANKING: zig-zag the king up the board so Black can never both hold the opposition and stop the c/d pawns. You are White vs Stockfish.",
    explain: "1.Kg2! and then Kf2–Kg3–Kf3–Kg4… — the zig-zag denies Black a stable opposition. The lesson that closes the course: opposition is a tool, not the goal — what you're really fighting for is the breakthrough squares.",
    quote: { q: "Diagram 1-10, J. Drtina 1907 — merely taking the opposition only draws; White wins by outflanking.", a: "Dvoretsky's Endgame Manual" },
  },
];

function loadDone(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveDone(done: Set<string>) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done])); } catch { /* */ }
}

type Phase = "task" | "revealed" | "playing" | "playdone";

export default function OppositionTrainer() {
  const [ready, setReady] = useState(false);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [phase, setPhase] = useState<Phase>("task");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [finished, setFinished] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const step = STEPS[idx]!;
  const goal = step.answer;
  const kings = useMemo(() => kingSquares(step.fen), [step]);

  const game = useRef(new Chess());
  const [fen, setFen] = useState(step.fen);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [boardKey, setBoardKey] = useState(0);

  const engineRef = useRef<Engine | null>(null);
  const getEngine = useCallback((): Engine => {
    if (!engineRef.current) engineRef.current = createEngine();
    return engineRef.current;
  }, []);
  useEffect(() => () => { engineRef.current?.quit(); }, []);

  useEffect(() => {
    ensureOracle().then(() => setReady(true)).catch(() => setMsg("Couldn't load the endgame tablebase."));
  }, []);

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

  const answerVerdict = useCallback((win: boolean) => {
    if (phase !== "task") return;
    setCorrect((win ? "win" : "draw") === step.answer);
    setPhase("revealed"); markDone();
  }, [phase, step, markDone]);

  const toggleTap = useCallback((sqName: string) => {
    if (phase !== "task") return;
    setSelected((prev) => { const n = new Set(prev); if (n.has(sqName)) n.delete(sqName); else n.add(sqName); return n; });
  }, [phase]);

  const checkTap = useCallback(() => {
    if (phase !== "task" || !step.targets) return;
    setCorrect(setEq(selected, step.targets));
    setPhase("revealed"); markDone();
  }, [phase, step, selected, markDone]);

  // ── play it out ──
  const finishPlay = useCallback((won: boolean, text: string) => {
    setPhase("playdone"); setCorrect(won); setMsg(text);
    if (won) markDone();
  }, [markDone]);

  const checkTerminal = useCallback((): boolean => {
    const f = game.current.fen();
    const pl = f.split(/\s+/)[0] ?? "";
    const promoted = /[QRBN]/.test(pl) ? "white" : /[qrbn]/.test(pl) ? "black" : null;
    if (promoted) {
      // a spite-promotion that hangs to an immediate recapture decides nothing — play on
      if (game.current.moves({ verbose: true }).some((m) => m.captured && m.captured !== "p")) return false;
      const mine = promoted === step.userPlays;
      finishPlay(mine, mine ? "The pawn queens — promoted! 🎉" : goal === "draw" ? "A pawn queened — the defence broke. Try again ↻" : "The defender queened first. Try again ↻");
      return true;
    }
    if (game.current.isCheckmate()) {
      const winner = game.current.turn() === "w" ? "black" : "white";
      finishPlay(winner === step.userPlays, winner === step.userPlays ? "Checkmate! 🎉" : "Checkmated. Try again ↻");
      return true;
    }
    if (game.current.isStalemate() || game.current.isDraw()) {
      const how = game.current.isStalemate() ? "Stalemate" : "Draw";
      finishPlay(goal === "draw", goal === "draw" ? `${how} — held! 🛡️` : `${how} — the win slipped. Try again ↻`);
      return true;
    }
    if (!/[Pp]/.test(pl)) {
      finishPlay(goal === "draw", goal === "draw" ? "All pawns gone — draw held! 🛡️" : "No pawns left — no win. Try again ↻");
      return true;
    }
    if (!step.engine) {
      // KPK — the oracle flags a thrown result instantly
      const r = resultAfter(f);
      if (r && ((goal === "win" && r === "draw") || (goal === "draw" && r === "win"))) {
        finishPlay(false, goal === "win" ? "That throws the win — opposition lost. Try again ↻" : "That loses — the king breaks through. Try again ↻");
        return true;
      }
    }
    return false;
  }, [goal, step, finishPlay]);

  const opponentMove = useCallback(async () => {
    let from = "", to = "", promo = "q";
    if (step.engine) {
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
    if (stm !== step.userPlays) setTimeout(() => void opponentMove(), 300);
  }, [step, opponentMove]);

  const onMove = useCallback((from: Key, to: Key) => {
    if (phase !== "playing") return;
    let mv: unknown = null;
    try { mv = game.current.move({ from, to, promotion: "q" }); } catch { mv = null; }
    if (!mv) { setFen(game.current.fen()); return; }
    setLastMove([from, to]); setFen(game.current.fen());
    if (checkTerminal()) return;
    setTimeout(() => void opponentMove(), 300);
  }, [phase, checkTerminal, opponentMove]);

  const myTurn = phase === "playing" && !game.current.isGameOver() &&
    ((game.current.turn() === "w" ? "white" : "black") === step.userPlays);
  const dests = useMemo(() => (myTurn ? destsFromChess(game.current as never) : new Map()), [fen, myTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── overlay ──
  const shapes: DrawShape[] = useMemo(() => {
    if (step.kind === "tap") {
      if (phase === "task") return [...selected].map((c) => ({ orig: c as Key, brush: "blue" }));
      if (phase !== "revealed" || !step.targets) return [];
      const s: DrawShape[] = [];
      const corr = new Set(step.targets);
      for (const c of step.targets) s.push({ orig: c as Key, brush: selected.has(c) ? "green" : "purple" });
      for (const c of selected) if (!corr.has(c)) s.push({ orig: c as Key, brush: "red" });
      // the opposition line: mover's king → the target square, and on to the enemy king
      if (kings.K && kings.k && step.targets[0]) s.push({ orig: step.targets[0] as Key, dest: (step.fen.includes(" b ") ? kings.K : kings.k) as Key, brush: "paleBlue" });
      return s;
    }
    if (step.kind === "verdict" && phase === "revealed" && kings.K && kings.k) {
      return [{ orig: kings.K as Key, dest: kings.k as Key, brush: "paleBlue" }];
    }
    return [];
  }, [step, phase, selected, kings]);

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
      <div className="text-5xl">🤝</div>
      <h1 className="mt-4 text-2xl font-bold text-white">Opposition mastered!</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-300">
        Direct, distant and very distant — plus the book classics: Neustadtl's only move, Dvoretsky's holds, Mattison's sacrifices and Drtina's outflanking.
        Keep it sharp:
      </p>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <a href="/study/pawn-endgames" className="rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">♟ Rated Pawn Endgames →</a>
        <a href="/study/promote" className="rounded-lg border border-ink-700 px-4 py-2.5 font-semibold text-ink-200 hover:bg-ink-800">👑 Promote One Pawn</a>
        <a href="/book" className="rounded-lg border border-ink-700 px-4 py-2.5 font-semibold text-ink-200 hover:bg-ink-800">📖 The Book tab</a>
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
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">🤝 Opposition · guided course</h1>
        <p className="mt-1 text-sm text-ink-400">Direct, distant and very distant opposition — then the book classics, played out on the board.</p>
      </div>

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

            {phase === "task" && step.kind === "verdict" && (
              <div className="mt-4 flex gap-2">
                <button onClick={() => answerVerdict(true)} className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-500">Win</button>
                <button onClick={() => answerVerdict(false)} className="flex-1 rounded-lg bg-sky-600 px-4 py-3 font-bold text-white hover:bg-sky-500">Draw</button>
              </div>
            )}

            {phase === "task" && step.kind === "tap" && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="text-sm text-ink-300">Selected: <b className="text-sky-300">{selected.size}</b></div>
                <button onClick={checkTap} className="rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Check</button>
                <button onClick={() => setSelected(new Set())} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Clear</button>
              </div>
            )}

            {phase === "task" && step.kind === "play" && (
              <button onClick={startPlay} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">
                ▶ Play ({step.userPlays} · {goal === "win" ? "win it" : "hold the draw"})
              </button>
            )}

            {phase === "revealed" && (
              <div className="mt-4">
                <div className={`text-lg font-bold ${correct ? "text-emerald-400" : "text-rose-400"}`}>{correct ? "Correct! ✓" : "Not quite —"}</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-300">{step.explain}</p>
                {step.quote && (
                  <blockquote className="mt-3 border-l-2 border-brand-500 pl-3">
                    <p className="text-sm italic text-ink-200">“{step.quote.q}”</p>
                    <footer className="mt-1 text-xs text-ink-500">— {step.quote.a}</footer>
                  </blockquote>
                )}
                <button onClick={advance} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Continue →</button>
              </div>
            )}

            {phase === "playing" && (
              <div className="mt-4">
                <div className="text-sm font-semibold text-white">You are {step.userPlays}. Goal: {goal === "win" ? "win — promote and mate." : "hold the draw."}</div>
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
                    {step.quote && (
                      <blockquote className="mt-3 border-l-2 border-brand-500 pl-3">
                        <p className="text-sm italic text-ink-200">“{step.quote.q}”</p>
                        <footer className="mt-1 text-xs text-ink-500">— {step.quote.a}</footer>
                      </blockquote>
                    )}
                    <button onClick={advance} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Continue →</button>
                  </>
                ) : (
                  <button onClick={startPlay} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">↻ Try again</button>
                )}
              </div>
            )}
          </div>

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
