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
// MEASURED, not guessed. At 6 concurrent streams Lichess returned 429 on four
// of them and served two; its own error text is "Please only run 1 request(s)
// at a time". So we hold a very small number of live connections and cover
// everything else by rotating one-shot fetches through the remaining rounds.
// That is the difference between us and Lichess on this: they are the origin
// and receive games pushed to them, we are a guest on their API.
const MAX_STREAMS = 2;           // concurrent open connections to Lichess
const ROTATE_MS = 9_000;         // one-shot refresh of the next unstreamed round
const BACKOFF_MS = 90_000;       // how long a 429 sidelines us
const TOURS_SCANNED = 60;        // how far down the recent-tournament list to look
// A round is "watched" for this long after someone last loaded it. Streams
// follow the audience: we hold an open connection to what people are actually
// looking at, and merely LIST the rest.
const WATCH_TTL_MS = 3 * 60_000;
const UA = "ChessGuru/1.0 (academy live board; contact ranjith.vsk@gmail.com)";

type StreamHandle = { roundId: string; ctrl: AbortController; startedAt: number };

@Injectable()
export class LiveBroadcastService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("live-broadcast");
  private streams = new Map<string, StreamHandle>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private rotateTimer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  // Lichess asks for one request at a time, so every outbound call queues
  // behind this. Without it the rotation and discovery race each other and
  // both get 429'd.
  private chain: Promise<unknown> = Promise.resolve();
  private throttledUntil = 0;
  private rotateCursor = 0;

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run as Promise<T>;
  }

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
    // The rotation is what gives every live round its games, not just the two
    // we can hold open.
    this.rotateTimer = setInterval(() => { void this.rotate(); }, ROTATE_MS);
    if (typeof this.rotateTimer.unref === "function") this.rotateTimer.unref();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.rotateTimer) clearInterval(this.rotateTimer);
    for (const s of this.streams.values()) { try { s.ctrl.abort(); } catch { /* */ } }
    this.streams.clear();
  }

  /** Ask which rounds are live, then open/close streams to match. */
  private async discover(): Promise<void> {
    if (this.stopping) return;
    let live: { roundId: string; roundName: string; tourId: string; tourName: string; url: string }[] = [];
    try {
      const text = await this.serialize(async () => {
        const r = await fetch(`https://lichess.org/api/broadcast?nb=${TOURS_SCANNED}`, {
          headers: { "User-Agent": UA, Accept: "application/x-ndjson" },
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429) { this.throttledUntil = Date.now() + BACKOFF_MS; throw new Error("429"); }
        if (!r.ok) throw new Error(`broadcast index ${r.status}`);
        return r.text();
      });
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

    // Every live round is RECORDED, so the index can show them all — Lichess
    // runs dozens at once and a viewer should see dozens. Only the ones people
    // are actually watching get an open stream; the cap is on connections to
    // Lichess, not on what we are willing to display. (owner: "lichess have
    // many broadcast running and results of many, how do they do that?" —
    // they are the origin and receive games directly; we are a consumer, so
    // we follow the audience instead of everything at once.)
    for (const l of live) {
      await this.rounds().updateOne(
        { _id: l.roundId as any },
        { $set: { ...l, ongoing: true, updatedAt: new Date() }, $setOnInsert: { startedAt: new Date() } },
        { upsert: true },
      ).catch(() => {});
    }
    const liveIds = new Set(live.map((l) => l.roundId));

    // Close anything no longer live.
    for (const [id, st] of [...this.streams]) {
      if (liveIds.has(id)) continue;
      try { st.ctrl.abort(); } catch { /* */ }
      this.streams.delete(id);
      this.log.log(`round ${id} finished — stream closed`);
    }
    await this.rounds().updateMany(
      { ongoing: true, _id: { $nin: [...liveIds] as any[] } },
      { $set: { ongoing: false, updatedAt: new Date() } },
    ).catch(() => {});

    // Rank by who is watching, newest interest first, and stream the top few.
    const watchedSince = new Date(Date.now() - WATCH_TTL_MS);
    const watched = await this.rounds()
      .find({ ongoing: true, lastViewedAt: { $gte: watchedSince } }, { projection: { _id: 1 } })
      .sort({ lastViewedAt: -1 })
      .limit(MAX_STREAMS)
      .toArray()
      .catch(() => [] as any[]);
    const watchedIds = watched.map((r: any) => String(r._id));

    // Nobody watching anything? Follow the most recently updated rounds, so
    // the page is never empty for the first person to arrive.
    let target = watchedIds;
    if (target.length < MAX_STREAMS) {
      const filler = live.map((l) => l.roundId).filter((id) => !target.includes(id));
      target = [...target, ...filler].slice(0, MAX_STREAMS);
    }
    const wanted = new Set(target);
    live = live.filter((l) => wanted.has(l.roundId));

    // Drop streams that lost their audience, open the ones that gained it.
    for (const [id, st] of [...this.streams]) {
      if (wanted.has(id)) continue;
      try { st.ctrl.abort(); } catch { /* */ }
      this.streams.delete(id);
      this.log.log(`round ${id} no longer watched — stream released`);
    }
    for (const l of live) {
      if (this.streams.has(l.roundId)) continue;
      this.openStream(l.roundId, l.tourName, l.roundName);
    }
  }

  /** Refresh ONE unstreamed live round per tick, round-robin, so every round
   *  on the index has real games and a result — just refreshed every rotation
   *  rather than instantly. With N live rounds each is ~N x ROTATE_MS behind,
   *  which for a classical tournament is well inside a move. */
  private async rotate(): Promise<void> {
    if (this.stopping || Date.now() < this.throttledUntil) return;
    const rounds = await this.rounds()
      .find({ ongoing: true }, { projection: { tourName: 1, roundName: 1 } })
      .sort({ _id: 1 })
      .limit(60)
      .toArray()
      .catch(() => [] as any[]);
    const pending = rounds.filter((r: any) => !this.streams.has(String(r._id)));
    if (!pending.length) return;
    const pick: any = pending[this.rotateCursor++ % pending.length];
    const id = String(pick._id);
    try {
      const text = await this.serialize(async () => {
        const r = await fetch(`https://lichess.org/api/broadcast/round/${id}.pgn`, {
          headers: { "User-Agent": UA, Accept: "application/x-chess-pgn" },
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429) { this.throttledUntil = Date.now() + BACKOFF_MS; throw new Error("429"); }
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      });
      await this.applyPgn(id, pick.tourName ?? "Broadcast", pick.roundName ?? "Round", text);
    } catch (e: any) {
      if (String(e?.message) === "429") this.log.warn("rotation throttled — backing off");
    }
  }

  /** Someone opened this round. Mark the interest and, if we are not already
   *  streaming it, fetch its games once so the page is populated immediately
   *  rather than blank until the next discover tick. */
  async noteViewed(roundId: string): Promise<void> {
    await this.rounds().updateOne({ _id: roundId as any }, { $set: { lastViewedAt: new Date() } }).catch(() => {});
    if (this.streams.has(roundId)) return;
    const meta: any = await this.rounds().findOne({ _id: roundId as any }).catch(() => null);
    if (!meta?.ongoing) return;
    try {
      const text = await this.serialize(async () => {
        const r = await fetch(`https://lichess.org/api/broadcast/round/${roundId}.pgn`, {
          headers: { "User-Agent": UA, Accept: "application/x-chess-pgn" },
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429) { this.throttledUntil = Date.now() + BACKOFF_MS; throw new Error("429"); }
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      });
      await this.applyPgn(roundId, meta.tourName ?? "Broadcast", meta.roundName ?? "Round", text);
    } catch { /* the next discover tick will stream it */ }
    if (this.streams.size < MAX_STREAMS) this.openStream(roundId, meta.tourName ?? "Broadcast", meta.roundName ?? "Round");
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
        const msg = String(e?.message ?? e);
        if (/429/.test(msg)) this.throttledUntil = Date.now() + BACKOFF_MS;
        if (!ctrl.signal.aborted) this.log.warn(`stream ${roundId} dropped: ${msg}`);
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
