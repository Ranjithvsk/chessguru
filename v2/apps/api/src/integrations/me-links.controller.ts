// Signed-in user's linked-account status + imported-games list + manual refresh.
// Everything here reads/writes only the caller's own data — no admin bypass.

import { Controller, Get, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { GamesFetchService } from "./games-fetch.service";

@Controller("me")
export class MeLinksController {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly games: GamesFetchService,
  ) {}

  @Get("linked-accounts")
  async status(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException();
    const u: any = await this.conn.db!.collection("users").findOne({ _id: uid as any });
    const l = u?.linkedAccounts?.lichess;
    const c = u?.linkedAccounts?.chesscom;
    // Never leak the OAuth accessToken or the pending verification token.
    const games = this.conn.db!.collection("externalGames");
    const [lc, cc] = await Promise.all([
      l?.username ? games.countDocuments({ userId: uid, source: "lichess" }) : Promise.resolve(0),
      c?.username ? games.countDocuments({ userId: uid, source: "chesscom" }) : Promise.resolve(0),
    ]);
    return {
      lichess: l?.username ? {
        username: l.username, title: l.title, ratings: l.ratings ?? null,
        linkedAt: l.linkedAt, lastImportAt: l.lastImportAt ?? null,
        gameCount: lc,
      } : null,
      chesscom: c?.username ? {
        username: c.username, title: c.title, country: c.country, ratings: c.ratings ?? null,
        linkedAt: c.linkedAt, lastImportAt: c.lastImportAt ?? null,
        gameCount: cc,
      } : c?.pendingHandle ? {
        pending: true, pendingHandle: c.pendingHandle, verifyToken: c.verifyToken,
      } : null,
    };
  }

  @Post("linked-accounts/refresh")
  async refresh(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException();
    const u: any = await this.conn.db!.collection("users").findOne({ _id: uid as any });
    const jobs: Promise<any>[] = [];
    if (u?.linkedAccounts?.lichess?.accessToken) {
      jobs.push(this.games.importGames(uid, "lichess", u.linkedAccounts.lichess.accessToken));
    }
    if (u?.linkedAccounts?.chesscom?.username) {
      jobs.push(this.games.importGames(uid, "chesscom", u.linkedAccounts.chesscom.username));
    }
    if (!jobs.length) return { ok: false, error: "No linked accounts yet." };
    // Wait for both to finish so the client can show the new counts immediately.
    const out = await Promise.allSettled(jobs);
    const imported = out.reduce((n, r) => n + (r.status === "fulfilled" ? Number(r.value) || 0 : 0), 0);
    return { ok: true, imported };
  }

  @Get("external-games")
  async list(@Req() req: any, @Query("source") source?: string, @Query("offset") offsetRaw?: string) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException();
    const offset = Math.max(0, parseInt(String(offsetRaw ?? "0"), 10) || 0);
    const PAGE = 50;
    const q: any = { userId: uid };
    if (source === "lichess" || source === "chesscom") q.source = source;
    const col = this.conn.db!.collection("externalGames");
    const [items, total] = await Promise.all([
      col.find(q, { projection: { pgn: 0 } }).sort({ played: -1 }).skip(offset).limit(PAGE).toArray(),
      col.countDocuments(q),
    ]);
    return { items, total, offset, pageSize: PAGE, hasMore: offset + PAGE < total };
  }
}
