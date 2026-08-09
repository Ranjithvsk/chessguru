// Phase 7l: shared write helper for the transactional-email log.
//
// digest + streak reminders both log every send attempt to `mailLog` so an
// admin can see delivery health at a glance. Deliberately NOT the same
// collection as classMailLog (which the class-reminder feature owns and
// updates via the Resend webhook) — keeping these separate avoids schema
// tangling and lets each channel evolve its own shape.
//
// The log is append-only. If we later add a Resend webhook for these
// channels, updates by resendId will layer on top of the initial insert.

import type { Connection } from "mongoose";

export interface MailLogEntry {
  userId: string;
  channel: "digest" | "streak";
  email: string;
  subject: string;
  status: "sent" | "failed";
  messageId?: string | null;   // upstream ID (dw-otp returns the delivering MX hostname)
  error?: string | null;
}

export async function logMail(conn: Connection, entry: MailLogEntry): Promise<void> {
  try {
    await conn.db!.collection("mailLog").insertOne({
      ...entry,
      sentAt: new Date(),
    } as any);
  } catch {
    // Never let logging errors break the send loop — the caller's already
    // stamped its dedup marker.
  }
}
