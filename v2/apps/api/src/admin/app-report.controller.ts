// GET /api/admin/app-report?days=N — ChessGuru's slice of the super-admin "App reports" page
// (owner 2026-09-19: "a report like Dream Meet's for all parts of ChessGuru and POS, till, staff,
// homepage… neatly organised"). Same guard as dream-meet-stats: the shared internal token
// (server-to-server from the owner console) or a signed-in ChessGuru admin.
// Everything here is a count over existing collections — nothing is written.
import { Controller, ForbiddenException, Get, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "./admins";
import * as fs from "fs";

/** Last lines of a pm2 error log on this box (the API runs as the pm2 user). */
function logTail(name: string, lines = 40): string[] {
  try {
    const dir = `${process.env.HOME || "/home/ubuntu"}/.pm2/logs`;
    // pm2 names the file <name>-error.log, or <name>-error-<id>.log for cluster instances
    const file = fs.readdirSync(dir).filter((f) => f === `${name}-error.log` || new RegExp(`^${name}-error-\\d+\\.log$`).test(f)).sort().pop();
    if (!file) return [];
    const p = `${dir}/${file}`; const st = fs.statSync(p); const fd = fs.openSync(p, "r"); const len = Math.min(st.size, 64 * 1024);
    const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    return buf.toString("utf8").split("\n").filter((l) => l.trim()).slice(-lines).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 400));
  } catch { return []; }
}

const STATS_TOKEN = process.env.CHESSGURU_STATS_TOKEN || process.env.DREAMCY_INTERNAL_TOKEN || "";

type ErrRow = { at: Date; kind: string; message: string; userId: string | null; url: string | null; academyId?: string | null; n: number };

@Controller()
export class AppReportController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Get("admin/app-report")
  async report(@Req() req: any, @Query("days") daysRaw?: string, @Query("detail") detail?: string, @Query("logs") logsRaw?: string) {
    const presented = String(req?.headers?.["x-internal-token"] || "");
    if (!(!!STATS_TOKEN && presented === STATS_TOKEN) && !isAdmin(req?.session?.userId)) throw new ForbiddenException("admin only");
    const days = Math.min(90, Math.max(1, parseInt(String(daysRaw ?? "7"), 10) || 7));
    const since = new Date(Date.now() - days * 86_400_000);
    const db = this.conn.db!;
    const col = (n: string) => db.collection(n);

    const [activeUsers, newUsers, puzzleRounds, studyRounds, classIds, classJoins, booksAdded, academies, errs, users] = await Promise.all([
      col("users").countDocuments({ lastSeen: { $gte: since } }),
      col("users").countDocuments({ createdAt: { $gte: since } }),
      col("rounds").countDocuments({ d: { $gte: since } }),
      col("study_rounds").countDocuments({ d: { $gte: since } }),
      col("classAttendance").distinct("classId", { joinedAt: { $gte: since } }),
      col("classAttendance").countDocuments({ joinedAt: { $gte: since }, manual: { $ne: true } }),
      col("books").countDocuments({ createdAt: { $gte: since } }),
      col("users").distinct("academyId", { lastSeen: { $gte: since }, academyId: { $nin: [null, ""] } }),
      col("errorEvents").find({ at: { $gte: since } }, { projection: { at: 1, kind: 1, message: 1, userId: 1, url: 1 } }).sort({ at: -1 }).limit(2000).toArray(),
      col("users").find({ lastSeen: { $gte: since } }, { projection: { _id: 1, academyId: 1, role: 1 } }).toArray(),
    ]);
    const academyOf = new Map<string, string | null>(users.map((u: any) => [String(u._id), u.academyId ?? null]));

    // Errors: by kind, plus the recent list de-duplicated on kind+message (n = how often).
    const byKind: Record<string, number> = {};
    const dedup = new Map<string, ErrRow>();
    const slowByRoute = new Map<string, { n: number; ms: number }>();
    for (const e of errs as any[]) {
      const kind = String(e.kind || "other"); byKind[kind] = (byKind[kind] ?? 0) + 1;
      const msg = String(e.message || "").slice(0, 300);
      if (kind === "slow") {
        const m = /^(GET|POST|PUT|PATCH|DELETE) (\S+) took ([\d.]+)s/.exec(msg);
        if (m) { const route = `${m[1]} ${m[2]!.replace(/[0-9a-f]{12,}|\d{3,}/g, ":id")}`; const cur = slowByRoute.get(route) ?? { n: 0, ms: 0 }; cur.n++; cur.ms += parseFloat(m[3]!) * 1000; slowByRoute.set(route, cur); }
      }
      const k = `${kind}|${msg.replace(/[0-9a-f]{8,}/g, "#").slice(0, 120)}`;
      const row = dedup.get(k);
      if (row) row.n++;
      else dedup.set(k, { at: e.at, kind, message: msg, userId: e.userId ?? null, url: e.url ?? null, academyId: e.userId ? academyOf.get(String(e.userId)) ?? null : null, n: 1 });
    }
    const recent = [...dedup.values()].filter((r) => r.kind !== "slow").sort((a, b) => +b.at - +a.at).slice(0, 40);
    const topSlow = [...slowByRoute.entries()].map(([route, v]) => ({ route, n: v.n, avgMs: Math.round(v.ms / v.n) })).sort((a, b) => b.n - a.n).slice(0, 8);

    // Per academy: who is actually using it.
    const perAcademy = new Map<string, { activeUsers: number; students: number; coaches: number; errors: number }>();
    for (const u of users as any[]) {
      const a = u.academyId || "—"; const cur = perAcademy.get(a) ?? { activeUsers: 0, students: 0, coaches: 0, errors: 0 };
      cur.activeUsers++; if (u.role === "student") cur.students++; if (u.role === "coach" || u.role === "academy_owner") cur.coaches++;
      perAcademy.set(a, cur);
    }
    for (const r of dedup.values()) { if (r.academyId) { const cur = perAcademy.get(r.academyId); if (cur) cur.errors += r.n; } }
    const academyDocs = await col("academies").find({ _id: { $in: [...perAcademy.keys()].filter((k) => k !== "—") } as any }, { projection: { name: 1 } }).toArray().catch(() => [] as any[]);
    const nameOf = new Map<string, string>((academyDocs as any[]).map((a) => [String(a._id), a.name || String(a._id)]));
    const byAcademy = [...perAcademy.entries()].map(([id, v]) => ({ academyId: id, name: nameOf.get(id) ?? id, ...v })).sort((a, b) => b.activeUsers - a.activeUsers).slice(0, 30);

    // ---- detail=1: per-day series, top users, games, pm2 error-log tails ----
    let det: Record<string, unknown> | undefined;
    if (detail === "1") {
      const dayOf = (d: any) => new Date(d).toISOString().slice(0, 10);
      const perDay = new Map<string, { day: string; puzzleRounds: number; studyRounds: number; classJoins: number; games: number }>();
      const bump = (d: any, k: "puzzleRounds" | "studyRounds" | "classJoins" | "games") => { const day = dayOf(d); const cur = perDay.get(day) ?? { day, puzzleRounds: 0, studyRounds: 0, classJoins: 0, games: 0 }; cur[k]++; perDay.set(day, cur); };
      const [rounds, studies, joins, games] = await Promise.all([
        col("rounds").find({ d: { $gte: since } }, { projection: { _id: 1, d: 1 } }).toArray(),
        col("study_rounds").find({ d: { $gte: since } }, { projection: { d: 1, t: 1 } }).toArray(),
        col("classAttendance").find({ joinedAt: { $gte: since }, manual: { $ne: true } }, { projection: { joinedAt: 1 } }).toArray(),
        col("live_games").find({ startedAt: { $gte: since } }, { projection: { startedAt: 1, status: 1 } }).toArray(),
      ]);
      const perUser = new Map<string, number>(); const perDrill = new Map<string, number>();
      for (const r of rounds as any[]) { bump(r.d, "puzzleRounds"); const uid = String(r._id).split(":")[0]!; perUser.set(uid, (perUser.get(uid) ?? 0) + 1); }
      for (const r of studies as any[]) { bump(r.d, "studyRounds"); perDrill.set(String(r.t), (perDrill.get(String(r.t)) ?? 0) + 1); }
      for (const r of joins as any[]) bump(r.joinedAt, "classJoins");
      for (const r of games as any[]) bump(r.startedAt, "games");
      const topIds = [...perUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      const topDocs = await col("users").find({ _id: { $in: topIds.map(([u]) => u) } as any }, { projection: { name: 1, username: 1, academyId: 1, role: 1 } }).toArray();
      const uDoc = new Map<string, any>(topDocs.map((u: any) => [String(u._id), u]));
      const names = String(logsRaw ?? "").split(",").map((x) => x.trim()).filter((x) => /^[\w-]+$/.test(x)).slice(0, 8);
      const logs: Record<string, string[]> = {}; for (const n of names) logs[n] = logTail(n);
      det = {
        perDay: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
        topUsers: topIds.map(([u, n]) => ({ userId: u, name: uDoc.get(u)?.name || uDoc.get(u)?.username || u, academyId: uDoc.get(u)?.academyId ?? null, role: uDoc.get(u)?.role ?? null, puzzleRounds: n })),
        studyByDrill: [...perDrill.entries()].map(([t, n]) => ({ drill: t, n })).sort((a, b) => b.n - a.n),
        games: { total: games.length, finished: (games as any[]).filter((g) => g.status === "finished" || g.finishedAt).length },
        logs,
      };
    }
    return {
      at: Date.now(), days, detail: det,
      usage: { activeUsers, newUsers, puzzleRounds, studyRounds, classes: classIds.length, classJoins, booksAdded, academies: academies.length },
      errors: { total: errs.length, byKind, recent, topSlow },
      byAcademy,
    };
  }
}
