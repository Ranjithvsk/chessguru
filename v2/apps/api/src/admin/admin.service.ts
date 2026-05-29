import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

@Injectable()
export class AdminService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private db() { return this.conn.db!; }
  private p() { return this.db().collection("puzzles"); }
  private statsCache: { at: number; data: any } | null = null;
  private distCache: { at: number; data: any } | null = null;

  async overview() {
    if (this.statsCache && Date.now() - this.statsCache.at < 60_000) return this.statsCache.data;
    const [total, engineGenerated, verified, engineGames, bfPools, piecePools, paths, users] = await Promise.all([
      this.p().estimatedDocumentCount(),
      this.p().countDocuments({ sourceGameId: { $exists: true } }), // indexed
      this.p().countDocuments({ verified: true }),
      this.db().collection("enginegames").estimatedDocumentCount(),
      this.db().collection("bfPools").estimatedDocumentCount(),
      this.db().collection("piecePools").estimatedDocumentCount(),
      this.db().collection("paths").estimatedDocumentCount(),
      this.db().collection("users").estimatedDocumentCount(),
    ]);
    const data = { total, engineGenerated, verified, engineGames, pools: { bfPools, piecePools, paths }, users };
    this.statsCache = { at: Date.now(), data };
    return data;
  }

  async distribution() {
    if (this.distCache && Date.now() - this.distCache.at < 300_000) return this.distCache.data;
    const SAMPLE = 4000;
    const [themeAgg, ratingAgg] = await Promise.all([
      this.p().aggregate([{ $sample: { size: SAMPLE } }, { $unwind: "$themes" }, { $group: { _id: "$themes", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 15 }]).toArray(),
      this.p().aggregate([{ $sample: { size: SAMPLE } }, { $bucket: { groupBy: "$glicko.r", boundaries: [0, 800, 1200, 1600, 2000, 2400, 4000], default: "?", output: { count: { $sum: 1 } } } }]).toArray(),
    ]);
    const data = {
      sampled: SAMPLE,
      themeDist: themeAgg.map((t: any) => ({ theme: t._id, count: t.count })),
      ratingDist: ratingAgg.map((b: any) => ({ band: b._id, count: b.count })),
    };
    this.distCache = { at: Date.now(), data };
    return data;
  }

  async generated(limit: number) {
    const d = await this.p().find({ sourceGameId: { $exists: true } }).sort({ _id: -1 }).limit(limit).toArray();
    return { puzzles: d.map((x: any) => ({ id: x._id, fen: x.fen, rating: Math.round(x.glicko?.r ?? x.rating ?? 0), themes: x.themes || [], verified: !!x.verified })) };
  }
  async generatedStats() {
    const total = await this.p().countDocuments({ sourceGameId: { $exists: true } });
    const approved = await this.p().countDocuments({ sourceGameId: { $exists: true }, verified: true });
    const rejected = await this.p().countDocuments({ sourceGameId: { $exists: true }, rejected: true });
    return { total, approved, rejected, pending: total - approved - rejected };
  }
  async approve(id: string) { await this.p().updateOne({ _id: id as any }, { $set: { verified: true, rejected: false } }); this.statsCache = null; return { ok: true }; }
  async reject(id: string) { await this.p().updateOne({ _id: id as any }, { $set: { verified: false, rejected: true } }); this.statsCache = null; return { ok: true }; }
}
