// Opening Trainer — interactive Ankidroid-style drill.
//
// Route: /study/daily.
//
// Design (owner ask 2026-08-20): instead of showing one FSRS card at a time
// with a "Show answer" button, drop the student on the starting position of
// an opening and let them PLAY the whole mainline. They play BOTH sides —
// black and white — one move at a time. Each attempt is checked against the
// mainline SAN:
//   * correct on first try  → grade "Good"
//   * correct after a peek  → grade "Hard"
//   * wrong (any peek → any retry) → grade "Again"
//
// At the end we show a score (correct/total), apply the grades to each
// next-move card via applyDrillResults(), and offer the next opening.
//
// State still lives in localStorage via ./lib/cards. Everything is
// client-side, no server round-trips.

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";
import {
  applyDrillResults,
  displayNameFor,
  isCustomLineSlug,
  nextOpeningToStudy,
  openingReviewSummary,
  queueSummary,
  upcomingOpenings,
  type OpeningReviewSummary,
} from "../lib/cards";
import type { Grade } from "../lib/fsrs";
import MyRepertoirePanel from "../components/MyRepertoirePanel";

/** Per-ply result the drill tracks; feeds applyDrillResults() at session end.
 *  Correctness is derived from (attempts, peeked) at grading time — see
 *  `gradeFor()` — so we don't have to re-derive it inside the drill loop. */
interface PlyOutcome { peeked: boolean; attempts: number }

/** Map a ply's outcome to an FSRS grade:
 *   attempts === 0 && !peeked → Good (3)
 *   attempts === 0 &&  peeked → Hard (2)   (played the shown move)
 *   attempts >= 1             → Again (1)  (any wrong attempt at all) */
function gradeFor(o: PlyOutcome): Grade {
  if (o.attempts > 0) return 1;
  return o.peeked ? 2 : 3;
}
/** First-try, no-peek correct count — used for the % score on the card. */
function correctCount(outcomes: PlyOutcome[]): number {
  return outcomes.filter((o) => o.attempts === 0 && !o.peeked).length;
}

export default function DailyStudy() {
  const navigate = useNavigate();
  // Bump to force queue-summary + next-opening pickup after each session /
  // activation. Every localStorage write from cards.ts should be followed by
  // a nonce bump on this page.
  const [nonce, setNonce] = useState(0);

  const summary = useMemo(() => queueSummary(), [nonce]);
  const [drill, setDrill] = useState<{ slug: string; name: string; sans: string[] } | null>(null);
  const [lastScore, setLastScore] = useState<{ slug: string; name: string; correct: number; total: number; nextReviewAt: Date | null } | null>(null);
  const [sessionsDone, setSessionsDone] = useState(0);
  // Upcoming schedule — top 5 openings by earliest due-date. Reloaded on
  // every nonce bump so the list stays fresh after a drill.
  const upcoming = useMemo(() => upcomingOpenings(5), [nonce]);

  // Pick the next opening whenever the queue may have changed. Skip the
  // pickup if the student is mid-drill or looking at their score screen.
  useEffect(() => {
    if (drill || lastScore) return;
    setDrill(nextOpeningToStudy());
  }, [nonce, drill, lastScore]);

  const onFinish = useCallback((outcomes: PlyOutcome[]) => {
    if (!drill) return;
    const grades: Array<Grade | undefined> = outcomes.map(gradeFor);
    applyDrillResults(drill.slug, grades);
    const correct = correctCount(outcomes);
    // Compute the opening's NEXT review after the FSRS update — students
    // want to see "come back in X days" on the scorecard (owner ask 2026-
    // 08-20 — "optimum memory retrieval interval so they never forget").
    const summary = openingReviewSummary(drill.slug);
    setLastScore({
      slug: drill.slug,
      name: drill.name,
      correct,
      total: outcomes.length,
      nextReviewAt: summary?.earliestDue ?? null,
    });
    setDrill(null);
    setSessionsDone((n) => n + 1);
    setNonce((n) => n + 1);
  }, [drill]);

  const onNextOpening = () => {
    setLastScore(null);
    setNonce((n) => n + 1);
  };

  const hasActive = summary.activeOpenings > 0;

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Opening Trainer</h1>
          <p className="mt-1 text-sm text-ink-500">Play both sides of each opening. Score refreshes your spaced-repetition schedule.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to="/study/progress" className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-200">
            📊 progress
          </Link>
          <Link to="/study/openings" className="rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold hover:bg-ink-800">
            + add openings
          </Link>
        </div>
      </header>

      {/* Stats strip */}
      <div className="mb-4 grid grid-cols-4 gap-2 text-center">
        <Stat label="due now" value={summary.dueNow} accent={summary.dueNow > 0 ? "text-emerald-400" : "text-ink-500"} />
        <Stat label="new" value={summary.newAvailable} accent="text-indigo-400" />
        <Stat label="cards" value={summary.totalCards} />
        <Stat label="openings" value={summary.activeOpenings} />
      </div>

      {sessionsDone > 0 && !drill && !lastScore && (
        <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-center text-xs font-semibold text-emerald-300">
          ✓ {sessionsDone} opening{sessionsDone === 1 ? "" : "s"} drilled this session
        </div>
      )}

      {/* Repertoire quick-add — coach-suggested + own with 📅 button per row. */}
      <div className="mb-4">
        <MyRepertoirePanel
          history={[]}
          onLoad={(entry) => {
            if (entry.slug) navigate(`/study/openings/${entry.slug}`);
            else navigate("/openings");
          }}
          onActivate={() => setNonce((n) => n + 1)}
        />
      </div>

      {!hasActive ? (
        <EmptyState />
      ) : lastScore ? (
        <Scorecard result={lastScore} onNext={onNextOpening} />
      ) : !drill ? (
        <AllCaughtUp sessionsDone={sessionsDone} />
      ) : (
        <DrillSession key={drill.slug} drill={drill} onFinish={onFinish} onSkip={() => { setDrill(null); setNonce((n) => n + 1); }} />
      )}

      {/* Upcoming schedule — spaced-repetition preview so the student can
          see when each activated opening is due next. */}
      {hasActive && upcoming.length > 0 && (
        <UpcomingPanel items={upcoming} />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-2.5">
      <div className={`text-xl font-bold ${accent ?? "text-ink-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-ink-800 bg-ink-900 p-8 text-center">
      <p className="text-2xl">📚</p>
      <h2 className="mt-2 text-lg font-bold text-white">No openings in your trainer yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-400">
        Add an opening from your Repertoire above (tap the 📅 button) or from the Openings browser.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link to="/openings" className="rounded-full bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-400">
          Browse openings
        </Link>
      </div>
    </div>
  );
}

function AllCaughtUp({ sessionsDone }: { sessionsDone: number }) {
  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-8 text-center">
      <p className="text-2xl">🎉</p>
      <h2 className="mt-2 text-lg font-bold text-emerald-200">
        {sessionsDone > 0 ? "Done for now" : "All caught up"}
      </h2>
      <p className="mt-1 text-sm text-emerald-300">
        {sessionsDone > 0 ? `Drilled ${sessionsDone} opening${sessionsDone === 1 ? "" : "s"}. ` : ""}
        Come back later — your spaced-repetition schedule will bring the next batch back on time.
      </p>
    </div>
  );
}

/** Interactive drill: student plays BOTH sides through the opening mainline
 *  one move at a time. Wrong moves count as mistakes but the student can
 *  keep trying — a "Show me" peek reveals the correct move (and locks in a
 *  worse grade). Completes at end-of-line or when the student quits. */
function DrillSession({
  drill,
  onFinish,
  onSkip,
}: {
  drill: { slug: string; name: string; sans: string[] };
  onFinish: (outcomes: PlyOutcome[]) => void;
  onSkip: () => void;
}) {
  // Chess instance driving legality + FEN. Recreated per drill.
  const game = useRef(new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [ply, setPly] = useState(0);                      // 0-based ply index into drill.sans
  const [peeked, setPeeked] = useState(false);            // did the student peek at THIS ply?
  const [attempts, setAttempts] = useState(0);            // wrong attempts on THIS ply
  const [feedback, setFeedback] = useState<"idle" | "wrong" | "correct">("idle");
  const [outcomes, setOutcomes] = useState<PlyOutcome[]>([]);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const [flash, setFlash] = useState<{ from: Key; to: Key } | null>(null);   // arrow hint after peek

  // Reset when the drill changes (new opening picked).
  useEffect(() => {
    game.current = new Chess();
    setFen(game.current.fen());
    setPly(0);
    setPeeked(false);
    setAttempts(0);
    setFeedback("idle");
    setOutcomes([]);
    setLastMove(undefined);
    setFlash(null);
  }, [drill.slug]);

  const total = drill.sans.length;
  const done = ply >= total;
  const currentSan = done ? null : drill.sans[ply]!;
  const turnColor: "white" | "black" = game.current.turn() === "w" ? "white" : "black";
  const dests = useMemo(() => (done ? new Map() : destsFromChess(game.current as any)), [fen, done]);

  // Compute the "correct" from/to for feedback + hint arrow. We do this by
  // trying the expected SAN against a cloned game (chess.js parses SAN
  // itself); the returned move object gives us verbose from/to.
  const expected = useMemo(() => {
    if (done || !currentSan) return null;
    const g2 = new Chess(fen);
    try {
      const m = g2.move(currentSan);
      if (!m) return null;
      return { from: m.from as Key, to: m.to as Key, san: currentSan };
    } catch { return null; }
  }, [fen, currentSan, done]);

  // Commit the correct move on the live game + advance to next ply.
  const advance = useCallback(() => {
    if (!currentSan || !expected) return;
    const rec: PlyOutcome = {
      correct: attempts === 0 && !peeked,
      peeked,
      attempts,
    };
    // On a "peeked" or "wrong-then-right" state the student still gets the
    // move applied so we can march forward; but they got the ply "wrong" for
    // grading purposes.
    if (!rec.correct && attempts === 0 && peeked) rec.correct = true;  // played the shown move
    if (attempts > 0) rec.correct = attempts === 0;                    // any wrong attempt at all = wrong
    try {
      game.current.move(currentSan);
      setFen(game.current.fen());
      setLastMove([expected.from, expected.to]);
    } catch { /* shouldn't happen — SAN validated by chess.js on clone */ }
    setOutcomes((prev) => [...prev, rec]);
    setPly((p) => p + 1);
    setPeeked(false);
    setAttempts(0);
    setFeedback("idle");
    setFlash(null);
  }, [attempts, currentSan, expected, peeked]);

  // On drill completion, hand results back up.
  useEffect(() => {
    if (!done) return;
    // Small delay so the last "correct" flash is visible.
    const t = setTimeout(() => onFinish(outcomes), 400);
    return () => clearTimeout(t);
  }, [done, outcomes, onFinish]);

  // Auto-advance the wrong→right flow: after the student plays the right
  // move (or explicitly asks for the answer), we let them press Enter or
  // wait 700ms.
  useEffect(() => {
    if (feedback !== "correct") return;
    const t = setTimeout(() => advance(), 500);
    return () => clearTimeout(t);
  }, [feedback, advance]);

  const onMove = (from: Key, to: Key) => {
    if (done || !currentSan) return;
    // Convert user move to SAN by trying it on a clone (handles promotions
    // simply — default to Q; matches most beginner-openings mainline).
    const g2 = new Chess(fen);
    let userSan: string | null = null;
    try {
      const m = g2.move({ from: String(from), to: String(to), promotion: "q" });
      if (m) userSan = m.san;
    } catch { /* illegal — chessground shouldn't call us then, but ignore */ }
    if (!userSan) return;
    // Compare on SAN so, e.g., "Nf3" vs "Ng1f3" both work; chess.js
    // canonicalises to the shortest legal SAN.
    if (userSan === currentSan) {
      setFeedback("correct");
    } else {
      setAttempts((a) => a + 1);
      setFeedback("wrong");
    }
  };

  const showAnswer = () => {
    if (!expected) return;
    setPeeked(true);
    setFlash({ from: expected.from, to: expected.to });
    setFeedback("idle");
  };

  const skipMove = () => {
    // Peeked-then-give-up counts as a "wrong" outcome; play the correct move
    // to march forward.
    setPeeked(true);
    setAttempts((a) => Math.max(a, 1));
    setFeedback("correct");                                // triggers advance
  };

  const shapes = flash ? [{ orig: flash.from, dest: flash.to, brush: "green" }] : [];

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <div className="min-w-0">
          <span className="font-semibold text-white">{drill.name}</span>
          {isCustomLineSlug(drill.slug) && (
            <span className="ml-2 text-[10px] font-normal text-ink-500">· custom line</span>
          )}
        </div>
        <div className="text-xs text-ink-400">
          Move <span className="tabular-nums text-white">{Math.min(ply + 1, total)}</span> / {total}
          <span className="ml-2">· {turnColor === "white" ? "White" : "Black"} to move</span>
        </div>
      </div>

      <div className="mx-auto max-w-md">
        <Board
          fen={fen}
          turnColor={turnColor}
          movableColor={done ? undefined : "both"}
          dests={dests}
          lastMove={lastMove}
          coordinates
          onMove={onMove}
          shapes={shapes as any}
          showDests
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <div className="text-xs">
          {feedback === "wrong" && (
            <span className="text-rose-300">✗ Not this one — try again{attempts >= 2 ? ", or peek 👁" : ""}.</span>
          )}
          {feedback === "correct" && (
            <span className="text-emerald-300">✓ Correct!</span>
          )}
          {feedback === "idle" && peeked && (
            <span className="text-amber-300">Play the highlighted move.</span>
          )}
          {feedback === "idle" && !peeked && (
            <span className="text-ink-500">Play the mainline move.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={showAnswer} disabled={peeked || done}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Show the correct move (counts as a hint)">
            👁 Show me
          </button>
          <button onClick={skipMove} disabled={done}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Skip this move — counted as wrong">
            ⏭ Skip move
          </button>
          <button onClick={onSkip}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-500 hover:bg-ink-800">
            End drill
          </button>
        </div>
      </div>
    </div>
  );
}

function Scorecard({ result, onNext }: { result: { slug: string; name: string; correct: number; total: number; nextReviewAt: Date | null }; onNext: () => void }) {
  const pct = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;
  const isStrong = pct >= 80;
  const isOk = pct >= 50 && pct < 80;
  const bg = isStrong ? "border-emerald-500/40 bg-emerald-500/10" : isOk ? "border-amber-500/40 bg-amber-500/10" : "border-rose-500/40 bg-rose-500/10";
  const emoji = isStrong ? "🏆" : isOk ? "👍" : "💪";
  const msg = isStrong
    ? "Great recall — this opening will space out further."
    : isOk
      ? "Solid. The moves you got wrong will come back sooner."
      : "Rough round — every miss is scheduled for tomorrow.";
  const displayName = displayNameFor(result.slug) || result.name;
  return (
    <div className={`rounded-xl border ${bg} p-6 text-center`}>
      <p className="text-3xl">{emoji}</p>
      <h2 className="mt-2 text-lg font-bold text-white">{displayName}</h2>
      <div className="mt-3 text-3xl font-bold text-white">
        {result.correct} <span className="text-ink-400">/ {result.total}</span>
        <span className="ml-2 text-base font-normal text-ink-400">({pct}%)</span>
      </div>
      <p className="mt-2 text-sm text-ink-300">{msg}</p>
      {result.nextReviewAt && (
        <p className="mt-2 text-xs text-ink-400">
          🗓 Next review of this opening: <span className="font-semibold text-ink-200">{formatDueRelative(result.nextReviewAt)}</span>
        </p>
      )}
      <button onClick={onNext}
        className="mt-4 rounded-full bg-brand-500 px-5 py-2 text-sm font-bold text-white hover:bg-brand-400">
        Next opening →
      </button>
    </div>
  );
}

function UpcomingPanel({ items }: { items: OpeningReviewSummary[] }) {
  return (
    <div className="mt-4 rounded-xl border border-ink-800 bg-ink-900 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-white">🗓 Upcoming reviews</h3>
        <span className="text-[10px] text-ink-500">FSRS · aims for ~90% recall</span>
      </div>
      <ul className="divide-y divide-ink-800/60">
        {items.map((it) => (
          <li key={it.slug} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span className="min-w-0 truncate text-ink-200">{it.name}</span>
            <span className="shrink-0 tabular-nums text-ink-400">{formatDueRelative(it.earliestDue)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-ink-500">
        Spaced-repetition intervals are computed per-move: correct moves get pushed further out, misses come back sooner. The schedule targets a 90% recall probability — the sweet spot for long-term memory (Wozniak, SuperMemo research).
      </p>
    </div>
  );
}

/** Human "in 3 days" / "in 2 h" / "in 30 min" / "due now" for the schedule UI. */
function formatDueRelative(when: Date, now: Date = new Date()): string {
  const ms = when.getTime() - now.getTime();
  if (ms <= 0) return "due now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 30) return `in ${d} day${d === 1 ? "" : "s"}`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `in ${mo} month${mo === 1 ? "" : "s"}`;
  const yr = Math.round(mo / 12);
  return `in ${yr} year${yr === 1 ? "" : "s"}`;
}
