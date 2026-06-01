import { Controller, Get, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { THEMES } from "./themes";
import { AuthService } from "./auth/auth.service";

@Controller()
export class MiscController {
  constructor(
    private readonly auth: AuthService,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  @Get("themes")
  themes() { return { themes: THEMES }; }

  @Get("me/rating")
  myRating(@Req() req: any) { return this.auth.myRating(req.session); }

  /** Solved-puzzle history + categorised summary for the signed-in user. */
  @Get("me/history")
  async myHistory(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) return { loggedIn: false };

    // rounds._id = "userId:puzzleId"; ":".."" range brackets exactly this user.
    const lo = `${userId}:`, hi = `${userId};`;
    const rounds = await this.conn
      .db!.collection("rounds")
      .find({ _id: { $gte: lo, $lt: hi } as any })
      .sort({ d: -1 })
      .limit(2000)
      .toArray();

    // Backfill puzzle details for older rounds that predate the denormalised fields.
    const need = rounds
      .filter((r: any) => !Array.isArray(r.th) || r.pr == null)
      .map((r: any) => String(r._id).slice(lo.length));
    const pmap: Record<string, any> = {};
    if (need.length) {
      const ps = await this.conn
        .db!.collection("puzzles")
        .find({ _id: { $in: need } as any }, { projection: { themes: 1, "glicko.r": 1 } })
        .toArray();
      for (const p of ps) pmap[String(p._id)] = p;
    }

    const items = rounds.map((r: any) => {
      const id = String(r._id).slice(lo.length);
      const p = pmap[id];
      const themes: string[] = Array.isArray(r.th) ? r.th : p?.themes ?? [];
      const puzzleRating = r.pr ?? (p?.glicko?.r != null ? Math.round(p.glicko.r) : null);
      return {
        id,
        date: r.d,
        win: !!r.w,
        ratingDiff: typeof r.rd === "number" ? r.rd : null,
        ratingAfter: typeof r.r === "number" ? r.r : null,
        puzzleRating,
        themes,
        mode: r.k ?? "puzzle",
      };
    });

    const total = items.length;
    const solved = items.filter((i) => i.win).length;
    const byTheme: Record<string, { theme: string; total: number; wins: number }> = {};
    const byBand: Record<string, { band: string; lo: number; total: number; wins: number }> = {};
    for (const it of items) {
      for (const t of it.themes) {
        if (!byTheme[t]) byTheme[t] = { theme: t, total: 0, wins: 0 };
        byTheme[t].total++;
        if (it.win) byTheme[t].wins++;
      }
      const b = it.puzzleRating == null ? -1 : Math.floor(it.puzzleRating / 200) * 200;
      const label = b < 0 ? "Unrated" : `${b}–${b + 199}`;
      if (!byBand[label]) byBand[label] = { band: label, lo: b, total: 0, wins: 0 };
      byBand[label].total++;
      if (it.win) byBand[label].wins++;
    }

    return {
      loggedIn: true,
      totals: { attempted: total, solved, failed: total - solved, winRate: total ? Math.round((solved / total) * 100) : 0 },
      byTheme: Object.values(byTheme).sort((a, b) => b.total - a.total),
      byBand: Object.values(byBand).sort((a, b) => a.lo - b.lo),
      items: items.slice(0, 200),
    };
  }
}
