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
  /** Verify X-Hub-Signature-256 against the raw body using the app secret. Open (allow) only
   *  when no app secret is configured yet, so an early test webhook isn't silently dropped. */
  verifySignature(rawBody: Buffer | undefined, header?: string): boolean {
    const c = this.cfg();
    if (!c.appSecret) return true;
    if (!rawBody || !header?.startsWith("sha256=")) return false;
    const expected = "sha256=" + createHmac("sha256", c.appSecret).update(rawBody).digest("hex");
    const a = Buffer.from(header); const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Process a webhook payload: update delivery/read status on our sent messages, and record
   *  inbound replies against the matching lead (also flips the 24-hour customer-service window). */
  async handleWebhook(body: any): Promise<void> {
    try {
      for (const entry of body?.entry ?? []) {
        for (const ch of entry?.changes ?? []) {
          const v = ch?.value ?? {};
          for (const st of v.statuses ?? []) {
            await this.msgs().updateOne({ wamid: st.id }, { $set: { status: st.status, statusAt: new Date(Number(st.timestamp) * 1000 || Date.now()) } });
          }
          for (const m of v.messages ?? []) {
            const from = String(m.from || "");
            const text = m.text?.body ?? m.button?.text ?? `[${m.type}]`;
            const lead = await this.leads().findOne({ phones: { $regex: from.slice(-10) } });
            const now = new Date();
            await this.msgs().insertOne({ _id: new ObjectId(), direction: "in", from, wamid: m.id, text, leadId: lead?._id ?? null, receivedAt: now });
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
  async sendTemplate(to: string, templateName: string, values: string[], leadId?: ObjectId | null): Promise<{ ok: boolean; wamid?: string; error?: string }> {
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
      await this.msgs().insertOne({ _id: new ObjectId(), direction: "out", to: num, template: def.name, values, wamid: wamid ?? null, status: r.ok ? "sent" : "failed", error: r.ok ? null : (j?.error?.message ?? `HTTP ${r.status}`), leadId: leadId ?? null, sentAt: new Date() });
      if (!r.ok) return { ok: false, error: j?.error?.message ?? `HTTP ${r.status}` };
      return { ok: true, wamid };
    } catch (e) {
      const error = (e as Error).message;
      await this.msgs().insertOne({ _id: new ObjectId(), direction: "out", to: num, template: def.name, values, status: "error", error, leadId: leadId ?? null, sentAt: new Date() });
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

  async recentMessages(leadId: string, limit = 20) {
    const rows = await this.msgs().find({ leadId: new ObjectId(leadId) }).sort({ sentAt: -1, receivedAt: -1 }).limit(limit).toArray();
    return rows.map((r) => ({ ...r, id: String(r._id), _id: undefined }));
  }
}
