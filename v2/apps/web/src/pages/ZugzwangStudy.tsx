// Zugzwang study chapter v1 — pattern-grouped gallery + practice mode over
// hand-verified positions from ZUGZWANG_POSITIONS.
//
// Two modes:
//   • Study — see position + explanation + reveal the best move
//   • Practice — hide answer, user plays a move on the board; correct = green,
//     wrong = reveal the answer + mechanism.

import { useEffect, useMemo, useState } from "react";
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

export default function ZugzwangStudyPage() {
  const [mode, setMode] = useState<Mode>("study");
  const [activePattern, setActivePattern] = useState<ZugzwangPattern | "all">("all");
  const [activeId, setActiveId] = useState<string>(ZUGZWANG_POSITIONS[0]!.id);
  const [revealed, setRevealed] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [attemptedUci, setAttemptedUci] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingNb, setRatingNb] = useState<number>(0);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const [guest, setGuest] = useState<boolean>(true);

  useEffect(() => {
    studyMe("zugzwang").then((r) => { setRating(r.rating); setRatingNb(r.nb); setGuest(r.guest); }).catch(() => { /* rating optional */ });
  }, []);

  const filtered = useMemo(
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

  function select(pos: ZugzwangPosition) {
    setActiveId(pos.id);
    setRevealed(false);
    setVerdict(null);
    setAttemptedUci(null);
    setLastDelta(null);
  }

  function onUserMove(from: Key, to: Key) {
    // Match against the recorded best move. Promotion moves in UCI carry the
    // piece as a lowercase suffix (e.g. "c7c8r"); if the user's move to the
    // last rank matches without suffix we accept any promotion-first-letter
    // prefix (the practice UI doesn't yet prompt for promotion piece).
    const uci = String(from) + String(to);
    setAttemptedUci(uci);
    const target = active.bestMoveUci;
    const matches = uci === target || (target.length === 5 && uci === target.slice(0, 4));
    setVerdict(matches ? "correct" : "wrong");
    if (!matches) setRevealed(true);
    // Submit result to Glicko rating engine (only in practice mode + only for
    // signed-in users — guest rating drifts but is not persisted).
    if (mode === "practice") {
      const currentRating = rating ?? 1200;
      studyComplete(active.id, matches, currentRating)
        .then((res) => {
          setLastDelta(res.ratingDiff);
          setRating(res.rating);
          setRatingNb((n) => n + 1);
        })
        .catch(() => { /* rating update optional — the UI still shows correct/wrong verdict */ });
    }
  }

  const dests = mode === "practice" && verdict !== "correct" ? destsFromChess(chess) : new Map();
  const movable = mode === "practice" && verdict !== "correct" ? turn : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Endgame theme</div>
          <h1 className="font-display text-3xl text-white">Zugzwang</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-400">
            The move you don't want to make. Curated from Wikipedia, Sämisch–Nimzowitsch 1923, Fischer's
            <em> My 60 Memorable Games</em>, the Lucena / Saavedra / Réti classics and Flear's pawn-ending manual.
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
              type="button" onClick={() => setMode("study")}
              className={`px-3 py-1.5 ${mode === "study" ? "bg-brand-500/25 text-brand-100" : "bg-ink-900 text-ink-400 hover:bg-ink-800"}`}
            >📖 Study</button>
            <button
              type="button" onClick={() => { setMode("practice"); setRevealed(false); setVerdict(null); setAttemptedUci(null); setLastDelta(null); }}
              className={`px-3 py-1.5 ${mode === "practice" ? "bg-emerald-500/25 text-emerald-100" : "bg-ink-900 text-ink-400 hover:bg-ink-800"}`}
            >🎯 Practice</button>
          </div>
        </div>
      </div>

      {/* pattern filter pills */}
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

      <div className="grid gap-6 md:grid-cols-[minmax(280px,1fr)_minmax(360px,2fr)]">
        {/* position list */}
        <div className="space-y-2">
          {filtered.map((p) => (
            <button
              key={p.id} type="button" onClick={() => select(p)}
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

        {/* board + detail panel */}
        <div>
          <div className={`rounded-xl border-2 p-4 ${mode === "practice" ? (verdict === "correct" ? "border-emerald-500 bg-emerald-500/5" : verdict === "wrong" ? "border-rose-500 bg-rose-500/5" : "border-brand-500 bg-brand-500/5") : "border-ink-700 bg-ink-900"}`}>
            {mode === "practice" && !verdict && (
              <div className="mb-3 rounded-lg bg-brand-500/20 px-3 py-2 text-center text-sm font-bold text-brand-100">
                🎯 Practice — {turn === "white" ? "White" : "Black"} to move. Drag a piece to answer.
              </div>
            )}
            <Board
              fen={active.fen}
              orientation={turn}
              turnColor={turn}
              movableColor={movable}
              dests={dests}
              onMove={onUserMove}
              coordinates
              showDests={mode === "practice"}
            />
            <div className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span className="rounded-full bg-ink-800 px-2 py-1 text-ink-300">
                {turn === "white" ? "White" : "Black"} to move
              </span>
              {mode === "practice" && !verdict && (
                <span className="text-ink-500">Play the correct move on the board.</span>
              )}
              {verdict === "correct" && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-1 font-semibold text-emerald-100">✓ Correct — {active.bestMoveSan}</span>
              )}
              {verdict === "wrong" && (
                <span className="rounded-full bg-rose-500/20 px-2 py-1 font-semibold text-rose-100">✗ Not this one — best was {active.bestMoveSan}</span>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
            <h2 className="font-display text-lg text-white">{active.name}</h2>
            <p className="mt-1 text-xs uppercase tracking-wide text-brand-400">
              {ZUGZWANG_PATTERNS.find((x) => x.id === active.pattern)?.label} · ★ {active.difficulty}
            </p>

            {mode === "study" || revealed ? (
              <>
                <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                  Best move: <span className="font-mono font-bold">{active.bestMoveSan}</span>
                  {active.outcome && <span className="ml-2 text-ink-300">— {active.outcome}</span>}
                </div>
                <p className="mt-3 text-sm text-ink-300">{active.mechanism}</p>
                <p className="mt-2 text-xs text-ink-500">Source: {active.source}</p>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-ink-400">
                  {active.outcome ? `Goal: ${active.outcome}` : "Find the best move."}
                </p>
                <button
                  type="button" onClick={() => setRevealed(true)}
                  className="mt-3 rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700"
                >Show answer</button>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-ink-500">
        v1 — 11 positions. Queen endgames, minor-piece endings, fortress-collapse, and domination classes coming next
        (needs book-look FEN verification for Averbakh / van Perlo / Müller diagrams).
      </p>
    </div>
  );
}
