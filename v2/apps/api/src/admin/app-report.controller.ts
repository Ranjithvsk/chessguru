// GET /api/admin/app-report?days=N — ChessGuru's slice of the super-admin "App reports" page
// (owner 2026-09-19: "a report like Dream Meet's for all parts of ChessGuru and POS, till, staff,
// homepage… neatly organised"). Same guard as dream-meet-stats: the shared internal token
// (server-to-server from the owner console) or a signed-in ChessGuru admin.
// Everything here is a count over existing collections — nothing is written.
import { Controller, ForbiddenException, Get, Query, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "./admins";

const STATS_TOKEN = process.env.CHESSGURU_STATS_TOKEN || process.env.DREAMCY_INTERNAL_TOKEN || "";

type ErrRow = { at: Date; kind: string; message: string; userId: string | null; url: string | null; academyId?: string | null; n: number };

@Controller()
export class AppReportController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Get("admin/app-report")
  async report(@Req() req: any, @Query("days") daysRaw?: string) {
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

    return {
      at: Date.now(), days,
      usage: { activeUsers, newUsers, puzzleRounds, studyRounds, classes: classIds.length, classJoins, booksAdded, academies: academies.length },
      errors: { total: errs.length, byKind, recent, topSlow },
      byAcademy,
    };
  }
}
