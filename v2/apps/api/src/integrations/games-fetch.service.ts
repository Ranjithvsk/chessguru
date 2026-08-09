// Pulls a user's recent games from Lichess and Chess.com and upserts them into
// the `externalGames` collection. Runs fire-and-forget after a successful link
// or when the user hits "Refresh" — never blocks the caller for network.
//
// Storage shape (externalGames):
//   { _id, userId, source: "lichess"|"chesscom",
//     gameId, url, played (Date), white, black, whiteRating, blackRating,
//     result, timeControl, opening, pgn }
// _id is `${source}:${gameId}` so re-imports are idempotent.

import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const LICHESS_PULL = 100;   // how many recent games to fetch on link/refresh
const CHESSCOM_MONTHS = 3;  // pull the last N calendar months of Chess.com games

@Injectable()
export class GamesFetchService {
  private readonly log = new Logger("GamesFetch");
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection("externalGames"); }
  private users() { return this.conn.db!.collection("users"); }

  /** Fire-and-forget wrapper — logs error, never throws. */
  triggerImport(userId: string, source: "lichess" | "chesscom", handleOrToken: string) {
    this.importGames(userId, source, handleOrToken).catch((err) => {
      this.log.warn(`import ${source} for ${userId} failed: ${err?.message || err}`);
    });
  }

  async importGames(userId: string, source: "lichess" | "chesscom", handleOrToken: string) {
    const started = Date.now();
    let imported = 0;
    if (source === "lichess") {
      imported = await this.importLichess(userId, handleOrToken);
    } else {
      imported = await this.importChesscom(userId, handleOrToken);
    }
    // Record last-sync stamp on user.linkedAccounts.<source>
    const patch: Record<string, any> = {};
    patch[`linkedAccounts.${source}.lastImportAt`] = new Date();
    patch[`linkedAccounts.${source}.lastImportCount`] = imported;
    await this.users().updateOne({ _id: userId as any }, { $set: patch });
    this.log.log(`imported ${imported} ${source} games for ${userId} in ${Date.now() - started}ms`);
    return imported;
  }

  // Lichess — https://lichess.org/api/games/user/<name>?max=100
  // Returns NDJSON (one JSON object per line). Use ?pgnInJson=true so we get
  // pgn as a string on each row; skip lines that don't parse.
  private async importLichess(userId: string, tokenOrHandle: string) {
    // If we got a token we can hit /api/account first to resolve username.
    // Callers pass the token OR (as a fallback) a bare username.
    let handle = tokenOrHandle;
    if (tokenOrHandle.length > 32 || tokenOrHandle.includes(".")) {
      const acct = await fetch("https://lichess.org/api/account", {
        headers: { Authorization: `Bearer ${tokenOrHandle}` },
      });
      if (!acct.ok) throw new Error(`lichess /api/account ${acct.status}`);
      const j: any = await acct.json();
      handle = j.username;
    }
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(handle)}?max=${LICHESS_PULL}&pgnInJson=true&opening=true`;
    const res = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
    if (!res.ok) throw new Error(`lichess games ${res.status}`);
    const text = await res.text();
    let n = 0;
    const ops: any[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let g: any; try { g = JSON.parse(line); } catch { continue; }
      const white = g.players?.white?.user?.name ?? "?";
      const black = g.players?.black?.user?.name ?? "?";
      const doc = {
        _id: `lichess:${g.id}`,
        userId,
        source: "lichess",
        gameId: g.id,
        url: `https://lichess.org/${g.id}`,
        played: new Date(g.createdAt),
        white, black,
        whiteRating: g.players?.white?.rating ?? null,
        blackRating: g.players?.black?.rating ?? null,
        result: g.winner ? (g.winner === "white" ? "1-0" : "0-1") : "1/2-1/2",
        timeControl: g.speed || null,
        opening: g.opening?.name ?? null,
        pgn: g.pgn ?? null,
        importedAt: new Date(),
      };
      ops.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      n++;
    }
    if (ops.length) await this.col().bulkWrite(ops, { ordered: false });
    return n;
  }

  // Chess.com — https://api.chess.com/pub/player/<handle>/games/<yyyy>/<mm>
  // Loops the last N calendar months. Requires a User-Agent per Chess.com policy.
  private async importChesscom(userId: string, handle: string) {
    const now = new Date();
    let n = 0;
    const ops: any[] = [];
    for (let i = 0; i < CHESSCOM_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const url = `https://api.chess.com/pub/player/${encodeURIComponent(handle.toLowerCase())}/games/${yyyy}/${mm}`;
      const res = await fetch(url, { headers: { "User-Agent": "ChessGuru/1.0 (contact: noreply@harinitharanjith.com)" } });
      if (res.status === 404) continue;   // no games that month
      if (!res.ok) throw new Error(`chess.com ${yyyy}/${mm} → ${res.status}`);
      const j: any = await res.json();
      for (const g of j.games ?? []) {
        const gameId = String(g.url || "").split("/").pop() || g.uuid;
        if (!gameId) continue;
        const doc = {
          _id: `chesscom:${gameId}`,
          userId,
          source: "chesscom",
          gameId,
          url: g.url,
          played: new Date((g.end_time || 0) * 1000),
          white: g.white?.username ?? "?",
          black: g.black?.username ?? "?",
          whiteRating: g.white?.rating ?? null,
          blackRating: g.black?.rating ?? null,
          result: g.white?.result === "win" ? "1-0" : g.black?.result === "win" ? "0-1" : "1/2-1/2",
          timeControl: g.time_control ?? null,
          opening: g.eco ?? null,
          pgn: g.pgn ?? null,
          importedAt: new Date(),
        };
        ops.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
        n++;
      }
    }
    if (ops.length) await this.col().bulkWrite(ops, { ordered: false });
    return n;
  }
}
