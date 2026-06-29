import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";
import { updatePuzzleRating, DEFAULT_VOLATILITY } from "../glicko/glicko";

const DEFAULT_STUDY_RATING = 1200;

// Serves + rates the study puzzles from study-factory (collection study_puzzles).
// Per-study user skill rating lives in userperfs.study.<type> (mirrors userperfs.puzzle).
@Injectable()
export class StudyService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("study_puzzles"); }
  private perfs() { return this.conn.db!.collection("userperfs"); }

  async levels() {
    const rows = await this.col().aggregate([
      { $group: { _id: "$type", n: { $sum: 1 }, min: { $min: "$rating" }, avg: { $avg: "$rating" }, max: { $max: "$rating" } } },
    ]).toArray();
    const out: Record<string, { n: number; min: number; avg: number; max: number }> = {};
    for (const r of rows) out[r._id] = { n: r.n, min: r.min, avg: Math.round(r.avg), max: r.max };
    return out;
  }

  // The users current skill rating for a study type (persisted for logged-in users).
  async me(userId: string | null, type: string) {
    if (!userId) return { rating: DEFAULT_STUDY_RATING, nb: 0, guest: true };
    const doc: any = await this.perfs().findOne({ _id: userId as any }, { projection: { ["study." + type]: 1 } });
    const perf = doc?.study?.[type];
    return { rating: Math.round(perf?.gl?.r ?? DEFAULT_STUDY_RATING), nb: perf?.nb ?? 0, guest: false };
  }

  // One puzzle of `type` near `level` (matchmaking) — a beginner never gets a GM puzzle.
  async puzzle(type: string, level: number) {
    const band = 175;
    let docs = await this.col().find({ type, rating: { $gte: level - band, $lte: level + band } }).limit(50).toArray();
    if (!docs.length) docs = await this.col().find({ type }).limit(50).toArray();
    if (!docs.length) return null;
    const d = docs[Math.floor(Math.random() * docs.length)];
    if (!d) return null;
    return { id: String(d._id), fen: d.fen, rating: d.rating, result: d.result, dtm: d.dtm, solution: d.solution };
  }

  // Record a solve/fail: Glicko-update the users per-study rating AND self-calibrate the puzzles rating.
  async complete(puzzleId: string, body: { win: boolean; userId?: string | null; rating?: number; deviation?: number }) {
    let pz: any = null;
    try { pz = await this.col().findOne({ _id: new ObjectId(puzzleId) }); } catch { pz = null; }
    if (!pz) return null;
    const win = !!body.win;
    const type = pz.type as string;
    const puzzleGlicko = { r: pz.rating ?? 1500, d: pz.rd ?? 350, v: pz.vol ?? DEFAULT_VOLATILITY };

    if (body.userId) {
      const doc: any = (await this.perfs().findOne({ _id: body.userId as any })) || {};
      const perf = doc.study?.[type] || { gl: { r: DEFAULT_STUDY_RATING, d: 500, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null };
      const upd = updatePuzzleRating(perf, puzzleGlicko, win);
      await this.perfs().updateOne({ _id: body.userId as any }, { $set: { ["study." + type]: upd.userPerf } }, { upsert: true });
      await this.col().updateOne({ _id: pz._id }, { $set: { rating: Math.round(upd.puzzleGlicko.r), rd: upd.puzzleGlicko.d, vol: upd.puzzleGlicko.v }, $inc: { nb: 1 } });
      await this.conn.db!.collection("study_rounds").updateOne(
        { _id: `${body.userId}:${puzzleId}` as any },
        { $set: { w: win, d: new Date(), t: type, r: Math.round(upd.userPerf.gl.r), rd: Math.round(upd.ratingDiff) } },
        { upsert: true },
      );
      return { win, rating: Math.round(upd.userPerf.gl.r), ratingDiff: Math.round(upd.ratingDiff), puzzleRating: Math.round(upd.puzzleGlicko.r) };
    }

    // Guest — one-off (not persisted), but anonymous solves still self-calibrate the puzzle.
    const r = body.rating || DEFAULT_STUDY_RATING, dev = body.deviation || 500;
    const upd = updatePuzzleRating({ gl: { r, d: dev, v: DEFAULT_VOLATILITY }, nb: 0, re: [], la: null }, puzzleGlicko, win);
    await this.col().updateOne({ _id: pz._id }, { $set: { rating: Math.round(upd.puzzleGlicko.r), rd: upd.puzzleGlicko.d, vol: upd.puzzleGlicko.v }, $inc: { nb: 1 } });
    return { win, rating: Math.round(upd.userPerf.gl.r), ratingDiff: Math.round(upd.ratingDiff), puzzleRating: Math.round(upd.puzzleGlicko.r) };
  }
}
