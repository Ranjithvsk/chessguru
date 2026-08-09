// Phase 9b: auto-summary cron worker.
//
// Companion to the opt-in autoSummary flag on classSchedules. Every 5 minutes
// this service looks for opted-in classes that:
//   - ended >= 15 min ago
//   - haven't already been auto-summarised (autoSummarySentAt not set)
//   - haven't already been manually summarised (summarySentAt not set)
// and fires the class-summary email flow as if the class creator had
// pressed Send in the dashboard.
//
// Single-process only, same caveat as ClassReminderService. If we ever
// horizontally scale the API pod, this needs a Redis-lock upgrade.
//
// Safety window: only classes that ENDED within the last 24h are eligible.
// Old classes that got the flag turned on retroactively should not blast
// a stale summary weeks later.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { AcademyService } from "../academy/academy.service";

const TICK_MS = 5 * 60_000;     // 5 min cadence
const GRACE_MS = 15 * 60_000;   // wait this long after endAt before sending
const MAX_LOOKBACK_MS = 24 * 3_600_000; // 24h window; older classes are ignored

@Injectable()
export class ClassAutoSummaryService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly academy: AcademyService,
  ) {}

  onModuleInit(): void {
    // Kick off 30s after boot (later than reminders so start-up chatter is
    // spread out), then tick every 5 min. See header comment.
    setTimeout(() => { this.tick().catch(() => {}); }, 30_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const schedules = this.conn.db!.collection("classSchedules");
    // Compute the ready-to-send window in JS since endAt (startAt + duration)
    // isn't a stored field. Cheap filter first, then post-filter in-process.
    const candidates: any[] = await schedules.find({
      autoSummary: true,
      summarySentAt: { $in: [null, undefined] as any },
      autoSummarySentAt: { $in: [null, undefined] as any },
      // Coarse Mongo-side filter: startAt within the lookback + grace headroom.
      startAt: { $gte: new Date(now - MAX_LOOKBACK_MS), $lte: new Date(now - GRACE_MS) },
    }).limit(200).toArray();
    for (const c of candidates) {
      const durationMs = (Number(c.durationMin) || 60) * 60_000;
      const endMs = new Date(c.startAt).getTime() + durationMs;
      if (now < endMs + GRACE_MS) continue;               // not yet
      if (now > endMs + MAX_LOOKBACK_MS) continue;        // too old
      try {
        const r: any = await this.academy.runAutoSummaryFor(String(c._id));
        // eslint-disable-next-line no-console
        console.log(`[auto-summary] ${c._id}:`, JSON.stringify(r));
        // Surface failure to the coach: attempted to send at least one email
        // but every one failed (dw-otp down at that moment, etc.). Stamp so
        // the dashboard can render a "⚠️ auto-send failed" chip.
        if (r?.ok && r?.dryRun !== true && r?.failed > 0 && r?.sent === 0) {
          await schedules.updateOne({ _id: c._id }, {
            $set: { autoSummaryFailedAt: new Date(), autoSummaryFailedCount: r.failed }
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[auto-summary] ${c._id} failed:`, e);
        await schedules.updateOne({ _id: c._id }, {
          $set: { autoSummaryFailedAt: new Date(), autoSummaryFailedError: String((e as Error)?.message || e).slice(0, 500) }
        }).catch(() => {});
      }
    }
  }
}
