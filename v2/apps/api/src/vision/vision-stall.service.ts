// Vision loop watchdog (feature 7, owner request 2026-09-10).
//
// The situation this exists to catch is the one found today: the nightly retrain ran faithfully
// for a month on a training set nobody was adding to, and the served model kept being replaced by
// a near-identical one. Every light was green. Nothing told anyone.
//
// Once a day it asks two questions: has an approved correction reached the training set in the
// last seven days, and did the last retrain actually change the served model. If either answer
// is no, it emails the owner, at most once every three days, saying exactly which.
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { statSync } from "node:fs";
import { sendMail } from "../lib/mail";

const CUR = "/home/ubuntu/chessguru/v2/apps/api/models/chess-classifier.onnx";
const PREV = "/home/ubuntu/chessguru/v2/apps/api/models/chess-classifier.onnx.prev";
const DAY = 86_400_000;

@Injectable()
export class VisionStallService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit() {
    // First check a few minutes after boot, then daily. Never on the request path.
    this.timer = setInterval(() => { void this.check(); }, DAY);
    setTimeout(() => { void this.check(); }, 3 * 60_000).unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async check(): Promise<void> {
    try {
      const refs = this.conn.db!.collection<any>("visionRefs");
      const settings = this.conn.db!.collection<any>("visionSettings");
      const last = await refs.find({ source: "correction", approved: true }, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).toArray();
      const lastAt = last[0]?.createdAt ? new Date(last[0].createdAt) : null;
      const daysSince = lastAt ? (Date.now() - lastAt.getTime()) / DAY : Infinity;

      let modelChanged: boolean | null = null;
      try { const a = statSync(CUR), b = statSync(PREV); modelChanged = a.size !== b.size || a.mtimeMs !== b.mtimeMs; } catch { modelChanged = null; }

      const problems: string[] = [];
      if (daysSince > 7) problems.push(lastAt ? `no approved correction has reached the training set for ${Math.floor(daysSince)} days (last: ${lastAt.toISOString().slice(0, 10)})` : "no approved correction has ever reached the training set");
      if (modelChanged === false) problems.push("the last nightly retrain left the served model byte-identical to the previous one");
      if (!problems.length) return;

      const doc = await settings.findOne({ _id: "vision" as any });
      const lastMail = doc?.lastStallMailAt ? new Date(doc.lastStallMailAt).getTime() : 0;
      if (Date.now() - lastMail < 3 * DAY) return;

      const to = process.env.ERROR_ALERT_TO || "ranjith.vsk@gmail.com";
      const text = [
        "The vision improvement loop looks stalled:",
        ...problems.map((p) => `  - ${p}`),
        "",
        "What that means: the scanner is not getting better, whatever the nightly job reports.",
        "See https://chessguru.cc/admin/vision for the review queue and the training-set counts.",
        "",
        "— ChessGuru vision watchdog (daily; at most one mail every 3 days)",
      ].join("\n");
      await sendMail({ to, subject: `[ChessGuru] vision loop stalled: ${problems.length} problem${problems.length > 1 ? "s" : ""}`, text, html: `<pre>${text}</pre>` } as any);
      await settings.updateOne({ _id: "vision" as any }, { $set: { lastStallMailAt: new Date(), lastStallProblems: problems } }, { upsert: true });
    } catch (e) {
      console.warn("[vision-stall] check failed:", (e as Error).message);
    }
  }
}
