import { Controller, Get, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { THEMES } from "./themes";
import { AuthService } from "./auth/auth.service";
import { applyLastMove } from "./lib/puzzle-format";

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

    const lo = `${userId}:`, hi = `${userId};`;
    const rounds = await this.conn
      .db!.collection("rounds")
      .find({ _id: { $gte: lo, $lt: hi } as any })
      .sort({ d: -1 })
      .limit(2000)
      .toArray();

    const DISPLAY = 200;                      // recent items get a (lazily-rendered) mini board
    const pidOf = (r: any) => String(r._id).slice(lo.length);
    const recent = rounds.slice(0, DISPLAY);
    const recentIds = recent.map(pidOf);
    const needThemes = rounds.slice(DISPLAY).filter((r: any) => !Array.isArray(r.th)).map(pidOf);
    const allNeed = Array.from(new Set([...recentIds, ...needThemes]));

    const pmap: Record<string, any> = {};
    if (allNeed.length) {
      const ps = await this.conn
        .db!.collection("puzzles")
        .find({ _id: { $in: allNeed } as any }, { projection: { fen: 1, line: 1, themes: 1, "glicko.r": 1 } })
        .toArray();
      for (const p of ps) pmap[String(p._id)] = p;
    }

    // Position the solver faced (puzzle fen after the opponent's setup move).
    const miniOf = (p: any) => {
      if (!p?.fen) return { fen: null, lastMove: null, orientation: "white" };
      const sol = String(p.line || "").trim().split(" ").filter(Boolean);
      const m: any = applyLastMove({ fen: p.fen, solution: sol });
      const orientation = String(m.fen).split(" ")[1] === "b" ? "black" : "white";
      return { fen: m.fen, lastMove: m.lastMove ?? null, orientation };
    };

    const items = recent.map((r: any) => {
      const id = pidOf(r); const p = pmap[id];
      const themes: string[] = Array.isArray(r.th) ? r.th : p?.themes ?? [];
      const puzzleRating = r.pr ?? (p?.glicko?.r != null ? Math.round(p.glicko.r) : null);
      return {
        id, date: r.d, win: !!r.w,
        ratingDiff: typeof r.rd === "number" ? r.rd : null,
        ratingAfter: typeof r.r === "number" ? r.r : null,
        puzzleRating, themes, mode: r.k ?? "puzzle", sel: r.sel ?? null,
        ...miniOf(p),
      };
    });

    // Summary over the whole (capped) history.
    const total = rounds.length;
    let solved = 0;
    const byTheme: Record<string, { theme: string; total: number; wins: number }> = {};
    const byBand: Record<string, { band: string; lo: number; total: number; wins: number }> = {};
    for (const r of rounds) {
      if (r.w) solved++;
      const id = pidOf(r);
      const themes: string[] = Array.isArray(r.th) ? r.th : pmap[id]?.themes ?? [];
      const pr = r.pr ?? (pmap[id]?.glicko?.r != null ? Math.round(pmap[id].glicko.r) : null);
      for (const t of themes) {
        if (!byTheme[t]) byTheme[t] = { theme: t, total: 0, wins: 0 };
        byTheme[t].total++; if (r.w) byTheme[t].wins++;
      }
      const b = pr == null ? -1 : Math.floor(pr / 200) * 200;
      const label = b < 0 ? "Unrated" : `${b}–${b + 199}`;
      if (!byBand[label]) byBand[label] = { band: label, lo: b, total: 0, wins: 0 };
      byBand[label].total++; if (r.w) byBand[label].wins++;
    }

    return {
      loggedIn: true,
      totals: { attempted: total, solved, failed: total - solved, winRate: total ? Math.round((solved / total) * 100) : 0 },
      byTheme: Object.values(byTheme).sort((a, b) => b.total - a.total),
      byBand: Object.values(byBand).sort((a, b) => a.lo - b.lo),
      items,
    };
  }
}
