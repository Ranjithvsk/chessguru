// Lichess account linking via OAuth 2.0 with PKCE.
// Lichess supports public clients WITHOUT app registration (since 2022) — we
// just supply an arbitrary client_id, a redirect_uri, and PKCE code_verifier.
//
// Flow:
//   1. Signed-in user hits GET /api/link/lichess/start
//      → server mints (code_verifier, state), stashes them in the session,
//        returns { authUrl } that the browser opens.
//   2. Lichess bounces back to /api/link/lichess/callback?code=…&state=…
//   3. Server exchanges the code for an access_token, calls /api/account to
//      resolve the Lichess username, upserts user.linkedAccounts.lichess,
//      kicks off the games import, and redirects the browser back to
//      /settings/accounts?linked=lichess.

import { Controller, Get, Logger, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes, createHash } from "crypto";
import { GamesFetchService } from "./games-fetch.service";

const CLIENT_ID   = "chessguru-web";
const REDIRECT_URI = (process.env.PUBLIC_URL || "https://harinitharanjith.com") + "/v2api/api/link/lichess/callback";
const SCOPES = "email:read preference:read";

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

@Controller("link/lichess")
export class LichessLinkController {
  private readonly log = new Logger("LichessLink");
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly games: GamesFetchService,
  ) {}

  private users() { return this.conn.db!.collection("users"); }

  @Get("start")
  start(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException("sign in first");
    const codeVerifier = b64url(randomBytes(32));
    const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
    const state = b64url(randomBytes(16));
    req.session.lichessOAuth = { codeVerifier, state, at: Date.now() };
    const p = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
      scope: SCOPES,
      state,
    });
    return { authUrl: `https://lichess.org/oauth?${p.toString()}` };
  }

  @Get("callback")
  async callback(@Req() req: any, @Res() res: any) {
    const { code, state, error } = req.query || {};
    const uid = req?.session?.userId;
    const stash = req?.session?.lichessOAuth;
    const back = (msg: string) => res.redirect(`/settings/accounts?${msg}`);
    if (!uid || !stash) {
      // Distinguish the two failure modes so we can debug from the URL param.
      // (Also logged with cookie presence + session-store hit so we can trace.)
      const reason = !uid ? "nouid" : "nostash";
      this.log.warn(`callback ${reason}: cookie=${!!req.headers?.cookie} sid=${req.sessionID} uid=${uid} hasStash=${!!stash}`);
      return back(`linked=lichess&status=${reason}`);
    }
    if (error) return back(`linked=lichess&status=denied`);
    if (!code || state !== stash.state) return back("linked=lichess&status=state_mismatch");
    delete req.session.lichessOAuth;
    // Exchange code for token
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: stash.codeVerifier,
    });
    const tokRes = await fetch("https://lichess.org/api/token", { method: "POST", body });
    if (!tokRes.ok) return back(`linked=lichess&status=token_${tokRes.status}`);
    const tok: any = await tokRes.json();
    const accessToken: string = tok.access_token;
    if (!accessToken) return back("linked=lichess&status=no_token");
    // Resolve Lichess username + profile
    const acct = await fetch("https://lichess.org/api/account", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!acct.ok) return back(`linked=lichess&status=acct_${acct.status}`);
    const me: any = await acct.json();
    const lichessUsername: string = me.username;
    await this.users().updateOne({ _id: uid as any }, { $set: { "linkedAccounts.lichess": {
      username: lichessUsername,
      title: me.title || null,
      ratings: {
        bullet:    me.perfs?.bullet?.rating   ?? null,
        blitz:     me.perfs?.blitz?.rating    ?? null,
        rapid:     me.perfs?.rapid?.rating    ?? null,
        classical: me.perfs?.classical?.rating ?? null,
        puzzle:    me.perfs?.puzzle?.rating   ?? null,
      },
      accessToken,   // used for authenticated refresh; scope-limited
      linkedAt: new Date(),
    } } });
    this.games.triggerImport(uid, "lichess", accessToken);
    return back(`linked=lichess&status=ok&handle=${encodeURIComponent(lichessUsername)}`);
  }

  @Post("unlink")
  async unlink(@Req() req: any) {
    const uid = req?.session?.userId;
    if (!uid) throw new UnauthorizedException();
    await this.users().updateOne({ _id: uid as any }, { $unset: { "linkedAccounts.lichess": "" } });
    await this.conn.db!.collection("externalGames").deleteMany({ userId: uid, source: "lichess" });
    return { ok: true };
  }
}
