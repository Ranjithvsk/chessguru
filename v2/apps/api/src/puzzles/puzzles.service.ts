import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { updatePuzzleRating, DEFAULT_VOLATILITY } from "../glicko/glicko";
import { fmtPuzzle, applyLastMove } from "../lib/puzzle-format";

const DIFF: Record<string, number> = { easiest: -600, easier: -300, normal: 0, harder: 300, hardest: 600 };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

@Injectable()
export class PuzzlesService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("puzzles"); }

  async random(theme: string, difficulty: string, rating: number, maxPc?: number) {
    const target = clamp(rating + (DIFF[difficulty] ?? 0), 400, 3000);
    const flex = Math.round(100 + Math.abs(1500 - target) / 4);
    const themeQ = theme && theme !== "mix" ? { themes: theme } : {};
    const pcQ = maxPc && maxPc < 32 ? { pieceCount: { $lte: maxPc } } : {};
    const tiers: any[] = [
      { vote: { $gte: 0.75 }, plays: { $gte: 100 } },
      { vote: { $gte: 0.5 }, plays: { $gte: 20 } },
      {},
    ];
    for (const tier of tiers) {
      const m = { "glicko.r": { $gte: target - flex, $lte: target + flex }, ...tier, ...themeQ, ...pcQ };
      const d = await this.col().aggregate([{ $match: m }, { $sample: { size: 1 } }]).toArray();
      if (d.length) return applyLastMove(fmtPuzzle(d[0]));
    }
    const wide = await this.col()
      .aggregate([{ $match: { "glicko.r": { $gte: target - 400, $lte: target + 400 }, ...themeQ, ...pcQ } }, { $sample: { size: 1 } }])
      .toArray();
    return wide.length ? applyLastMove(fmtPuzzle(wide[0])) : null;
  }

  async byId(id: string) {
    const d = await this.col().findOne({ _id: id as any });
    return d ? applyLastMove(fmtPuzzle(d)) : null;
  }

  async complete(id: string, body: { win: boolean; userId?: string | null; hint?: boolean; mode?: string; rating?: number; deviation?: number }) {
    const pz = await this.col().findOne({ _id: id as any });
    if (!pz) return null;
    await this.col().updateOne({ _id: id as any }, { $inc: { plays: 1 } });
    const puzzleGlicko = pz.glicko || { r: 1500, d: 500, v: DEFAULT_VOLATILITY };
    const { win, userId, hint, mode } = body;

    if (userId) {
      const perfsCol = this.conn.db!.collection("userperfs");
      const doc: any = (await perfsCol.findOne({ _id: userId as any })) || {};
      const key = mode === "blindfold" ? "blindfold" : "puzzle";
      const perf = doc[key] || { gl: { r: key === "blindfold" ? 800 : 1500, d: 500, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null };
      if (hint) return { win, ratingDiff: 0, rating: Math.round(perf.gl.r), glicko: perf.gl };
      const upd = updatePuzzleRating(perf, puzzleGlicko, win);
      await perfsCol.updateOne({ _id: userId as any }, { $set: { [key]: upd.userPerf } }, { upsert: true });
      await this.conn.db!.collection("rounds").updateOne({ _id: `${userId}:${id}` as any }, { $set: { w: win, d: new Date() } }, { upsert: true });
      return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl };
    }

    // guest — one-off, non-persisted
    const r = body.rating || 1500, dev = body.deviation || 500;
    if (hint) return { win, ratingDiff: 0, rating: r, glicko: { r, d: dev, v: DEFAULT_VOLATILITY } };
    const upd = updatePuzzleRating({ gl: { r, d: dev, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null }, puzzleGlicko, win);
    return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl };
  }
}
