// ChessGuru Connect — shared-number multi-tenant WhatsApp for academies.
//
// Architecture (see chat 2026-08-22 for the deep plan):
//   - ONE WABA + ONE phone_number_id serves ALL academies.
//   - Outbound: academy admin sends → we tag every wamid with academy_id.
//   - Inbound: Meta webhook → 4-layer router → route to correct academy's inbox:
//       1. Interactive button payload (`context.button.payload` with "academy:<id>")
//       2. `context.id` → lookup which academy sent that outbound
//       3. Sender's contact record → single academy → route
//       4. Ambiguous / unmapped → owner queue
//
// Env (apps/api/.env):
//   WHATSAPP_TOKEN                     (shared with DWP — reused)
//   WHATSAPP_PHONE_NUMBER_ID           (shared)
//   WA_TPL_OUTREACH                    (default template if academy hasn't picked one)
//   CONNECT_WEBHOOK_VERIFY_TOKEN       (owner pastes into Meta Business Manager)

import { Controller, Get, Post, Query, Param, Req, Res, Body, HttpCode } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

const WA_VER   = process.env.WHATSAPP_API_VERSION || "v21.0";
const WA_TOKEN = () => process.env.WHATSAPP_TOKEN || "";
const WA_PHONE = () => process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WA_LANG  = () => process.env.WHATSAPP_LANG || "en_US";

// Normalise Indian mobile → E.164-digits (no + sign, per Meta wire format).
function toE164Digits(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d;
}

@Controller("connect")
export class ConnectController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /* ═════════════════════════════════════════════════════════════════════
   * WEBHOOK — Meta calls these. Public (no session). Verify signature in prod v2.
   * ═════════════════════════════════════════════════════════════════════ */

  /** GET /api/connect/webhook — Meta's initial verification challenge.
   *  Meta calls with ?hub.mode=subscribe&hub.verify_token=<X>&hub.challenge=<Y>
   *  If our token matches, echo the challenge back plaintext to prove ownership. */
  @Get("webhook")
  async verifyWebhook(@Query() q: any, @Res() res: any) {
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"];
    const challenge = q["hub.challenge"];
    if (mode === "subscribe" && token && token === process.env.CONNECT_WEBHOOK_VERIFY_TOKEN) {
      // Meta requires the exact plain-text challenge, no JSON wrapper.
      return res.status(200).type("text/plain").send(challenge);
    }
    return res.status(403).send("forbidden");
  }

  /** POST /api/connect/webhook — inbound messages + status callbacks.
   *  Meta wraps everything in entry[0].changes[0].value. We handle:
   *   - value.messages[]  → new inbound message → route via 4-layer logic
   *   - value.statuses[]  → delivery/read status → update outbound record */
  @Post("webhook")
  @HttpCode(200)
  async receiveWebhook(@Body() body: any) {
    try {
      const changes = body?.entry?.flatMap((e: any) => e?.changes || []) || [];
      for (const c of changes) {
        const v = c?.value || {};
        if (Array.isArray(v.statuses)) {
          for (const s of v.statuses) await this.handleStatus(s).catch(() => null);
        }
        if (Array.isArray(v.messages)) {
          for (const m of v.messages) await this.handleInbound(m, v).catch((e) => console.warn("[connect] inbound handler failed", e));
        }
      }
    } catch (e) { console.warn("[connect webhook]", e); }
    // Meta needs 200 within 5s or it retries — always ack success even on internal errors.
    return { ok: true };
  }

  private async handleStatus(s: any) {
    const db = this.conn.db!;
    const patch: any = { status: s.status };
    if (s.status === "delivered") patch.delivered_at = new Date();
    if (s.status === "read")      patch.read_at = new Date();
    if (s.status === "failed")    patch.failed_reason = s.errors?.[0]?.title || "failed";
    await db.collection("connect_outbound").updateOne({ wamid: s.id }, { $set: patch });
  }

  private async handleInbound(m: any, v: any) {
    const db = this.conn.db!;
    const from = String(m.from || "");           // digits, no +
    const wamid = String(m.id || "");
    const body =
      m.text?.body ||
      m.button?.text ||
      m.interactive?.button_reply?.title ||
      m.interactive?.list_reply?.title ||
      `[${m.type || "message"}]`;
    const contextWamid = m.context?.id || null;
    const buttonPayload = m.interactive?.button_reply?.id || m.button?.payload || null;

    // ───── 4-LAYER ROUTER ─────
    let academyId: string | null = null;
    let routedVia = "none";

    // L1: Interactive button payload "academy:<id>"
    if (buttonPayload && buttonPayload.startsWith("academy:")) {
      academyId = buttonPayload.slice(8);
      routedVia = "button";
    }
    // L2: context.id → last outbound we sent them
    if (!academyId && contextWamid) {
      const out = await db.collection("connect_outbound").findOne({ wamid: contextWamid });
      if (out?.academy_id) { academyId = out.academy_id; routedVia = "context"; }
    }
    // L3: sender's contact record → single-academy match
    if (!academyId) {
      const contact = await db.collection("connect_contacts").findOne({ phone: from });
      const ids = contact?.academy_ids || [];
      if (ids.length === 1) { academyId = ids[0]; routedVia = "contact-solo"; }
      else if (ids.length > 1) {
        // Ambiguous — pick the academy whose LAST outbound to this phone is most recent
        const recent = await db.collection("connect_outbound").findOne(
          { to_phone: from, academy_id: { $in: ids } },
          { sort: { sent_at: -1 } });
        if (recent?.academy_id) { academyId = recent.academy_id; routedVia = "contact-recent"; }
        else                    { academyId = ids[0]; routedVia = "contact-first"; }
      }
    }
    // L4: unrouted → owner queue (academy_id = null)

    await db.collection("connect_inbound").insertOne({
      wamid, from_phone: from,
      to_phone_id: v.metadata?.phone_number_id || WA_PHONE(),
      academy_id: academyId,           // null = unassigned queue
      body, context_wamid: contextWamid, button_payload: buttonPayload,
      raw_type: m.type || "text",
      received_at: new Date(m.timestamp ? +m.timestamp * 1000 : Date.now()),
      routed_via: routedVia,
      unread: true,
    });

    // Auto-add the sender to contacts (linked to the academy that received them).
    // Only if academyId is known — prevents polluting contacts with ambiguous cases.
    if (academyId) {
      await db.collection("connect_contacts").updateOne(
        { phone: from },
        { $setOnInsert: { phone: from, created_at: new Date() },
          $addToSet: { academy_ids: academyId } },
        { upsert: true });
    }
  }

  /* ═════════════════════════════════════════════════════════════════════
   * OWNER-FACING (session-gated to academy owner or coach).
   * ═════════════════════════════════════════════════════════════════════ */

  private mine(req: any): { uid: string; academyId: string } | { error: string } {
    const uid = req?.session?.userId;
    const academyId = req?.session?.academyId;
    const role = req?.session?.role;
    if (!uid) return { error: "AuthRequired" };
    if (!academyId) return { error: "NoAcademy" };
    if (!["academy_owner", "coach", "admin"].includes(role)) return { error: "Forbidden" };
    return { uid, academyId };
  }

  /** GET /api/connect/me/inbox — list conversations for my academy (grouped by phone). */
  @Get("me/inbox")
  async myInbox(@Req() req: any, @Query() q: any) {
    const s = this.mine(req); if ("error" in s) return { error: s.error };
    const limit = Math.min(50, parseInt(q.limit || "30", 10));
    const rows = await this.conn.db!.collection("connect_inbound").aggregate([
      { $match: { academy_id: s.academyId } },
      { $sort: { received_at: -1 } },
      { $group: {
          _id: "$from_phone",
          last_body: { $first: "$body" },
          last_at: { $first: "$received_at" },
          unread_count: { $sum: { $cond: [{ $eq: ["$unread", true] }, 1, 0] } },
          msg_count: { $sum: 1 },
      }},
      { $sort: { unread_count: -1, last_at: -1 } },
      { $limit: limit },
    ]).toArray();
    // Attach contact display name if known
    const phones = rows.map((r) => r._id);
    const contacts = await this.conn.db!.collection("connect_contacts").find({ phone: { $in: phones } }).toArray();
    const nameByPhone = new Map(contacts.map((c: any) => [c.phone, c.name || null]));
    return { rows: rows.map((r: any) => ({ ...r, name: nameByPhone.get(r._id) || null })) };
  }

  /** GET /api/connect/me/conversations/:phone — chat history with one phone. */
  @Get("me/conversations/:phone")
  async myConversation(@Req() req: any, @Param("phone") phone: string) {
    const s = this.mine(req); if ("error" in s) return { error: s.error };
    const p = toE164Digits(phone);
    const [inbound, outbound] = await Promise.all([
      this.conn.db!.collection("connect_inbound").find({ academy_id: s.academyId, from_phone: p }).sort({ received_at: 1 }).limit(200).toArray(),
      this.conn.db!.collection("connect_outbound").find({ academy_id: s.academyId, to_phone: p }).sort({ sent_at: 1 }).limit(200).toArray(),
    ]);
    const merged = [
      ...inbound.map((m: any) => ({ direction: "in", at: m.received_at, body: m.body, wamid: m.wamid, status: null })),
      ...outbound.map((m: any) => ({ direction: "out", at: m.sent_at, body: m.body, wamid: m.wamid, status: m.status || "sent" })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    // Mark inbound as read on load
    await this.conn.db!.collection("connect_inbound").updateMany(
      { academy_id: s.academyId, from_phone: p, unread: true }, { $set: { unread: false } });
    return { messages: merged };
  }

  /** POST /api/connect/me/send — send message. Body:
   *  { to: "919...", template?: "chessguru_tournament_listed", vars?: string[], text?: string }
   *  If text is provided and last inbound from `to` was <24h ago → free-form service message.
   *  Otherwise must use an approved template. */
  @Post("me/send")
  async mySend(@Req() req: any, @Body() body: any) {
    const s = this.mine(req); if ("error" in s) return { error: s.error };
    const to = toE164Digits(body?.to);
    if (!to || to.length < 10) return { ok: false, error: "Invalid phone" };
    const token = WA_TOKEN(); const phoneId = WA_PHONE();
    if (!token || !phoneId) return { ok: false, error: "WhatsApp not configured on the server" };

    // 24h service window check
    let canFreeform = false;
    if (body?.text) {
      const lastIn = await this.conn.db!.collection("connect_inbound").findOne(
        { academy_id: s.academyId, from_phone: to }, { sort: { received_at: -1 } });
      canFreeform = !!lastIn && Date.now() - new Date(lastIn.received_at).getTime() < 24 * 3600 * 1000;
    }

    let waBody: any;
    if (canFreeform && body.text) {
      waBody = { messaging_product: "whatsapp", to, type: "text", text: { body: String(body.text).slice(0, 4000), preview_url: false } };
    } else {
      const tpl = body?.template || process.env.WA_TPL_OUTREACH;
      if (!tpl) return { ok: false, error: "No approved template selected — pass ?template=<name> or set WA_TPL_OUTREACH env" };
      const vars: string[] = Array.isArray(body?.vars) ? body.vars.map((v: any) => String(v).slice(0, 900)) : [];
      waBody = {
        messaging_product: "whatsapp", to, type: "template",
        template: { name: tpl, language: { code: WA_LANG() },
          components: vars.length ? [{ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) }] : [] },
      };
    }

    const res = await fetch(`https://graph.facebook.com/${WA_VER}/${phoneId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(waBody),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j?.error?.message || JSON.stringify(j).slice(0, 200);
      const code = j?.error?.code;
      const hint = code === 132001 ? " — template not approved for your WABA" : code === 131047 ? " — outside 24h window, use template" : "";
      return { ok: false, error: `Meta ${res.status}: ${msg}${hint}`, meta: j };
    }
    const wamid = j?.messages?.[0]?.id;
    await this.conn.db!.collection("connect_outbound").insertOne({
      wamid, academy_id: s.academyId, from_user_id: s.uid, to_phone: to,
      template: waBody.type === "template" ? waBody.template.name : null,
      body: body?.text || (waBody.type === "template" ? `[template: ${waBody.template.name}]` : "[msg]"),
      status: "sent", sent_at: new Date(),
    });
    // Ensure contact exists linked to this academy
    await this.conn.db!.collection("connect_contacts").updateOne(
      { phone: to }, { $setOnInsert: { phone: to, created_at: new Date() }, $addToSet: { academy_ids: s.academyId } }, { upsert: true });
    return { ok: true, wamid };
  }

  /** GET /api/connect/me/contacts */
  @Get("me/contacts")
  async myContacts(@Req() req: any, @Query() q: any) {
    const s = this.mine(req); if ("error" in s) return { error: s.error };
    const limit = Math.min(500, parseInt(q.limit || "200", 10));
    const rows = await this.conn.db!.collection("connect_contacts")
      .find({ academy_ids: s.academyId })
      .sort({ created_at: -1 }).limit(limit).toArray();
    return { rows };
  }

  /** POST /api/connect/me/contacts — add or bulk-import.
   *  Body: { phone, name? }  OR  { bulk: [{phone,name},...] } */
  @Post("me/contacts")
  async addContacts(@Req() req: any, @Body() body: any) {
    const s = this.mine(req); if ("error" in s) return { error: s.error };
    const items = Array.isArray(body?.bulk) ? body.bulk : [body];
    let added = 0, updated = 0;
    for (const it of items) {
      const p = toE164Digits(it?.phone);
      if (!p || p.length < 10) continue;
      const name = String(it?.name || "").trim().slice(0, 80) || null;
      const r = await this.conn.db!.collection("connect_contacts").updateOne(
        { phone: p },
        { $setOnInsert: { phone: p, created_at: new Date() },
          $addToSet: { academy_ids: s.academyId },
          ...(name ? { $set: { name } } : {}) },
        { upsert: true });
      if (r.upsertedCount) added++; else updated++;
    }
    return { ok: true, added, updated };
  }

  /** GET /api/connect/me/config — dashboard config (my academy + shared number info). */
  @Get("me/config")
  async myConfig(@Req() req: any) {
    const s = this.mine(req); if ("error" in s) return { error: s.error };
    return {
      academy_id: s.academyId,
      shared_phone_id: WA_PHONE(),
      default_template: process.env.WA_TPL_OUTREACH || null,
      configured: !!(WA_TOKEN() && WA_PHONE()),
    };
  }

  /** GET /api/connect/me/stats — bare-min counters for a dashboard header. */
  @Get("me/stats")
  async myStats(@Req() req: any) {
    const s = this.mine(req); if ("error" in s) return { error: s.error };
    const db = this.conn.db!;
    const [contacts, inbound24, outbound24, unread] = await Promise.all([
      db.collection("connect_contacts").countDocuments({ academy_ids: s.academyId }),
      db.collection("connect_inbound").countDocuments({ academy_id: s.academyId, received_at: { $gte: new Date(Date.now() - 24 * 3600e3) } }),
      db.collection("connect_outbound").countDocuments({ academy_id: s.academyId, sent_at: { $gte: new Date(Date.now() - 24 * 3600e3) } }),
      db.collection("connect_inbound").countDocuments({ academy_id: s.academyId, unread: true }),
    ]);
    return { contacts, inbound_24h: inbound24, outbound_24h: outbound24, unread };
  }
}
