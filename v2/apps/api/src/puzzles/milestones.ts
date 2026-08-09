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

export interface MilestoneResult {
  milestone: number;
  firstTime: boolean;   // true when we just inserted this row — client shows the big celebration
}

/** Record + celebrate (if first time). Returns null if no milestone was hit.
 *  Idempotent by ({userId, rating}) — a second crossing after a dip is a no-op
 *  as far as celebrations go, though we still count it via $inc. */
export async function recordAndCelebrate(
  conn: Connection, push: PushService, userId: string, from: number, to: number,
): Promise<MilestoneResult | null> {
  const hit = crossedMilestone(Math.round(from), Math.round(to));
  if (hit == null) return null;
  const now = new Date();
  const res = await conn.db!.collection("milestones").updateOne(
    { userId, rating: hit },
    { $setOnInsert: { userId, rating: hit, firstCrossedAt: now }, $set: { lastCrossedAt: now }, $inc: { crossings: 1 } },
    { upsert: true },
  );
  const firstTime = !!res.upsertedId;
  if (firstTime) {
    // Fire-and-forget — celebration push shouldn't block the puzzle response.
    push.sendToUser(userId, {
      title: `🎉 You just hit ${hit}!`,
      body: `Your puzzle rating just crossed ${hit}. Keep going.`,
      url: "/dashboard",
      tag: `cg-milestone-${hit}`,
    }).catch(() => { /* per-service logged */ });
  }
  return { milestone: hit, firstTime };
}
