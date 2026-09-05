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

import { Body, Controller, Get, HttpException, HttpStatus, Post, Req } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const UPSTREAM = process.env.SUPPORT_UPSTREAM_URL || "https://pos.dreamcy.com/pos/support/ticket";
// 2026-08-27 (TKT-90 chat loop): the "your tickets" tab of the widget calls
// this GET endpoint. We proxy to pos-api's /pos/support/my-tickets using the
// shared INTERNAL_API_SECRET so the student's session stays authoritative.
const UPSTREAM_LIST = process.env.SUPPORT_UPSTREAM_LIST_URL || "https://pos.dreamcy.com/pos/support/my-tickets";
const INTERNAL_TOKEN = process.env.DREAMCY_INTERNAL_TOKEN || process.env.SUPPORT_INTERNAL_TOKEN || "";
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
    // Upstream caps `app` at 30 chars and 502s past it — slicing only the
    // academyId let the "chessguru-" prefix push the total over, so any academy
    // with a slug longer than 20 chars had every ticket rejected and silently
    // parked in the local fallback collection. Slice the whole tag instead.
    // (2026-09-05: test-academy-only-email came to 33; shriguruchessacademy
    // sits at exactly 30.) The academy id is still spelled out in `who` below,
    // so truncating here never loses the filer's identity.
    // Must stay byte-identical to the tag built in myTickets().
    const app = academyId ? `chessguru-${academyId}`.slice(0, 30) : "chessguru";
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
  @Get("my-tickets")
  async myTickets(@Req() req: any) {
    const userId: string | null = req?.session?.userId ?? null;
    const username: string | null = req?.session?.username ?? null;
    const academyId: string | null = req?.session?.academyId ?? null;
    if (!userId && !username) return { tickets: [] };

    // Determine which app tag(s) this user's tickets landed under. Match how
    // ticket() stamps `app` above:  chessguru-<academyId>  or  chessguru.
    // Same 30-char slice as ticket() — if these two ever diverge, a user's own
    // tickets stop matching and the "Your tickets" tab silently goes empty.
    const app = academyId ? `chessguru-${academyId}`.slice(0, 30) : "chessguru";
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
