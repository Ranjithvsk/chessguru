// Late-fee auto-cron.
//
// Once an hour we look for every plan that has a positive
// `lateFeeAmountPaise`, find its invoices whose `dueOn + graceDays` has
// elapsed, and append a `{kind: "LATE"}` line to each one. The atomic
// updateOne uses `lateFeeAppliedAt: {$exists: false}` in both the query AND
// the filter, so the fee is charged exactly once per invoice even if two API
// pods tick at the same moment.
//
// The line is appended to the existing invoice (not a new invoice) — one
// billing period stays one document, which keeps monthly reports simple and
// matches how accountants think about statement lines. Total is $inc'd
// atomically alongside the $push so paidPaise / status / balance math never
// sees an inconsistent intermediate state.
//
// Cadence: hourly (setInterval 60m), idempotent via the flag so late/early
// ticks are safe. First tick fires 45 s after boot so start-up races settle.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { COL, FeePlanDoc, InvoiceDoc } from "./fees.types";

const TICK_MS = 60 * 60 * 1000;             // once an hour
const BATCH_CAP = 500;                       // safety cap per plan per tick

@Injectable()
export class FeesLateFeeCron implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit() {
    setTimeout(() => {
      this.tick().catch((e) => console.warn("[fees-late-fee] first tick failed:", e));
      setInterval(() => { this.tick().catch((e) => console.warn("[fees-late-fee] tick failed:", e)); }, TICK_MS);
    }, 45_000);
  }

  private plans()    { return this.conn.db!.collection<FeePlanDoc>(COL.plans); }
  private invoices() { return this.conn.db!.collection<InvoiceDoc>(COL.invoices); }

  private async tick(): Promise<void> {
    const now = new Date();
    // Every plan that has an enabled late-fee amount, scoped nowhere else so
    // cross-tenant scanning is fine — Mongo indexes on planId will keep the
    // per-invoice query cheap.
    const plans = await this.plans().find({ lateFeeAmountPaise: { $gt: 0 } }).toArray();
    if (plans.length === 0) return;

    let applied = 0;
    for (const plan of plans) {
      const graceMs = (plan.lateFeeGraceDays ?? 7) * 86400_000;
      const cutoff = new Date(now.getTime() - graceMs);
      const feeAmount = plan.lateFeeAmountPaise ?? 0;
      if (feeAmount <= 0) continue;

      // Candidate invoices: open, past cutoff, late fee not already applied.
      const candidates = await this.invoices().find({
        academyId: plan.academyId,
        planId: String(plan._id),
        status: { $in: ["SENT", "PARTIAL", "OVERDUE"] },
        dueOn: { $lt: cutoff },
        lateFeeAppliedAt: { $exists: false },
      }).limit(BATCH_CAP).toArray();
      if (candidates.length === 0) continue;

      for (const inv of candidates) {
        // Atomic: append line, bump total, flag applied, flip to OVERDUE.
        // The `lateFeeAppliedAt: {$exists: false}` in the filter re-checks at
        // write time so concurrent ticks (e.g. multi-pod future) race safely.
        try {
          const r = await this.invoices().updateOne(
            { _id: inv._id, academyId: plan.academyId, lateFeeAppliedAt: { $exists: false } },
            {
              $push: { lines: { name: "Late fee", amountPaise: feeAmount, kind: "LATE" } },
              $inc: { totalPaise: feeAmount },
              $set: { status: "OVERDUE", lateFeeAppliedAt: now, updatedAt: now },
            },
          );
          if (r.modifiedCount > 0) applied++;
        } catch (e) {
          console.warn("[fees-late-fee] apply failed for invoice", String(inv._id), ":", e);
        }
      }
    }
    if (applied > 0) console.log(`[fees-late-fee] applied late fee to ${applied} invoice(s)`);
  }
}
