// Re-flushes supportFallback rows to the dreamcy pos-api ticket endpoint.
//
// SupportController.saveFallback() parks a submission locally whenever the
// upstream POST fails, so a transient outage doesn't lose a user's support
// request. Until 2026-09-05 nothing ever read that collection back — it was
// written in one place and read in none, so a parked ticket was silently lost
// forever: no TKT row, no email, and the filer saw an "accepted" widget.
//
// What put rows there in practice was not an outage but a 400: upstream capped
// `app` at 30 chars, and "chessguru-<academy-slug>" exceeded that for any slug
// past 20 characters. That cap is now 120, so previously-parked rows succeed on
// replay.
//
// Duplicate risk: rows saved with upstreamStatus 0 (network error / timeout)
// MAY have been accepted upstream before the connection dropped, so replaying
// them can produce a second ticket and a second notification email. There is no
// idempotency key on the support endpoint to key off. We replay them anyway —
// a duplicate ticket is a visible annoyance, a dropped support request is an
// invisible one, and the invisible failure is the worse of the two.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const UPSTREAM = process.env.SUPPORT_UPSTREAM_URL || "https://pos.dreamcy.com/pos/support/ticket";
const TICK_MS = 10 * 60_000;
const FIRST_RUN_DELAY_MS = 40_000;
const BATCH = 20;
// A 4xx is deterministic — the same payload will be rejected the same way
// forever. Bounded so a permanently-malformed row can't be retried for eternity;
// it stays in the collection with gaveUpAt set so it's still greppable.
const MAX_ATTEMPTS = 5;

@Injectable()
export class SupportFallbackDrainService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    setTimeout(() => { this.tick().catch(() => {}); }, FIRST_RUN_DELAY_MS);
    setInterval(() => { this.tick().catch((e) => console.warn("[support-drain] tick failed:", e)); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const col = this.conn.db!.collection("supportFallback");
    const rows = await col
      .find({ drainedAt: { $exists: false }, gaveUpAt: { $exists: false } })
      .sort({ createdAt: 1 })
      .limit(BATCH)
      .toArray();
    if (!rows.length) return;

    let sent = 0;
    for (const row of rows) {
      const attempts = (typeof row.drainAttempts === "number" ? row.drainAttempts : 0) + 1;
      try {
        const r = await fetch(UPSTREAM, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row.payload),
          signal: AbortSignal.timeout(15_000),
        });
        const text = await r.text();
        if (r.ok) {
          let ticketNo: string | null = null;
          try { ticketNo = JSON.parse(text)?.ticketNo ?? null; } catch { /* ignore */ }
          await col.updateOne(
            { _id: row._id },
            { $set: { drainedAt: new Date(), drainedTicketNo: ticketNo, drainAttempts: attempts } },
          );
          sent++;
          continue;
        }
        // Give up early on a deterministic rejection once we've burned the
        // attempt budget; keep retrying 5xx until then either way.
        const giveUp = attempts >= MAX_ATTEMPTS;
        await col.updateOne(
          { _id: row._id },
          {
            $set: {
              drainAttempts: attempts,
              lastDrainStatus: r.status,
              lastDrainError: text.slice(0, 500),
              lastDrainAt: new Date(),
              ...(giveUp ? { gaveUpAt: new Date() } : {}),
            },
          },
        );
      } catch (e) {
        const giveUp = attempts >= MAX_ATTEMPTS;
        await col.updateOne(
          { _id: row._id },
          {
            $set: {
              drainAttempts: attempts,
              lastDrainStatus: 0,
              lastDrainError: String((e as Error).message).slice(0, 300),
              lastDrainAt: new Date(),
              ...(giveUp ? { gaveUpAt: new Date() } : {}),
            },
          },
        );
      }
    }
    if (sent) console.log(`[support-drain] re-sent ${sent}/${rows.length} parked ticket(s)`);
  }
}
