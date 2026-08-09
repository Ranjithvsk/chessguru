// Phase 7n: rating-milestone celebrations.
//
// After every rated solve we check whether the user just crossed a round-number
// rating threshold (upwards). Every 100 points from 800 to 2200. On first
// crossing we insert a `milestones` row and fire a push; the puzzle-complete
// response includes the milestone so the client can render confetti + a badge.
//
// If a user later dips below and re-crosses the same milestone, we don't
// celebrate again — the row already exists. This is intentional: repeated
// hits of the same threshold get old fast.

import type { Connection } from "mongoose";
import { PushService } from "../push/push.service";

const STEPS = [800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200] as const;
// Solve-count milestones (Phase 7o). Same overlay + push infra as rating but
// on a "practice volume" axis. Rows are keyed by (userId, type, value) so a
// count=100 milestone doesn't collide with a rating=100 milestone (which
// doesn't exist, but the key shape leaves room to add more axes later).
const COUNT_STEPS = [25, 100, 250, 500, 1000, 2500, 5000] as const;

/** Highest milestone (if any) crossed going from `from` → `to`. Only counts
 *  upward crossings. If several are crossed in one solve (unlikely but
 *  possible during initial calibration), the highest wins. */
export function crossedMilestone(from: number, to: number): number | null {
  if (!(to > from)) return null;
  let hit: number | null = null;
  for (const step of STEPS) {
    if (from < step && to >= step) hit = step;
  }
  return hit;
}

export function crossedCountMilestone(from: number, to: number): number | null {
  if (!(to > from)) return null;
  let hit: number | null = null;
  for (const step of COUNT_STEPS) {
    if (from < step && to >= step) hit = step;
  }
  return hit;
}

export interface MilestoneResult {
  type: "rating" | "count";
  milestone: number;
  firstTime: boolean;   // true when we just inserted this row — client shows the big celebration
}

/** Record + celebrate (if first time). Returns null if no milestone was hit.
 *  Idempotent by ({userId, type, value}) — a second crossing after a dip is a
 *  no-op as far as celebrations go, though we still count it via $inc.
 *  If BOTH a rating and a count milestone fire on the same solve (very rare —
 *  e.g. crossing 1500 rating on your 500th puzzle), the rating one wins the
 *  overlay because rating is the more meaningful signal; the count milestone
 *  still records + pushes so it's not lost. */
export async function recordAndCelebrate(
  conn: Connection, push: PushService, userId: string,
  ratingFrom: number, ratingTo: number,
  countFrom: number, countTo: number,
): Promise<MilestoneResult | null> {
  const ratingHit = crossedMilestone(Math.round(ratingFrom), Math.round(ratingTo));
  const countHit  = crossedCountMilestone(Math.round(countFrom), Math.round(countTo));
  const now = new Date();

  const recordOne = async (type: "rating" | "count", value: number): Promise<MilestoneResult> => {
    const res = await conn.db!.collection("milestones").updateOne(
      { userId, type, value },
      { $setOnInsert: { userId, type, value, firstCrossedAt: now }, $set: { lastCrossedAt: now }, $inc: { crossings: 1 } },
      { upsert: true },
    );
    return { type, milestone: value, firstTime: !!res.upsertedId };
  };

  let ratingRes: MilestoneResult | null = null;
  let countRes: MilestoneResult | null = null;
  if (ratingHit != null) ratingRes = await recordOne("rating", ratingHit);
  if (countHit != null)  countRes  = await recordOne("count", countHit);

  // Push (fire-and-forget) for each first-time crossing.
  if (ratingRes?.firstTime) {
    push.sendToUser(userId, {
      title: `🎉 You just hit ${ratingHit}!`,
      body: `Your puzzle rating just crossed ${ratingHit}. Keep going.`,
      url: "/dashboard", tag: `cg-milestone-rating-${ratingHit}`,
    }).catch(() => { /* per-service logged */ });
  }
  if (countRes?.firstTime) {
    push.sendToUser(userId, {
      title: `🏅 ${countHit} puzzles solved!`,
      body: `That's a lot of tactics. Keep the streak alive.`,
      url: "/dashboard", tag: `cg-milestone-count-${countHit}`,
    }).catch(() => { /* per-service logged */ });
  }

  // Client only renders one overlay per solve — prefer rating (more meaningful).
  return ratingRes ?? countRes ?? null;
}
