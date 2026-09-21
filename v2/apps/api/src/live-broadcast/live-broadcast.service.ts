// Live broadcast ingest — tournament games arriving move by move, the way
// Lichess shows them.
//
// Lichess publishes two things we need. /api/broadcast lists tournaments and
// marks a round `ongoing` while it is being played. /api/stream/broadcast/
// round/<id>.pgn is a long-lived response that emits the round's ENTIRE PGN
// again every time any board in it changes. So one open connection per live
// round is enough to follow every game on it.
//
// Design notes, all of them learned the hard way elsewhere in this codebase:
//
//  * State lives in Mongo (`liveBroadcastGames`), not in this process's memory.
//    An in-memory map would be invisible to the class-ws process and would die
//    on every API reload — the exact shape of bug that broke the abandoned
//    sweeper, the class-end broadcast and the challenge marks earlier today.
//
//  * Streams are capped and refreshed on a timer. A tournament weekend can
//    have dozens of concurrent rounds and we are a guest on Lichess's
//    infrastructure, not an entitled one.
//
//  * A round that finishes is dropped from the live set. The archive loader
//    picks those games up later through its own de-duplication, so nothing is
//    lost and nothing is written twice.
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Chess } from "chess.js";

const DISCOVER_MS = 60_000;      // how often we re-ask which rounds are live
const MAX_STREAMS = 6;           // concurrent open connections to Lichess
const TOURS_SCANNED = 30;        // how far down the recent-tournament list to look
const UA = "ChessGuru/1.0 (academy live board; contact ranjith.vsk@gmail.com)";

type StreamHandle = { roundId: string; ctrl: AbortController; startedAt: number };

@Injectable()
export class LiveBroadcastService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("live-broadcast");
  private streams = new Map<string, StreamHandle>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private games() { return this.conn.db!.collection("liveBroadcastGames"); }
  private rounds() { return this.conn.db!.collection("liveBroadcastRounds"); }

  async onModuleInit(): Promise<void> {
    // Indexes first — the page queries these on every poll.
    try {
      await this.games().createIndex({ roundId: 1, board: 1 }, { name: "round_board" });
      await this.games().createIndex({ updatedAt: -1 }, { name: "fresh" });
      await this.rounds().createIndex({ ongoing: 1, updatedAt: -1 }, { name: "live_rounds" });
    } catch { /* index already there */ }
    setTimeout(() => { void this.discover(); }, 8_000);          // let the app finish booting
    this.timer = setInterval(() => { void this.discover(); }, DISCOVER_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const s of this.streams.values()) { try { s.ctrl.abort(); } catch { /* */ } }
    this.streams.clear();
  }

  /** Ask which rounds are live, then open/close streams to match. */
  private async discover(): Promise<void> {
    if (this.stopping) return;
    let live: { roundId: string; roundName: string; tourId: string; tourName: string; url: string }[] = [];
    try {
      const r = await fetch(`https://lichess.org/api/broadcast?nb=${TOURS_SCANNED}`, {
        headers: { "User-Agent": UA, Accept: "application/x-ndjson" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`broadcast index ${r.status}`);
      const text = await r.text();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let d: any;
        try { d = JSON.parse(line); } catch { continue; }
        const tour = d?.tour ?? {};
        for (const rd of Array.isArray(d?.rounds) ? d.rounds : []) {
          if (!rd?.ongoing) continue;
          live.push({
            roundId: String(rd.id), roundName: String(rd.name ?? "Round"),
            tourId: String(tour.id ?? ""), tourName: String(tour.name ?? "Broadcast"),
            url: String(rd.url ?? ""),
          });
        }
      }
    } catch (e: any) {
      this.log.warn(`discover failed: ${e?.message ?? e}`);
      return;                                   // keep whatever streams we have
    }

    live = live.slice(0, MAX_STREAMS);
    const wanted = new Set(live.map((l) => l.roundId));

    // Close rounds that are no longer live.
    for (const [id, s] of [...this.streams]) {
      if (wanted.has(id)) continue;
      try { s.ctrl.abort(); } catch { /* */ }
      this.streams.delete(id);
      await this.rounds().updateOne({ _id: id as any }, { $set: { ongoing: false, updatedAt: new Date() } }).catch(() => {});
      this.log.log(`round ${id} finished — stream closed`);
    }

    // Open the new ones.
    for (const l of live) {
      await this.rounds().updateOne(
        { _id: l.roundId as any },
        { $set: { ...l, ongoing: true, updatedAt: new Date() }, $setOnInsert: { startedAt: new Date() } },
        { upsert: true },
      ).catch(() => {});
      if (this.streams.has(l.roundId)) continue;
      this.openStream(l.roundId, l.tourName, l.roundName);
    }
  }

  /** Hold one streaming connection and apply every snapshot it sends. */
  private openStream(roundId: string, tourName: string, roundName: string): void {
    const ctrl = new AbortController();
    this.streams.set(roundId, { roundId, ctrl, startedAt: Date.now() });
    this.log.log(`streaming ${tourName} — ${roundName} (${roundId})`);

    void (async () => {
      try {
        const r = await fetch(`https://lichess.org/api/stream/broadcast/round/${roundId}.pgn`, {
          headers: { "User-Agent": UA, Accept: "application/x-chess-pgn" },
          signal: ctrl.signal,
        });
        if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
        const reader = (r.body as any).getReader();
        const dec = new TextDecoder();
        let buf = "";
        // The stream emits the whole round PGN on each change, separated by a
        // blank line between games. We accumulate and flush on a quiet moment
        // rather than per chunk, so one board's move does not trigger a dozen
        // partial parses.
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
          const pgn = buf; buf = "";
          if (pgn.trim()) void this.applyPgn(roundId, tourName, roundName, pgn);
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(flush, 800);
        }
        if (flushTimer) clearTimeout(flushTimer);
        flush();
      } catch (e: any) {
        if (!ctrl.signal.aborted) this.log.warn(`stream ${roundId} dropped: ${e?.message ?? e}`);
      } finally {
        this.streams.delete(roundId);
        // discover() reopens it on the next tick if the round is still live.
      }
    })();
  }

  /** Split a multi-game PGN and upsert each board's current state. */
  private async applyPgn(roundId: string, tourName: string, roundName: string, pgn: string): Promise<void> {
    const games = splitGames(pgn);
    if (!games.length) return;
    const now = new Date();
    const ops: any[] = [];

    games.forEach((one, i) => {
      const g = new Chess();
      let sans: string[] = [];
      let h: Record<string, string> = {};
      try {
        g.loadPgn(one);
        sans = g.history();
        h = (g.header?.() ?? {}) as Record<string, string>;
      } catch {
        // A board that has not started yet is headers-only and will not parse
        // as a game. We still want it listed, so fall back to the headers.
        h = headersOnly(one);
      }
      const white = h.White || "?", black = h.Black || "?";
      if (white === "?" && black === "?") return;              // nothing to show
      const board = Number(h.Board) || i + 1;
      ops.push({
        updateOne: {
          filter: { roundId, board },
          update: {
            $set: {
              roundId, tourName, roundName, board,
              whiteName: white, blackName: black,
              whiteElo: Number(h.WhiteElo) || null, blackElo: Number(h.BlackElo) || null,
              whiteClock: h.WhiteClock ?? null, blackClock: h.BlackClock ?? null,
              result: h.Result || "*",
              moves: sans,
              ply: sans.length,
              fen: sans.length ? g.fen() : (h.FEN || START_FEN),
              lastMove: sans.length ? sans[sans.length - 1] : null,
              finished: (h.Result || "*") !== "*",
              updatedAt: now,
            },
            $setOnInsert: { startedAt: now },
          },
          upsert: true,
        },
      });
    });

    if (!ops.length) return;
    try {
      await this.games().bulkWrite(ops, { ordered: false });
      // Count what we actually HOLD, not what this flush happened to carry: a
      // stream chunk can arrive with a handful of boards and would otherwise
      // make a 20-board round report itself as 3.
      const boards = await this.games().countDocuments({ roundId });
      await this.rounds().updateOne({ _id: roundId as any }, { $set: { updatedAt: now, boards } }).catch(() => {});
    } catch (e: any) {
      this.log.warn(`apply ${roundId}: ${e?.message ?? e}`);
    }
  }

  /** For the status endpoint — what this process is currently following. */
  openStreams(): { roundId: string; forMs: number }[] {
    return [...this.streams.values()].map((s) => ({ roundId: s.roundId, forMs: Date.now() - s.startedAt }));
  }
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** A header line after moves have begun is the next game. */
function splitGames(raw: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let seenMoves = false;
  const flush = () => { const t = cur.join("\n").trim(); if (t) out.push(t); cur = []; seenMoves = false; };
  for (const line of String(raw || "").split(/\r?\n/)) {
    const isHeader = /^\s*\[/.test(line);
    if (isHeader && seenMoves) flush();
    if (!isHeader && line.trim()) seenMoves = true;
    cur.push(line);
  }
  flush();
  return out;
}

function headersOnly(pgn: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const m of String(pgn).matchAll(/^\s*\[(\w+)\s+"([^"]*)"\]/gm)) h[m[1]!] = m[2]!;
  return h;
}
