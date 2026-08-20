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
  deactivateOpening,
  displayNameFor,
  isCustomLineSlug,
  openingReviewSummary,
  queueSummary,
  resolveDrill,
  trainerSlugFor,
  upcomingOpenings,
  type OpeningReviewSummary,
  type RepTreeNode,
} from "../lib/cards";
import { useQuery } from "@tanstack/react-query";
import { listRepertoire } from "../lib/repertoire-api";
import { getMyTrainerRollup, postDrillSession, type TrainerRollup } from "../lib/opening-trainer-api";
import { TrainerStatsStrip } from "../components/TrainerStatsStrip";
import type { Grade } from "../lib/fsrs";
import MyRepertoirePanel from "../components/MyRepertoirePanel";

/** Per-ply result the drill tracks; feeds applyDrillResults() at session end.
 *  `cardKey` is the FSRS card sub-key (numeric ply for flat sans, dotted
 *  tree path for tree entries) — so the same drill loop grades both
 *  linear and tree openings. Correctness is derived from (attempts, peeked)
 *  at grading time — see `gradeFor()`. */
interface PlyOutcome {
  cardKey: string;                                     // "5" or "0.1.0"
  peeked: boolean;
  attempts: number;
  fenBefore: string;
  correctSan: string;
  correctFrom: string;
  correctTo: string;
  moveNo: number;                                      // 1-based
  sideToMove: "w" | "b";
  isAlternative: boolean;                              // branch alt vs mainline
}

/** Post-move FEN — replay the visit's SAN on its fenBefore. Used to decide
 *  whether the next visit is a mainline continuation (arrow shown) or a
 *  backtracked alternative (no arrow, would be misleading). */
function fenAfter(v: Visit): string {
  const g = new Chess(v.fenBefore);
  try { g.move(v.san); } catch { /* invalid saved SAN, drop */ }
  return g.fen();
}

/** A single unit of work in a drill — one move to play. Precomputed once
 *  per drill so the runtime loop is just "consume the next visit". */
interface Visit {
  cardKey: string;                                     // matches PlyOutcome.cardKey
  san: string;
  fenBefore: string;
  sideToMove: "w" | "b";
  moveNo: number;                                      // 1-based
  from: string;                                        // for feedback arrow
  to: string;
  isAlternative: boolean;                              // sibling index > 0
}

/** Build a visit plan from either a flat sans list or a full move-tree.
 *  Tree walk is DFS with mainline priority: at each node we visit the
 *  mainline (children[0]) subtree first, THEN the alternative siblings
 *  (children[1..]) in tree order — each alternative sits at the SAME parent
 *  position as the mainline it competes with. Matches the classical Anki-
 *  style "play mainline, at each junction the trainer asks: what were your
 *  alternatives here?" flow. */
function planVisits(drill: { sans: string[]; tree?: RepTreeNode[] }): Visit[] {
  const out: Visit[] = [];
  if (drill.tree && drill.tree.length > 0) {
    const walk = (nodes: RepTreeNode[], pathPrefix: number[], parentFen: string, parentPly: number) => {
      // Mainline first (index 0), then alternatives (index 1..).
      const ordered = nodes.map((n, i) => ({ n, i })).sort((a, b) => a.i - b.i);
      for (const { n, i } of ordered) {
        const g = new Chess(parentFen);
        let move: { from: string; to: string; san: string } | null = null;
        try { move = g.move(n.san) as any; } catch { /* illegal SAN in saved tree — skip */ }
        if (!move) continue;
        const pathArr = [...pathPrefix, i];
        out.push({
          cardKey: pathArr.join("."),
          san: n.san,
          fenBefore: parentFen,
          sideToMove: parentPly % 2 === 0 ? "w" : "b",
          moveNo: Math.floor(parentPly / 2) + 1,
          from: move.from,
          to: move.to,
          isAlternative: i > 0,
        });
        walk(n.children, pathArr, g.fen(), parentPly + 1);
      }
    };
    const start = new Chess();
    walk(drill.tree, [], start.fen(), 0);
    return out;
  }
  // Flat sans fallback (corpus openings + legacy line entries).
  const g = new Chess();
  for (let i = 0; i < drill.sans.length; i++) {
    const san = drill.sans[i]!;
    const fenBefore = g.fen();
    let move: { from: string; to: string; san: string } | null = null;
    try { move = g.move(san) as any; } catch { break; }
    if (!move) break;
    out.push({
      cardKey: String(i + 1),
      san,
      fenBefore,
      sideToMove: i % 2 === 0 ? "w" : "b",
      moveNo: Math.floor(i / 2) + 1,
      from: move.from,
      to: move.to,
      isAlternative: false,
    });
  }
  return out;
}

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
function missed(outcomes: PlyOutcome[]): PlyOutcome[] {
  return outcomes.filter((o) => o.attempts > 0 || o.peeked);
}

export default function DailyStudy() {
  const navigate = useNavigate();
  // Bump to force queue-summary + next-opening pickup after each session /
  // activation. Every localStorage write from cards.ts should be followed by
  // a nonce bump on this page.
  const [nonce, setNonce] = useState(0);

  const summary = useMemo(() => queueSummary(), [nonce]);
  const [drill, setDrill] = useState<{ slug: string; name: string; sans: string[]; tree?: RepTreeNode[] } | null>(null);
  const [lastScore, setLastScore] = useState<{ slug: string; name: string; correct: number; total: number; nextReviewAt: Date | null; misses: PlyOutcome[] } | null>(null);
  const [sessionsDone, setSessionsDone] = useState(0);
  // Upcoming schedule — top 5 openings by earliest due-date. Reloaded on
  // every nonce bump so the list stays fresh after a drill.
  const upcoming = useMemo(() => upcomingOpenings(5), [nonce]);
  // Server-side rollup — 7/30-day activity, streak, coach compliance.
  // Refetches on every drill finish (nonce bump) so the strip updates
  // in place. Falls back to null on logout / offline.
  const { data: rollup } = useQuery<TrainerRollup | null>({
    queryKey: ["opening-trainer-rollup", nonce],
    queryFn: async () => {
      try { return await getMyTrainerRollup(); } catch { return null; }
    },
    staleTime: 30_000,
  });

  // Coach-locked slugs — derived from repertoire entries with forceTrain
  // set. Students can't remove these from their training queue (owner ask
  // 2026-08-20). Fetches same query MyRepertoirePanel uses; React Query
  // dedupes so no extra request.
  const { data: repData } = useQuery({ queryKey: ["my-repertoire"], queryFn: listRepertoire });
  const lockedSlugs = useMemo(() => {
    const s = new Set<string>();
    for (const e of repData?.entries ?? []) {
      if (!e.forceTrain) continue;
      const slug = trainerSlugFor(e);
      if (slug) s.add(slug);
    }
    return s;
  }, [repData?.entries]);

  // No auto-pick — the student picks which opening to drill from the
  // queue below (owner ask 2026-08-20 — "option to play desired opening
  // in case of multiple openings to train"). The old behaviour of
  // silently dropping them into the earliest-due opening surprised
  // students with multiple activations.
  const startDrill = useCallback((slug: string) => {
    const d = resolveDrill(slug);
    if (!d) return;
    setLastScore(null);
    setDrill(d);
  }, []);
  const removeOpening = useCallback((slug: string, name: string) => {
    if (lockedSlugs.has(slug)) {
      alert(`"${name}" was added by your coach as required study. Ask your coach to unassign it.`);
      return;
    }
    if (!confirm(`Remove "${name}" from the Opening Trainer?\n\nAll spaced-repetition progress on this opening will be dropped.`)) return;
    deactivateOpening(slug);
    setNonce((n) => n + 1);
  }, [lockedSlugs]);

  const onFinish = useCallback((outcomes: PlyOutcome[]) => {
    if (!drill) return;
    const grades: Record<string, Grade> = {};
    for (const o of outcomes) grades[o.cardKey] = gradeFor(o);
    applyDrillResults(drill.slug, grades);
    // Fire-and-forget analytics write. Failure never blocks the drill —
    // the FSRS state above is the source of truth for scheduling.
    const correctFirstTry = outcomes.filter((o) => o.attempts === 0 && !o.peeked).length;
    const correctWithPeek = outcomes.filter((o) => o.attempts === 0 && o.peeked).length;
    const wrongAtLeastOnce = outcomes.filter((o) => o.attempts > 0).length;
    postDrillSession({
      slug: drill.slug,
      name: drill.name,
      totalMoves: outcomes.length,
      correctFirstTry,
      correctWithPeek,
      wrongAtLeastOnce,
      scorePct: outcomes.length > 0 ? Math.round((correctFirstTry / outcomes.length) * 100) : 0,
      isForceAssigned: lockedSlugs.has(drill.slug),
    }).catch(() => { /* offline / logged-out — swallow */ });
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
      misses: missed(outcomes),
    });
    setDrill(null);
    setSessionsDone((n) => n + 1);
    setNonce((n) => n + 1);
  }, [drill]);

  const onNextOpening = () => {
    setLastScore(null);
    setNonce((n) => n + 1);
    // Return to the picker; student chooses next opening from the queue.
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

      {rollup && (
        <div className="mb-4">
          <TrainerStatsStrip rollup={rollup} />
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
      ) : drill ? (
        <DrillSession key={drill.slug} drill={drill} onFinish={onFinish} onSkip={() => { setDrill(null); setNonce((n) => n + 1); }} />
      ) : (
        <AllCaughtUp sessionsDone={sessionsDone} hasQueue={upcoming.length > 0} />
      )}

      {/* Training queue — every activated opening as a row with Play +
          Remove buttons. Shown regardless of whether a drill is active
          so the student can switch openings without going back to the
          repertoire. Sorted by earliest due-date so the "most due" one
          floats to the top. */}
      {hasActive && upcoming.length > 0 && (
        <TrainingQueue items={upcoming}
          activeSlug={drill?.slug ?? null}
          lockedSlugs={lockedSlugs}
          onPlay={startDrill}
          onRemove={removeOpening} />
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

function AllCaughtUp({ sessionsDone, hasQueue }: { sessionsDone: number; hasQueue: boolean }) {
  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center">
      <p className="text-2xl">🎉</p>
      <h2 className="mt-2 text-lg font-bold text-emerald-200">
        {sessionsDone > 0 ? "Ready when you are" : "Pick an opening to drill"}
      </h2>
      <p className="mt-1 text-sm text-emerald-300">
        {sessionsDone > 0 && `Drilled ${sessionsDone} opening${sessionsDone === 1 ? "" : "s"}. `}
        {hasQueue ? "Tap ▶ on any opening below to start." : "Add an opening from your repertoire to begin."}
      </p>
    </div>
  );
}

/** Interactive drill: student plays BOTH sides through the opening. For
 *  tree entries it walks the tree in DFS order — mainline first, then at
 *  each junction it prompts for every alternative sibling. For flat sans
 *  (corpus openings + legacy line entries) it just walks the list. Wrong
 *  attempts count as mistakes; a "Show me" peek reveals the correct move
 *  and downgrades the FSRS grade for that card. */
function DrillSession({
  drill,
  onFinish,
  onSkip,
}: {
  drill: { slug: string; name: string; sans: string[]; tree?: RepTreeNode[] };
  onFinish: (outcomes: PlyOutcome[]) => void;
  onSkip: () => void;
}) {
  // Precompute the visit plan once per drill. For tree entries this is DFS
  // over the tree; for flat sans it's just each ply in order.
  const visits = useMemo(() => planVisits(drill), [drill.slug]);
  const total = visits.length;

  const [visitIdx, setVisitIdx] = useState(0);
  const [peeked, setPeeked] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<"idle" | "wrong" | "correct">("idle");
  const [outcomes, setOutcomes] = useState<PlyOutcome[]>([]);
  const [flash, setFlash] = useState<{ from: Key; to: Key } | null>(null);
  // Bumped on every wrong attempt to force Board -> chessground to re-apply
  // the true fen; without it, chessground eagerly renders the illegal-but-
  // legal-per-chess move the student just dropped and won't snap back.
  const [boardSync, setBoardSync] = useState(0);

  // Reset when the drill changes (new opening picked).
  useEffect(() => {
    setVisitIdx(0);
    setPeeked(false);
    setAttempts(0);
    setFeedback("idle");
    setOutcomes([]);
    setFlash(null);
  }, [drill.slug]);

  const done = visitIdx >= total;
  const current: Visit | null = done ? null : visits[visitIdx]!;
  const prevVisit: Visit | null = visitIdx > 0 ? visits[visitIdx - 1]! : null;
  // Compute dests directly from the current visit's fenBefore so the Board
  // gets legal moves for the RIGHT position on the same render the position
  // changes. The old code split "load position into a ref" and "compute
  // dests from that ref" across a useEffect + useMemo, which stayed one
  // render behind and blocked the student's move on every visit change
  // (owner report 2026-08-20: "clicked pawn to e5, didn't move").
  const dests = useMemo(() => {
    if (done || !current) return new Map();
    return destsFromChess(new Chess(current.fenBefore) as any);
  }, [current?.fenBefore, done]);

  // For the "last-move" arrow we want to show the PREVIOUS visit's move —
  // but only when the current visit is a mainline continuation of it. If
  // the current visit is an alternative (or the drill just backtracked to
  // a different position), don't paint a misleading lastMove arrow.
  const lastMove: [Key, Key] | undefined = useMemo(() => {
    if (!prevVisit || !current) return undefined;
    if (current.fenBefore !== fenAfter(prevVisit)) return undefined;
    return [prevVisit.from as Key, prevVisit.to as Key];
  }, [current?.fenBefore, prevVisit?.cardKey]);

  const advance = useCallback(() => {
    if (!current) return;
    setOutcomes((prev) => [...prev, {
      cardKey: current.cardKey,
      peeked,
      attempts,
      fenBefore: current.fenBefore,
      correctSan: current.san,
      correctFrom: current.from,
      correctTo: current.to,
      moveNo: current.moveNo,
      sideToMove: current.sideToMove,
      isAlternative: current.isAlternative,
    }]);
    setVisitIdx((i) => i + 1);
    setPeeked(false);
    setAttempts(0);
    setFeedback("idle");
    setFlash(null);
  }, [attempts, current, peeked]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => onFinish(outcomes), 400);
    return () => clearTimeout(t);
  }, [done, outcomes, onFinish]);

  useEffect(() => {
    if (feedback !== "correct") return;
    const t = setTimeout(() => advance(), 500);
    return () => clearTimeout(t);
  }, [feedback, advance]);

  const onMove = (from: Key, to: Key) => {
    if (done || !current) return;
    const g2 = new Chess(current.fenBefore);
    let userSan: string | null = null;
    try {
      const m = g2.move({ from: String(from), to: String(to), promotion: "q" });
      if (m) userSan = m.san;
    } catch { /* illegal */ }
    if (!userSan) return;
    if (userSan === current.san) setFeedback("correct");
    else {
      setAttempts((a) => a + 1);
      setFeedback("wrong");
      // Snap the visually-moved piece back to its origin square. Chessground
      // eagerly applies any legal move; without a resync it stays where the
      // student dropped it (owner report 2026-08-20 — "can't undo wrong
      // move, then only I can play correct move").
      setBoardSync((n) => n + 1);
    }
  };

  const showAnswer = () => {
    if (!current) return;
    setPeeked(true);
    setFlash({ from: current.from as Key, to: current.to as Key });
    setFeedback("idle");
  };

  const skipMove = () => {
    setPeeked(true);
    setAttempts((a) => Math.max(a, 1));
    setFeedback("correct");
  };

  const shapes = flash ? [{ orig: flash.from, dest: flash.to, brush: "green" }] : [];
  const turnColor: "white" | "black" = current?.sideToMove === "w" ? "white" : "black";
  const currentFen = current?.fenBefore ?? new Chess().fen();

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <div className="min-w-0">
          <span className="font-semibold text-white">{drill.name}</span>
          {isCustomLineSlug(drill.slug) && (
            <span className="ml-2 text-[10px] font-normal text-ink-500">· {drill.tree ? "tree" : "custom line"}</span>
          )}
        </div>
        <div className="text-xs text-ink-400">
          Move <span className="tabular-nums text-white">{Math.min(visitIdx + 1, total)}</span> / {total}
          {current && (
            <span className="ml-2">· {current.sideToMove === "w" ? "White" : "Black"} to move</span>
          )}
        </div>
      </div>

      {current?.isAlternative && (
        <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
          🔀 Alternative at move {current.moveNo}{current.sideToMove === "b" ? "…" : "."} — you saved a sideline here. Play it.
        </div>
      )}

      <div className="mx-auto max-w-md">
        <Board
          fen={currentFen}
          turnColor={turnColor}
          movableColor={done ? undefined : "both"}
          dests={dests}
          lastMove={lastMove}
          coordinates
          onMove={onMove}
          shapes={shapes as any}
          showDests
          syncNonce={boardSync}
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

function Scorecard({ result, onNext }: { result: { slug: string; name: string; correct: number; total: number; nextReviewAt: Date | null; misses: PlyOutcome[] }; onNext: () => void }) {
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
    <div className={`rounded-xl border ${bg} p-6`}>
      <div className="text-center">
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

      {/* Mistake spotlight — mini boards for every ply the student missed,
          with the correct move arrowed on top. Bjork's desirable-difficulty
          research: immediate re-encoding of a mistake is significantly more
          effective for long-term retention than passively waiting for the
          next scheduled review. */}
      {result.misses.length > 0 && (
        <MissesSpotlight misses={result.misses} />
      )}
    </div>
  );
}

function MissesSpotlight({ misses }: { misses: PlyOutcome[] }) {
  return (
    <div className="mt-5 border-t border-ink-800 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-white">🔎 Moves to remember</h3>
      <p className="mb-3 text-[11px] text-ink-500">Look once — encoding a mistake right after you make it is one of the fastest ways to lock in the correct move.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {misses.map((m, i) => (
          <MissCard key={i} miss={m} />
        ))}
      </div>
    </div>
  );
}

function MissCard({ miss }: { miss: PlyOutcome }) {
  const shape = { orig: miss.correctFrom, dest: miss.correctTo, brush: "green" };
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950 p-2">
      <div className="mb-1 flex items-baseline justify-between text-[10px]">
        <span className="font-semibold text-ink-300">
          Move {miss.moveNo}{miss.sideToMove === "b" ? "…" : "."} · {miss.sideToMove === "w" ? "White" : "Black"}
        </span>
        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono font-bold text-rose-300">
          {miss.correctSan}
        </span>
      </div>
      <div className="pointer-events-none">
        <Board
          fen={miss.fenBefore}
          viewOnly
          coordinates={false}
          orientation={miss.sideToMove === "w" ? "white" : "black"}
          shapes={[shape] as any}
        />
      </div>
    </div>
  );
}

function TrainingQueue({
  items, activeSlug, lockedSlugs, onPlay, onRemove,
}: {
  items: OpeningReviewSummary[];
  activeSlug: string | null;
  /** Slugs the student can't remove — set by the coach as required study
   *  via the "Force-add to trainer" checkbox in the Share modal. */
  lockedSlugs: Set<string>;
  onPlay: (slug: string) => void;
  onRemove: (slug: string, name: string) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-ink-800 bg-ink-900 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-white">🗓 Your training queue</h3>
        <span className="text-[10px] text-ink-500">FSRS · aims for ~90% recall</span>
      </div>
      <ul className="divide-y divide-ink-800/60">
        {items.map((it) => {
          const isActive = it.slug === activeSlug;
          const isLocked = lockedSlugs.has(it.slug);
          return (
            <li key={it.slug} className={`flex items-center gap-2 py-1.5 text-xs ${isActive ? "bg-brand-500/10 px-2 rounded" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-ink-100">
                  {it.name}
                  {isLocked && (
                    <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300"
                      title="Coach-assigned — you can't remove this">🎓 assigned</span>
                  )}
                </div>
                <div className="text-[10px] tabular-nums text-ink-500">Next: {formatDueRelative(it.earliestDue)} · {it.totalCards} card{it.totalCards === 1 ? "" : "s"}</div>
              </div>
              <button onClick={() => onPlay(it.slug)}
                disabled={isActive}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${isActive
                  ? "bg-brand-500/40 text-white cursor-default"
                  : "bg-brand-500 text-white hover:bg-brand-400"}`}
                title={isActive ? "Currently drilling" : "Start drilling this opening"}>
                {isActive ? "● Playing" : "▶ Play"}
              </button>
              {!isLocked && (
                <button onClick={() => onRemove(it.slug, it.name)}
                  className="shrink-0 rounded px-1.5 py-1 text-[11px] text-ink-500 hover:bg-rose-500/20 hover:text-rose-300"
                  title="Remove from Opening Trainer">
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[10px] text-ink-500">
        Intervals are computed per-move: correct moves get pushed further out, misses come back sooner. The schedule targets a 90% recall probability — the sweet spot for long-term memory (SuperMemo research).
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
