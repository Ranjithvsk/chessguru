import { Controller, Get, Patch, Req, Res, Query, Param, Body } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { THEMES } from "./themes";
import { AuthService } from "./auth/auth.service";
import { applyLastMove } from "./lib/puzzle-format";
import { resolveViewedUser } from "./admin/view-as";
import { isAdmin } from "./admin/admins";
type Response = any;

@Controller()
export class MiscController {
  constructor(
    private readonly auth: AuthService,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  @Get("themes")
  themes() { return { themes: THEMES }; }

  /** GET /api/me/prefs — the signed-in user's notification preferences. Cheap
   *  read; the dashboard shows the current opt-in state for the weekly digest.
   *  Anonymous callers get { loggedIn: false } so the UI can degrade silently. */
  @Get("me/prefs")
  async myPrefs(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) return { loggedIn: false };
    const u: any = await this.conn.db!.collection("users").findOne(
      { _id: userId as any },
      { projection: { email: 1, weeklyDigestOptedOut: 1, weeklyDigestOptedOutAt: 1, digestSentAt: 1 } },
    );
    return {
      loggedIn: true,
      hasEmail: typeof u?.email === "string" && u.email.length > 0,
      weeklyDigestOptedOut: !!u?.weeklyDigestOptedOut,
      weeklyDigestOptedOutAt: u?.weeklyDigestOptedOutAt ?? null,
      lastDigestAt: u?.digestSentAt ?? null,
      streakReminderOptedOut: !!u?.streakReminderOptedOut,
      streakReminderOptedOutAt: u?.streakReminderOptedOutAt ?? null,
      lastStreakReminderAt: u?.streakReminderSentAt ?? null,
    };
  }

  /** PATCH /api/me/prefs { weeklyDigestOptedOut?, streakReminderOptedOut? } —
   *  flip email-channel opt-ins for the signed-in user. Complements the HMAC
   *  email-footer links; users can also re-enable from inside the app. */
  @Patch("me/prefs")
  async patchPrefs(@Req() req: any, @Body() body: any) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) throw new (await import("@nestjs/common")).HttpException("sign in required", 401);
    const set: any = {};
    if (typeof body?.weeklyDigestOptedOut === "boolean") {
      set.weeklyDigestOptedOut = body.weeklyDigestOptedOut;
      set.weeklyDigestOptedOutAt = body.weeklyDigestOptedOut ? new Date() : null;
    }
    if (typeof body?.streakReminderOptedOut === "boolean") {
      set.streakReminderOptedOut = body.streakReminderOptedOut;
      set.streakReminderOptedOutAt = body.streakReminderOptedOut ? new Date() : null;
    }
    if (Object.keys(set).length === 0) return { ok: true, changed: false };
    await this.conn.db!.collection("users").updateOne({ _id: userId as any }, { $set: set });
    return { ok: true, changed: true };
  }

  /** GET /api/me/history.csv — full flattened round history for the signed-in
   *  user (or an admin-viewed user via ?as=). Same underlying scan as /me/history
   *  but skips the mini-board / summary work — just the raw rows a coach or
   *  compliance archive needs. RFC-4180 escaped so a stray comma in a theme
   *  can't corrupt the file. Capped at 5000 rows — that's ~2 years of daily play
   *  and well past what any spreadsheet workflow needs. */
  @Get("me/history.csv")
  async myHistoryCsv(@Req() req: any, @Res() res: Response, @Query("as") asRaw?: string) {
    const userId: string | null = await resolveViewedUser(this.conn, req.session, asRaw);
    if (!userId) throw new (await import("@nestjs/common")).HttpException("sign in required", 401);
    const lo = `${userId}:`, hi = `${userId};`;
    const rounds: any[] = await this.conn.db!.collection("rounds")
      .find({ _id: { $gte: lo, $lt: hi } as any })
      .sort({ d: -1 })
      .limit(5000)
      .toArray();
    // Standard RFC 4180: quote anything with a comma / quote / newline, escape " as "".
    const q = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ["date,puzzleId,puzzleRating,win,ratingDiff,ratingAfter,solveMs,themes,mode,selectedTheme"];
    for (const r of rounds) {
      const puzzleId = String(r._id).slice(lo.length);
      const themes = Array.isArray(r.th) ? r.th.join("|") : "";
      lines.push([
        q(r.d ? new Date(r.d).toISOString() : ""),
        q(puzzleId),
        q(typeof r.pr === "number" ? r.pr : ""),
        q(r.w ? "1" : "0"),
        q(typeof r.rd === "number" ? r.rd : ""),
        q(typeof r.r === "number" ? r.r : ""),
        q(typeof r.ms === "number" ? r.ms : ""),
        q(themes),
        q(r.k ?? "puzzle"),
        q(r.sel ?? ""),
      ].join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="chessguru-history-${userId}.csv"`);
    res.send(lines.join("\n"));
  }

  @Get("me/rating")
  async myRating(@Req() req: any, @Query("as") asRaw?: string) {
    // Admin "view as" — read the target user's rating snapshot directly.
    // Non-admins or missing ?as= fall through to the session's own rating.
    const uid = await resolveViewedUser(this.conn, req.session, asRaw);
    const selfUid: string | null = req?.session?.userId ?? null;
    if (uid && uid !== selfUid && isAdmin(selfUid)) {
      const perf: any = await this.conn.db!.collection("userperfs").findOne({ _id: uid as any });
      return { rating: Math.round(perf?.puzzle?.gl?.r ?? 1500), loggedIn: true, userId: uid, asAdmin: true };
    }
    return this.auth.myRating(req.session);
  }

  /** The signed-in user's round for a specific puzzle — used by the review view to
   *  show what wrong move they played and what the best move was. Returns
   *  { round: null } when there's no round (either not signed in, or the user
   *  hasn't played this puzzle) so the client can render neutrally. */
  @Get("me/round/:pid")
  async myRound(@Req() req: any, @Param("pid") pid: string) {
    const userId: string | null = req?.session?.userId ?? null;
    if (!userId) return { round: null };
    const r: any = await this.conn.db!.collection("rounds").findOne({ _id: `${userId}:${pid}` as any });
    if (!r) return { round: null };
    const p: any = await this.conn.db!.collection("puzzles").findOne({ _id: pid as any }, { projection: { line: 1 } });
    const sol = String(p?.line || "").trim().split(" ").filter(Boolean);
    return { round: {
      win: !!r.w, date: r.d, ratingDiff: typeof r.rd === "number" ? r.rd : null,
      ms: typeof r.ms === "number" ? r.ms : null,
      wrong: typeof r.wr === "string" ? r.wr : null,
      best: !r.w ? (sol[1] ?? null) : null,   // solver's expected first move (line[0] is the opponent's setup)
    } };
  }

  /** Solved-puzzle history + categorised summary for the signed-in user.
   *  Admins may pass ?as=<username> to view another user's history. */
  @Get("me/history")
  async myHistory(@Req() req: any, @Query("offset") offsetRaw?: string, @Query("as") asRaw?: string) {
    const userId: string | null = await resolveViewedUser(this.conn, req.session, asRaw);
    if (!userId) return { loggedIn: false };
    const offset = Math.max(0, parseInt(String(offsetRaw ?? "0"), 10) || 0);

    const lo = `${userId}:`, hi = `${userId};`;
    const rounds = await this.conn
      .db!.collection("rounds")
      .find({ _id: { $gte: lo, $lt: hi } as any })
      .sort({ d: -1 })
      .limit(2000)
      .toArray();

    const DISPLAY = 200;                      // recent items get a (lazily-rendered) mini board
    const pidOf = (r: any) => String(r._id).slice(lo.length);
    const recent = rounds.slice(offset, offset + DISPLAY);   // the requested page
    const recentIds = recent.map(pidOf);
    const needThemes = rounds.filter((r: any) => !Array.isArray(r.th)).map(pidOf);
    const allNeed = Array.from(new Set([...recentIds, ...needThemes]));

    const pmap: Record<string, any> = {};
    if (allNeed.length) {
      const ps = await this.conn
        .db!.collection("puzzles")
        .find({ _id: { $in: allNeed } as any }, { projection: { fen: 1, line: 1, themes: 1, "glicko.r": 1 } })
        .toArray();
      for (const p of ps) pmap[String(p._id)] = p;
    }
    // Which line-move index the solver was on when they mis-clicked. Every solved
    // puzzle stores the OPPONENT's setup move as the FIRST token in `line`; the
    // solver's expected move is index 1. So the "best move" to show on a miss = line[1].
    const bestOf = (p: any): string | null => {
      const sol = String(p?.line || "").trim().split(" ").filter(Boolean);
      return sol[1] ?? null;
    };

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
        ms: typeof r.ms === "number" ? r.ms : null,   // solve time in ms (null on legacy rows)
        wrong: typeof r.wr === "string" ? r.wr : null, // UCI of the wrong move played (misses only)
        best: !r.w ? bestOf(p) : null,                // expected first move — for the "best was X" callout
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

    const selfUid: string | null = req?.session?.userId ?? null;
    const viewedAs = userId !== selfUid ? userId : null;
    // For admin ?as= views, snapshot the VIEWED user's puzzle rating so the
    // client shows their number (not the admin's) in the stats grid.
    let viewedRating: number | null = null;
    if (viewedAs) {
      const perf: any = await this.conn.db!.collection("userperfs").findOne({ _id: userId as any });
      viewedRating = Math.round(perf?.puzzle?.gl?.r ?? 1500);
    }
    return {
      loggedIn: true,
      viewedAs,   // set only when an admin is viewing another user's data
      viewedRating,  // ditto — viewed user's puzzle rating for the stats grid
      totals: { attempted: total, solved, failed: total - solved, winRate: total ? Math.round((solved / total) * 100) : 0 },
      byTheme: Object.values(byTheme).sort((a, b) => b.total - a.total),
      byBand: Object.values(byBand).sort((a, b) => a.lo - b.lo),
      items,
      hasMore: offset + DISPLAY < rounds.length,   // more pages available?
      nextOffset: offset + DISPLAY,
    };
  }
}
