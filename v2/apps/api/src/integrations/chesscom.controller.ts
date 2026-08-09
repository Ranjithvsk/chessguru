// Chess.com account linking — Chess.com does NOT offer OAuth for individuals,
// only a public REST API. To prove the user actually owns the handle we make
// them paste a short token into their Chess.com profile "location" field.
//
// Flow:
//   1. POST /api/link/chesscom/init  { handle } → { verifyToken }
//      Server generates a token like "cg-verify-abcd1234" and returns it.
//   2. User pastes the token into their Chess.com profile "Location".
//   3. POST /api/link/chesscom/verify { handle } → checks the profile.
//      On match, upserts user.linkedAccounts.chesscom and kicks off import.

import { BadRequestException, Body, Controller, Post, Req, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { GamesFetchService } from "./games-fetch.service";

const UA = "ChessGuru/1.0 (contact: noreply@harinitharanjith.com)";

function normHandle(raw: any): string {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

@Controller("link/chesscom")
export class ChesscomLinkController {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly games: GamesFetchService,
  ) {}

  private users() { return this.conn.db!.collection("users"); }

  @Post("init")
  async init(@Body() body: any, @Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException();
    const handle = normHandle(body?.handle);
    if (!handle) throw new BadRequestException("handle required");
    // Sanity-check the handle exists on Chess.com so we don't ask the user to
    // verify against an account that doesn't exist.
    const probe = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(handle)}`, { headers: { "User-Agent": UA } });
    if (probe.status === 404) return { ok: false, error: "That Chess.com handle doesn't exist." };
    if (!probe.ok) return { ok: false, error: `Chess.com API error ${probe.status}` };
    const token = `cg-verify-${randomBytes(4).toString("hex")}`;
    await this.users().updateOne({ _id: uid as any }, { $set: {
      "linkedAccounts.chesscom": { pendingHandle: handle, verifyToken: token, pendingAt: new Date() },
    } });
    return { ok: true, verifyToken: token, instructions: `Open your Chess.com profile → Edit Profile → set your Location to: ${token}` };
  }

  @Post("verify")
  async verify(@Body() body: any, @Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException();
    const user: any = await this.users().findOne({ _id: uid as any });
    const pend = user?.linkedAccounts?.chesscom;
    const handle = normHandle(body?.handle) || pend?.pendingHandle;
    const token = pend?.verifyToken;
    if (!handle || !token) return { ok: false, error: "No pending verification — start over." };
    const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(handle)}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return { ok: false, error: `Chess.com API error ${res.status}` };
    const p: any = await res.json();
    const location = String(p.location || "").trim();
    if (!location.includes(token)) {
      return { ok: false, error: "Verification token not found in your Chess.com profile Location yet. Save the profile and try again." };
    }
    // Verified — fetch full stats snapshot for the record.
    const statsRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(handle)}/stats`, { headers: { "User-Agent": UA } });
    const stats: any = statsRes.ok ? await statsRes.json() : {};
    await this.users().updateOne({ _id: uid as any }, { $set: { "linkedAccounts.chesscom": {
      username: handle,
      title: p.title || null,
      country: p.country ? String(p.country).split("/").pop() : null,
      ratings: {
        blitz:  stats?.chess_blitz?.last?.rating  ?? null,
        rapid:  stats?.chess_rapid?.last?.rating  ?? null,
        bullet: stats?.chess_bullet?.last?.rating ?? null,
        daily:  stats?.chess_daily?.last?.rating  ?? null,
      },
      linkedAt: new Date(),
    } } });
    this.games.triggerImport(uid, "chesscom", handle);
    return { ok: true, handle };
  }

  @Post("unlink")
  async unlink(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException();
    await this.users().updateOne({ _id: uid as any }, { $unset: { "linkedAccounts.chesscom": "" } });
    await this.conn.db!.collection("externalGames").deleteMany({ userId: uid, source: "chesscom" });
    return { ok: true };
  }
}
