// Standalone error sink — write to `errorEvents` + a throttled email — usable
// WITHOUT Nest DI. The :4000 API wraps this in ErrorAlertsService; the separate
// :4100 class-ws process (class-ws-main.ts) constructs it directly, so realtime
// board-sync + video-signal failures finally get recorded and mailed instead of
// being swallowed. Behaviour (coalescing, 1-mail-per-fault-per-hour, 20/hr cap,
// 30-day TTL) is unchanged from the original ErrorAlertsService.
import { Connection } from "mongoose";
import { sendMail } from "../lib/mail";

export type ErrorKind = "server" | "client" | "slow" | "mail" | "realtime";

export interface ErrorReport {
  kind: ErrorKind;
  message: string;
  stack?: string;
  route?: string;
  method?: string;
  status?: number;
  ms?: number;
  userId?: string;
  academyId?: string;
  url?: string;
  userAgent?: string;
  ip?: string;
  /** false = record to `errorEvents` only, don't email. */
  notify?: boolean;
}

const RETAIN_DAYS = 30;
const COOLDOWN_MS = 60 * 60 * 1000;
const COALESCE_MS = 10 * 60_000;
const MAX_MAILS_PER_HOUR = 20;
const MAX_STACK = 4000;
const MAX_MESSAGE = 500;

const trunc = (s: unknown, n: number) => (s == null ? undefined : String(s).slice(0, n));

const normalize = (msg: string) =>
  msg
    .replace(/0x[0-9a-f]+/gi, "#")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .slice(0, 200);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A route/url that belongs to a live class / Dream Meet, so the mail subject can
// be tagged for easy filtering ("show me everything Dream Meet").
const DREAM_MEET_RX = /(\/send-position|\/api\/class\/|\/class-v2\/|\/call\/|class-ws|video-signal)/i;

export class ErrorReporter {
  private readonly lastMailed = new Map<string, number>();
  private mailedThisHour = 0;
  private hourStartedAt = Date.now();

  constructor(private readonly conn: Connection) {}

  /** Create the collection indexes. Safe to call on boot; never throws. */
  async ensureIndexes(): Promise<void> {
    try {
      const col = this.conn.db!.collection("errorEvents");
      await col.createIndex({ at: -1 });
      await col.createIndex({ kind: 1, at: -1 });
      await col.createIndex({ at: 1 }, { expireAfterSeconds: RETAIN_DAYS * 86_400 });
    } catch {
      /* index setup must never block boot */
    }
  }

  /** Fire-and-forget: callers are error paths and must not be able to throw. */
  report(ev: ErrorReport): void {
    void this.handle(ev).catch(() => { /* an alerting failure must stay silent */ });
  }

  private async handle(ev: ErrorReport) {
    const message = trunc(ev.message, MAX_MESSAGE) || "(no message)";
    const doc = {
      at: new Date(),
      kind: ev.kind,
      message,
      stack: trunc(ev.stack, MAX_STACK),
      route: trunc(ev.route, 300),
      method: trunc(ev.method, 10),
      status: ev.status,
      ms: ev.ms,
      userId: trunc(ev.userId, 100),
      academyId: trunc(ev.academyId, 100),
      url: trunc(ev.url, 500),
      userAgent: trunc(ev.userAgent, 300),
      ip: trunc(ev.ip, 60),
      sig: `${ev.kind}|${ev.route || ev.url || "-"}|${normalize(message)}`,
    };
    const col = this.conn.db!.collection("errorEvents");
    const since = new Date(Date.now() - COALESCE_MS);
    const bumped = await col.updateOne(
      { sig: doc.sig, at: { $gte: since } },
      { $inc: { n: 1 }, $set: { lastAt: doc.at } },
    ).catch(() => ({ matchedCount: 0 }));
    if (!bumped.matchedCount) await col.insertOne({ ...doc, n: 1 } as any).catch(() => {});
    if (ev.notify !== false && this.shouldMail(doc.sig)) await this.mail(doc);
  }

  private shouldMail(sig: string): boolean {
    const now = Date.now();
    if (now - this.hourStartedAt > COOLDOWN_MS) {
      this.hourStartedAt = now;
      this.mailedThisHour = 0;
    }
    if (this.mailedThisHour >= MAX_MAILS_PER_HOUR) return false;
    const last = this.lastMailed.get(sig);
    if (last && now - last < COOLDOWN_MS) return false;
    this.lastMailed.set(sig, now);
    this.mailedThisHour++;
    if (this.lastMailed.size > 500) {
      for (const [k, t] of this.lastMailed) if (now - t > COOLDOWN_MS) this.lastMailed.delete(k);
    }
    return true;
  }

  private async mail(d: any) {
    const to = process.env.ERROR_ALERT_TO || "ranjith.vsk@gmail.com";
    const where = d.route || d.url || "unknown";
    const isDreamMeet = d.kind === "realtime" || DREAM_MEET_RX.test(where);
    const base =
      d.kind === "realtime" ? "Live-class realtime error"
      : d.kind === "client" ? "Browser crash"
      : d.kind === "slow" ? "Slow request"
      : d.kind === "mail" ? "Mail health"
      : `Server ${d.status || 500}`;
    // Tag anything Dream-Meet-related so the owner can filter their inbox to it.
    const label = isDreamMeet ? `Dream Meet · ${base}` : base;
    const rows: [string, unknown][] = [
      ["When", d.at.toISOString()],
      ["Kind", d.kind],
      ["Route", `${d.method || ""} ${where}`.trim()],
      ["Status", d.status],
      ["Duration", d.ms != null ? `${d.ms} ms` : undefined],
      ["User", d.userId || "(signed out)"],
      ["Academy", d.academyId],
      ["Page", d.url],
      ["Browser", d.userAgent],
    ];
    const html =
      `<h2 style="margin:0 0 12px">${escapeHtml(label)}</h2>` +
      `<p style="font:14px/1.5 system-ui;margin:0 0 16px"><b>${escapeHtml(d.message)}</b></p>` +
      `<table style="font:13px/1.5 system-ui;border-collapse:collapse">` +
      rows
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${k}</td><td>${escapeHtml(String(v))}</td></tr>`)
        .join("") +
      `</table>` +
      (d.stack ? `<pre style="font:12px/1.4 ui-monospace;background:#f6f6f6;padding:12px;overflow:auto">${escapeHtml(d.stack)}</pre>` : "") +
      `<p style="font:13px system-ui;color:#666">Full history: https://chessguru.cc/admin/errors</p>` +
      `<p style="font:12px system-ui;color:#999">Repeats of this same fault are suppressed for 1 hour.</p>`;
    await sendMail({
      to,
      subject: `[ChessGuru] ${label} — ${where}`,
      html,
      text: `${label}: ${d.message}\n${d.method || ""} ${where}\nuser=${d.userId || "-"}\nacademy=${d.academyId || "-"}\n\n${d.stack || ""}`,
    });
  }
}
