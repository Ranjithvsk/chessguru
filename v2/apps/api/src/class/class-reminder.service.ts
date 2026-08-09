// Phase 6d + 6e: class-reminder scheduler.
//
// Runs a small setInterval inside the Nest process. Every minute it fires TWO
// stages:
//   * 15-min stage — a "starts in N min" nudge, right before class
//   * 24h stage   — a "tomorrow at X" heads-up so coach + invitees can plan
//
// Each stage has its own stamp field on the schedule doc (reminderSentAt for
// 15-min, reminded24hAt for 24h) — sends are independent, and either flag is
// atomic-claimed before send so a double tick / restart mid-batch can't
// re-fire.
//
// Design notes:
//   * Single-process only (setInterval on the API pod). If we ever run more
//     than one API replica we should move this to a BullMQ job with a Redis
//     lock — until then the atomic findOneAndUpdate is enough.
//   * Wide tolerance windows so a server hiccup doesn't miss a fire. For
//     example, the 24h window is (now+22h, now+26h] — even if the scheduler
//     was down for an hour, next tick still catches every class in that band.
//   * Coach's email pulled from users via createdByUserId. Anonymous-coach
//     classes still get their invitees pinged.
//   * Failure to send an individual address is logged but doesn't roll back
//     the stamp — half a batch beats an infinite retry loop.

import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";

const TICK_MS = 60_000;                    // scan cadence
// Stages: { stamp field, near-boundary, far-boundary } — startAt must fall in
// (near, far] to be a candidate. Wider than the "true" firing point on the
// far side so a missed tick still gets caught by the next one.
type Stage = { key: "m15" | "h1" | "h24"; stampField: "reminderSentAt" | "reminded1hAt" | "reminded24hAt";
               nearMs: number; farMs: number; label: string };
const STAGES: Stage[] = [
  // 15-min stage: fire from just-starting (nearMs=0) up to 15 min ahead.
  { key: "m15", stampField: "reminderSentAt", nearMs: 0, farMs: 15 * 60_000, label: "starts soon" },
  // 1h stage: 40..80 min ahead (20 min grace either side of exactly-1h before).
  { key: "h1",  stampField: "reminded1hAt",   nearMs: 40 * 60_000, farMs: 80 * 60_000, label: "in an hour" },
  // 24h stage: 22h..26h window (2h grace either side of exactly-24h before).
  { key: "h24", stampField: "reminded24hAt",  nearMs: 22 * 3_600_000, farMs: 26 * 3_600_000, label: "tomorrow" },
];
// Default stage set when a schedule row has no reminderStages field (legacy /
// pre-6f rows). Matches the effective behaviour before this change so upgrading
// doesn't silently start firing 1h reminders on classes coaches didn't opt into.
const DEFAULT_STAGE_KEYS = new Set(["h24", "m15"]);

// Public origin used in email join links. Falls back to the DNS name we know
// this API is behind; overridable in prod via env.
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://harinitharanjith.com";

@Injectable()
export class ClassReminderService implements OnModuleInit {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  onModuleInit(): void {
    // Kick off shortly after boot so we don't race with Nest wiring, then tick
    // every minute. In-process only — see the header comment.
    setTimeout(() => { this.tick().catch(() => {}); }, 5_000);
    setInterval(() => { this.tick().catch(() => {}); }, TICK_MS);
  }

  async tick(): Promise<void> {
    for (const stage of STAGES) {
      await this.runStage(stage).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn(`[class-reminder] stage ${stage.key} failed:`, e);
      });
    }
  }

  private async runStage(stage: Stage): Promise<void> {
    const now = new Date();
    const nearAt = new Date(now.getTime() + stage.nearMs);
    const farAt  = new Date(now.getTime() + stage.farMs);
    const schedules = this.conn.db!.collection("classSchedules");
    const stamp = stage.stampField;
    const candidates = await schedules.find({
      startAt: { $gt: nearAt, $lte: farAt },
      $or: [{ [stamp]: null }, { [stamp]: { $exists: false } }],
    }).limit(50).toArray();
    if (candidates.length === 0) return;
    for (const row of candidates) {
      // Skip when this stage is opted-out for this class. Missing field falls
      // back to the pre-6f default set so legacy rows behave unchanged.
      const stages: string[] = Array.isArray(row.reminderStages)
        ? row.reminderStages
        : Array.from(DEFAULT_STAGE_KEYS);
      if (!stages.includes(stage.key)) continue;
      // Atomic claim so a peer tick can't re-fire this stage for this class.
      const claimed: any = await schedules.findOneAndUpdate(
        { _id: row._id, $or: [{ [stamp]: null }, { [stamp]: { $exists: false } }] },
        { $set: { [stamp]: now } },
        { returnDocument: "before" } as any,
      );
      const target = claimed?.value ?? claimed;
      if (!target || !target._id) continue;
      await this.sendFor(target, stage).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn(`[class-reminder] ${stage.key} send failed for`, row._id, e);
      });
    }
  }

  private async sendFor(row: any, stage: Stage): Promise<void> {
    // Coach + invitees, deduped, lowercased.
    const recipients = new Set<string>();
    if (Array.isArray(row.invitees)) {
      for (const inv of row.invitees) {
        if (inv?.email && typeof inv.email === "string") recipients.add(inv.email.toLowerCase());
      }
    }
    if (row.createdByUserId) {
      const user: any = await this.conn.db!.collection("users").findOne({ _id: row.createdByUserId as any });
      if (user?.email && typeof user.email === "string") recipients.add(String(user.email).toLowerCase());
    }
    if (recipients.size === 0) return;

    const joinUrl = `${PUBLIC_ORIGIN}/class/${encodeURIComponent(row._id)}`;
    const start = new Date(row.startAt);
    const when = start.toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short",
      hour: "numeric", minute: "2-digit",
    });
    const msAway = Math.max(0, start.getTime() - Date.now());
    // Human "in X" tag — differs by stage so the email reads correctly.
    // 15-min stage: "in 12 min" / "starting now" (if <1 min)
    // 24h stage:    "tomorrow at 6:30 PM" style
    // Copy differs per stage — "in 12 min" for m15, "in about an hour" for h1,
    // "tomorrow · 6:30 PM" for h24. Each also gets its own subject prefix so
    // an inbox that already has one reminder for the class doesn't collapse the
    // second one under the same subject line.
    const time = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    let inTag: string;
    let subject: string;
    let kicker: string;
    if (stage.key === "m15") {
      inTag = msAway < 60_000 ? "starting now" : `in ${Math.round(msAway / 60_000)} min`;
      subject = `⏰ ${row.title} — ${inTag}`;
      kicker = "Class reminder";
    } else if (stage.key === "h1") {
      inTag = `in about an hour · ${time}`;
      subject = `⌛ ${row.title} — in about an hour`;
      kicker = "Class in an hour";
    } else {
      inTag = msAway < 36 * 3_600_000
        ? `tomorrow · ${time}`
        : `on ${when}`;
      subject = `📅 Tomorrow: ${row.title} at ${time}`;
      kicker = "Class tomorrow";
    }
    const text = [
      `${row.title}`,
      ``,
      `${inTag} (${when})`,
      `Coach:  ${row.coach}`,
      `Duration: ${row.durationMin} min`,
      row.notes ? `Notes: ${row.notes}` : "",
      ``,
      `Join the class:`,
      joinUrl,
      ``,
      `— ChessGuru`,
    ].filter(Boolean).join("\n");
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:520px">
        <div style="background:linear-gradient(135deg,#6d28d9,#4338ca);color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.75">${escapeHtml(kicker)}</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px">${escapeHtml(row.title)}</div>
          <div style="font-size:13px;margin-top:6px;opacity:.85">${escapeHtml(when)} · ${escapeHtml(inTag)}</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:20px 24px;border-radius:0 0 12px 12px">
          <div style="font-size:14px;color:#374151">
            👑 Coach: <b>${escapeHtml(row.coach)}</b> · ${row.durationMin} min
          </div>
          ${row.notes ? `<p style="font-size:13px;color:#4b5563;margin:12px 0">${escapeHtml(row.notes)}</p>` : ""}
          <p style="margin:20px 0">
            <a href="${escapeAttr(joinUrl)}"
               style="display:inline-block;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;
                      padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
              ▶ Join the class
            </a>
          </p>
          <p style="font-size:11px;color:#9ca3af;margin-top:20px">
            Direct link: <a href="${escapeAttr(joinUrl)}" style="color:#6b7280">${escapeHtml(joinUrl)}</a>
          </p>
        </div>
      </div>
    `;
    // Fire in parallel. Individual send failures logged in sendMail; we don't
    // unwind the stamp so a Resend outage doesn't cause a resend storm.
    await Promise.all([...recipients].map((to) => sendMail({ to, subject, html, text })));
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
