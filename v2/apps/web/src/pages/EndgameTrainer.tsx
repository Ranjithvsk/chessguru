// Endgame trainer — "Rule of the Square" & K+P vs K. A Yes/No question ("will the pawn
// promote?"), then the square is drawn as proof, then you can play it out against the
// exact KPK oracle. Positions are rating-matched from the study API (separate endgame
// rating) or drawn from a chosen endgame book with the author's own words; all
// correctness comes from the in-app tablebase (offline, instant).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board, { destsFromChess } from "../components/Board";
import {
  ensureOracle, generatePuzzle, buildPuzzle, evaluateKPK, resultAfter,
  type EndgamePuzzle,
} from "../lib/endgame/oracle";
import { studyPuzzle, studyMe, studyBooks, studyComplete, type StudyBook } from "../lib/api";

const SOLVED_KEY = "cg_endgame_solved";
const STUDY_TYPE = "kpk";

// Book-position meta carried alongside a server puzzle (author's words).
interface BookMeta { book: string | null; author: string | null; quote: string | null; topic: string | null; }

function kingSquares(fen: string): { K: string; k: string } {
  const rows = (fen.split(/\s+/)[0] ?? "").split("/");
  let K = "", kk = "";
  for (let r = 0; r < 8; r++) { let f = 0; for (const ch of (rows[7 - r] ?? "")) { if (/\d/.test(ch)) { f += +ch; continue; } const name = ("abcdefgh"[f] ?? "?") + (r + 1); if (ch === "K") K = name; else if (ch === "k") kk = name; f++; } }
  return { K, k: kk };
}

type Phase = "loading" | "question" | "revealed" | "playing" | "result";

export default function EndgameTrainer() {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [puzzle, setPuzzle] = useState<EndgamePuzzle | null>(null);
  const [solved, setSolved] = useState<number>(() => { try { return Number(localStorage.getItem(SOLVED_KEY)) || 0; } catch { return 0; } });
  const [correct, setCorrect] = useState<boolean | null>(null);   // answer feedback
  const [msg, setMsg] = useState("");

  // separate endgame rating (study API, type "kpk")
  const [rating, setRating] = useState(1200);
  const ratingRef = useRef(1200);
  const [nb, setNb] = useState(0);
  const [guest, setGuest] = useState(true);
  const [delta, setDelta] = useState<number | null>(null);   // last rating change

  // book selector + current puzzle's book meta
  const [books, setBooks] = useState<StudyBook[]>([]);
  const [book, setBook] = useState("");                       // "" = rating-matched practice
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [pzRating, setPzRating] = useState<number | null>(null);   // difficulty rating of the suggested puzzle
  const serverId = useRef<string | null>(null);              // study_puzzles _id for /complete
  const scored = useRef(false);                              // rate a given puzzle at most once

  // play-it-out state
  const game = useRef(new Chess());
  const [fen, setFen] = useState("");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [playing, setPlaying] = useState(false);
  const [boardKey, setBoardKey] = useState(0);   // fresh chessground per puzzle (no stale interactivity state)

  const nextPuzzle = useCallback(async (bk = book) => {
    setDelta(null);
    let posFen = "", id: string | null = null, bm: BookMeta | null = null, pr: number | null = null;
    try {
      const sp = await studyPuzzle(STUDY_TYPE, ratingRef.current, undefined, bk || undefined);
      if (sp) { posFen = sp.fen; id = sp.id; pr = sp.rating; bm = { book: sp.book ?? null, author: sp.author ?? null, quote: sp.quote ?? null, topic: sp.topic ?? null }; }
    } catch { /* offline / API down — fall back to the client generator below */ }
    if (!posFen) {
      const c = generatePuzzle("square_basic") ?? generatePuzzle("double_step");
      if (!c) return;
      posFen = c.fen; id = null; bm = null; pr = null;
    }
    const style: "promote" | "catch" = Math.random() < 0.5 ? "promote" : "catch";
    const p = buildPuzzle(posFen, { style });
    serverId.current = id; scored.current = false;
    setMeta(bm); setPzRating(pr);
    setPuzzle(p);
    game.current = new Chess(p.fen);
    setFen(p.fen); setLastMove(undefined); setCorrect(null); setMsg(""); setPlaying(false);
    setBoardKey((k) => k + 1);
    setPhase("question");
  }, [book]);

  useEffect(() => {
    let alive = true;
    ensureOracle()
      .then(async () => {
        if (!alive) return;
        try {
          const [me, bks] = await Promise.all([studyMe(STUDY_TYPE), studyBooks(STUDY_TYPE)]);
          if (!alive) return;
          setRating(me.rating); ratingRef.current = me.rating; setNb(me.nb); setGuest(me.guest);
          setBooks(bks ?? []);
        } catch { /* ratings/books are best-effort */ }
        setReady(true);
        await nextPuzzle();
      })
      .catch(() => setMsg("Couldn't load the endgame tablebase."));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── record the solve on the study API (separate endgame rating) ──
  const scoreOnce = useCallback(async (win: boolean) => {
    if (scored.current) return;
    scored.current = true;
    const id = serverId.current;
    if (!id) return;                          // offline/generated puzzle — local progress only
    try {
      const res = await studyComplete(id, win, ratingRef.current);
      setRating(res.rating); ratingRef.current = res.rating; setDelta(res.ratingDiff);
      setNb((n) => n + 1);
    } catch { /* keep going — never block practice on a rating write */ }
  }, []);

  // ── answer the Yes/No question ──
  const answer = useCallback((yes: boolean) => {
    if (!puzzle || phase !== "question") return;
    const right = yes === puzzle.answer;
    setCorrect(right);
    const ns = solved + 1; setSolved(ns); try { localStorage.setItem(SOLVED_KEY, String(ns)); } catch { /* */ }
    void scoreOnce(right);
    setMsg(right ? "Correct!" : "Not quite —");
    setPhase("revealed");
  }, [puzzle, phase, solved, scoreOnce]);

  // ── square overlay shapes (drawn on reveal / during play) ──
  const shapes: DrawShape[] = useMemo(() => {
    if (!puzzle || phase === "question") return [];
    const s: DrawShape[] = puzzle.overlay.squareCells.map((c) => ({ orig: c as Key, brush: "yellow" }));
    const ks = kingSquares(puzzle.fen);
    s.push({ orig: puzzle.overlay.promotionSquare as Key, brush: "blue" });
    s.push({ orig: puzzle.overlay.pawn as Key, dest: puzzle.overlay.promotionSquare as Key, brush: "green" });
    const defKing = puzzle.defender === "white" ? ks.K : ks.k;
    if (defKing) s.push({ orig: defKing as Key, dest: puzzle.overlay.promotionSquare as Key, brush: "red" });
    return s;
  }, [puzzle, phase]);

  // ── play it out against the oracle ──
  const startPlay = useCallback(() => {
    if (!puzzle) return;
    game.current = new Chess(puzzle.fen);
    setFen(puzzle.fen); setLastMove(undefined); setMsg("");
    setPlaying(true); setPhase("playing");
    // if it's the opponent's move first, let the oracle move
    if (puzzle.sideToMove !== puzzle.playItOut.userPlays) setTimeout(() => oracleMove(), 250);
  }, [puzzle]);

  const finishPlay = useCallback((won: boolean, text: string) => { setPlaying(false); setPhase("result"); setMsg(text); setCorrect(won); }, []);

  const checkTerminal = useCallback((): boolean => {
    if (!puzzle) return true;
    const f = game.current.fen();
    const r = resultAfter(f);          // interprets promotion (win) / capture (draw) / ongoing
    const goal = puzzle.playItOut.goal;
    // left KPK domain?
    const pl = f.split(/\s+/)[0] ?? "";
    const queened = /[Qq]/.test(pl), noPawn = !/[Pp]/.test(pl);
    if (queened) { finishPlay(goal === "win", goal === "win" ? "The pawn queens — you won it! 🎉" : "The pawn queened — the defence broke. Try again ↻"); return true; }
    if (noPawn) { finishPlay(goal === "draw", goal === "draw" ? "Pawn caught — draw held! 🛡️" : "You lost the pawn — no win left. Try again ↻"); return true; }
    if (game.current.isCheckmate()) { finishPlay(goal === "win", "Checkmate! 🎉"); return true; }
    if (game.current.isStalemate() || game.current.isDraw()) { finishPlay(goal === "draw", goal === "draw" ? "Draw held! 🛡️" : "Stalemate — the win slipped. Try again ↻"); return true; }
    // still KPK — did the mover throw the result?
    if (r && ((goal === "win" && r === "draw") || (goal === "draw" && r === "win"))) {
      finishPlay(false, goal === "win" ? "That throws the win — the king escapes. Try again ↻" : "That lets the pawn through — try again ↻");
      return true;
    }
    return false;
  }, [puzzle, finishPlay]);

  const oracleMove = useCallback(() => {
    if (!puzzle) return;
    const e = evaluateKPK(game.current.fen());
    if (!e.legal || !e.bestMove) { checkTerminal(); return; }
    try {
      game.current.move({ from: e.bestMove.from, to: e.bestMove.to, promotion: (e.bestMove.promotion as "q") || "q" });
      setLastMove([e.bestMove.from as Key, e.bestMove.to as Key]); setFen(game.current.fen());
    } catch { /* */ }
    checkTerminal();
  }, [puzzle, checkTerminal]);

  const onMove = useCallback((from: Key, to: Key) => {
    if (!puzzle || phase !== "playing") return;
    let mv: unknown = null;
    try { mv = game.current.move({ from, to, promotion: "q" }); } catch { mv = null; }
    if (!mv) { setFen(game.current.fen()); return; }
    setLastMove([from, to]); setFen(game.current.fen());
    if (checkTerminal()) return;
    setTimeout(() => oracleMove(), 300);
  }, [puzzle, phase, checkTerminal, oracleMove]);

  const userColor = puzzle?.playItOut.userPlays;
  const myTurn = phase === "playing" && playing && !game.current.isGameOver() &&
    ((game.current.turn() === "w" ? "white" : "black") === userColor);
  const dests = useMemo(() => (myTurn ? destsFromChess(game.current as never) : new Map()), [fen, myTurn]);

  const onPickBook = useCallback((v: string) => { setBook(v); void nextPuzzle(v); }, [nextPuzzle]);

  if (!ready) return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="text-lg font-semibold text-ink-200">Preparing the endgame tablebase…</div>
      <div className="mt-2 text-sm text-ink-400">Computing every King + Pawn vs King position (once — then it's cached & offline).</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">🏁 Endgame trainer · Rule of the Square</h1>
          <p className="mt-1 text-sm text-ink-400">Can the king catch the pawn? Answer, then see the square — and play it out.</p>
        </div>
        <div className="text-right text-sm text-ink-300">
          <div className="flex items-center justify-end gap-1.5">
            <span>Endgame rating:</span>
            <b className="text-white">{rating}</b>
            {delta !== null && <span className={delta >= 0 ? "text-emerald-400" : "text-rose-400"}>{delta >= 0 ? `+${delta}` : delta}</span>}
          </div>
          <div className="text-ink-400">Solved: {solved}{guest ? " · sign in to save your rating" : nb ? ` · ${nb} rated` : ""}</div>
        </div>
      </div>

      {/* Practice mode: rating-matched, or a specific book's famous positions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-ink-500">Practice</label>
        <select
          value={book}
          onChange={(e) => onPickBook(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-100 focus:border-brand-500 focus:outline-none"
        >
          <option value="">🎯 Rating-matched positions</option>
          {books.map((b) => (
            <option key={b.book} value={b.book}>📖 {b.book} ({b.n})</option>
          ))}
        </select>
        {book && <span className="text-xs text-ink-500">Famous positions from this book — with the author's words.</span>}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="cg-board-host">
          <Board
            key={boardKey}
            fen={fen}
            orientation={userColor ?? (puzzle?.attacker === "black" ? "black" : "white")}
            turnColor={game.current.turn() === "w" ? "white" : "black"}
            movableColor={myTurn ? userColor : undefined}
            dests={dests}
            lastMove={lastMove}
            shapes={shapes}
            onMove={onMove}
          />
        </div>

        <aside className="flex flex-col gap-3">
          {puzzle && (phase === "question") && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-wide text-ink-500">{meta?.topic ?? (meta?.book ? "Endgame study" : "K + P vs K")}</div>
                {pzRating !== null && (
                  <span className="rounded-full bg-ink-800 px-2 py-0.5 text-xs font-semibold text-ink-200" title={book ? "Difficulty rating of this book position" : "Matched to your endgame rating (±175)"}>
                    Rated {pzRating}
                  </span>
                )}
              </div>
              {pzRating !== null && !book && (
                <div className="mt-1 text-[11px] text-ink-500">
                  {pzRating > rating + 60 ? "A notch above your level ↑" : pzRating < rating - 60 ? "A warm-up below your level ↓" : "Matched to your rating"}
                </div>
              )}
              <div className="mt-1 text-lg font-semibold text-white">{puzzle.question}</div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => answer(true)} className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-500">Yes</button>
                <button onClick={() => answer(false)} className="flex-1 rounded-lg bg-rose-600 px-4 py-3 font-bold text-white hover:bg-rose-500">No</button>
              </div>
            </div>
          )}

          {puzzle && (phase === "revealed") && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className={`text-lg font-bold ${correct ? "text-emerald-400" : "text-rose-400"}`}>{msg} {correct ? "" : `it ${puzzle.promotes ? "promotes" : "is caught"}.`}</div>
              {meta?.quote && (
                <blockquote className="mt-3 border-l-2 border-brand-500 pl-3">
                  <p className="text-sm italic text-ink-200">“{meta.quote}”</p>
                  <footer className="mt-1 text-xs text-ink-500">— {meta.author}{meta.book ? `, ${meta.book}` : ""}{meta.topic ? ` · ${meta.topic}` : ""}</footer>
                </blockquote>
              )}
              <p className="mt-2 text-sm text-ink-300">{puzzle.explanation}</p>
              <div className="mt-2 text-xs text-ink-500">The shaded squares are the pawn's <b>square</b>. Green = the pawn's run, red = the king's chase.</div>
              <div className="mt-4 flex flex-col gap-2">
                <button onClick={startPlay} className="rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">▶ Play it out ({puzzle.playItOut.userPlays})</button>
                <button onClick={() => nextPuzzle()} className="rounded-lg border border-ink-700 px-4 py-2.5 font-semibold text-ink-200 hover:bg-ink-800">Next position ↻</button>
              </div>
            </div>
          )}

          {puzzle && (phase === "playing") && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className="text-sm font-semibold text-white">You are {puzzle.playItOut.userPlays}. Goal: {puzzle.playItOut.goal === "win" ? "promote the pawn." : "catch the pawn / hold the draw."}</div>
              <div className="mt-2 text-sm text-ink-400">{msg || "Your move."}</div>
              <button onClick={() => nextPuzzle()} className="mt-4 w-full rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:bg-ink-800">Give up · Next ↻</button>
            </div>
          )}

          {puzzle && (phase === "result") && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className={`text-lg font-bold ${correct ? "text-emerald-400" : "text-rose-400"}`}>{msg}</div>
              <div className="mt-4 flex flex-col gap-2">
                <button onClick={startPlay} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800">Try again</button>
                <button onClick={() => nextPuzzle()} className="rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Next position ↻</button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
