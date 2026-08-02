// Memory Master 500 — progress metrics derived from card state.
//
// Pure functions over the FSRS store — the dashboard never queries state
// directly. Everything the dashboard needs is computed once and returned as a
// plain object.

import { openingBySlug, FAMILIES } from "./openings";
import { activatedSlugs, loadAllStates } from "./cards";
import type { FsrsState } from "./fsrs";

/** A card is "mastered" once its next-review stability exceeds 21 days —
 *  the point at which forgetting curves flatten and it becomes long-term. */
const MASTERED_STABILITY_DAYS = 21;

export interface Progress {
  totalCards: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
  masteredCards: number;
  lapseTotal: number;
  activeOpenings: number;

  /** Retention rate = 1 - (lapses / reps), across all cards with ≥1 rep. */
  retentionPct: number;

  /** Consecutive days ending today with at least 1 review. */
  streakDays: number;

  /** Best-ever streak seen in the review log. */
  bestStreakDays: number;

  /** Review count per day for the last 30 days (index 0 = 30 days ago … 29 = today). */
  reviewsByDay: number[];

  /** Due-card count per day for the next 30 days (0 = today, 29 = 29 days out). */
  dueByDay: number[];

  /** Per-family: activated openings + card counts + mastered fraction. */
  byFamily: Array<{
    familyId: string;
    familyName: string;
    colorHex: string;
    openings: number;
    cards: number;
    mastered: number;
  }>;

  /** Top 5 recently-studied opening slugs (by lastReview). */
  recent: Array<{ slug: string; name: string; when: string }>;
}

export function computeProgress(now: Date = new Date()): Progress {
  const store = loadAllStates();
  const active = activatedSlugs();
  const cards = Object.entries(store)
    .filter(([id]) => {
      const slug = id.split(":")[0];
      return slug && active.has(slug);
    })
    .map(([id, s]) => ({ id, s }));

  // Buckets ----------------------------------------------------------------
  let newCards = 0, learningCards = 0, reviewCards = 0, masteredCards = 0, lapseTotal = 0;
  let repsTotal = 0;
  for (const { s } of cards) {
    if (s.state === "new") newCards++;
    else if (s.state === "learning" || s.state === "relearning") learningCards++;
    else reviewCards++;
    if (s.stability >= MASTERED_STABILITY_DAYS) masteredCards++;
    lapseTotal += s.lapses;
    repsTotal += s.reps + s.lapses;
  }
  const retentionPct = repsTotal > 0 ? Math.round((1 - lapseTotal / repsTotal) * 100) : 100;

  // Reviews-per-day (last 30 days) -----------------------------------------
  const reviewsByDay = new Array<number>(30).fill(0);
  const dayKeysSeen = new Set<string>();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const { s } of cards) {
    if (!s.lastReview) continue;
    const d = new Date(s.lastReview);
    const dayDiff = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
    if (dayDiff >= 0 && dayDiff < 30) reviewsByDay[29 - dayDiff]!++;
    dayKeysSeen.add(dayKey(d));
  }

  // Streak (approx: consecutive days with ≥1 review, ending today or yesterday)
  const sortedDays = [...dayKeysSeen].sort().reverse();
  let streakDays = 0;
  let bestStreakDays = 0;
  if (sortedDays.length > 0) {
    let cursor = new Date(today);
    // Allow "today or yesterday" as the streak seed so an evening user isn't
    // penalised for not reviewing yet.
    const todayKey = dayKey(today);
    const yesterdayKey = dayKey(new Date(today.getTime() - 86_400_000));
    if (sortedDays[0] === todayKey || sortedDays[0] === yesterdayKey) {
      if (sortedDays[0] === yesterdayKey) cursor = new Date(cursor.getTime() - 86_400_000);
      for (const dk of sortedDays) {
        if (dk === dayKey(cursor)) {
          streakDays++;
          cursor = new Date(cursor.getTime() - 86_400_000);
        } else if (new Date(dk) < cursor) {
          break;
        }
      }
    }
    // Best-ever: longest run of consecutive dates in the sorted list.
    let run = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      const prev = new Date(sortedDays[i - 1]!);
      const cur = new Date(sortedDays[i]!);
      const diffDays = Math.round((prev.getTime() - cur.getTime()) / 86_400_000);
      if (diffDays === 1) { run++; bestStreakDays = Math.max(bestStreakDays, run); }
      else run = 1;
    }
    bestStreakDays = Math.max(bestStreakDays, run, streakDays);
  }

  // Upcoming due load (next 30 days) ---------------------------------------
  const dueByDay = new Array<number>(30).fill(0);
  for (const { s } of cards) {
    const due = new Date(s.due);
    const dueDayStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const daysOut = Math.floor((dueDayStart.getTime() - today.getTime()) / 86_400_000);
    if (daysOut < 0) dueByDay[0]!++;        // overdue lumps onto today
    else if (daysOut < 30) dueByDay[daysOut]!++;
  }

  // Per-family --------------------------------------------------------------
  const familyBuckets = new Map<string, { openings: Set<string>; cards: number; mastered: number }>();
  for (const { id, s } of cards) {
    const slug = id.split(":")[0]!;
    const o = openingBySlug.get(slug);
    if (!o) continue;
    let b = familyBuckets.get(o.familyId);
    if (!b) { b = { openings: new Set(), cards: 0, mastered: 0 }; familyBuckets.set(o.familyId, b); }
    b.openings.add(slug);
    b.cards++;
    if (s.stability >= MASTERED_STABILITY_DAYS) b.mastered++;
  }
  const byFamily = FAMILIES
    .map((f) => {
      const b = familyBuckets.get(f.id);
      return {
        familyId: f.id,
        familyName: f.name,
        colorHex: f.colorHex,
        openings: b?.openings.size ?? 0,
        cards: b?.cards ?? 0,
        mastered: b?.mastered ?? 0,
      };
    })
    .filter((r) => r.cards > 0)
    .sort((a, b) => b.cards - a.cards);

  // Recent 5 openings -------------------------------------------------------
  const perOpeningLast = new Map<string, string>();
  for (const { id, s } of cards) {
    if (!s.lastReview) continue;
    const slug = id.split(":")[0]!;
    const prev = perOpeningLast.get(slug);
    if (!prev || s.lastReview > prev) perOpeningLast.set(slug, s.lastReview);
  }
  const recent = [...perOpeningLast.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, 5)
    .map(([slug, when]) => ({
      slug,
      name: openingBySlug.get(slug)?.name ?? slug,
      when,
    }));

  return {
    totalCards: cards.length,
    newCards,
    learningCards,
    reviewCards,
    masteredCards,
    lapseTotal,
    activeOpenings: active.size,
    retentionPct,
    streakDays,
    bestStreakDays,
    reviewsByDay,
    dueByDay,
    byFamily,
    recent,
  };
}
