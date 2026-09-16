// Triangulation — a Learn/Study chapter.
//
// The board here is not a lookalike: it is SharedClassBoard in local mode, the
// same component My Studies and the live class render, with the same
// ClassNotationPanel beside it. Moves you play on a position are recorded in
// the notation panel exactly as they are in a notebook chapter.
//
// Two modes:
//   • Study    — the book positions. A question to think about first, then the
//                mechanism, the author's line, the engine's verdict, and a
//                short discussion of the idea.
//   • Exercise — find the move. Play it on the board; the notation panel
//                records it and the answer is checked.
//
// Every position was verified with Stockfish before it was written down.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SharedClassBoard, {
  triggerClassBoardAction, triggerClassFlipOrientation, triggerClassSeek,
  useClassCursorInfo,
} from "../components/SharedClassBoard";
import { ClassNotationPanel } from "../components/ClassNotationPanel";
import type { LocalRoomState } from "../lib/localClassRoom";
import { studyComplete, studyMe } from "../lib/api";
import {
  TRIANGULATION_POSITIONS, TRIANGULATION_PATTERNS, TRIANGULATION_PRACTICE,
  type TriangulationPattern, type TriangulationPosition,
} from "../lib/triangulationCorpus";

type Mode = "study" | "practice";
type Verdict = null | "correct" | "wrong";

function turnOf(fen: string): "white" | "black" {
  return (fen.split(/\s+/)[1] ?? "w") === "w" ? "white" : "black";
}

function accepts(pos: TriangulationPosition, uci: string): boolean {
  if (uci === pos.bestMoveUci) return true;
  if (pos.bestMoveUci.length === 5 && uci === pos.bestMoveUci.slice(0, 4)) return true;
  return (pos.altMoveUci ?? []).some((a) => a === uci || (a.length === 5 && uci === a.slice(0, 4)));
}

interface Session {
  streak: number; bestStreak: number; solved: number; wrong: number;
  seenIds: Set<string>;
}
const freshSession = (): Session => ({ streak: 0, bestStreak: 0, solved: 0, wrong: 0, seenIds: new Set() });

function BoardChrome() {
  const { cursorIdx, historyLen } = useClassCursorInfo();
  const btn = "rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-sm text-ink-200 hover:border-ink-500 disabled:opacity-40";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button type="button" className={btn} title="Start position" onClick={() => triggerClassSeek(0)} disabled={cursorIdx === 0}>⏮</button>
      <button type="button" className={btn} title="Previous move" onClick={() => triggerClassBoardAction("stepBack")} disabled={cursorIdx === 0}>◀</button>
      <span className="px-1 font-mono text-xs text-ink-400">{cursorIdx} / {historyLen}</span>
      <button type="button" className={btn} title="Next move" onClick={() => triggerClassBoardAction("stepForward")}>▶</button>
      <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden />
      <button type="button" className={btn} title="Flip board" onClick={() => triggerClassFlipOrientation()}>🔄 Flip</button>
    </div>
  );
}

export default function TriangulationStudyPage() {
  const [mode, setMode] = useState<Mode>("study");
  const [activePattern, setActivePattern] = useState<TriangulationPattern | "all">("all");
  const [activeId, setActiveId] = useState<string>(TRIANGULATION_POSITIONS[0]!.id);
  const [revealed, setRevealed] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [played, setPlayed] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingNb, setRatingNb] = useState<number>(0);
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const [guest, setGuest] = useState<boolean>(true);
  const [session, setSession] = useState<Session>(freshSession);
  const answered = useRef(false);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    studyMe("triangulation").then((r) => { setRating(r.rating); setRatingNb(r.nb); setGuest(r.guest); })
      .catch(() => { /* rating optional */ });
    return () => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); };
  }, []);

  const pool = useMemo(
    () => activePattern === "all" ? TRIANGULATION_POSITIONS
      : TRIANGULATION_POSITIONS.filter((p) => p.pattern === activePattern),
    [activePattern],
  );
  const practicePool = useMemo(
    () => activePattern === "all" ? TRIANGULATION_PRACTICE
      : TRIANGULATION_PRACTICE.filter((p) => p.pattern === activePattern),
    [activePattern],
  );
  const active = useMemo(
    () => TRIANGULATION_POSITIONS.find((p) => p.id === activeId) ?? TRIANGULATION_POSITIONS[0]!,
    [activeId],
  );
  const turn = turnOf(active.fen);
  const room = `tri-${active.id}-${nonce}`;
  const localInitial = useMemo(
    () => ({ startFen: active.fen, tree: [] as never[], startShapes: [] as never[] }),
    [active.fen],
  );

  const resetBoard = useCallback(() => {
    answered.current = false;
    setPlayed(null);
    setNonce((n) => n + 1);
  }, []);

  const pickNext = useCallback((exclude: Set<string>): TriangulationPosition => {
    const src0 = practicePool.length ? practicePool : TRIANGULATION_PRACTICE;
    const unseen = src0.filter((p) => !exclude.has(p.id));
    const src = unseen.length ? unseen : src0;
    return src[Math.floor(Math.random() * src.length)] ?? src0[0]!;
  }, [practicePool]);

  const startPractice = useCallback(() => {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    const s = freshSession();
    const first = pickNext(s.seenIds);
    setSession(s); setActiveId(first.id); setRevealed(false); setVerdict(null); setLastDelta(null);
    setMode("practice"); resetBoard();
  }, [pickNext, resetBoard]);

  const serveNext = useCallback(() => {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setSession((prev) => {
      const seen = new Set(prev.seenIds).add(activeId);
      const next = pickNext(seen);
      setActiveId(next.id); setRevealed(false); setVerdict(null); setLastDelta(null);
      return { ...prev, seenIds: seen };
    });
    resetBoard();
  }, [activeId, pickNext, resetBoard]);

  const retry = useCallback(() => {
    setRevealed(false); setVerdict(null); resetBoard();
  }, [resetBoard]);

  const selectFromList = useCallback((pos: TriangulationPosition) => {
    if (advanceTimer.current) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setActiveId(pos.id); setRevealed(false); setVerdict(null); setLastDelta(null); resetBoard();
  }, [resetBoard]);

  const grade = useCallback((uci: string) => {
    const matches = accepts(active, uci);
    setVerdict(matches ? "correct" : "wrong");
    if (!matches) setRevealed(true);
    const currentRating = rating ?? 1200;
    studyComplete(active.id, matches, currentRating)
      .then((res) => {
        if (!res || res.ratingDiff == null) return;
        setLastDelta(res.ratingDiff); setRating(res.rating); setRatingNb((n) => n + 1);
      })
      .catch(() => { /* rating update optional */ });
    setSession((prev) => matches
      ? { ...prev, streak: prev.streak + 1, bestStreak: Math.max(prev.bestStreak, prev.streak + 1), solved: prev.solved + 1 }
      : { ...prev, streak: 0, wrong: prev.wrong + 1 });
    if (matches) {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(() => { serveNext(); }, 1600);
    }
  }, [active, rating, serveNext]);

  // The notebook board reports every change; in Exercise mode the first move
  // played on it is the answer.
  const onLocalChange = useCallback((st: LocalRoomState) => {
    if (mode !== "practice" || answered.current) return;
    const first = st.tree?.[0]?.move;
    if (!first) return;
    answered.current = true;
    setPlayed(`${first.from}${first.to}`);
    grade(`${first.from}${first.to}`);
  }, [mode, grade]);

  // ─── Render ────────────────────────────────────────────────────────────

  const header = (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Endgame concept</div>
        <h1 className="font-display text-3xl text-white">Triangulation</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          A king manoeuvre whose whole purpose is to lose a tempo, so the opponent is the one left
          with the move. Read from the academy library — Dvoretsky, Neustadtl, Panchenko, Alburt,
          Seirawan — and every position checked against the engine.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {rating != null && (
          <div className="rounded-full bg-brand-500/15 px-3 py-1 text-xs font-semibold text-brand-100" title={`${ratingNb} attempts${guest ? " (guest — not saved)" : ""}`}>
            ★ {rating}{lastDelta != null && <span className={`ml-1 ${lastDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>({lastDelta >= 0 ? "+" : ""}{lastDelta})</span>}
          </div>
        )}
        <div className="flex overflow-hidden rounded-lg border border-ink-700 text-xs font-semibold">
          <button type="button"
            onClick={() => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); setMode("study"); setRevealed(false); setVerdict(null); resetBoard(); }}
            className={`px-3 py-1.5 ${mode === "study" ? "bg-brand-500/25 text-brand-100" : "bg-ink-900 text-ink-400 hover:bg-ink-800"}`}
          >📖 Study</button>
          <button type="button" onClick={startPractice}
            className={`px-3 py-1.5 ${mode === "practice" ? "bg-emerald-500/25 text-emerald-100" : "bg-ink-900 text-ink-400 hover:bg-ink-800"}`}
          >🎯 Exercise</button>
        </div>
      </div>
    </div>
  );

  const patternPills = (
    <div className="mb-4 flex flex-wrap gap-2">
      <button type="button" onClick={() => setActivePattern("all")}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${activePattern === "all" ? "bg-brand-500/25 text-brand-100" : "bg-ink-800 text-ink-400 hover:bg-ink-700"}`}
      >All ({TRIANGULATION_POSITIONS.length})</button>
      {TRIANGULATION_PATTERNS.map((p) => {
        const count = TRIANGULATION_POSITIONS.filter((x) => x.pattern === p.id).length;
        if (count === 0) return null;
        return (
          <button key={p.id} type="button" onClick={() => setActivePattern(p.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${activePattern === p.id ? "bg-brand-500/25 text-brand-100" : "bg-ink-800 text-ink-400 hover:bg-ink-700"}`}
            title={p.blurb}
          >{p.label} ({count})</button>
        );
      })}
    </div>
  );

  // The notebook board + its notation panel. Same components as My Studies.
  const boardBlock = (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,1.35fr)_minmax(240px,1fr)]">
      <div className="min-w-0">
        <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="rounded-full bg-ink-800 px-2 py-1 text-ink-300">
              {turn === "white" ? "White" : "Black"} to move
            </span>
            {mode === "practice" && !verdict && (
              <span className="text-ink-400">Play the move on the board</span>
            )}
            {played && <span className="font-mono text-ink-400">you played {played}</span>}
          </div>
          <SharedClassBoard key={room} local room={room} localInitial={localInitial} onLocalChange={onLocalChange} />
          <BoardChrome />
        </div>
      </div>
      <div className="min-w-0 overflow-y-auto" style={{ maxHeight: "min(74vh, 680px)" }}>
        <ClassNotationPanel room={room} role="coach" />
      </div>
    </div>
  );

  // ─── Exercise mode ─────────────────────────────────────────────────────

  if (mode === "practice") {
    const accuracy = session.solved + session.wrong === 0 ? 0
      : Math.round((session.solved / (session.solved + session.wrong)) * 100);
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        {header}
        {patternPills}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-orange-300">Streak</div>
            <div className="mt-1 text-2xl font-bold text-orange-100 tabular-nums">🔥 {session.streak}</div>
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

        <div className={`mb-4 rounded-lg px-3 py-2 text-center text-sm font-bold ${
          verdict === "correct" ? "bg-emerald-500/25 text-emerald-100"
          : verdict === "wrong" ? "bg-rose-500/25 text-rose-100"
          : "bg-brand-500/20 text-brand-100"}`}>
          {verdict === "correct" && <>✓ Correct — <span className="font-mono">{active.bestMoveSan}</span> · next in a moment…</>}
          {verdict === "wrong" && <>✗ Not this one — the move is <span className="font-mono">{active.bestMoveSan}</span></>}
          {!verdict && <>🎯 {turn === "white" ? "White" : "Black"} to move — lose a tempo</>}
        </div>

        {boardBlock}

        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">
            {TRIANGULATION_PATTERNS.find((x) => x.id === active.pattern)?.label} · ★ {active.difficulty}
          </div>
          <h2 className="mt-1 font-display text-lg text-white">{active.name}</h2>
          {!revealed && !verdict && (
            <p className="mt-2 text-sm text-ink-400">{active.think ?? (active.outcome ? `Goal: ${active.outcome}` : "Find the move.")}</p>
          )}
          {revealed && (
            <>
              <p className="mt-3 text-sm text-ink-300">{active.mechanism}</p>
              {active.line && <p className="mt-2 font-mono text-xs text-ink-300">{active.line}</p>}
              {active.discussion && <p className="mt-2 text-sm text-ink-300">{active.discussion}</p>}
              <p className="mt-2 text-xs text-ink-500">Source: {active.source}</p>
            </>
          )}
          {verdict === "wrong" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={retry}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">↻ Retry this one</button>
              <button type="button" onClick={serveNext}
                className="rounded-lg bg-ink-700 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-600">Next →</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Study mode ────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {header}

      <div className="mb-5 grid gap-4 rounded-xl border border-ink-700 bg-ink-900 p-4 md:grid-cols-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">The idea</div>
          <p className="mt-1 text-sm text-ink-300">
            Some positions are lost for whoever has to move. If that is you, you do not need a better
            plan — you need to give the move back. A king can reach the same square in one move or in
            three, so three king moves return you to where you started having spent a tempo the
            opponent could not spend.
          </p>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">When it works</div>
          <p className="mt-1 text-sm text-ink-300">
            Only when you have more spare squares than your opponent. Count them before you start:
            in the Neustadtl study White has two waiting squares and Black has one, and that single
            square of difference is the whole win. If both sides can triangulate, nobody gains.
          </p>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Only the king</div>
          <p className="mt-1 text-sm text-ink-300">
            A knight can never triangulate: it changes square colour on every move, so it can never
            return to a square in an odd number of moves. Queens, rooks and bishops can lose a tempo,
            but the king is the piece that does it in the endings where it matters.
          </p>
        </div>
      </div>

      {patternPills}

      <div className="grid gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(560px,3fr)]">
        <div className="space-y-2">
          {pool.map((p) => (
            <button key={p.id} type="button" onClick={() => selectFromList(p)}
              className={`block w-full rounded-lg border p-3 text-left transition ${p.id === activeId ? "border-brand-500 bg-brand-500/10" : "border-ink-700 bg-ink-900 hover:border-ink-500"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{p.name}</span>
                <span className="shrink-0 rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-ink-400">★ {p.difficulty}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-500">
                {TRIANGULATION_PATTERNS.find((x) => x.id === p.pattern)?.label}
                {p.studyOnly && <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-ink-400">demo</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="min-w-0">
          {boardBlock}

          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
            <h2 className="font-display text-lg text-white">{active.name}</h2>
            <p className="mt-1 text-xs uppercase tracking-wide text-brand-400">
              {TRIANGULATION_PATTERNS.find((x) => x.id === active.pattern)?.label} · ★ {active.difficulty}
            </p>

            {active.think && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                <span className="font-semibold">Think first. </span>{active.think}
              </div>
            )}

            {!revealed ? (
              <button type="button" onClick={() => setRevealed(true)}
                className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
                Show the answer
              </button>
            ) : (
              <>
                <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                  {active.studyOnly ? "Played here: " : "Best move: "}
                  <span className="font-mono font-bold">{active.bestMoveSan}</span>
                  {active.outcome && <span className="ml-2 text-ink-300">— {active.outcome}</span>}
                </div>
                <p className="mt-3 text-sm text-ink-300">{active.mechanism}</p>
                {active.line && (
                  <p className="mt-3 rounded-lg bg-ink-800/70 px-3 py-2 font-mono text-xs leading-relaxed text-ink-200">{active.line}</p>
                )}
                {active.discussion && (
                  <p className="mt-3 text-sm text-ink-300"><span className="font-semibold text-ink-200">Discussion. </span>{active.discussion}</p>
                )}
                {active.engine && <p className="mt-2 text-xs text-ink-400">🔎 {active.engine}</p>}
                <p className="mt-2 text-xs text-ink-500">Source: {active.source}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
