import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { createHmac, timingSafeEqual } from "crypto";
import { ObjectId } from "mongodb";
import { bodyComponents, toCreatePayload, WA_TEMPLATES, WA_TEMPLATE_BY_NAME } from "./wa-templates";

/** WhatsApp Business Platform (Meta Cloud API) client — academy outreach (2026-09-13).
 *
 *  Nothing here sends until the WABA env is filled in (see isConfigured / missingConfig); until
 *  then every method that would call Meta returns a "not configured" result and the leads UI
 *  shows the setup checklist instead of a Send button. Every outbound send is gated on the
 *  lead's opt-in by the caller (admin-leads / controller), and logged to `whatsappMessages`.
 *
 *  Env:
 *    WA_PHONE_NUMBER_ID     the sending number's Phone Number ID (Cloud API)
 *    WA_BUSINESS_ACCOUNT_ID the WhatsApp Business Account (WABA) id — for template management
 *    WA_ACCESS_TOKEN        a permanent System User token with whatsapp_business_messaging +
 *                           whatsapp_business_management
 *    WA_APP_SECRET          the Meta app secret — verifies the webhook X-Hub-Signature-256
 *    WA_VERIFY_TOKEN        an arbitrary string you also paste into the webhook config
 *    WA_GRAPH_VERSION       Graph API version, default v21.0
 */
/** Who a WhatsApp number belongs to, as far as one academy can see. */
export type WaContact = {
  name: string | null;      // best display name for the number's owner
  username: string | null;
  role: string | null;      // "parent" | "student" | "coach" | "lead" | ...
  students: string[];       // this academy's students the owner is responsible for
  parents: string[];        // named guardians, when the number IS a student's
};

@Injectable()
export class WhatsappService {
  private readonly log = new Logger("WhatsApp");
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private cfg() {
    return {
      phoneNumberId: (process.env.WA_PHONE_NUMBER_ID || "").trim(),
      wabaId: (process.env.WA_BUSINESS_ACCOUNT_ID || "").trim(),
      token: (process.env.WA_ACCESS_TOKEN || "").trim(),
      appSecret: (process.env.WA_APP_SECRET || "").trim(),
      verifyToken: (process.env.WA_VERIFY_TOKEN || "").trim(),
      version: (process.env.WA_GRAPH_VERSION || "v21.0").trim(),
    };
  }
  private graph(path: string) { return `https://graph.facebook.com/${this.cfg().version}/${path}`; }
  private msgs() { return this.conn.db!.collection("whatsappMessages"); }
  private leads() { return this.conn.db!.collection("academyLeads"); }
  private users() { return this.conn.db!.collection("users"); }

  /** The stable part of an Indian mobile, however it was typed: "9841937366",
   *  "+91 98419 37366" and "098419-37366" all reduce to the same 10-digit key. */
  private static last10(raw: unknown): string {
    const d = String(raw ?? "").replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : "";
  }

  isConfigured(): boolean {
    const c = this.cfg();
    return !!(c.phoneNumberId && c.wabaId && c.token);
  }
  missingConfig(): string[] {
    const c = this.cfg();
    const need: Array<[string, string]> = [
      ["WA_PHONE_NUMBER_ID", c.phoneNumberId], ["WA_BUSINESS_ACCOUNT_ID", c.wabaId], ["WA_ACCESS_TOKEN", c.token],
      ["WA_APP_SECRET", c.appSecret], ["WA_VERIFY_TOKEN", c.verifyToken],
    ];
    return need.filter(([, v]) => !v).map(([k]) => k);
  }

  /** E.164 without the leading +, India-default: bare 10 digits → 91XXXXXXXXXX. */
  static toWaNumber(raw: string): string | null {
    const m = String(raw || "").match(/\+?\d[\d ()-]{6,}\d/);
    if (!m) return null;
    let n = m[0].replace(/\D/g, "");
    if (n.length === 10) n = "91" + n;
    if (n.length < 11 || n.length > 15) return null;
    return n;
  }

  // ---- webhook -----------------------------------------------------------------------------
  /** GET verify handshake. Returns the challenge string to echo, or null to 403. */
  verifyChallenge(mode?: string, token?: string, challenge?: string): string | null {
    const c = this.cfg();
    if (mode === "subscribe" && token && c.verifyToken && token === c.verifyToken) return challenge ?? "";
    return null;
  }
  /** Verify X-Hub-Signature-256 against the raw body using the app secret.
   *
   *  FAIL CLOSED when no app secret is set. This used to allow unsigned bodies through so an
   *  early test webhook wasn't silently dropped, but the route is public: an unsigned POST can
   *  insert messages, move a lead's 24-hour window and flip optIn to false via a forged STOP.
   *  Meta's setup handshake is the GET, which uses WA_VERIFY_TOKEN and is unaffected, so the
   *  only cost is that POSTs are refused until WA_APP_SECRET is filled in — which is correct. */
  /** True when an app secret is configured, i.e. signatures can actually be checked. */
  canVerify(): boolean { return !!this.cfg().appSecret; }

  verifySignature(rawBody: Buffer | undefined, header?: string): boolean {
    const c = this.cfg();
    if (!c.appSecret) { this.log.warn("webhook POST refused: WA_APP_SECRET is not set"); return false; }
    if (!rawBody || !header?.startsWith("sha256=")) return false;
    const expected = "sha256=" + createHmac("sha256", c.appSecret).update(rawBody).digest("hex");
    const a = Buffer.from(header); const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Unsigned webhooks (WA_APP_SECRET not filled in yet): log delivery status and NOTHING else.
   *  Meta disables a subscription that keeps failing, and without this the reason a send never
   *  arrived was thrown away — the owner's marketing templates were accepted by Graph and then
   *  silently dropped (2026-09-15). Read-only on purpose: an unsigned POST still cannot write a
   *  message, move a lead's 24-hour window, or flip optIn via a forged STOP. */
  statusesOnly(body: any): void {
    try {
      for (const entry of body?.entry ?? []) {
        for (const ch of entry?.changes ?? []) {
          for (const st of ch?.value?.statuses ?? []) {
            const err = st.errors?.[0];
            this.log.warn(
              `[unsigned] status ${st.status} to ${st.recipient_id} wamid=${String(st.id).slice(-12)}` +
              (err ? ` — ${err.code} ${err.title}${err.error_data?.details ? ": " + err.error_data.details : ""}` : ""),
            );
          }
        }
      }
    } catch (e) { this.log.error(`webhook(status-only): ${(e as Error).message}`); }
  }

  /** Process a webhook payload: update delivery/read status on our sent messages, and record
   *  inbound replies against the matching lead (also flips the 24-hour customer-service window). */
  async handleWebhook(body: any): Promise<void> {
    try {
      for (const entry of body?.entry ?? []) {
        for (const ch of entry?.changes ?? []) {
          const v = ch?.value ?? {};
          for (const st of v.statuses ?? []) {
            // Always log a failure, even for a wamid we never stored — a send made from the CRM or
            // by hand has no row here, and without this its reason is lost (Meta was silently
            // dropping marketing templates with 131049, 2026-09-15).
            const e = st.errors?.[0];
            if (e || st.status === "failed") {
              this.log.warn(`delivery ${st.status} to ${st.recipient_id}` + (e ? ` — ${e.code} ${e.title}` : ""));
            }
            await this.msgs().updateOne({ wamid: st.id }, { $set: { status: st.status, statusAt: new Date(Number(st.timestamp) * 1000 || Date.now()), ...(e ? { error: `${e.code} ${e.title}` } : {}) } });
          }
          for (const m of v.messages ?? []) {
            const from = String(m.from || "");
            const text = m.text?.body ?? m.button?.text ?? `[${m.type}]`;
            const lead = await this.leads().findOne({ phones: { $regex: from.slice(-10) } });
            const now = new Date();
            // Thread the reply to whoever last messaged this number, so an academy sees
            // replies to its own sends while our sales replies stay on the lead.
            const prior = await this.msgs().findOne(
              { direction: "out", to: from },
              { sort: { sentAt: -1 }, projection: { academyId: 1 } });
            await this.msgs().insertOne({
              _id: new ObjectId(), direction: "in", from, wamid: m.id, text,
              leadId: lead?._id ?? null, academyId: prior?.academyId ?? null, receivedAt: now,
            });
            if (lead) {
              const stop = /\b(stop|unsubscribe|opt.?out)\b/i.test(text);
              const push: any = { activity: { at: now, by: "whatsapp", kind: "whatsapp", text: `↩ reply: ${text.slice(0, 300)}` } };
              const set: any = { lastContactAt: now, waWindowUntil: new Date(now.getTime() + 24 * 3600 * 1000), updatedAt: now };
              if (stop) { set.optIn = false; set.optInAt = null; set.optInSource = ""; push.activity = { at: now, by: "whatsapp", kind: "note", text: "Opt-in withdrawn (replied STOP on WhatsApp)" }; }
              await this.leads().updateOne({ _id: lead._id }, { $set: set, $push: push });
            }
          }
        }
      }
    } catch (e) { this.log.error(`webhook: ${(e as Error).message}`); }
  }

  // ---- sending -----------------------------------------------------------------------------
  /** Send a template.
   *
   *  `owner` records WHO sent it. academyId is null for our own sales outreach to
   *  academyLeads, and set when an academy messages its own parents. phoneNumberId and
   *  wabaId are stamped on every row so moving an academy onto its own WhatsApp number
   *  later is a credential change, not a rewrite of this collection. */
  async sendTemplate(
    to: string,
    templateName: string,
    values: string[],
    leadId?: ObjectId | null,
    owner?: { academyId?: string | null; byUserId?: string | null },
  ): Promise<{ ok: boolean; wamid?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "WhatsApp is not configured yet" };
    const def = WA_TEMPLATE_BY_NAME[templateName];
    if (!def) return { ok: false, error: `unknown template ${templateName}` };
    const num = WhatsappService.toWaNumber(to);
    if (!num) return { ok: false, error: "no valid phone number" };
    const c = this.cfg();
    const payload = {
      messaging_product: "whatsapp", to: num, type: "template",
      template: { name: def.name, language: { code: def.language }, components: bodyComponents(values) },
    };
    try {
      const r = await fetch(this.graph(`${c.phoneNumberId}/messages`), {
        method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
      });
      const j: any = await r.json().catch(() => ({}));
      const wamid = j?.messages?.[0]?.id;
      await this.msgs().insertOne({
        _id: new ObjectId(), direction: "out", to: num, template: def.name, values,
        wamid: wamid ?? null, status: r.ok ? "sent" : "failed",
        error: r.ok ? null : (j?.error?.message ?? `HTTP ${r.status}`),
        leadId: leadId ?? null, academyId: owner?.academyId ?? null, byUserId: owner?.byUserId ?? null,
        phoneNumberId: c.phoneNumberId, wabaId: c.wabaId, sentAt: new Date(),
      });
      if (!r.ok) return { ok: false, error: j?.error?.message ?? `HTTP ${r.status}` };
      return { ok: true, wamid };
    } catch (e) {
      const error = (e as Error).message;
      await this.msgs().insertOne({
        _id: new ObjectId(), direction: "out", to: num, template: def.name, values,
        status: "error", error, leadId: leadId ?? null,
        academyId: owner?.academyId ?? null, byUserId: owner?.byUserId ?? null,
        phoneNumberId: c.phoneNumberId, wabaId: c.wabaId, sentAt: new Date(),
      });
      return { ok: false, error };
    }
  }

  // ---- template management -----------------------------------------------------------------
  async listTemplates(): Promise<{ ok: boolean; templates?: any[]; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "not configured" };
    const c = this.cfg();
    try {
      const r = await fetch(this.graph(`${c.wabaId}/message_templates?fields=name,status,category,language&limit=100`), {
        headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(15_000),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: j?.error?.message ?? `HTTP ${r.status}` };
      return { ok: true, templates: j?.data ?? [] };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }

  /** Create (submit for review) the templates defined in wa-templates that don't exist yet. */
  async syncTemplates(): Promise<{ ok: boolean; results?: Array<{ name: string; ok: boolean; status?: string; error?: string }>; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "not configured" };
    const existing = await this.listTemplates();
    const have = new Set((existing.templates ?? []).map((t: any) => t.name));
    const c = this.cfg();
    const results: Array<{ name: string; ok: boolean; status?: string; error?: string }> = [];
    for (const def of WA_TEMPLATES) {
      if (have.has(def.name)) { results.push({ name: def.name, ok: true, status: "already exists" }); continue; }
      try {
        const r = await fetch(this.graph(`${c.wabaId}/message_templates`), {
          method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(toCreatePayload(def)), signal: AbortSignal.timeout(15_000),
        });
        const j: any = await r.json().catch(() => ({}));
        results.push(r.ok ? { name: def.name, ok: true, status: j?.status ?? "submitted" } : { name: def.name, ok: false, error: j?.error?.message ?? `HTTP ${r.status}` });
      } catch (e) { results.push({ name: def.name, ok: false, error: (e as Error).message }); }
    }
    return { ok: true, results };
  }

  /** Every message an academy has sent or received, newest first. Scoped hard to the
   *  caller's own academyId — one academy can never read another's threads. */
  /** What the parent actually saw. We store a template's NAME and its merge values rather than
   *  the rendered text, so rebuild it here — an inbox that read «Template "academy_notice_v1" ·
   *  Ranjith · Guna Chess Academy» would be describing our plumbing instead of the message.
   *  Returns null for a template we no longer have a definition for, and the caller falls back. */
  static renderBody(m: { text?: string | null; template?: string | null; values?: unknown }): string | null {
    if (m.text) return String(m.text);
    const def = m.template ? WA_TEMPLATE_BY_NAME[String(m.template)] : undefined;
    if (!def) return null;
    const values = Array.isArray(m.values) ? (m.values as unknown[]).map(String) : [];
    return def.bodyText.replace(/\{\{(\d+)\}\}/g, (_, i: string) => values[Number(i) - 1] ?? `{{${i}}}`);
  }

  async messagesForAcademy(academyId: string, limit = 100) {
    const rows = await this.msgs().find({ academyId }).sort({ sentAt: -1, receivedAt: -1 }).limit(limit).toArray();
    return rows.map((m) => ({ ...m, body: WhatsappService.renderBody(m as any) }));
  }

  /** The same, collapsed to one row per counterparty number, for an inbox list. */
  /** Put names to the numbers in an academy's inbox.
   *
   *  A thread is keyed by a phone number, which on its own tells an academy nothing. Work out
   *  who the number belongs to — a parent (and which of their children this academy teaches),
   *  a student, or failing both a lead — so the inbox reads like a contact list.
   *
   *  Matching is on the last 10 digits because `users.mobile` is hand-entered and turns up in
   *  every format. That costs a scan of this academy's users who have a mobile rather than an
   *  indexed $in; academies hold hundreds of people, not millions, and the projection is a
   *  handful of fields, so it stays cheap. Nothing crosses the academy boundary: both the
   *  owner lookup and the children/parents lookup are filtered by academyId, so a guardian
   *  shared with another academy cannot leak that academy's student names.
   */
  async contactsForAcademy(academyId: string, numbers: string[]): Promise<Record<string, WaContact>> {
    const want = new Set(numbers.map((n) => WhatsappService.last10(n)).filter(Boolean));
    if (!want.size) return {};

    const people = await this.users()
      .find(
        { academyId, mobile: { $exists: true, $nin: ["", null] } },
        { projection: { username: 1, name: 1, role: 1, mobile: 1, childrenIds: 1, parentIds: 1 } },
      )
      .toArray();
    const owners = people.filter((u) => want.has(WhatsappService.last10(u.mobile)));

    // One lookup for everyone we might need to name alongside them.
    const relatedIds = new Set<string>();
    for (const u of owners) {
      for (const id of ((u.childrenIds ?? []) as unknown[])) relatedIds.add(String(id));
      for (const id of ((u.parentIds ?? []) as unknown[])) relatedIds.add(String(id));
    }
    const related = relatedIds.size
      ? await this.users()
          .find({ _id: { $in: [...relatedIds] } as any, academyId }, { projection: { username: 1, name: 1 } })
          .toArray()
      : [];
    const nameOf = new Map(related.map((r) => [String(r._id), String(r.name || r.username || r._id)]));
    const names = (ids: unknown) =>
      ((ids ?? []) as unknown[]).map((id) => nameOf.get(String(id))).filter((v): v is string => !!v);

    const out: Record<string, WaContact> = {};
    for (const u of owners) {
      out[WhatsappService.last10(u.mobile)] = {
        name: String(u.name || u.username || "") || null,
        username: u.username ? String(u.username) : null,
        role: u.role ? String(u.role) : null,
        students: names(u.childrenIds),
        parents: names(u.parentIds),
      };
    }

    // A number that never became a user may still be a named lead.
    const unresolved = [...want].filter((k) => !out[k]);
    if (unresolved.length) {
      const leads = await this.leads().find({ academyId }, { projection: { name: 1, phones: 1 } }).toArray();
      for (const l of leads) {
        for (const phone of ((l.phones ?? []) as unknown[])) {
          const key = WhatsappService.last10(phone);
          if (key && !out[key] && unresolved.includes(key)) {
            out[key] = { name: String(l.name || "") || null, username: null, role: "lead", students: [], parents: [] };
          }
        }
      }
    }
    return out;
  }

  async threadsForAcademy(academyId: string, limit = 50) {
    const rows = await this.msgs().aggregate([
      { $match: { academyId } },
      { $addFields: { peer: { $ifNull: ["$to", "$from"] }, at: { $ifNull: ["$sentAt", "$receivedAt"] } } },
      { $sort: { at: -1 } },
      { $group: { _id: "$peer", lastAt: { $first: "$at" }, lastText: { $first: "$text" },
                  lastTemplate: { $first: "$template" }, lastValues: { $first: "$values" },
                  lastDirection: { $first: "$direction" }, count: { $sum: 1 } } },
      { $sort: { lastAt: -1 } },
      { $limit: limit },
    ]).toArray();
    const contacts = await this.contactsForAcademy(academyId, rows.map((r) => String(r._id)));
    return rows.map((r) => ({
      ...r,
      contact: contacts[WhatsappService.last10(String(r._id))] ?? null,
      lastBody: WhatsappService.renderBody({ text: r.lastText, template: r.lastTemplate, values: r.lastValues }),
    }));
  }

  async recentMessages(leadId: string, limit = 20) {
    const rows = await this.msgs().find({ leadId: new ObjectId(leadId) }).sort({ sentAt: -1, receivedAt: -1 }).limit(limit).toArray();
    return rows.map((r) => ({ ...r, id: String(r._id), _id: undefined }));
  }
}
