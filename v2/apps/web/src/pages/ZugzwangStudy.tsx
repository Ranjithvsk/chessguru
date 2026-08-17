// Zugzwang study chapter.
//
// Two modes:
//   • Study — browsable gallery: pattern-filter pills + position list + board
//     with best move + mechanism + source revealed on click.
//   • Practice — rush flow: continuous rating-matched serve, streak counter,
//     auto-advance on correct, retry/next on wrong. Feels like a real trainer,
//     not a "guess-then-look."

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";
import { studyComplete, studyMe } from "../lib/api";
import {
  ZUGZWANG_POSITIONS, ZUGZWANG_PATTERNS,
  type ZugzwangPattern, type ZugzwangPosition,
} from "../lib/zugzwangCorpus";

type Mode = "study" | "practice";
type Verdict = null | "correct" | "wrong";

function turnOf(fen: string): "white" | "black" {
  return (fen.split(/\s+/)[1] ?? "w") === "w" ? "white" : "black";
}

interface Session {
  streak: number;
  bestStreak: number;
  solved: number;
  wrong: number;
  seenIds: Set<string>;
  startAt: number;
}
const freshSession = (): Session => ({
  streak: 0, bestStreak: 0, solved: 0, wrong: 0, seenIds: new Set(), startAt: Date.now(),
});

export default function ZugzwangStudyPage() {
  const [mode, setMode] = useState<Mode>("study");
  const [activePattern, setActivePattern] = useState<ZugzwangPattern | "all">("all");
  const [activeId, setActiveId] = useState<string>(ZUGZWANG_POSITIONS[0]!.id);
  const [revealed, setRevealed] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingNb, setRatingNb] = useState<number>(0);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const [guest, setGuest] = useState<boolean>(true);
  const [session, setSession] = useState<Session>(freshSession);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    studyMe("zugzwang").then((r) => { setRating(r.rating); setRatingNb(r.nb); setGuest(r.guest); }).catch(() => { /* rating optional */ });
    return () => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); };
  }, []);

  const pool = useMemo(
    () => activePattern === "all"
      ? ZUGZWANG_POSITIONS
      : ZUGZWANG_POSITIONS.filter((p) => p.pattern === activePattern),
    [activePattern],
  );

  const active = useMemo(
    () => ZUGZWANG_POSITIONS.find((p) => p.id === activeId) ?? ZUGZWANG_POSITIONS[0]!,
    [activeId],
  );

  const chess = useMemo(() => new Chess(active.fen), [active.fen]);
  const turn = turnOf(active.fen);

  const pickNext = useCallback((exclude: Set<string>): ZugzwangPosition => {
    const unseen = pool.filter((p) => !exclude.has(p.id));
    // If pool exhausted, start over with a fresh set (loop forever in practice).
    const src = unseen.length ? unseen : pool;
    return src[Math.floor(Math.random() * src.length)] ?? pool[0]!;
  }, [pool]);

  const startPractice = useCallback(() => {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    const s = freshSession();
    const first = pickNext(s.seenIds);
    setSession(s);
    setActiveId(first.id);
    setRevealed(false);
    setVerdict(null);
    setLastDelta(null);
    setMode("practice");
  }, [pickNext]);

  const serveNext = useCallback(() => {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setSession((prev) => {
      const seen = new Set(prev.seenIds).add(activeId);
      const next = pickNext(seen);
      setActiveId(next.id);
      setRevealed(false);
      setVerdict(null);
      setLastDelta(null);
      return { ...prev, seenIds: seen };
    });
  }, [activeId, pickNext]);

  const retry = useCallback(() => {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setRevealed(false);
    setVerdict(null);
  }, []);

  function selectFromList(pos: ZugzwangPosition) {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setActiveId(pos.id);
    setRevealed(false);
    setVerdict(null);
    setLastDelta(null);
  }

  function onUserMove(from: Key, to: Key) {
    const uci = String(from) + String(to);
    const target = active.bestMoveUci;
    const matches = uci === target || (target.length === 5 && uci === target.slice(0, 4));
    setVerdict(matches ? "correct" : "wrong");
    if (!matches) setRevealed(true);
    if (mode === "practice") {
      // Update rating in the background
      const currentRating = rating ?? 1200;
      studyComplete(active.id, matches, currentRating)
        .then((res) => { setLastDelta(res.ratingDiff); setRating(res.rating); setRatingNb((n) => n + 1); })
        .catch(() => { /* rating update optional */ });
      // Update session stats
      setSession((prev) => matches
        ? { ...prev, streak: prev.streak + 1, bestStreak: Math.max(prev.bestStreak, prev.streak + 1), solved: prev.solved + 1 }
        : { ...prev, streak: 0, wrong: prev.wrong + 1 });
      // Auto-advance on correct
      if (matches) {
        if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
        advanceTimer.current = window.setTimeout(() => { serveNext(); }, 1200);
      }
    }
  }

  const canMove = mode === "practice" && verdict === null;
  const dests = canMove ? destsFromChess(chess) : new Map();
  const movable = canMove ? turn : undefined;

  // ─── Render ────────────────────────────────────────────────────────────

  const header = (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Endgame theme</div>
        <h1 className="font-display text-3xl text-white">Zugzwang</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          The move you don't want to make. Curated from Wikipedia, Sämisch–Nimzowitsch 1923, Fischer's
          <em> My 60 Memorable Games</em>, the Lucena / Saavedra / Réti classics, van Perlo, Rinck.
          {' '}{ZUGZWANG_POSITIONS.length} positions across {ZUGZWANG_PATTERNS.length} pattern classes.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {rating != null && (
          <div className="rounded-full bg-brand-500/15 px-3 py-1 text-xs font-semibold text-brand-100" title={`${ratingNb} attempts${guest ? " (guest — not saved)" : ""}`}>
            ★ {rating}{lastDelta != null && <span className={`ml-1 ${lastDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>({lastDelta >= 0 ? "+" : ""}{lastDelta})</span>}
          </div>
        )}
        <div className="flex overflow-hidden rounded-lg border border-ink-700 text-xs font-semibold">
          <button
            type="button" onClick={() => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); setMode("study"); setRevealed(false); setVerdict(null); }}
            className={`px-3 py-1.5 ${mode === "study" ? "bg-brand-500/25 text-brand-100" : "bg-ink-900 text-ink-400 hover:bg-ink-800"}`}
          >📖 Study</button>
          <button
            type="button" onClick={startPractice}
            className={`px-3 py-1.5 ${mode === "practice" ? "bg-emerald-500/25 text-emerald-100" : "bg-ink-900 text-ink-400 hover:bg-ink-800"}`}
          >🎯 Practice</button>
        </div>
      </div>
    </div>
  );

  const patternPills = (
    <div className="mb-4 flex flex-wrap gap-2">
      <button
        type="button" onClick={() => setActivePattern("all")}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${activePattern === "all" ? "bg-brand-500/25 text-brand-100" : "bg-ink-800 text-ink-400 hover:bg-ink-700"}`}
      >All ({ZUGZWANG_POSITIONS.length})</button>
      {ZUGZWANG_PATTERNS.map((p) => {
        const count = ZUGZWANG_POSITIONS.filter((x) => x.pattern === p.id).length;
        if (count === 0) return null;
        return (
          <button
            key={p.id} type="button" onClick={() => setActivePattern(p.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${activePattern === p.id ? "bg-brand-500/25 text-brand-100" : "bg-ink-800 text-ink-400 hover:bg-ink-700"}`}
            title={p.blurb}
          >{p.label} ({count})</button>
        );
      })}
    </div>
  );

  // ─── Practice mode ─────────────────────────────────────────────────────

  if (mode === "practice") {
    const accuracy = session.solved + session.wrong === 0 ? 0 : Math.round((session.solved / (session.solved + session.wrong)) * 100);
    const boardBorder = verdict === "correct" ? "border-emerald-500 shadow-[0_0_40px_-10px_rgba(52,211,153,0.5)]"
      : verdict === "wrong" ? "border-rose-500 shadow-[0_0_40px_-10px_rgba(244,63,94,0.5)]"
      : "border-brand-500";
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        {header}
        {patternPills}

        {/* Stats bar */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-orange-300">Streak</div>
            <div className="mt-1 flex items-center justify-center gap-1 text-2xl font-bold text-orange-100 tabular-nums">
              🔥 {session.streak}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300">Solved</div>
            <div className="mt-1 text-2xl font-bold text-emerald-100 tabular-nums">✓ {session.solved}</div>
          </div>
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-rose-300">Missed</div>
            <div className="mt-1 text-2xl font-bold text-rose-100 tabular-nums">✗ {session.wrong}</div>
          </div>
          <div className="rounded-xl border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-brand-300">Accuracy</div>
            <div className="mt-1 text-2xl font-bold text-brand-100 tabular-nums">{accuracy}%</div>
          </div>
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-amber-300">Best</div>
            <div className="mt-1 text-2xl font-bold text-amber-100 tabular-nums">🏆 {session.bestStreak}</div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(360px,3fr)_minmax(260px,2fr)]">
          {/* Big centered board */}
          <div className={`rounded-2xl border-2 p-4 transition-all ${boardBorder} bg-ink-900`}>
            <div className={`mb-3 rounded-lg px-3 py-2 text-center text-sm font-bold ${
              verdict === "correct" ? "bg-emerald-500/25 text-emerald-100"
              : verdict === "wrong" ? "bg-rose-500/25 text-rose-100"
              : "bg-brand-500/20 text-brand-100"
            }`}>
              {verdict === "correct" && <>✓ Correct — <span className="font-mono">{active.bestMoveSan}</span>{lastDelta != null && <span className="ml-2 text-emerald-300">+{lastDelta}</span>} · next in a moment…</>}
              {verdict === "wrong" && <>✗ Not this one — best was <span className="font-mono">{active.bestMoveSan}</span>{lastDelta != null && <span className="ml-2 text-rose-300">{lastDelta}</span>}</>}
              {!verdict && <>🎯 {turn === "white" ? "White" : "Black"} to move — drag a piece</>}
            </div>
            <Board
              fen={active.fen}
              orientation={turn}
              turnColor={turn}
              movableColor={movable}
              dests={dests}
              onMove={onUserMove}
              coordinates
              showDests
            />
            {verdict === "wrong" && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={retry}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
                >↻ Retry this one</button>
                <button type="button" onClick={serveNext}
                  className="rounded-lg bg-ink-700 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-600"
                >Next →</button>
              </div>
            )}
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">
                {ZUGZWANG_PATTERNS.find((x) => x.id === active.pattern)?.label} · ★ {active.difficulty}
              </div>
              <h2 className="mt-1 font-display text-lg text-white">{active.name}</h2>
              {!revealed && !verdict && (
                <p className="mt-2 text-sm text-ink-400">
                  {active.outcome ? `Goal: ${active.outcome}` : "Find the best move."}
                </p>
              )}
              {revealed && (
                <>
                  <p className="mt-3 text-sm text-ink-300">{active.mechanism}</p>
                  <p className="mt-2 text-xs text-ink-500">Source: {active.source}</p>
                </>
              )}
            </div>
            <button type="button" onClick={startPractice}
              className="w-full rounded-lg border border-ink-700 bg-ink-900 px-4 py-2 text-sm font-semibold text-ink-300 hover:bg-ink-800"
            >⟲ Restart session</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Study mode ────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {header}
      {patternPills}

      <div className="grid gap-6 md:grid-cols-[minmax(280px,1fr)_minmax(360px,2fr)]">
        <div className="space-y-2">
          {pool.map((p) => (
            <button
              key={p.id} type="button" onClick={() => selectFromList(p)}
              className={`block w-full rounded-lg border p-3 text-left transition ${p.id === activeId ? "border-brand-500 bg-brand-500/10" : "border-ink-700 bg-ink-900 hover:border-ink-500"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{p.name}</span>
                <span className="shrink-0 rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-ink-400">★ {p.difficulty}</span>
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-500">
                {ZUGZWANG_PATTERNS.find((x) => x.id === p.pattern)?.label}
              </div>
            </button>
          ))}
        </div>

        <div>
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
            <Board
              fen={active.fen}
              orientation={turn}
              turnColor={turn}
              coordinates
            />
            <div className="mt-3 text-xs">
              <span className="rounded-full bg-ink-800 px-2 py-1 text-ink-300">
                {turn === "white" ? "White" : "Black"} to move
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
            <h2 className="font-display text-lg text-white">{active.name}</h2>
            <p className="mt-1 text-xs uppercase tracking-wide text-brand-400">
              {ZUGZWANG_PATTERNS.find((x) => x.id === active.pattern)?.label} · ★ {active.difficulty}
            </p>
            <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
              Best move: <span className="font-mono font-bold">{active.bestMoveSan}</span>
              {active.outcome && <span className="ml-2 text-ink-300">— {active.outcome}</span>}
            </div>
            <p className="mt-3 text-sm text-ink-300">{active.mechanism}</p>
            <p className="mt-2 text-xs text-ink-500">Source: {active.source}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
