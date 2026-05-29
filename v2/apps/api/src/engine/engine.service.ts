import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Queue, Worker } from "bullmq";
import { spawn } from "child_process";

const CONNECTION = { host: "127.0.0.1", port: 6379 };
const QUEUE = "extraction";
const PREFIX = "cgv2"; // namespace so we don't collide with the old app's redis usage
const EXTRACTOR = `${process.env.HOME || "/home/ubuntu"}/chessguru/engine-battle/puzzle_extractor.js`;
const PER_GAME_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("EngineService");
  private queue!: Queue;
  private worker!: Worker;

  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit() {
    this.queue = new Queue(QUEUE, { connection: CONNECTION, prefix: PREFIX });
    // concurrency 1 → at most one Stockfish extraction at a time (protects the shared box)
    this.worker = new Worker(QUEUE, (job) => this.runExtractor(String(job.data?.gameId ?? "")), {
      connection: CONNECTION, prefix: PREFIX, concurrency: 1,
    });
    this.worker.on("completed", (job, res: any) => this.log.log(`extract ${job.id} done: ${JSON.stringify(res)}`));
    this.worker.on("failed", (job, err) => this.log.error(`extract ${job?.id} failed: ${err?.message}`));
    this.log.log("extraction queue + worker ready (concurrency 1)");
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
  }

  /** Reuse the proven extractor for one game (separate process; doesn't block the event loop). */
  private runExtractor(gameId: string): Promise<{ gameId: string; code: number; tail: string }> {
    return new Promise((resolve, reject) => {
      if (!gameId) return reject(new Error("no gameId"));
      const ch = spawn("node", [EXTRACTOR, "--game", gameId], { env: process.env });
      let out = "";
      const cap = (d: Buffer) => { out += d.toString(); if (out.length > 8000) out = out.slice(-8000); };
      ch.stdout.on("data", cap);
      ch.stderr.on("data", cap);
      const killer = setTimeout(() => ch.kill("SIGKILL"), PER_GAME_TIMEOUT_MS);
      ch.on("error", (e) => { clearTimeout(killer); reject(e); });
      ch.on("close", (code) => { clearTimeout(killer); resolve({ gameId, code: code ?? -1, tail: out.slice(-400) }); });
    });
  }

  async stats() {
    const counts = await this.queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    const recent = await this.queue.getJobs(["completed", "failed", "active"], 0, 9);
    return {
      counts,
      recent: recent.filter(Boolean).map((j: any) => ({ id: j.id, gameId: j.data?.gameId, state: j.finishedOn ? (j.failedReason ? "failed" : "completed") : "active", ts: j.finishedOn || j.processedOn || j.timestamp })),
    };
  }

  /** Enqueue extraction for un-extracted decisive engine games (manual, capped). */
  async enqueue(limit: number) {
    const lim = Math.max(1, Math.min(limit || 3, 10));
    const games = await this.conn.db!.collection("enginegames")
      .find({ puzzleExtracted: { $ne: true }, result: { $in: ["1-0", "0-1"] } })
      .sort({ startedAt: -1 }).limit(lim).project({ _id: 1 }).toArray();
    let enqueued = 0;
    for (const g of games) {
      await this.queue.add("extract", { gameId: String(g._id) }, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
      enqueued++;
    }
    return { enqueued, availableGames: games.length };
  }
}
