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

  async listUsers() {
    const db = this.db();
    const users = await db.collection("users").find({}, { projection: { bpass: 0 } }).toArray();
    const perfs = await db.collection("userperfs").find({}).toArray();
    const pm: Record<string, any> = {}; for (const p of perfs) pm[String(p._id)] = p;
    const agg = await db.collection("rounds").aggregate([
      { $project: { uid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, d: 1, w: 1 } },
      { $group: { _id: "$uid", solves: { $sum: 1 }, wins: { $sum: { $cond: ["$w", 1, 0] } }, last: { $max: "$d" } } },
    ]).toArray();
    const rm: Record<string, any> = {}; for (const r of agg) rm[String(r._id)] = r;
    return users.map((u: any) => {
      const pf = pm[String(u._id)] || {}; const rd = rm[String(u._id)] || {};
      const study = pf.study ? Object.fromEntries(Object.entries(pf.study).map(([k, v]: any) => [k, Math.round(v?.gl?.r ?? 0)])) : {};
      return {
        username: u.username, email: u.email || null, createdAt: u.createdAt || null,
        puzzleRating: pf.puzzle?.gl?.r ? Math.round(pf.puzzle.gl.r) : null,
        solves: rd.solves ?? u.count ?? 0, wins: rd.wins ?? 0,
        lastActive: rd.last || pf.puzzle?.la || null, lastLogin: u.lastLogin || null, study,
      };
    }).sort((a: any, b: any) => b.solves - a.solves);
  }

  async userDetail(username: string) {
    const db = this.db();
    const u: any = await db.collection("users").findOne({ username }, { projection: { bpass: 0 } });
    if (!u) return null;
    const id = String(u._id);
    const pf: any = await db.collection("userperfs").findOne({ _id: id as any });
    const lo = id + ":", hi = id + ";";
    const rounds = await db.collection("rounds").find({ _id: { $gte: lo, $lt: hi } as any }).sort({ d: -1 }).limit(50).toArray();
    const ratings: Record<string, { r: number; nb: number }> = {};
    if (pf) for (const [k, v] of Object.entries(pf)) {
      if (k === "_id") continue;
      const val: any = v;
      if (val?.gl?.r) ratings[k] = { r: Math.round(val.gl.r), nb: val.nb || 0 };
      else if (k === "study" && val) for (const [t, sv] of Object.entries(val)) { const s2: any = sv; if (s2?.gl?.r) ratings["study:" + t] = { r: Math.round(s2.gl.r), nb: s2.nb || 0 }; }
    }
    return {
      username: u.username, email: u.email || null, createdAt: u.createdAt || null, lastLogin: u.lastLogin || null, ratings,
      recent: rounds.map((r: any) => ({ puzzleId: String(r._id).split(":")[1], win: !!r.w, at: r.d, rating: r.r ?? null, ratingDiff: r.rd ?? null, themes: r.th || [] })),
    };
  }
}
