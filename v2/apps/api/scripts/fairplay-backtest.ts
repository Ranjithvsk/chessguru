// Replay the Fair Play trust score day by day over past solves.
//   corepack pnpm --filter @chessguru/api exec tsx scripts/fairplay-backtest.ts mageswaran deepakcharanv akshayprathab gunachess
// Uses today's crowd baselines (built from all wins, so a little of the future
// leaks into each day — fine for an acceptance replay). Resets are ignored so
// the window is always the trailing 30 days.
import mongoose from "mongoose";
import { scoreStudent, type RoundLite } from "../src/fairplay/score";

const URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chessguru";
const users = process.argv.slice(2);
const FROM = new Date(process.env.FROM || "2026-08-01T00:00:00Z");
const TO = new Date(process.env.TO || new Date().toISOString());
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

(async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;
  const per = await db.collection("rounds").aggregate([
    { $match: { w: true, ms: { $gt: 0, $lte: 1_800_000 }, pr: { $gt: 0 } } },
    { $project: { pid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 1] }, ms: 1, pr: 1 } },
    { $group: { _id: "$pid", medMs: { $median: { input: "$ms", method: "approximate" } }, n: { $sum: 1 } } },
  ]).toArray();
  const perPuzzle = new Map(per.map((p: any) => [String(p._id), { medMs: p.medMs, n: p.n }]));
  const bands = await db.collection("rounds").aggregate([
    { $match: { w: true, ms: { $gt: 0, $lte: 1_800_000 }, pr: { $gt: 0 } } },
    { $project: { band: { $multiply: [{ $floor: { $divide: ["$pr", 100] } }, 100] }, ms: 1 } },
    { $group: { _id: "$band", medMs: { $median: { input: "$ms", method: "approximate" } }, n: { $sum: 1 } } },
    { $match: { n: { $gte: 20 } } },
  ]).toArray();
  const perBand = new Map(bands.map((b: any) => [Number(b._id), b.medMs]));
  console.log(`crowd: ${perPuzzle.size} puzzles, ${perBand.size} bands`);

  for (const u of users) {
    const loo = await db.collection("rounds").aggregate([
      { $match: { w: true, ms: { $gt: 0, $lte: 1_800_000 }, pr: { $gt: 0 }, _id: { $not: { $regex: `^${esc(u)}:` } } } },
      { $project: { band: { $multiply: [{ $floor: { $divide: ["$pr", 100] } }, 100] }, ms: 1 } },
      { $group: { _id: "$band", medMs: { $median: { input: "$ms", method: "approximate" } }, n: { $sum: 1 } } },
      { $match: { n: { $gte: 20 } } },
    ]).toArray();
    const looBand = new Map(loo.map((b: any) => [Number(b._id), b.medMs]));
    const crowd = (pid: string, pr: number) => { const p = perPuzzle.get(pid); if (p && p.n >= 5) return p.medMs; return looBand.get(Math.floor(pr / 100) * 100) ?? null; };
    const rows = await db.collection("rounds").find({ _id: { $regex: `^${esc(u)}:` } as any, k: "puzzle", d: { $lte: TO } }).sort({ d: 1 }).toArray();
    const all: RoundLite[] = rows.filter((x: any) => typeof x.pr === "number" && typeof x.r === "number").map((x: any) => ({ pid: String(x._id).slice(u.length + 1), d: new Date(x.d), pr: x.pr, r: x.r, w: !!x.w, ms: x.ms, mv_ms: x.mv_ms, dub: x.dub, dubr: x.dubr, th: x.th, sel: x.sel }));
    let firstWatch: string | null = null, firstReview: string | null = null;
    const series: string[] = [];
    for (let t = FROM.getTime(); t <= TO.getTime(); t += 86400000) {
      const dayEnd = new Date(t + 86400000 - 1), start = new Date(t + 86400000 - 30 * 86400000);
      const win = all.filter((x) => x.d >= start && x.d <= dayEnd);
      const r = scoreStudent(win, crowd);
      const dayStr = new Date(t).toISOString().slice(5, 10);
      series.push(`${dayStr}:${r.score}`);
      if (r.band !== "clear" && !firstWatch) firstWatch = dayStr;
      if (r.band === "review" && !firstReview) firstReview = dayStr;
    }
    const final = scoreStudent(all.filter((x) => x.d >= new Date(TO.getTime() - 30 * 86400000)), crowd);
    console.log(`\n${u}: ${all.length} solves · final ${final.score} (${final.band}) · components ${JSON.stringify(final.components)} · first watch ${firstWatch ?? "never"} · first review ${firstReview ?? "never"}`);
    console.log("  " + series.join(" "));
    console.log(`  hard ${JSON.stringify(final.evidence.hard)} atLevel ${JSON.stringify(final.evidence.atLevel)} above ${JSON.stringify(final.evidence.above)} crowdRatio ${final.evidence.crowdRatio} climb ${final.evidence.ratingStart}→${final.evidence.ratingEnd}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
