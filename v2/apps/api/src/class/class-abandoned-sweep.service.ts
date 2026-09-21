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
// Someone is "still here" if class-ws touched their attendance row recently.
// Deliberately generous against the ~30s heartbeat, so a brief mobile blip can
// never be mistaken for an abandoned class.
const LIVE_SEEN_MS = 2 * 60_000;

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
      // Liveness has to come from a source that is TRUE ACROSS PROCESSES.
      //
      // getLiveAttendees() reads THIS process's in-memory `rooms` map. That worked
      // only while classes happened to run in this same process. Once class traffic
      // was routed to the dedicated class-ws process (2026-09-21), the API process
      // held no room for a live class, so this returned [] and the sweeper ended a
      // perfectly healthy lesson five minutes in — students saw "Class ended"
      // mid-class while the coach was still teaching.
      //
      // classAttendance.lastSeenAt is written by whichever process actually owns the
      // socket, so it is true wherever the class runs. In-memory stays as a fast path.
      const attendees = getLiveAttendees(id);
      let coachIn = row.coachUserId
        ? attendees.some((a) => a.userId && String(a.userId) === String(row.coachUserId))
        : attendees.length > 0;                              // legacy row without coachUserId — anyone present keeps it alive
      if (!coachIn) {
        const q: Record<string, unknown> = { classId: id, lastSeenAt: { $gte: new Date(Date.now() - LIVE_SEEN_MS) } };
        if (row.coachUserId) q.userId = String(row.coachUserId);
        coachIn = (await this.conn.db!.collection("classAttendance").countDocuments(q).catch(() => 0)) > 0;
      }
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
      // Mark the CLASS finished, not just the room. This sweep tore down the live room
      // and the banner but never wrote endedAt, so an abandoned class stayed "never
      // ended" forever: it read that way on the Dream Meet page, and a student who
      // refreshed walked straight back into the dead room and sat looking at a stale
      // position while the coach taught somewhere else. Pressing End was the only thing
      // that ever set it, and on a phone the End button was off the edge of the screen.
      // (owner, 2026-09-19: "class was abandoned by coach ... but student is in old class")
      await this.conn.db!.collection("classSchedules")
        .updateOne({ _id: id as any, endedAt: { $exists: false } },
                   { $set: { endedAt: new Date(), endedBy: "abandoned-sweep" } })
        .catch(() => {});
      try { closeClassRoom(id, "coach_abandoned"); } catch { /* */ }
      // eslint-disable-next-line no-console
      console.warn(`[class-abandoned-sweep] closed ${id} (stale ${(Math.round((now - at)/1000))}s, no coach)`);
    }
  }
}
