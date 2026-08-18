// Parent-scoped read API. Powers the /parent portal page — my children +
// current billing + latest progress snapshots. Owner ask 2026-08-18:
// "parent portal with billing and progress reports".
//
// Auth: session must exist. Any authenticated user with childrenIds populated
// can call these endpoints; other roles simply get an empty payload.
import { Controller, Get, HttpException, HttpStatus, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ParentReportsService } from "../parent-reports/parent-reports.service";

@Controller("parent")
export class ParentPortalController {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly reportsSvc: ParentReportsService,
  ) {}

  /** Home payload for /parent: children + aggregated billing + a per-child
   *  progress snapshot (last 30 days) from the existing report builder. */
  @Get("me")
  async me(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new HttpException("sign in required", HttpStatus.UNAUTHORIZED);
    const users = this.conn.db!.collection("users");
    const parent: any = await users.findOne({ _id: userId as any });
    if (!parent) throw new HttpException("no user", HttpStatus.NOT_FOUND);

    const childIds: string[] = Array.isArray(parent.childrenIds) ? parent.childrenIds.map(String) : [];
    if (!childIds.length) {
      return {
        me: { _id: parent._id, username: parent.username, name: parent.name, email: parent.email, role: parent.role },
        children: [],
        invoices: [],
        totalPendingPaise: 0,
      };
    }
    // Batch-fetch student docs + userperfs (for current rating) in parallel.
    const [childDocs, perfs] = await Promise.all([
      users.find({ _id: { $in: childIds as any } }, { projection: { _id: 1, username: 1, name: 1, email: 1, academyId: 1, coachId: 1, dailyStreakCurrent: 1 } }).toArray(),
      this.conn.db!.collection("userperfs").find({ _id: { $in: childIds as any } }, { projection: { "puzzle.gl.r": 1, "puzzle.nb": 1 } }).toArray(),
    ]);
    const ratingById = new Map<string, { rating: number; nb: number }>();
    for (const p of perfs) {
      const r = Math.round((p as any).puzzle?.gl?.r ?? 1500);
      const nb = (p as any).puzzle?.nb ?? 0;
      ratingById.set(String(p._id), { rating: r, nb });
    }

    // Progress snapshot: reuse the report builder with a 30-day window.
    const end = new Date();
    const start = new Date(end); start.setDate(start.getDate() - 30);
    const snapshots = await Promise.all(childDocs.map(async (c: any) => {
      try {
        const data = await this.reportsSvc.buildData(String(c._id), start, end);
        return { studentId: String(c._id), summary: data };
      } catch { return { studentId: String(c._id), summary: null }; }
    }));

    // Billing — invoices across all children. Aggregate pending totals so
    // the header pill can show a single "₹1,200 pending" number.
    const invoices = await this.conn.db!.collection("feeInvoices")
      .find({ studentId: { $in: childIds } }, { sort: { generatedAt: -1 } })
      .limit(60)
      .toArray();
    const totalPendingPaise = invoices
      .filter((i: any) => i.status === "pending")
      .reduce((s: number, i: any) => s + (i.amountPaise || 0), 0);

    const children = childDocs.map((c: any) => {
      const perf = ratingById.get(String(c._id));
      const snap = snapshots.find((s) => s.studentId === String(c._id))?.summary || null;
      return {
        _id: String(c._id), username: c.username, name: c.name || c.username,
        academyId: c.academyId ?? null, coachId: c.coachId ?? null,
        dailyStreakCurrent: c.dailyStreakCurrent ?? 0,
        puzzleRating: perf?.rating ?? null,
        puzzleTotal: perf?.nb ?? 0,
        // Compact per-child progress snapshot (last 30 days) — the /parent
        // page shows chips: solved, W-D-L, streak, top weakness.
        snapshot: snap
          ? {
              period: snap.period,
              rating: snap.rating,
              games: snap.games,
              puzzles: snap.puzzles,
              revision: snap.revision,
              topWeaknesses: snap.weaknesses.slice(0, 3),
            }
          : null,
      };
    });

    return {
      me: { _id: parent._id, username: parent.username, name: parent.name, email: parent.email, role: parent.role },
      children,
      invoices: invoices.map((i: any) => ({
        _id: i._id, studentId: i.studentId, studentUsername: i.studentUsername,
        period: i.period, amountPaise: i.amountPaise, status: i.status,
        generatedAt: i.generatedAt, paidAt: i.paidAt ?? null, paymentMethod: i.paymentMethod ?? null,
      })),
      totalPendingPaise,
    };
  }
}
