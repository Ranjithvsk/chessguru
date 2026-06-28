import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

// Serves the rated study puzzles produced by study-factory/generate.py (collection study_puzzles).
// Each doc: { type, fen, result, dtm, solution[], rating, rd, vol, nb, maiaBand, ... }.
@Injectable()
export class StudyService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection("study_puzzles"); }

  // Per-type rating summary so the Study list can show each studys level.
  async levels() {
    const rows = await this.col().aggregate([
      { $group: { _id: "$type", n: { $sum: 1 }, min: { $min: "$rating" }, avg: { $avg: "$rating" }, max: { $max: "$rating" } } },
    ]).toArray();
    const out: Record<string, { n: number; min: number; avg: number; max: number }> = {};
    for (const r of rows) out[r._id] = { n: r.n, min: r.min, avg: Math.round(r.avg), max: r.max };
    return out;
  }

  // One puzzle of `type` near `level` (rating). Matchmaking so a beginner never gets a GM puzzle.
  async puzzle(type: string, level: number) {
    const band = 175;
    let docs = await this.col().find({ type, rating: { $gte: level - band, $lte: level + band } }).limit(50).toArray();
    if (!docs.length) docs = await this.col().find({ type }).limit(50).toArray();
    if (!docs.length) return null;
    const d = docs[Math.floor(Math.random() * docs.length)];
    if (!d) return null;
    return { id: String(d._id), fen: d.fen, rating: d.rating, result: d.result, dtm: d.dtm, solution: d.solution };
  }
}
