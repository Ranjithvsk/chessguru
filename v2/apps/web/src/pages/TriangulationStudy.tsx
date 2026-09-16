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
import { Chess } from "chess.js";
import SharedClassBoard, {
  triggerClassBoardAction, triggerClassFlipOrientation, triggerClassSeek,
  useClassCursorInfo,
} from "../components/SharedClassBoard";
import { ClassNotationPanel } from "../components/ClassNotationPanel";
import type { LocalRoomState, LocalTreeNode } from "../lib/localClassRoom";
import { studyComplete, studyMe } from "../lib/api";
import {
  TRIANGULATION_POSITIONS, TRIANGULATION_PATTERNS, TRIANGULATION_PRACTICE,
  type TriangulationPattern, type TriangulationPosition,
} from "../lib/triangulationCorpus";
import { TRIANGULATION_ANSWERS, markMove, MARKS } from "../lib/triangulationAnswers";

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


/** The student's answer is the line they played — read it off the notation tree. */
function mainline(st: LocalRoomState, max = 4): string[] {
  const out: string[] = [];
  let nodes: LocalTreeNode[] | undefined = st.tree;
  while (nodes && nodes.length && out.length < max) {
    const n: LocalTreeNode | undefined = nodes[0];
    if (!n) break;
    out.push(n.move.from + n.move.to + (n.move.promotion ?? ""));
    nodes = n.children;
  }
  return out;
}

/** Same line, in the notation the student reads on the panel. */
function lineSan(fen: string, ucis: string[]): string[] {
  const out: string[] = [];
  let c: Chess;
  try { c = new Chess(fen); } catch { return out; }
  for (const u of ucis) {
    const mv = c.moves({ verbose: true }).find((m) => m.from + m.to + (m.promotion ?? "") === u
      || (m.from + m.to) === u);
    if (!mv) break;
    out.push(mv.san);
    c.move(mv.san);
  }
  return out;
}

interface Graded {
  marks: Array<ReturnType<typeof markMove>>;
  score: number;
  outOf: number;
  verdict: string;
}

function verdictFor(score: number, outOf: number): string {
  const pct = outOf ? score / outOf : 0;
  if (pct === 1) return "Full marks. You found the move and you read the defence — which is the only way this concept is ever really understood.";
  if (pct >= 0.8) return "Almost exactly right. One half is the move; the other keeps the result but misses the point.";
  if (pct >= 0.6) return "Sound but not sharp. Nothing here throws the position away, yet neither move is the one the position is asking for.";
  if (pct >= 0.3) return "Half there. One move holds; the other changes the result. Read the mechanism below and play it through again.";
  return "Not yet. The question to ask is not what is a good move, but who would rather not be the one to move.";
}

const MARK_LABEL: Record<string, string> = {
  best: "the move",
  sound: "sound — keeps the result, misses the point",
  wrong: "changes the result",
  none: "nothing entered",
};
const MARK_CLASS: Record<string, string> = {
  best: "text-emerald-200",
  sound: "text-amber-200",
  wrong: "text-rose-200",
  none: "text-ink-400",
};

export default function TriangulationStudyPage() {
  const [mode, setMode] = useState<Mode>("study");
  const [activePattern, setActivePattern] = useState<TriangulationPattern | "all">("all");
  const [activeId, setActiveId] = useState<string>(TRIANGULATION_POSITIONS[0]!.id);
  const [revealed, setRevealed] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [played, setPlayed] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [lineUci, setLineUci] = useState<string[]>([]);
  const [graded, setGraded] = useState<Graded | null>(null);
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

  const clearAnswers = useCallback(() => {
    setLineUci([]); setGraded(null);
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
    setMode("practice"); resetBoard(); clearAnswers();
  }, [pickNext, resetBoard, clearAnswers]);

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
    setActiveId(pos.id); setRevealed(false); setVerdict(null); setLastDelta(null); resetBoard(); clearAnswers();
  }, [resetBoard, clearAnswers]);

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

  const answers = TRIANGULATION_ANSWERS[active.id];
  const answerSan = useMemo(() => lineSan(active.fen, lineUci), [active.fen, lineUci]);

  const checkAnswers = useCallback(() => {
    const k = TRIANGULATION_ANSWERS[active.id];
    const m1 = lineUci[0] ?? null;
    const m2 = lineUci[1] ?? null;
    let mark1 = markMove(k?.mover, m1);
    // The chapter's move and the engine's can differ and both win — the
    // Dvoretsky triangle can be walked either way round. The move the chapter
    // teaches counts as the move, not as merely sound.
    const taught = new Set<string>([active.bestMoveUci, ...(active.altMoveUci ?? [])]);
    if (mark1 === "sound" && m1 && taught.has(m1)) mark1 = "best";
    const mark2 = markMove(m1 ? k?.replies[m1] : undefined, m2);
    const outOf = 10;
    const score = (MARKS[mark1] ?? 0) + (MARKS[mark2] ?? 0);
    setGraded({ marks: [mark1, mark2], score, outOf, verdict: verdictFor(score, outOf) });
    setRevealed(true);
    studyComplete(active.id, score === outOf, rating ?? 1200)
      .then((res) => {
        if (!res || res.ratingDiff == null) return;
        setLastDelta(res.ratingDiff); setRating(res.rating); setRatingNb((n) => n + 1);
      })
      .catch(() => { /* rating optional */ });
  }, [active, lineUci, rating]);

  // The notebook board reports every change; in Exercise mode the first move
  // played on it is the answer.
  const onLocalChange = useCallback((st: LocalRoomState) => {
    const line = mainline(st);
    setLineUci(line);
    if (mode !== "practice" || answered.current) return;
    const first = line[0];
    if (!first) return;
    answered.current = true;
    setPlayed(first);
    grade(first);
  }, [mode, grade]);

  // ─── Render ────────────────────────────────────────────────────────────

  const header = (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Endgame concept</div>
        <h1 className="font-display text-3xl text-white">Triangulation</h1>
        <p className="mt-0.5 max-w-3xl text-xs text-ink-400">
          A king manoeuvre whose whole purpose is to lose a tempo, so the opponent is left with the
          move. From the academy library, every position engine-checked.
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
    <div className="mb-2 flex flex-wrap gap-2">
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

  // The notebook board + its notation panel. Same components as My Studies —
  // and, like My Studies, the board MUST sit inside a sized container: it lays
  // itself out in container-query units, so without containerType and a real
  // height it resolves against the viewport and overflows the page.
  const boardPane = (
    <div className="flex min-w-0 flex-col">
      <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="rounded-full bg-ink-800 px-2.5 py-1 font-medium text-ink-200">
            {turn === "white" ? "⬜ White" : "⬛ Black"} to move
          </span>
          <span className="text-ink-500">
            {mode === "practice"
              ? (verdict ? "" : "play your move on the board")
              : "try any line you like — nothing is graded until you submit"}
          </span>
        </div>
        <div
          className="relative flex min-h-0 items-center justify-center overflow-hidden"
          style={{ containerType: "size", height: "min(66vh, 620px)" } as React.CSSProperties}
        >
          <SharedClassBoard key={room} local room={room} localInitial={localInitial} onLocalChange={onLocalChange} />
        </div>
        <BoardChrome />
      </div>
    </div>
  );

  const notationPane = (
    <div className="min-w-0 rounded-xl border border-ink-700 bg-ink-900/60 p-1">
      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Notation</div>
      <div className="min-w-0 overflow-y-auto" style={{ maxHeight: "min(66vh, 620px)" }}>
        <ClassNotationPanel room={room} role="coach" />
      </div>
    </div>
  );

  // ─── Exercise mode ─────────────────────────────────────────────────────

  if (mode === "practice") {
    const accuracy = session.solved + session.wrong === 0 ? 0
      : Math.round((session.solved / (session.solved + session.wrong)) * 100);
    return (
      <div className="w-full">
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          {boardPane}
          <div className="min-w-0">{notationPane}</div>
        </div>

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
    <div className="w-full">
      {header}

      <details className="group mb-3 rounded-xl border border-ink-700 bg-ink-900">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-semibold text-white">What triangulation is, and when it works</span>
          <span className="text-xs text-ink-400 group-open:hidden">show</span>
          <span className="hidden text-xs text-ink-400 group-open:inline">hide</span>
        </summary>
        <div className="grid gap-4 border-t border-ink-800 px-4 py-4 md:grid-cols-3">
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
      </details>

      {patternPills}

      {/* The chapter's positions, as a strip. A left rail costs the board 260px
          of width inside a 1152px shell, and the board is the point of the page. */}
      <div className="-mx-1 mb-3 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
        {pool.map((p) => (
          <button key={p.id} type="button" onClick={() => selectFromList(p)}
            className={`w-52 shrink-0 snap-start rounded-lg border p-2.5 text-left transition ${p.id === activeId ? "border-brand-500 bg-brand-500/10" : "border-ink-700 bg-ink-900 hover:border-ink-500"}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-xs font-semibold leading-snug text-white">{p.name}</span>
              <span className="shrink-0 rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">★ {p.difficulty}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 truncate text-[10px] uppercase tracking-wide text-ink-500">
              {TRIANGULATION_PATTERNS.find((x) => x.id === p.pattern)?.label}
              {p.studyOnly && <span className="rounded bg-ink-800 px-1 py-0.5 text-[9px] normal-case tracking-normal text-ink-400">demo</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {boardPane}
        <div className="min-w-0">{notationPane}</div>

        <div className="min-w-0 xl:col-span-2">
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
            <h2 className="font-display text-lg text-white">{active.name}</h2>
            <p className="mt-1 text-xs uppercase tracking-wide text-brand-400">
              {TRIANGULATION_PATTERNS.find((x) => x.id === active.pattern)?.label} · ★ {active.difficulty}
            </p>

            {active.think && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                <span className="font-semibold">Think first. </span>{active.think}
              </div>
            )}

            {/* The answer is whatever you played on the board — the notation
                panel already has it, so there is nothing to retype. */}
            <div className="mt-4 rounded-lg border border-ink-700 bg-ink-950/40 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Your answer</div>
              <p className="mt-1 text-xs text-ink-400">
                Play it on the board: your move, then the reply you expect. Try as many lines as you
                like — the notation panel keeps them all, and only the main line is marked.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-ink-900 px-3 py-2">
                <span className="text-[11px] uppercase tracking-wide text-ink-500">Main line</span>
                {answerSan.length === 0 ? (
                  <span className="text-sm text-ink-500">nothing played yet</span>
                ) : (
                  <span className="font-mono text-sm text-white">
                    {answers?.turn === "black" ? "1… " : "1. "}
                    {answerSan.slice(0, 2).map((san, i) => (
                      <span key={i} className={graded ? (graded.marks[i] === "best" ? "text-emerald-200"
                        : graded.marks[i] === "sound" ? "text-amber-200"
                        : graded.marks[i] === "wrong" ? "text-rose-200" : "") : ""}>
                        {san}{i === 0 && answerSan.length > 1 ? " " : ""}
                      </span>
                    ))}
                    {answerSan.length > 2 && <span className="text-ink-500"> (+{answerSan.length - 2} more, not marked)</span>}
                  </span>
                )}
              </div>

              {!graded ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={checkAnswers} disabled={answerSan.length === 0}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40">
                    Check answer
                  </button>
                  <button type="button" onClick={() => { setNonce((n) => n + 1); setLineUci([]); }}
                    className="rounded-lg border border-ink-700 bg-ink-900 px-4 py-2 text-sm font-semibold text-ink-300 hover:bg-ink-800">
                    Clear the board
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-display text-2xl text-white tabular-nums">{graded.score}<span className="text-ink-500">/{graded.outOf}</span></span>
                    <span className="text-sm text-ink-300">{graded.verdict}</span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    {([0, 1] as const).map((i) => {
                      const key = i === 0 ? answers?.mover : (lineUci[0] ? answers?.replies[lineUci[0]] : undefined);
                      const who = i === 0
                        ? (answers?.turn === "black" ? "Black" : "White")
                        : (answers?.turn === "black" ? "White" : "Black");
                      const mark = graded.marks[i] ?? "none";
                      const taughtSan = i === 0 ? active.bestMoveSan : key?.bestSan;
                      return (
                        <div key={i} className="flex flex-wrap items-baseline gap-2">
                          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-ink-500">
                            {i === 0 ? `${who} — your move` : `${who} — the reply`}
                          </span>
                          <span className={`font-mono ${MARK_CLASS[mark]}`}>{answerSan[i] ?? "—"}</span>
                          <span className={`text-xs ${MARK_CLASS[mark]}`}>{MARK_LABEL[mark]}</span>
                          {key && (
                            <span className="text-xs text-ink-400">
                              · {i === 0 ? "the chapter plays" : "best is"}{" "}
                              <span className="font-mono text-ink-200">{taughtSan}</span>
                              {key.result === "win" ? ", which wins"
                                : key.result === "draw" ? ", which holds the draw"
                                : " — the position is lost anyway, so this is only the most stubborn"}
                              {key.okUci.length > 0 && <> · {key.okUci.length} other move{key.okUci.length === 1 ? "" : "s"} reach the same result</>}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => { setGraded(null); setLineUci([]); setNonce((n) => n + 1); setRevealed(false); }}
                    className="mt-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-semibold text-ink-300 hover:bg-ink-800">
                    Play it again
                  </button>
                </div>
              )}
            </div>

            {revealed && (
              <>
                <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
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
