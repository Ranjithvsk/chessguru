// Watches the one dependency that can fail silently and take everything
// user-facing with it: outbound mail.
//
// Context (2026-09-04): the France->Mumbai SSH tunnel that fronts dw-otp died
// on 30 Aug and nobody noticed for five days. Password resets, OTP sign-in,
// digests and every reminder were dead the whole time. `sendMail` fails open —
// it logs, returns { ok: false }, and no caller looks at the return value — so
// there was nothing to see anywhere.
//
// Two independent signals, because they catch different failures:
//   1. an active probe of dw-otp's /health — catches the transport being down
//      (tunnel dead, service down, wrong port) even when nothing is sending
//   2. the sendMail observer — catches sends that are accepted by the transport
//      but rejected downstream (DKIM, MX refusal, a relay 403), which a
//      /health probe reports as perfectly healthy
//
// The awkward part is the alert channel: when mail is down we cannot email
// about it. So the state is written to `errorEvents` (kind "mail") and to a
// `mailHealth` doc that the admin UI reads, and the *recovery* is emailed —
// the owner gets a postmortem with the outage duration the moment mail works
// again, which is the only moment that mail can tell them anything.
import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { sendMail, setMailObserver } from "../lib/mail";
import { ErrorAlertsService } from "./error-alerts.service";

const PROBE_MS = 2 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8_000;
/** Two consecutive misses before declaring an outage. The tunnel unit restarts
 *  on a 10s timer, so a single miss is routinely just a reconnect in progress. */
const FAILURES_TO_TRIP = 2;
// Real sends fail for reasons a /health probe cannot see (2026-09-07: dw-otp was up but
// had lost the DKIM key entry for our domain, so every send got a 502 while /health
// said ok). Send failures therefore keep their own counter, and once they trip the
// state only a real successful send may clear it — a healthy probe in between must
// not "recover" a path that still rejects every message.
const SEND_FAILURES_TO_TRIP = 2;
// dw-otp can always sign for its own domain, so a DOWN alert sent from it still lands
// when the failure is "cannot sign for harinitharanjith.com". Sent with observe:false
// so the monitor does not mistake its own alert for the customer path recovering.
const FALLBACK_FROM = process.env.MAIL_FALLBACK_FROM || "ChessGuru alerts <noreply@otp.dreamworldplants.com>";
const STATE_ID = "dwotp";

export interface MailHealth {
  ok: boolean;
  /** When the current state (up or down) began. */
  since: Date;
  lastOkAt: Date | null;
  lastError: string | null;
  checkedAt: Date;
}

@Injectable()
export class MailHealthService implements OnModuleInit {
  private ok = true;
  private since = new Date();
  private lastOkAt: Date | null = null;
  private lastError: string | null = null;
  private checkedAt = new Date();
  private consecutiveFailures = 0;
  private sendFailures = 0;
  private downBy: "probe" | "send" | null = null;

  constructor(
    @InjectConnection() private readonly conn: Connection,
    private readonly alerts: ErrorAlertsService,
  ) {}

  async onModuleInit() {
    // Resume the previous state so a pm2 restart during an outage doesn't reset
    // the clock and re-alert, and doesn't report a fresh recovery that never
    // happened. Without this, a nightly restart would hide a permanent outage.
    try {
      const prev = await this.conn.db!.collection("mailHealth").findOne({ _id: STATE_ID as any });
      if (prev) {
        this.ok = prev.ok !== false;
        this.since = prev.since ?? new Date();
        this.lastOkAt = prev.lastOkAt ?? null;
        this.lastError = prev.lastError ?? null;
      }
    } catch { /* a monitoring read must never block boot */ }

    setMailObserver((ok, error) => {
      // A real send is stronger evidence than any probe, in both directions.
      if (ok) {
        this.sendFailures = 0;
        this.downBy = null;
        void this.transition(true, null).catch(() => {});
      } else {
        void this.markDown(error || "send failed", "send").catch(() => {});
      }
    });

    setInterval(() => { this.probe().catch(() => {}); }, PROBE_MS);
    setTimeout(() => { this.probe().catch(() => {}); }, 15_000);
  }

  current(): MailHealth {
    return { ok: this.ok, since: this.since, lastOkAt: this.lastOkAt, lastError: this.lastError, checkedAt: this.checkedAt };
  }

  private async probe() {
    const url = process.env.DWOTP_URL || "http://127.0.0.1:4025";
    this.checkedAt = new Date();
    let error: string | null = null;
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (!r.ok) error = `dw-otp /health returned HTTP ${r.status}`;
      else {
        const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (!j?.ok) error = "dw-otp /health did not report ok";
      }
    } catch (e) {
      error = String((e as any)?.message || e);
    }
    if (error) await this.markDown(error, "probe");
    // A reachable service proves nothing about signing/delivery: while sends are the
    // thing failing, only a send may recover the state.
    else if (this.downBy !== "send") await this.transition(true, null);
  }

  /** Only trips after FAILURES_TO_TRIP consecutive misses, so a reconnect blip
   *  doesn't page. Once already down, every further failure is a no-op. */
  private async markDown(error: string, source: "probe" | "send") {
    this.lastError = error;
    if (!this.ok) return;
    if (source === "send") {
      if (++this.sendFailures < SEND_FAILURES_TO_TRIP) return;
    } else if (++this.consecutiveFailures < FAILURES_TO_TRIP) return;
    this.downBy = source;
    await this.transition(false, error);
  }

  private async transition(ok: boolean, error: string | null) {
    if (ok) {
      this.consecutiveFailures = 0;
      this.lastOkAt = new Date();
      this.lastError = null;
    }
    if (ok === this.ok) { await this.persist(); return; }

    const downSince = this.since;
    // Set state BEFORE alerting. Reporting a mail outage tries to send mail,
    // which fails, which calls the observer, which lands back here — flipping
    // the flag first makes that re-entry a no-op instead of a loop.
    this.ok = ok;
    this.since = new Date();
    this.consecutiveFailures = 0;
    await this.persist();

    if (!ok) {
      this.alerts.report({
        kind: "mail",
        message: `Outbound email is down — ${error || "dw-otp unreachable"}`,
        route: process.env.DWOTP_URL || "http://127.0.0.1:4025",
        notify: false, // that mail would use the broken identity; the fallback alert below is the notification
      });
      console.error(`[mail-health] DOWN: ${error}`);
      await this.alertViaFallback(error || "dw-otp unreachable");
      return;
    }

    const downMs = Date.now() - downSince.getTime();
    console.log(`[mail-health] RECOVERED after ${fmtDuration(downMs)}`);
    this.alerts.report({
      kind: "mail",
      message: `Outbound email recovered after ${fmtDuration(downMs)} down`,
      notify: false, // the postmortem below is the notification
    });
    await this.mailPostmortem(downSince, downMs);
  }

  /** Try to say "mail is down" from dw-otp's own domain. Lands whenever the service
   *  is reachable but cannot sign or deliver for ours; silently pointless when the
   *  transport itself is gone (the errorEvents row + admin UI remain the record). */
  private async alertViaFallback(error: string) {
    const to = process.env.ERROR_ALERT_TO || "ranjith.vsk@gmail.com";
    const from = process.env.MAIL_FROM || "(MAIL_FROM unset)";
    const signing = /DKIM selector/i.test(error);
    try {
      const r = await sendMail({
        to,
        from: FALLBACK_FROM,
        observe: false,
        subject: `[ChessGuru] Outbound email is DOWN — ${error.slice(0, 80)}`,
        html:
          `<h2 style="margin:0 0 12px">ChessGuru cannot send email</h2>` +
          `<p style="font:14px/1.5 system-ui">Every message sent as <b>${from}</b> is failing:</p>` +
          `<pre style="font:12px/1.4 ui-monospace;background:#f6f6f6;padding:12px;overflow:auto">${error}</pre>` +
          (signing
            ? `<p style="font:14px/1.5 system-ui">The mail service is reachable — it has lost the DKIM key entry for our domain. ` +
              `On Mumbai, <code>apps/otp-service/mailer.js</code> → <code>DKIM_BY_DOMAIN</code> must list <code>harinitharanjith.com</code>; ` +
              `run <code>git diff HEAD -- mailer.js</code> there and <code>pm2 restart dw-otp</code>. This exact thing happened on 2026-09-07.</p>`
            : `<p style="font:14px/1.5 system-ui">Password resets, OTP sign-in, digests and reminders are all failing silently until this is fixed.</p>`) +
          `<p style="font:13px system-ui;color:#666">This alert was sent from ${FALLBACK_FROM} because the normal identity cannot send. ` +
          `Details: https://chessguru.cc/admin/errors</p>`,
        text: `ChessGuru cannot send email as ${from}: ${error}
` +
          (signing ? `dw-otp is up but has no DKIM entry for our domain — check DKIM_BY_DOMAIN in apps/otp-service/mailer.js on Mumbai and pm2 restart dw-otp.
` : `Resets, OTP sign-in, digests and reminders are failing silently.
`) +
          `https://chessguru.cc/admin/errors`,
      });
      console.error(`[mail-health] fallback alert ${r.ok ? "delivered" : `failed: ${r.error}`}`);
    } catch (e) {
      console.error(`[mail-health] fallback alert threw:`, e);
    }
  }

  /** The only message that can be delivered about a mail outage, because it is
   *  sent at the exact moment mail starts working again. */
  private async mailPostmortem(downSince: Date, downMs: number) {
    const to = process.env.ERROR_ALERT_TO || "ranjith.vsk@gmail.com";
    const dur = fmtDuration(downMs);
    await sendMail({
      to,
      subject: `[ChessGuru] Email is working again — it was down for ${dur}`,
      html:
        `<h2 style="margin:0 0 12px">Outbound email recovered</h2>` +
        `<p style="font:14px/1.5 system-ui">ChessGuru could not send any email for <b>${dur}</b>, ` +
        `from ${downSince.toISOString()} until ${new Date().toISOString()}.</p>` +
        `<p style="font:14px/1.5 system-ui">Anything that mails was silently failing for that whole window: ` +
        `password resets, OTP sign-in, weekly digests, streak reminders, class and fee reminders. ` +
        `Users who tried to reset a password during it got nothing and will need to try again.</p>` +
        `<p style="font:13px system-ui;color:#666">Details: https://chessguru.cc/admin/errors</p>`,
      text: `Outbound email was down for ${dur} (${downSince.toISOString()} → ${new Date().toISOString()}).\nPassword resets, OTP sign-in, digests and reminders all failed silently in that window.\nhttps://chessguru.cc/admin/errors`,
    });
  }

  private async persist() {
    try {
      await this.conn.db!.collection("mailHealth").updateOne(
        { _id: STATE_ID as any },
        { $set: { ok: this.ok, since: this.since, lastOkAt: this.lastOkAt, lastError: this.lastError, checkedAt: this.checkedAt } },
        { upsert: true },
      );
    } catch { /* monitoring must not throw into a send path */ }
  }
}

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
