import { DEFAULT_DEVIATION, DEFAULT_RATING, DEFAULT_VOLATILITY, type Glicko, type Perf } from "@chessguru/glicko";
import { collection } from "./mongo";
import type { TimeControl } from "@chessguru/protocol";

/** Lichess-style speed bucket from estimated game duration (initial + 40·inc). */
export function speedOf(tc: TimeControl): string {
  const est = tc.initial + 40 * tc.increment;
  if (est < 180_000) return "bullet";
  if (est < 480_000) return "blitz";
  if (est < 1_500_000) return "rapid";
  return "classical";
}

const defaultPerf = (): Perf => ({ gl: { r: DEFAULT_RATING, d: DEFAULT_DEVIATION, v: DEFAULT_VOLATILITY }, nb: 0, la: null });

/** Per-user, per-speed rating doc in live_perfs (kept separate from puzzle userperfs). */
export async function getPerf(userId: string, speed: string): Promise<Perf> {
  const c = await collection("live_perfs");
  const doc = (await c.findOne({ _id: userId as never })) as Record<string, Perf> | null;
  return doc && doc[speed] ? doc[speed] : defaultPerf();
}

export async function setPerf(userId: string, speed: string, gl: Glicko, prev: Perf): Promise<void> {
  const c = await collection("live_perfs");
  const perf: Perf = { gl, nb: (prev.nb ?? 0) + 1, la: new Date() };
  await c.updateOne({ _id: userId as never }, { $set: { [speed]: perf } }, { upsert: true });
}
