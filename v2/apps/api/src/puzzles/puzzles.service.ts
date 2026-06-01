import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { updatePuzzleRating, DEFAULT_VOLATILITY } from "../glicko/glicko";
import { fmtPuzzle, applyLastMove } from "../lib/puzzle-format";

const DIFF: Record<string, number> = { easiest: -600, easier: -300, normal: 0, harder: 300, hardest: 600 };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
// Cap the exclusion set so $nin stays cheap even for very active accounts.
const MAX_PLAYED = 5000;

@Injectable()
export class PuzzlesService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("puzzles"); }

  /**
   * Puzzle IDs to KEEP OUT of this user's draw (spaced repetition):
   *   - SOLVED puzzles (w:true) are excluded forever — never repeat a solved one.
   *   - FAILED puzzles (w:false) are excluded only for REPEAT_FAILED_DAYS, then become
   *     eligible again so the user gets another crack at the ones they missed.
   * rounds._id is "userId:puzzleId"; range scan on the indexed _id, most-recent-first.
   */
  private async playedIds(userId: string): Promise<string[]> {
    // ";" (0x3B) sorts immediately after ":" (0x3A), so [userId:, userId;) brackets exactly this user's rounds.
    const lo = `${userId}:`;
    const hi = `${userId};`;
    const REPEAT_FAILED_DAYS = 14;
    const cutoff = new Date(Date.now() - REPEAT_FAILED_DAYS * 86400000);
    const rows = await this.conn.db!
      .collection("rounds")
      .find({ _id: { $gte: lo, $lt: hi } as any }, { projection: { _id: 1, w: 1, d: 1 } })
      .sort({ d: -1 })
      .limit(MAX_PLAYED)
      .toArray();
    const out: string[] = [];
    for (const r of rows as any[]) {
      const id = String(r._id).slice(lo.length);
      if (r.w) out.push(id);                                          // solved -> never repeat
      else if (r.d && new Date(r.d) >= cutoff) out.push(id);          // failed recently -> hold off
      // failed long ago -> eligible to retry
    }
    return out;
  }

  async random(theme: string, difficulty: string, rating: number, maxPc?: number, userId?: string | null) {
    const target = clamp(rating + (DIFF[difficulty] ?? 0), 400, 3000);
    const played = userId ? await this.playedIds(userId) : [];
    const playedSet = new Set(played);

    // ── FAST PATH: precomputed pools (`paths`) — sample an id, fetch by indexed _id. ──
    // paths: { _id:"theme|tier|RRRR", min, max, ids:[puzzleId] }; exactly one band path per rating.
    // Avoids the $sample-over-5.9M-docs scan (4–6s). pieceCount-filtered requests fall through.
    if (!maxPc || maxPc >= 32) {
      const band = String(Math.max(0, Math.round(target))).padStart(4, "0");
      const esc = theme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const paths = this.conn.db!.collection("paths");
      for (const tier of ["top", "good", "all"]) {
        const key = `${theme}|${tier}|${band}`;
        const path = await paths.findOne({
          _id: { $regex: `^${esc}\\|${tier}\\|` } as any,
          min: { $lte: key },
          max: { $gte: key },
        });
        const ids: string[] = (path?.ids as string[]) || [];
        if (!ids.length) continue;
        const avail = ids.filter((id) => !playedSet.has(id));
        if (!avail.length) continue; // user cleared this pool -> next tier, then fresh $sample fallback
        const pick = avail[Math.floor(Math.random() * avail.length)]!;
        const d = await this.col().findOne({ _id: pick as any });
        if (d) return applyLastMove(fmtPuzzle(d));
      }
    }

    // ── FALLBACK: $match + $sample (rare: piece-count filter, exotic theme, or missing pool). ──
    const flex = Math.round(100 + Math.abs(1500 - target) / 4);
    const themeQ = theme && theme !== "mix" ? { themes: theme } : {};
    const pcQ = maxPc && maxPc < 32 ? { pieceCount: { $lte: maxPc } } : {};
    const dedupQ = played.length ? { _id: { $nin: played } } : {};
    const sample = async (m: any) => {
      const d = await this.col().aggregate([{ $match: m }, { $sample: { size: 1 } }]).toArray();
      return d.length ? applyLastMove(fmtPuzzle(d[0])) : null;
    };
    const tiers: any[] = [
      { vote: { $gte: 0.75 }, plays: { $gte: 100 } },
      { vote: { $gte: 0.5 }, plays: { $gte: 20 } },
      {},
    ];
    for (const tier of tiers) {
      const pz = await sample({ "glicko.r": { $gte: target - flex, $lte: target + flex }, ...tier, ...themeQ, ...pcQ, ...dedupQ });
      if (pz) return pz;
    }
    const wide = await sample({ "glicko.r": { $gte: target - 400, $lte: target + 400 }, ...themeQ, ...pcQ, ...dedupQ });
    if (wide) return wide;
    if (played.length) {
      const any = await sample({ "glicko.r": { $gte: target - 400, $lte: target + 400 }, ...themeQ, ...pcQ });
      if (any) return any;
    }
    return null;
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
      await this.conn.db!.collection("rounds").updateOne(
        { _id: `${userId}:${id}` as any },
        { $set: {
          w: win,
          d: new Date(),
          rd: upd.ratingDiff,                                 // rating change this solve
          r: Math.round(upd.userPerf.gl.r),                   // user rating after
          pr: Math.round(puzzleGlicko.r ?? 1500),             // puzzle rating
          th: Array.isArray(pz.themes) ? pz.themes : [],      // puzzle themes (for categorising)
          k: key,                                             // "puzzle" | "blindfold"
        } },
        { upsert: true },
      );
      return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl };
    }

    // guest — one-off, non-persisted
    const r = body.rating || 1500, dev = body.deviation || 500;
    if (hint) return { win, ratingDiff: 0, rating: r, glicko: { r, d: dev, v: DEFAULT_VOLATILITY } };
    const upd = updatePuzzleRating({ gl: { r, d: dev, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null }, puzzleGlicko, win);
    return { win, ratingDiff: upd.ratingDiff, rating: upd.userPerf.gl.r, glicko: upd.userPerf.gl };
  }
}
