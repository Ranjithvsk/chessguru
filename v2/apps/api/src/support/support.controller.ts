// Owner ask 2026-08-25: "we have one token raise system right in super admin
// dreamcy, when qn mark is pressed, bug reporting, need same for chess guru,
// all users, all tenants".
//
// Instead of standing up a parallel ticket table, this controller PROXIES
// widget submissions to the central dreamcy pos-api endpoint
// (https://pos.dreamcy.com/pos/support/ticket) which writes to
// platform.support_ticket in dreamcy_db. That table is what the super-admin
// dashboard at /superadmin/tickets already reads — so ChessGuru tickets show
// up in the same inbox as till/pos/staff tickets, filterable by the `app`
// column (we stamp "chessguru-<academy-slug>" or "chessguru" for anonymous).
//
// Widget lives at apps/web/src/components/SupportWidget.tsx, mounted in
// App.tsx, submitting to /api/support/ticket (same-origin — no CORS pain).
// We enrich the payload with the ChessGuru session identity (userId, name,
// academy) BEFORE forwarding so super-admin sees who filed it.

import { Body, Controller, Get, HttpException, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const UPSTREAM = process.env.SUPPORT_UPSTREAM_URL || "https://pos.dreamcy.com/pos/support/ticket";
// 2026-08-27 (TKT-90 chat loop): the "your tickets" tab of the widget calls
// this GET endpoint. We proxy to pos-api's /pos/support/my-tickets using the
// shared INTERNAL_API_SECRET so the student's session stays authoritative.
const UPSTREAM_LIST = process.env.SUPPORT_UPSTREAM_LIST_URL || "https://pos.dreamcy.com/pos/support/my-tickets";
// The widget bundle and the file store both live with pos-api. ChessGuru serves
// them from its own origin so the browser never talks to Mumbai directly, and
// so the bundle stays ONE file: it used to be forked into
// apps/web/src/components/SupportWidget.tsx, which is how the POS widget moved
// to 50 attachments while ChessGuru silently stayed at 4.
const UPSTREAM_WIDGET = process.env.SUPPORT_UPSTREAM_WIDGET_URL || "https://pos.dreamcy.com/pos/support/widget.js";
const UPSTREAM_ATTACH = process.env.SUPPORT_UPSTREAM_ATTACH_URL || "https://pos.dreamcy.com/pos/support/attachment";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const INTERNAL_TOKEN = process.env.DREAMCY_INTERNAL_TOKEN || process.env.SUPPORT_INTERNAL_TOKEN || "";

// Say so at BOOT if the token is missing.
//
// Without it every support call 502s with "Support upstream returned 401" — and the
// API starts perfectly happily, so nothing announces the fault. It ran like that for
// days: ~40 failures a day across ~18 people (2026-09-14..17), which also buried real
// errors in the log. The token was eventually corrected in .env at 11:00 on 09-17 and
// the failures stopped at the next restart — but nobody was told either time.
//
// Note the trap: dotenv loads .env at STARTUP, so fixing .env does nothing until the
// API is restarted.
if (!INTERNAL_TOKEN) {
  // eslint-disable-next-line no-console
  console.warn(
    "[support] DREAMCY_INTERNAL_TOKEN is empty — every support request will fail with " +
    "'Support upstream returned 401'. Set it in apps/api/.env and RESTART the API " +
    "(dotenv only reads .env at startup).",
  );
}
const MAX_SHOTS = 4;
const MAX_MESSAGE = 5000;
const MAX_CONTACT = 200;

type IncomingBody = {
  kind?: string;
  message?: string;
  contact?: string;
  screenshots?: string[];
  pageUrl?: string;
  parentSeq?: number;
};

@Controller("support")
export class SupportController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Post("ticket")
  async ticket(@Body() body: IncomingBody, @Req() req: any) {
    const b = body || {};
    const kindRaw = String(b.kind || "").toUpperCase();
    const kind = ["CHAT", "BUG", "FEATURE", "COMPLAINT"].includes(kindRaw) ? kindRaw : "CHAT";
    const messageRaw = String(b.message || "").trim().slice(0, MAX_MESSAGE);
    if (!messageRaw) throw new HttpException("message required", HttpStatus.BAD_REQUEST);
    const contact = typeof b.contact === "string" ? b.contact.trim().slice(0, MAX_CONTACT) : "";
    // Sanitize + cap screenshots (data URIs); each ≤ 4MB to match pos-api's
    // ceiling. Silently drop anything malformed instead of 4xx — user can
    // always send a new ticket without images.
    const shots: string[] = Array.isArray(b.screenshots)
      ? b.screenshots
          .filter((s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length < 4_000_000)
          .slice(0, MAX_SHOTS)
      : [];
    const pageUrl = typeof b.pageUrl === "string" ? b.pageUrl.slice(0, 500) : "";

    // Session identity — anonymous submissions still land, tagged as
    // "chessguru" only. Signed-in users get their id + academy stamped into
    // the app tag and prepended to the message for super-admin readability.
    const userId: string | null = req?.session?.userId ?? null;
    const username: string | null = req?.session?.username ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    const role: string | null = req?.session?.role ?? null;

    // pos-api Body zod schema uses `pageUrl`, `screenshots`, `screenshot`,
    // `app`, `kind`, `message`, `contact`, `parentSeq`. Forward the shape
    // exactly so the upstream doesn't reject on unknown fields.
    // NOT truncated: upstream now caps `app` at 120. A 30-char slice left only
    // 20 chars for the slug, so two academies sharing their first 20 characters
    // collapsed to the same tag — and myTickets() looks tickets up BY this tag,
    // which would have shown each academy the other's support threads.
    // Must stay byte-identical to the tag built in myTickets().
    const app = academyId ? `chessguru-${academyId}` : "chessguru";
    // Prepend a small who/where block so super-admin sees the user without
    // clicking into pos systems (which won't know a ChessGuru userId).
    const who = userId
      ? `👤 ${username || userId} (${role || "user"}) · academy: ${academyId || "-"}`
      : "👤 anonymous";
    const enrichedMessage = `${who}\n\n${messageRaw}`.slice(0, MAX_MESSAGE);

    // Fall back to the signed-in user's email as the contact. Dreamcy only
    // emails ticket replies to platform.tenant_operator rows (keyed on
    // tenant_id) or to `contact` when it parses as an email — and ChessGuru
    // academies have no platform.tenant row at all, so a ticket with no
    // contact is permanently email-silent. Every ChessGuru reply sent before
    // 2026-09-05 reached the filer only inside the in-app widget thread.
    const sessionEmail = userId ? await this.emailFor(userId) : null;

    const upstreamPayload: any = {
      kind,
      message: enrichedMessage,
      contact: contact || sessionEmail || undefined,
      screenshots: shots.length ? shots : undefined,
      pageUrl: pageUrl || undefined,
      app,
      parentSeq: typeof b.parentSeq === "number" && b.parentSeq > 0 ? Math.floor(b.parentSeq) : undefined,
      // Stamp user identity on the ticket so the user's own "Your tickets"
      // tab can find it. pos-api uses these as fallback when no pos-api JWT
      // is present (our case — this proxy has no pos-api token). 2026-08-27.
      userId: userId || undefined,
      userName: username || undefined,
    };

    try {
      const r = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upstreamPayload),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await r.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
      if (!r.ok) {
        // Persist a local fallback so a temporary upstream outage doesn't
        // lose the ticket. Super-admin won't see these until we re-flush,
        // but at least owner can grep the collection to recover them.
        await this.saveFallback(userId, academyId, upstreamPayload, r.status, text.slice(0, 500));
        throw new HttpException(
          json?.message || `Support upstream returned ${r.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return { ok: true, ticketNo: json?.ticketNo ?? null, id: json?.id ?? null };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Network / timeout — save locally so nothing is lost.
      await this.saveFallback(userId, academyId, upstreamPayload, 0, String((e as Error).message).slice(0, 300));
      throw new HttpException("Support system is temporarily unreachable — try again in a minute.", HttpStatus.BAD_GATEWAY);
    }
  }

  /** List the signed-in user's tickets + reply threads. Powers the "Your
   *  tickets" tab of the widget. Anonymous callers get an empty list — a
   *  ticket has to have a user identity for us to link it back. TKT-90. */
  /** The shared widget bundle, proxied rather than copied. A fix deployed to
   *  pos-api reaches ChessGuru with no rebuild here — the same reasoning the
   *  admin panel already uses. */
  @Get("widget.js")
  async widget(@Req() req: any, @Res() res: any) {
    try {
      const r = await fetch(UPSTREAM_WIDGET, { headers: { "if-none-match": String(req?.headers?.["if-none-match"] || "") } });
      if (r.status === 304) return res.status(304).end();
      if (!r.ok) return res.status(502).type("application/javascript").send("/* support widget unavailable */");
      const js = await r.text();
      const etag = r.headers.get("etag");
      if (etag) res.setHeader("etag", etag);
      // Short cache, like admin's proxy: long enough to skip a fetch per
      // navigation, short enough that a widget fix lands within minutes.
      res.setHeader("cache-control", "public, max-age=300, must-revalidate");
      return res.type("application/javascript").send(js);
    } catch {
      return res.status(502).type("application/javascript").send("/* support widget unavailable */");
    }
  }

  /** One attachment, forwarded to pos-api's store. Raw body straight through —
   *  the bytes are never re-encoded, which is the point. */
  @Post("attachment")
  async attachment(@Req() req: any, @Res() res: any) {
    const buf: Buffer = req.body;
    if (!Buffer.isBuffer(buf) || buf.byteLength === 0) return res.status(400).json({ error: "ValidationError", message: "Empty upload." });
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: "TooLarge", message: `Each file must be under ${Math.round(MAX_ATTACHMENT_BYTES / 1048576)} MB.` });
    }
    const name = String(req?.query?.name || "file").slice(0, 200);
    try {
      const r = await fetch(`${UPSTREAM_ATTACH}?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "content-type": String(req?.headers?.["content-type"] || "application/octet-stream") },
        // This project's lib types give BodyInit/BlobPart a DOM-only shape that
        // admits neither Buffer nor Uint8Array. undici accepts a Buffer at
        // runtime, so the cast is the honest fix rather than a needless copy.
        body: buf as unknown as BodyInit,
      });
      const text = await r.text();
      return res.status(r.status).type("application/json").send(text);
    } catch {
      return res.status(502).json({ error: "Upstream", message: "Could not save that file." });
    }
  }

  @Get("my-tickets")
  async myTickets(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    const username: string | null = req?.session?.username ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!userId && !username) return { tickets: [] };

    // Determine which app tag(s) this user's tickets landed under. Match how
    // ticket() stamps `app` above:  chessguru-<academyId>  or  chessguru.
    // Untruncated, same as ticket() — if these two ever diverge, a user's own
    // tickets stop matching and the "Your tickets" tab silently goes empty.
    const app = academyId ? `chessguru-${academyId}` : "chessguru";
    const qs = new URLSearchParams();
    if (userId) qs.set("userId", userId);
    // userName is our fallback path for LEGACY tickets that predate the
    // userId-stamping change — pos-api parses "👤 <userName>" from the
    // message prefix.
    if (username) qs.set("userName", username);
    qs.set("app", app);

    try {
      const r = await fetch(`${UPSTREAM_LIST}?${qs.toString()}`, {
        method: "GET",
        headers: { "x-internal-token": INTERNAL_TOKEN },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new HttpException(`Support upstream returned ${r.status}`, HttpStatus.BAD_GATEWAY);
      const j = (await r.json().catch(() => null)) as { tickets?: any[] } | null;
      return { tickets: Array.isArray(j?.tickets) ? j!.tickets : [] };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException("Support system is temporarily unreachable — try again in a minute.", HttpStatus.BAD_GATEWAY);
    }
  }

  /** users._id is the username (a plain string, never an ObjectId). */
  private async emailFor(userId: string): Promise<string | null> {
    try {
      const u = await this.conn.db!
        .collection("users")
        .findOne({ _id: userId as any }, { projection: { email: 1 } });
      const e = typeof u?.email === "string" ? u.email.trim() : "";
      return e.includes("@") ? e.slice(0, MAX_CONTACT) : null;
    } catch {
      return null;
    }
  }

  private async saveFallback(
    userId: string | null,
    academyId: string | null,
    payload: any,
    upstreamStatus: number,
    upstreamError: string,
  ) {
    try {
      await this.conn.db!.collection("supportFallback").insertOne({
        userId,
        academyId,
        payload,
        upstreamStatus,
        upstreamError,
        createdAt: new Date(),
      });
    } catch { /* silent */ }
  }
}
