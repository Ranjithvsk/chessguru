// Auto-close abandoned live classes.
//
// Every minute, walks classLiveAnnouncements and for each row:
//   * if the coach is CURRENTLY in the ws room → bump `at` to now (heartbeat)
//   * else if `at` is older than 5 min → delete the announcement + kick the
//     ws room via closeClassRoom (safety net: nobody's still there because
//     nobody's been there for 5 min)
//
// Owner ask 2026-08-18: "when coach left the class, the class should be auto
// closed after 5 minutes" — so a coach who forgets to hit End can't leave a
// zombie "🔴 live now" banner haunting the academy dashboard.
//
// In-process (setInterval); same single-replica assumption as class-reminder.
// Ordering matters: heartbeat first, then the older-than-5-min sweep, so a
// coach who's live still gets their `at` bumped this tick and won't be culled.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { closeClassRoom, getLiveAttendees } from "./class-ws";

const TICK_MS = 60_000;
const ABANDONED_MS = 5 * 60_000;

@Injectable()
export class ClassAbandonedSweepService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    setTimeout(() => { this.tick().catch(() => {}); }, 20_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    const coll = this.conn.db!.collection("classLiveAnnouncements");
    const rows: any[] = await coll.find(
      {},
      { projection: { _id: 1, at: 1, coachUserId: 1 } },
    ).limit(200).toArray();
    if (!rows.length) return;
    const now = Date.now();
    for (const row of rows) {
      const id = String(row._id);
      const at = row.at ? new Date(row.at).getTime() : 0;
      const attendees = getLiveAttendees(id);
      const coachIn = row.coachUserId
        ? attendees.some((a) => a.userId && String(a.userId) === String(row.coachUserId))
        : attendees.length > 0;                              // legacy row without coachUserId — anyone present keeps it alive
      if (coachIn) {
        // Heartbeat — coach is here, keep the announcement fresh.
        if (now - at > 45_000) {
          await coll.updateOne({ _id: row._id }, { $set: { at: new Date() } }).catch(() => {});
        }
        continue;
      }
      if (now - at < ABANDONED_MS) continue;
      // Coach gone AND row is stale — close.
      await coll.deleteOne({ _id: row._id }).catch(() => {});
      try { closeClassRoom(id, "coach_abandoned"); } catch { /* */ }
      // eslint-disable-next-line no-console
      console.warn(`[class-abandoned-sweep] closed ${id} (stale ${(Math.round((now - at)/1000))}s, no coach)`);
    }
  }
}
