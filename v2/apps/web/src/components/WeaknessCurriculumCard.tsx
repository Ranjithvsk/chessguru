// Weakness curriculum — a 15-puzzle mini-course targeting the user's biggest
// weakness theme, with a rating ratchet so puzzles start easy and get harder
// as they progress. Progress persists in localStorage per user; ready for
// backend persistence when we want cross-device sync.
//
// Owner ask 2026-08-18: better than always-tough theme suggestions — build a
// weakness curriculum with progress bar. This is the first concrete step.
//
// Flow:
//   1. On mount, ask the suggested-themes API for the top-weakness theme.
//   2. If no active curriculum in localStorage, offer "Start course".
//   3. Once started, generate 15 steps ramping from userRating-150 up to
//      userRating+50 in even ~14pt increments.
//   4. "Solve next" button sets the trainer's theme + fires a puzzle fetch
//      with exactRating=<current step> (backend picker respects the exact
//      override, bypassing the auto-difficulty offset).
//   5. Advance step on any completion (win or loss — exposure counts).
//   6. On step 15 complete: mark done, celebrate, offer new curriculum.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { prettify } from "../lib/format";

const STEPS = 15;
/** Build the rating ramp for a curriculum step 0..STEPS-1.
 *  Anchors from -150 to +50 pts relative to the user's global rating so the
 *  course opens confidently and finishes just above ceiling — good stretch. */
function buildSteps(userRating: number): number[] {
  const start = userRating - 150;
  const end = userRating + 50;
  const step = (end - start) / (STEPS - 1);
  return Array.from({ length: STEPS }, (_, i) => Math.round(start + step * i));
}

type CurriculumState = {
  theme: string;
  ratings: number[];
  stepIndex: number;         // 0..ratings.length; == ratings.length = done
  startedAt: string;         // ISO
  completedAt?: string;
};

const LS_KEY = "cg.weakness-curriculum.v1";

function loadState(): CurriculumState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j?.theme || !Array.isArray(j?.ratings)) return null;
    return j as CurriculumState;
  } catch { return null; }
}
function saveState(s: CurriculumState | null) {
  try {
    if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
    else localStorage.removeItem(LS_KEY);
  } catch { /* */ }
}

interface Props {
  /** Current theme in the parent trainer state — used to detect whether the
   *  most-recent solve was on the curriculum theme (so we can auto-advance). */
  currentTheme: string;
  /** Number of solves completed in the parent trainer — increments whenever
   *  a puzzle is submitted. Auto-advances the curriculum step when this
   *  changes AND currentTheme matches the curriculum theme. */
  solveCounter: number;
  /** Fires to switch the trainer to a specific theme + optional exactRating
   *  and pull a fresh puzzle. Wired to the trainer's own setTheme + a small
   *  extension that stashes an exactRating hint. */
  onSolveNext: (theme: string, exactRating: number) => void;
}

export function WeaknessCurriculumCard({ currentTheme, solveCounter, onSolveNext }: Props) {
  const [state, setState] = useState<CurriculumState | null>(() => loadState());
  const [dismissed, setDismissed] = useState(false);
  const { data: suggested } = useQuery({
    queryKey: ["suggested-themes"],
    queryFn: api.suggestedThemes,
    staleTime: 5 * 60_000,
  });

  // Auto-advance: whenever the parent's solveCounter changes AND the trainer
  // is on our curriculum theme, we know one puzzle finished — bump the step.
  // Ignore the initial mount (solveCounter=0) and any change while dismissed.
  const [lastSeenCounter, setLastSeenCounter] = useState(solveCounter);
  useEffect(() => {
    if (solveCounter === lastSeenCounter) return;
    setLastSeenCounter(solveCounter);
    if (!state || state.completedAt) return;
    if (currentTheme !== state.theme) return;
    const nextIndex = state.stepIndex + 1;
    const next: CurriculumState = {
      ...state,
      stepIndex: nextIndex,
      completedAt: nextIndex >= state.ratings.length ? new Date().toISOString() : undefined,
    };
    setState(next);
    saveState(next);
  }, [solveCounter, lastSeenCounter, state, currentTheme]);

  // Suggest starting a course if there's a top weakness but no active state.
  const topWeakness = useMemo(() => {
    if (!suggested) return null;
    return suggested.items.find((s) => s.reason === "weakness") || null;
  }, [suggested]);

  const startCourse = useCallback((theme: string) => {
    const globalR = suggested?.global ?? 1500;
    const s: CurriculumState = {
      theme,
      ratings: buildSteps(globalR),
      stepIndex: 0,
      startedAt: new Date().toISOString(),
    };
    setState(s);
    saveState(s);
    setDismissed(false);
  }, [suggested?.global]);

  const abandonCourse = useCallback(() => {
    if (!confirm("Abandon this course? Your progress is not saved.")) return;
    setState(null);
    saveState(null);
  }, []);

  const solveNext = useCallback(() => {
    if (!state || state.completedAt) return;
    const rating = state.ratings[state.stepIndex];
    if (typeof rating !== "number") return;
    onSolveNext(state.theme, rating);
  }, [state, onSolveNext]);

  // — Render paths —

  if (dismissed) return null;

  // Offer state: no active course + a clear weakness exists.
  if (!state && topWeakness) {
    return (
      <section className="mb-3 rounded-xl2 border-2 border-brand-500/40 bg-gradient-to-br from-brand-500/10 to-transparent p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">📚 Weakness course available</h2>
            <p className="mt-0.5 text-xs text-ink-400">
              You're weakest at <b className="text-white">{prettify(topWeakness.theme)}</b>
              {topWeakness.yourRating != null && <> ({topWeakness.yourRating}, {topWeakness.delta ?? 0} vs global)</>}.
              A {STEPS}-puzzle course ramps you from easy to your ceiling.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => startCourse(topWeakness.theme)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">
              Start course
            </button>
            <button onClick={() => setDismissed(true)} title="Not now"
              className="rounded-lg border border-ink-700 px-2 py-1.5 text-xs text-ink-400 hover:text-white">✕</button>
          </div>
        </div>
      </section>
    );
  }

  // Active state.
  if (state) {
    const done = state.stepIndex;
    const total = state.ratings.length;
    const pct = Math.round((done / total) * 100);
    const nextRating = state.ratings[Math.min(done, total - 1)] ?? 0;
    const isComplete = !!state.completedAt || done >= total;

    return (
      <section className="mb-3 rounded-xl2 border-2 border-brand-500/40 bg-gradient-to-br from-brand-500/10 to-transparent p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">📚 Course: {prettify(state.theme)}</h2>
            <p className="mt-0.5 text-xs text-ink-400">
              {isComplete
                ? <>🎉 Complete! You worked through {total} puzzles from rating {state.ratings[0]} up to {state.ratings[total - 1]}.</>
                : <>Step <b className="text-white tabular-nums">{done + 1}</b> of {total} · next puzzle rating <b className="text-white tabular-nums">{nextRating}</b></>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isComplete ? (
              <button onClick={abandonCourse}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">
                Pick next course
              </button>
            ) : (
              <button onClick={solveNext}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">
                Solve next →
              </button>
            )}
            <button onClick={abandonCourse} title="Abandon this course"
              className="rounded-lg border border-ink-700 px-2 py-1.5 text-xs text-ink-400 hover:text-white">✕</button>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </section>
    );
  }

  return null;
}
