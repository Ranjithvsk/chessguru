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

  /** All academies + their student counts — powers the super-admin picker on
   *  /academy/leaderboard so ranjith can hop across tenants. 2026-08-27. */
  async listAcademies(): Promise<Array<{ id: string; name: string; studentCount: number }>> {
    const [acads, counts, standaloneCount] = await Promise.all([
      this.db().collection("academies").find({}, { projection: { _id: 1, name: 1 } }).toArray(),
      this.db().collection("users").aggregate([
        { $match: { academyId: { $ne: null }, role: "student" } },
        { $group: { _id: "$academyId", n: { $sum: 1 } } },
      ]).toArray(),
      // Standalone users — self-signups with no academyId (also captures old
      // accounts predating multi-tenant). Owner ask 2026-08-27 (ranjith):
      // srinithi_sn / gunal / l-n1234 aren't in any academy but should still
      // show up somewhere for cross-fleet review.
      this.db().collection("users").countDocuments({
        $or: [{ academyId: null }, { academyId: { $exists: false } }],
      }),
    ]);
    const cmap: Record<string, number> = {};
    for (const c of counts) cmap[String(c._id)] = c.n;
    const rows = acads
      .map((a: any) => ({ id: String(a._id), name: String(a.name ?? a._id), studentCount: cmap[String(a._id)] ?? 0 }))
      .sort((a, b) => b.studentCount - a.studentCount);
    // Virtual bucket for non-academy self-signup users. Uses a sentinel id
    // "__platform__" — buildLeaderboard swaps this to `academyId: null` filter.
    return [
      { id: "__platform__", name: "ChessGuru (no academy)", studentCount: standaloneCount },
      ...rows,
    ];
  }

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
    // Owner ask 2026-08-27: leaderboard dashboard needs recent-window
    // rating trajectory so we can spot bleeders (high win% + falling rating)
    // vs gainers at a glance. 7-day window per user: solves, wins, net
    // rating change from oldest-round pre-rd to newest-round post-r.
    const cutoff7d = new Date(Date.now() - 7 * 86400000);
    const agg7d = await db.collection("rounds").aggregate([
      { $match: { d: { $gte: cutoff7d } } },
      { $project: { uid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, d: 1, w: 1, r: 1, rd: 1 } },
      { $sort: { uid: 1, d: 1 } },
      { $group: {
          _id: "$uid",
          solves7d: { $sum: 1 },
          wins7d: { $sum: { $cond: ["$w", 1, 0] } },
          firstR: { $first: "$r" }, firstRd: { $first: "$rd" },
          lastR: { $last: "$r" },
      } },
    ]).toArray();
    const r7m: Record<string, any> = {};
    for (const r of agg7d) r7m[String(r._id)] = r;
    const sagg = await db.collection("study_rounds").aggregate([
      { $project: { uid: { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] }, d: 1, w: 1 } },
      { $group: { _id: "$uid", solves: { $sum: 1 }, wins: { $sum: { $cond: ["$w", 1, 0] } }, last: { $max: "$d" } } },
    ]).toArray();
    const sm: Record<string, any> = {}; for (const r of sagg) sm[String(r._id)] = r;
    return users.map((u: any) => {
      const pf = pm[String(u._id)] || {}; const rd = rm[String(u._id)] || {}; const sd = sm[String(u._id)] || {};
      const r7 = r7m[String(u._id)] || {};
      const study = pf.study ? Object.fromEntries(Object.entries(pf.study).map(([k, v]: any) => [k, Math.round(v?.gl?.r ?? 0)])) : {};
      // 7d net rating change: start = firstRoundR - firstRoundRd (pre-round), end = lastRoundR (post-round).
      const startR7d = typeof r7.firstR === "number" ? r7.firstR - (r7.firstRd || 0) : null;
      const endR7d = typeof r7.lastR === "number" ? r7.lastR : null;
      const net7d = startR7d != null && endR7d != null ? endR7d - startR7d : null;
      return {
        username: u.username, email: u.email || null, createdAt: u.createdAt || null,
        academyId: u.academyId ?? null, role: u.role ?? null,
        puzzleRating: pf.puzzle?.gl?.r ? Math.round(pf.puzzle.gl.r) : null,
        solves: rd.solves ?? u.count ?? 0, wins: rd.wins ?? 0,
        studySolves: sd.solves ?? 0, studyWins: sd.wins ?? 0,
        lastActive: [rd.last, sd.last, pf.puzzle?.la].filter(Boolean).sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime())[0] || null,
        lastLogin: u.lastLogin || null, study,
        // Recent window (7d): rating trajectory + activity — powers the
        // leaderboard bleeders/gainers view. All null when user hasn't
        // played in the window.
        solves7d: r7.solves7d ?? 0,
        wins7d: r7.wins7d ?? 0,
        net7d,
      };
    }).sort((a: any, b: any) => (b.net7d ?? -1e9) - (a.net7d ?? -1e9));
  }

  async userDetail(username: string) {
    const db = this.db();
    const u: any = await db.collection("users").findOne({ username }, { projection: { bpass: 0 } });
    if (!u) return null;
    const id = String(u._id);
    const pf: any = await db.collection("userperfs").findOne({ _id: id as any });
    const lo = id + ":", hi = id + ";";
    const rounds = await db.collection("rounds").find({ _id: { $gte: lo, $lt: hi } as any }).sort({ d: -1 }).limit(50).toArray();
    const srounds = await db.collection("study_rounds").find({ _id: { $gte: lo, $lt: hi } as any }).sort({ d: -1 }).limit(50).toArray();
    const now = Date.now();
    const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const weekAgo = new Date(now - 7 * 86400000);
    const [solvesToday, solvesWeek] = await Promise.all([
      db.collection("rounds").countDocuments({ _id: { $gte: lo, $lt: hi } as any, d: { $gte: todayStart } }),
      db.collection("rounds").countDocuments({ _id: { $gte: lo, $lt: hi } as any, d: { $gte: weekAgo } }),
    ]);
    const sAgg = await db.collection("study_rounds").aggregate([{ $match: { _id: { $gte: lo, $lt: hi } } }, { $group: { _id: null, n: { $sum: 1 }, w: { $sum: { $cond: ["$w", 1, 0] } } } }]).toArray();
    const studyTot = sAgg[0]?.n ?? 0, studyWon = sAgg[0]?.w ?? 0;
    const themesAgg = await db.collection("rounds").aggregate([{ $match: { _id: { $gte: lo, $lt: hi } } }, { $unwind: "$th" }, { $group: { _id: "$th", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 6 }]).toArray();
    const topThemes = themesAgg.map((t: any) => ({ theme: t._id, n: t.n }));
    const ratingHistory = (((pf?.puzzle?.re as number[]) || []).slice(0, 20).reverse()).map((r) => Math.round(r));
    const ratings: Record<string, { r: number; nb: number }> = {};
    if (pf) for (const [k, v] of Object.entries(pf)) {
      if (k === "_id") continue;
      const val: any = v;
      if (val?.gl?.r) ratings[k] = { r: Math.round(val.gl.r), nb: val.nb || 0 };
      else if (k === "study" && val) for (const [t, sv] of Object.entries(val)) { const s2: any = sv; if (s2?.gl?.r) ratings["study:" + t] = { r: Math.round(s2.gl.r), nb: s2.nb || 0 }; }
    }
    return {
      username: u.username, email: u.email || null, createdAt: u.createdAt || null, lastLogin: u.lastLogin || null, ratings,
      solvesToday, solvesWeek, studySolves: studyTot, studyWins: studyWon, topThemes, ratingHistory,
      recent: rounds.map((r: any) => ({ puzzleId: String(r._id).split(":")[1], win: !!r.w, at: r.d, rating: r.r ?? null, ratingDiff: r.rd ?? null, themes: r.th || [] })),
      recentStudy: srounds.map((r: any) => ({ type: r.t || "?", win: !!r.w, at: r.d, rating: r.r ?? null, ratingDiff: r.rd ?? null })),
    };
  }

  // Analytics dashboard for the admin home: user counts, solve totals, 14-day trends,
  // content/generation stats, and the inactive-user list. UTC day boundaries.
  async overviewDash() {
    const db = this.db();
    const now = Date.now(), dayMs = 86400000;
    const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const weekAgo = new Date(now - 7 * dayMs), twoWk = new Date(now - 14 * dayMs);
    const usersCol = db.collection("users"), rounds = db.collection("rounds"), sr = db.collection("study_rounds");
    const uidExpr = { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] };

    const [total, newToday, newWeek] = await Promise.all([
      usersCol.countDocuments({}),
      usersCol.countDocuments({ createdAt: { $gte: todayStart } }),
      usersCol.countDocuments({ createdAt: { $gte: weekAgo } }),
    ]);
    const lastAgg = async (col: any) => col.aggregate([{ $project: { uid: uidExpr, d: 1 } }, { $group: { _id: "$uid", last: { $max: "$d" } } }]).toArray();
    const [ra, sa] = await Promise.all([lastAgg(rounds), lastAgg(sr)]);
    const lastMap: Record<string, number> = {};
    for (const r of [...ra, ...sa]) { const t = r.last ? new Date(r.last).getTime() : 0; if (t > (lastMap[r._id] || 0)) lastMap[r._id] = t; }
    const active7d = Object.values(lastMap).filter((t) => t >= now - 7 * dayMs).length;
    const active30d = Object.values(lastMap).filter((t) => t >= now - 30 * dayMs).length;

    const [pTotal, sTotal, pWeek, sWeek, pToday, sToday] = await Promise.all([
      rounds.estimatedDocumentCount(), sr.countDocuments({}),
      rounds.countDocuments({ d: { $gte: weekAgo } }), sr.countDocuments({ d: { $gte: weekAgo } }),
      rounds.countDocuments({ d: { $gte: todayStart } }), sr.countDocuments({ d: { $gte: todayStart } }),
    ]);

    const byDay = (col: any, field: string) => col.aggregate([{ $match: { [field]: { $gte: twoWk } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$" + field } }, n: { $sum: 1 } } }]).toArray();
    const [suAgg, pAct, sAct] = await Promise.all([byDay(usersCol, "createdAt"), byDay(rounds, "d"), byDay(sr, "d")]);
    const m = (a: any[]) => Object.fromEntries(a.map((x) => [x._id, x.n]));
    const suM = m(suAgg), pM = m(pAct), sM = m(sAct);
    const days: string[] = [];
    for (let i = 13; i >= 0; i--) days.push(new Date(now - i * dayMs).toISOString().slice(0, 10));
    const signups14 = days.map((d) => ({ date: d, n: suM[d] || 0 }));
    const activity14 = days.map((d) => ({ date: d, puzzle: pM[d] || 0, study: sM[d] || 0 }));

    const [puzzlePool, studyTotal, studyByTypeAgg, studyPending] = await Promise.all([
      db.collection("puzzles").estimatedDocumentCount(),
      db.collection("study_puzzles").countDocuments({}),
      db.collection("study_puzzles").aggregate([{ $group: { _id: "$type", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
      db.collection("study_puzzles").countDocuments({ seedMethod: { $nin: ["maia-playout", "curated+dtm+maia", "maia-playout-failed"] } }),
    ]);
    const studyByType = studyByTypeAgg.map((x: any) => ({ type: x._id, n: x.n }));

    const names = await usersCol.find({}, { projection: { username: 1 } }).toArray();
    const idToName: Record<string, string> = {}; for (const u of names) idToName[String(u._id)] = (u as any).username;
    const inactive = Object.entries(lastMap)
      .filter(([, t]) => t < now - 14 * dayMs)
      .map(([uid, t]) => ({ username: idToName[uid] || uid, lastActive: new Date(t), days: Math.floor((now - t) / dayMs) }))
      .sort((a, b) => b.days - a.days).slice(0, 10);

    return {
      users: { total, newToday, newWeek, active7d, active30d },
      solves: { puzzleTotal: pTotal, studyTotal: sTotal, today: pToday + sToday, week: pWeek + sWeek },
      signups14, activity14,
      content: { puzzlePool, studyTotal, studyByType, studyPending },
      inactive,
    };
  }
}
