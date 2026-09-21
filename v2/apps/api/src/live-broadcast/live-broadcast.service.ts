// Live broadcast ingest — every tournament on air, by polling.
//
// The first version of this streamed. Lichess offers a streaming endpoint, so
// reaching for it seemed obvious, and it was wrong: at 6 concurrent streams it
// served two and returned 429 on four, because what it limits is CONCURRENT
// CONNECTIONS, not request volume. Streaming therefore capped us at ~2
// tournaments no matter how many were playing.
//
// Polling holds no connections open. One request at a time, round-robin across
// every live round, means we cover ALL of them — measured at 5 live
// tournaments, ~1.4s per fetch, so a full refresh of everything on air every
// ~7 seconds. For classical chess that is inside a move.
//
// Two things NOT to do here, both learned by measuring:
//
//  * Do not use /api/broadcast/<tourId>.pgn for this. It returns every round
//    of the tournament including all the finished ones — 1.18MB and over 30s
//    for a live Olympiad section. The per-round endpoint returns just the
//    round being played.
//
//  * Do not run these requests in parallel. Lichess's own wording is "Please
//    only run 1 request(s) at a time"; a parallel burst is exactly what earns
//    the 429. Every outbound call in this file queues behind one chain.
//
// State lives in Mongo, never in this process's memory: an in-memory map dies
// on every API reload and is invisible to the class-ws process — the shape of
// bug that broke the abandoned sweeper, the class-end broadcast and the
// challenge marks, all in one day.
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Chess } from "chess.js";

const DISCOVER_MS = 90_000;      // re-ask which rounds are live
const POLL_MS = 2_500;           // gap between board refreshes
const TOURS_SCANNED = 60;        // how far down the recent-tournament list to look
const BACKOFF_MS = 90_000;       // how long a 429 sidelines us
const UA = "ChessGuru/1.0 (academy live board; contact ranjith.vsk@gmail.com)";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

@Injectable()
export class LiveBroadcastService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("live-broadcast");
  private discoverTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private chain: Promise<unknown> = Promise.resolve();
  private throttledUntil = 0;
  private cursor = 0;
  private liveRoundIds: string[] = [];
  private lastCycleMs = 0;
  private cycleStartedAt = Date.now();

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private games() { return this.conn.db!.collection("liveBroadcastGames"); }
  private rounds() { return this.conn.db!.collection("liveBroadcastRounds"); }

  /** One request at a time, always. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run as Promise<T>;
  }

  private async getText(url: string): Promise<string> {
    const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/x-chess-pgn, application/x-ndjson, */*" };
    // A token lifts the anonymous per-IP limit. Optional — everything works
    // without one, just with a longer cycle.
    const token = (process.env.LICHESS_TOKEN || "").trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (r.status === 429) { this.throttledUntil = Date.now() + BACKOFF_MS; throw new Error("429"); }
    if (!r.ok) throw new Error(String(r.status));
    return r.text();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.games().createIndex({ roundId: 1, board: 1 }, { name: "round_board" });
      await this.games().createIndex({ updatedAt: -1 }, { name: "fresh" });
      await this.rounds().createIndex({ ongoing: 1, updatedAt: -1 }, { name: "live_rounds" });
    } catch { /* already there */ }
    setTimeout(() => { void this.discover(); }, 8_000);
    this.discoverTimer = setInterval(() => { void this.discover(); }, DISCOVER_MS);
    this.pollTimer = setInterval(() => { void this.pollNext(); }, POLL_MS);
    for (const t of [this.discoverTimer, this.pollTimer]) if (typeof t?.unref === "function") t.unref();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.discoverTimer) clearInterval(this.discoverTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Which rounds are being played right now. Every one of them, not a subset. */
  private async discover(): Promise<void> {
    if (this.stopping || Date.now() < this.throttledUntil) return;
    type L = { roundId: string; roundName: string; tourId: string; tourName: string; url: string;
               state: "live" | "playing" | "soon"; startsAt: number | null };
    const live: L[] = [];
    try {
      const text = await this.serialize(() => this.getText(`https://lichess.org/api/broadcast?nb=${TOURS_SCANNED}`));
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let d: any;
        try { d = JSON.parse(line); } catch { continue; }
        const tour = d?.tour ?? {};
        for (const rd of Array.isArray(d?.rounds) ? d.rounds : []) {
          if (rd?.finished) continue;
          const startsAt = Number(rd?.startsAt) || null;
          const started = startsAt !== null && startsAt <= Date.now();
          // `ongoing` is narrower than it sounds: Lichess raises it only once
          // it is actually receiving moves, so a round that has begun but whose
          // organiser has not pushed anything yet is NOT flagged. Filtering on
          // it alone hid tournaments that were genuinely being played —
          // measured, two rounds that had started 22 minutes earlier were
          // invisible. A round counts as current if upstream says ongoing OR
          // its start time has passed.
          const state: "live" | "playing" | "soon" =
            rd?.ongoing ? "live" : started ? "playing" : "soon";
          // 48h, not 12. A multi-day event has REST DAYS: when this was 12h
          // the FIDE Olympiad disappeared from the page entirely between
          // rounds 6 and 7, which were 38.5 hours apart, even though the
          // tournament was very much still running. A window shorter than the
          // longest normal gap between rounds makes big events vanish exactly
          // when people go looking for them.
          if (state === "soon" && (startsAt === null || startsAt - Date.now() > 48 * 3600_000)) continue;
          live.push({
            roundId: String(rd.id), roundName: String(rd.name ?? "Round"),
            tourId: String(tour.id ?? ""), tourName: String(tour.name ?? "Broadcast"),
            url: String(rd.url ?? ""), state, startsAt,
          });
        }
      }
    } catch (e: any) {
      if (String(e?.message) !== "429") this.log.warn(`discover failed: ${e?.message ?? e}`);
      return;
    }

    const now = new Date();
    for (const l of live) {
      await this.rounds().updateOne(
        { _id: l.roundId as any },
        { $set: { ...l, ongoing: l.state !== "soon", updatedAt: now }, $setOnInsert: { startedAt: now } },
        { upsert: true },
      ).catch(() => {});
    }
    // Only rounds actually in play are polled. An upcoming round is listed so
    // the page is never empty between rounds, but fetching it would return an
    // empty board list and spend budget we owe the live ones.
    const ids = live.filter((l) => l.state !== "soon").map((l) => l.roundId);
    const allIds = live.map((l) => l.roundId);
    await this.rounds().updateMany(
      { ongoing: true, _id: { $nin: allIds as any[] } },
      { $set: { ongoing: false, state: "finished", updatedAt: now } },
    ).catch(() => {});

    if (ids.length !== this.liveRoundIds.length) {
      const soon = live.length - ids.length;
      this.log.log(`${ids.length} round${ids.length === 1 ? "" : "s"} in play${soon ? `, ${soon} starting soon` : ""} — full refresh every ~${Math.round(ids.length * POLL_MS / 1000)}s`);
    }
    this.liveRoundIds = ids;
  }

  /** Refresh ONE live round per tick, round-robin, so every tournament on air
   *  is covered rather than the two a streaming connection budget allowed. */
  private async pollNext(): Promise<void> {
    if (this.stopping || Date.now() < this.throttledUntil) return;
    if (!this.liveRoundIds.length) return;
    if (this.cursor >= this.liveRoundIds.length) {
      this.lastCycleMs = Date.now() - this.cycleStartedAt;
      this.cycleStartedAt = Date.now();
      this.cursor = 0;
    }
    const roundId = this.liveRoundIds[this.cursor++]!;
    const meta: any = await this.rounds().findOne({ _id: roundId as any }).catch(() => null);
    if (!meta?.ongoing) return;
    try {
      const pgn = await this.serialize(() => this.getText(`https://lichess.org/api/broadcast/round/${roundId}.pgn`));
      await this.applyPgn(roundId, meta.tourName ?? "Broadcast", meta.roundName ?? "Round", pgn);
    } catch (e: any) {
      if (String(e?.message) === "429") this.log.warn("throttled — backing off 90s");
    }
  }

  /** Someone opened a round: refresh it now rather than waiting for its turn. */
  async noteViewed(roundId: string): Promise<void> {
    await this.rounds().updateOne({ _id: roundId as any }, { $set: { lastViewedAt: new Date() } }).catch(() => {});
    const meta: any = await this.rounds().findOne({ _id: roundId as any }).catch(() => null);
    if (!meta?.ongoing) return;
    const fresh = meta.updatedAt && Date.now() - new Date(meta.updatedAt).getTime() < POLL_MS * 2;
    if (fresh || Date.now() < this.throttledUntil) return;    // it was just refreshed
    try {
      const pgn = await this.serialize(() => this.getText(`https://lichess.org/api/broadcast/round/${roundId}.pgn`));
      await this.applyPgn(roundId, meta.tourName ?? "Broadcast", meta.roundName ?? "Round", pgn);
    } catch { /* its turn in the rotation comes round soon enough */ }
  }

  /** Split a round's PGN and upsert each board's current state. */
  private async applyPgn(roundId: string, tourName: string, roundName: string, pgn: string): Promise<void> {
    const parts = splitGames(pgn);
    if (!parts.length) return;
    const now = new Date();
    const ops: any[] = [];

    parts.forEach((one, i) => {
      const g = new Chess();
      let sans: string[] = [];
      let h: Record<string, string> = {};
      try {
        // Annotations must come OFF before chess.js sees the movetext. A
        // broadcast PGN carries { [%eval 0.18] [%clk 1:00:50] } and "1..."
        // continuation numbers, and chess.js 1.4 rejects the lot — measured on
        // a real dump, 8 of 88 games parsed as published against 85 of 88
        // stripped. Clocks are pulled out first, since that is the only place
        // they exist: there is no WhiteClock header, which is why the live
        // boards showed no time.
        g.loadPgn(stripAnnotations(one));
        sans = g.history();
        h = (g.header?.() ?? {}) as Record<string, string>;
      } catch {
        // A board that has not started is headers-only and will not parse as a
        // game. We still want it listed, so fall back to reading the headers.
        h = headersOnly(one);
      }
      const white = h.White || "?", black = h.Black || "?";
      if (white === "?" && black === "?") return;
      const board = Number(h.Board) || i + 1;
      const clocks = lastClocks(one);
      ops.push({
        updateOne: {
          filter: { roundId, board },
          update: {
            $set: {
              roundId, tourName, roundName, board,
              whiteName: white, blackName: black,
              whiteElo: Number(h.WhiteElo) || null, blackElo: Number(h.BlackElo) || null,
              // From the movetext, not a header — see lastClocks().
              whiteClock: clocks.white, blackClock: clocks.black,
              // Whose move it is, and when we read these clocks. Together they
              // let a viewer run the side-to-move's clock down between
              // refreshes instead of showing a frozen number — the published
              // clock is that player's time at their last move, so the time
              // since is exactly what has elapsed on it.
              turn: sans.length % 2 === 0 ? "w" : "b",
              clockAsOf: now,
              // Everything the feed knows about the players. Title and FIDE id
              // are in the headers; there is no country tag, but the FIDE id
              // identifies the player if we ever want to resolve one.
              whiteTitle: h.WhiteTitle ?? null, blackTitle: h.BlackTitle ?? null,
              // Team events DO carry the country: an Olympiad board reads
              // WhiteTeam "Timor-Leste" / BlackTeam "Cambodia". This is the
              // only place a nationality appears in the format — individual
              // tournaments have no such tag — so it is what a flag can be
              // drawn from, and what team results are aggregated by.
              whiteTeam: h.WhiteTeam ?? null, blackTeam: h.BlackTeam ?? null,
              whiteFideId: h.WhiteFideId ?? null, blackFideId: h.BlackFideId ?? null,
              timeControl: h.TimeControl ?? null,
              // The feed states these; no need to derive what we are told.
              eco: h.ECO ?? null, openingName: h.Opening ?? null,
              gameUrl: h.GameURL ?? null,
              result: h.Result || "*",
              moves: sans, ply: sans.length,
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
      // Count what we HOLD, not what this response carried.
      const boards = await this.games().countDocuments({ roundId });
      await this.rounds().updateOne({ _id: roundId as any }, { $set: { updatedAt: now, boards } }).catch(() => {});
    } catch (e: any) {
      this.log.warn(`apply ${roundId}: ${e?.message ?? e}`);
    }
  }

  /** For the index: what we are following and how fresh it is. */
  status(): { rounds: number; cycleSec: number; throttled: boolean } {
    return {
      rounds: this.liveRoundIds.length,
      cycleSec: Math.round((this.lastCycleMs || this.liveRoundIds.length * POLL_MS) / 1000),
      throttled: Date.now() < this.throttledUntil,
    };
  }
}

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

/** chess.js 1.4 cannot parse a broadcast PGN as published — see applyPgn. */
function stripAnnotations(pgn: string): string {
  return String(pgn)
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/[ \t]+/g, " ");
}

/** The clocks a broadcast actually publishes live in the movetext, as
 *  { [%clk 1:00:50] } after each move — there is no WhiteClock header. The
 *  LAST such annotation for each side is that player's remaining time.
 *  White's moves are the odd-numbered annotations, Black's the even ones. */
function lastClocks(pgn: string): { white: string | null; black: string | null } {
  const all = [...String(pgn).matchAll(/\[%clk\s+([0-9:.]+)\s*\]/g)].map((m) => m[1]!);
  if (!all.length) return { white: null, black: null };
  let white: string | null = null, black: string | null = null;
  for (let i = 0; i < all.length; i++) {
    if (i % 2 === 0) white = all[i]!;
    else black = all[i]!;
  }
  return { white, black };
}
