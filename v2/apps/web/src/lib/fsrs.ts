// Memory Master 500 — FSRS-lite scheduler.
//
// A simplified spaced-repetition scheduler in the FSRS-v4 family:
//   - Card state: new → learning → review (→ relearning on lapse)
//   - Grades: Again(1) / Hard(2) / Good(3) / Easy(4)
//   - Two continuous states per card:
//       stability  D  — how many days until 90 % retention
//       difficulty  — a 1-10 measure of how hard the card feels
//   - Next-due formula: due = now + stability days
//
// This is NOT the full FSRS-v4 optimisation (no per-user parameter fitting via
// gradient descent over review history) — the point is to have a defensible
// scheduler in ~120 lines that beats naive SM-2 and lands cards on sane review
// dates from day one. When we have enough real reviews we can swap in the
// full FSRS or wire an existing lib.
//
// References:
//   https://github.com/open-spaced-repetition/fsrs4anki/wiki/
//   https://blog.senrigan.io/fsrs.html
export type Grade = 1 | 2 | 3 | 4;
export const GRADE_LABELS: Record<Grade, { key: string; label: string; shortcut: string }> = {
  1: { key: "again", label: "Again",  shortcut: "1" },
  2: { key: "hard",  label: "Hard",   shortcut: "2" },
  3: { key: "good",  label: "Good",   shortcut: "3" },
  4: { key: "easy",  label: "Easy",   shortcut: "4" },
};

export type CardState = "new" | "learning" | "review" | "relearning";

export interface FsrsState {
  state: CardState;
  stability: number;          // days
  difficulty: number;         // 1-10
  due: string;                // ISO date-time
  lastReview?: string;
  reps: number;               // successful reviews (Good/Easy)
  lapses: number;             // Again after being in review
}

/** Initial state for a brand-new card. `due` is now — first review is immediate. */
export function newCard(now: Date = new Date()): FsrsState {
  return {
    state: "new",
    stability: 0,
    difficulty: 5,           // middle of 1-10
    due: now.toISOString(),
    reps: 0,
    lapses: 0,
  };
}

// FSRS-inspired parameter constants (defaults roughly matching FSRS-v4).
const W = {
  initialStability: [0.5, 1.0, 2.5, 6.0],   // days per grade for a NEW card graduating
  hardMultiplier: 1.2,
  easyBonus: 1.5,
  requestRetention: 0.9,
  minDifficulty: 1,
  maxDifficulty: 10,
};

/** Advance one card by one grade. Returns the NEW state — caller persists. */
export function grade(card: FsrsState, g: Grade, now: Date = new Date()): FsrsState {
  const nowISO = now.toISOString();
  const nextDifficulty = clampDifficulty(card.difficulty + difficultyDelta(g));

  // NEW / LEARNING: first-graduation ladder.
  if (card.state === "new" || card.state === "learning") {
    if (g === 1) {
      // Again — restart the learning ladder, 1 minute cool-down.
      return {
        state: "learning",
        stability: 0,
        difficulty: nextDifficulty,
        due: addMinutes(now, 1).toISOString(),
        lastReview: nowISO,
        reps: card.reps,
        lapses: card.lapses,
      };
    }
    // 2/3/4 → GRADUATE to review with the grade-mapped initial stability.
    const stability = W.initialStability[g - 1]!;
    return {
      state: "review",
      stability,
      difficulty: nextDifficulty,
      due: addDays(now, stability).toISOString(),
      lastReview: nowISO,
      reps: card.reps + 1,
      lapses: card.lapses,
    };
  }

  // REVIEW: FSRS-like stability growth.
  if (card.state === "review") {
    if (g === 1) {
      // Lapse — enter relearning, brief cool-down, keep difficulty higher.
      return {
        state: "relearning",
        stability: Math.max(0.5, card.stability * 0.2),   // memory retained a bit
        difficulty: nextDifficulty,
        due: addMinutes(now, 5).toISOString(),
        lastReview: nowISO,
        reps: card.reps,
        lapses: card.lapses + 1,
      };
    }
    // Grow stability. Rough FSRS-v4-ish: newS = S * (1 + f(D) * f(retention) * gradeMul).
    // We approximate with a stable-enough closed-form.
    const gradeMul = g === 2 ? W.hardMultiplier : g === 3 ? 2.5 : W.easyBonus * 3;
    const diffFactor = (11 - card.difficulty) / 10;  // easier cards grow faster
    const newStability = Math.min(365 * 4, card.stability * (1 + diffFactor * gradeMul * 0.3));
    return {
      state: "review",
      stability: newStability,
      difficulty: nextDifficulty,
      due: addDays(now, newStability).toISOString(),
      lastReview: nowISO,
      reps: card.reps + 1,
      lapses: card.lapses,
    };
  }

  // RELEARNING: like learning but after a lapse. Return to review on any pass.
  if (g === 1) {
    return { ...card, difficulty: nextDifficulty, due: addMinutes(now, 5).toISOString(), lastReview: nowISO };
  }
  const stability = Math.max(1, card.stability);
  return {
    state: "review",
    stability,
    difficulty: nextDifficulty,
    due: addDays(now, stability).toISOString(),
    lastReview: nowISO,
    reps: card.reps + 1,
    lapses: card.lapses,
  };
}

function difficultyDelta(g: Grade): number {
  // Again = big rise · Hard = small rise · Good = neutral · Easy = fall.
  return g === 1 ? 1.5 : g === 2 ? 0.5 : g === 3 ? 0 : -0.5;
}
function clampDifficulty(d: number): number {
  return Math.max(W.minDifficulty, Math.min(W.maxDifficulty, d));
}
function addDays(d: Date, days: number): Date { return new Date(d.getTime() + days * 86_400_000); }
function addMinutes(d: Date, min: number): Date { return new Date(d.getTime() + min * 60_000); }

/** True if the card is due at (or before) `now`. */
export function isDue(card: FsrsState, now: Date = new Date()): boolean {
  return new Date(card.due) <= now;
}

/** Human "in 3 days", "in 2 minutes", "overdue by 4 hours" for the UI. */
export function humanDue(card: FsrsState, now: Date = new Date()): string {
  const ms = new Date(card.due).getTime() - now.getTime();
  const min = Math.round(ms / 60_000);
  if (Math.abs(min) < 60) return min >= 0 ? `in ${min} min` : `overdue ${-min} min`;
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return hr >= 0 ? `in ${hr} h` : `overdue ${-hr} h`;
  const d = Math.round(hr / 24);
  return d >= 0 ? `in ${d} d` : `overdue ${-d} d`;
}
