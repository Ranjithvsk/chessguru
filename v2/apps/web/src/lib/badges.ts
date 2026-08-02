// Memory Master 500 — belts + badges derived from FSRS state.
//
// Everything here is a PURE FUNCTION over the existing card store — no event
// log, no server, no separate persistence. Every badge is a computable
// threshold: cards mastered, openings activated, streak days, retention %,
// total reps, family mastery.
//
// Called by pages/Progress.tsx to render the belt + badge grid.

import type { Progress } from "./progress";
import { loadAllStates, activatedSlugs } from "./cards";
import { openingBySlug } from "./openings";

/* ---------- BELT (single-track progression by cards mastered) ---------- */
export interface Belt {
  name: string;
  colorHex: string;
  threshold: number;   // cards mastered to reach this belt
}
export const BELTS: Belt[] = [
  { name: "White",  colorHex: "#f8fafc", threshold: 0 },
  { name: "Yellow", colorHex: "#facc15", threshold: 25 },
  { name: "Orange", colorHex: "#fb923c", threshold: 75 },
  { name: "Green",  colorHex: "#22c55e", threshold: 150 },
  { name: "Blue",   colorHex: "#3b82f6", threshold: 300 },
  { name: "Purple", colorHex: "#a855f7", threshold: 500 },
  { name: "Brown",  colorHex: "#92400e", threshold: 750 },
  { name: "Black",  colorHex: "#111827", threshold: 1000 },
];

export interface BeltProgress {
  current: Belt;
  next: Belt | null;   // null when on Black
  toNext: number;      // cards mastered still needed
  pct: number;         // 0-100 progress within current tier
}

export function computeBelt(mastered: number): BeltProgress {
  let cur = BELTS[0]!;
  let next: Belt | null = null;
  for (let i = 0; i < BELTS.length; i++) {
    if (mastered >= BELTS[i]!.threshold) cur = BELTS[i]!;
    else { next = BELTS[i]!; break; }
  }
  const span = next ? next.threshold - cur.threshold : 1;
  const gained = mastered - cur.threshold;
  const pct = next ? Math.min(100, Math.round((gained / span) * 100)) : 100;
  return { current: cur, next, toNext: next ? next.threshold - mastered : 0, pct };
}

/* ---------- BADGES (unlockable achievements) ---------- */
export interface Badge {
  id: string;
  name: string;
  hint: string;
  glyph: string;
  earned: boolean;
  /** For progress-badge groups: how close we are ("120 / 250 cards"). */
  progress?: string;
}

export function computeBadges(p: Progress): Badge[] {
  const badges: Badge[] = [];

  // 1) Cards mastered milestones ---------------------------------------------
  const CARD_TIERS = [1, 10, 25, 100, 250, 500, 1000];
  for (const t of CARD_TIERS) {
    badges.push({
      id: `mastered-${t}`,
      name: `${t} card${t === 1 ? "" : "s"} mastered`,
      hint: `Stability ≥ 21 days on ${t} card${t === 1 ? "" : "s"}.`,
      glyph: t >= 500 ? "🏅" : t >= 100 ? "🥇" : t >= 25 ? "🥈" : "🥉",
      earned: p.masteredCards >= t,
      progress: p.masteredCards < t ? `${p.masteredCards} / ${t}` : undefined,
    });
  }

  // 2) Openings activated ----------------------------------------------------
  const OPENING_TIERS = [1, 5, 20, 50, 100];
  for (const t of OPENING_TIERS) {
    badges.push({
      id: `activated-${t}`,
      name: `${t} opening${t === 1 ? "" : "s"} in queue`,
      hint: `Activate ${t} openings for spaced-repetition.`,
      glyph: t >= 50 ? "📚" : t >= 20 ? "📖" : "📕",
      earned: p.activeOpenings >= t,
      progress: p.activeOpenings < t ? `${p.activeOpenings} / ${t}` : undefined,
    });
  }

  // 3) Streaks ---------------------------------------------------------------
  const STREAKS = [3, 7, 30, 100];
  for (const t of STREAKS) {
    badges.push({
      id: `streak-${t}`,
      name: `${t}-day streak`,
      hint: `Review ≥ 1 card every day for ${t} days.`,
      glyph: t >= 100 ? "🔥" : t >= 30 ? "☄️" : "✨",
      earned: p.bestStreakDays >= t,
      progress: p.bestStreakDays < t ? `${p.bestStreakDays} / ${t}` : undefined,
    });
  }

  // 4) Retention ------------------------------------------------------------
  const totalReps = countTotalReps();
  badges.push({
    id: "retention-95",
    name: "95%+ retention",
    hint: "Keep retention above 95% with 100+ total reviews.",
    glyph: "🎯",
    earned: totalReps >= 100 && p.retentionPct >= 95,
    progress: totalReps < 100 ? `${totalReps} / 100 reviews` : `${p.retentionPct}% retention`,
  });

  // 5) Total reviews --------------------------------------------------------
  const REVIEW_TIERS = [100, 500, 1000, 5000];
  for (const t of REVIEW_TIERS) {
    badges.push({
      id: `reviews-${t}`,
      name: `${t.toLocaleString()} reviews`,
      hint: `Grade ${t.toLocaleString()} cards total.`,
      glyph: t >= 1000 ? "⚡" : t >= 500 ? "💫" : "⭐",
      earned: totalReps >= t,
      progress: totalReps < t ? `${totalReps} / ${t.toLocaleString()}` : undefined,
    });
  }

  // 6) Family mastery -------------------------------------------------------
  for (const f of p.byFamily) {
    if (f.cards >= 5 && f.mastered === f.cards) {
      badges.push({
        id: `family-${f.familyId}`,
        name: `${f.familyName} master`,
        hint: `All ${f.cards} activated cards in this family mastered.`,
        glyph: "👑",
        earned: true,
      });
    }
  }

  return badges;
}

/** Count total FSRS reviews across every card (reps + lapses). */
function countTotalReps(): number {
  const store = loadAllStates();
  const active = activatedSlugs();
  let total = 0;
  for (const [id, s] of Object.entries(store)) {
    const slug = id.split(":")[0];
    if (!slug || !active.has(slug)) continue;
    total += s.reps + s.lapses;
  }
  return total;
}

/** Slug of a randomly-chosen family the user is closest to mastering (for
 *  a "one more family to unlock the crown" nudge). Returns null if none apply. */
export function nextFamilyToMaster(p: Progress): { familyName: string; remaining: number } | null {
  const close = p.byFamily
    .filter((f) => f.cards >= 5 && f.mastered < f.cards)
    .map((f) => ({ familyName: f.familyName, remaining: f.cards - f.mastered }))
    .sort((a, b) => a.remaining - b.remaining);
  return close[0] ?? null;
}

/** Helper for Progress.tsx: map an opening slug to its family badge (for
 *  "you just mastered your last French card — unlocked French Master!"). */
export function familyBadgeForSlug(slug: string): string | null {
  const o = openingBySlug.get(slug);
  return o ? `family-${o.familyId}` : null;
}
