import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";
import { isAdmin } from "../admin/admins";
import { WhatsappService } from "./whatsapp.service";
import { WA_TEMPLATES, WA_TEMPLATE_BY_NAME } from "./wa-templates";

/** WhatsApp: public webhook (Meta calls it) + superadmin send/manage routes. */
@Controller()
export class WhatsappController {
  constructor(private readonly wa: WhatsappService, @InjectConnection() private readonly conn: Connection) {}
  private leads() { return this.conn.db!.collection("academyLeads"); }
  private requireAdmin(req: any): string {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    if (!isAdmin(req.session.userId)) throw new ForbiddenException("admin only");
    return String(req.session.userId);
  }

  private requireAcademy(req: any): { academyId: string; userId: string } {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    const academyId = req.session?.academyId ? String(req.session.academyId) : "";
    if (!academyId) throw new ForbiddenException("academy session required");
    return { academyId, userId: String(req.session.userId) };
  }

  // ---- webhook (PUBLIC — no session) --------------------------------------------------------
  @Get("whatsapp/webhook")
  verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string, @Res() res: any) {
    const echo = this.wa.verifyChallenge(mode, token, challenge);
    if (echo === null) return res.status(403).send("forbidden");
    return res.status(200).send(echo);
  }

  @Post("whatsapp/webhook")
  async receive(@Req() req: any, @Res() res: any) {
    if (!this.wa.canVerify()) {
      // No app secret yet: ack so Meta keeps the subscription alive, and log delivery status only.
      res.status(200).send("ok");
      this.wa.statusesOnly(req.body);
      return;
    }
    if (!this.wa.verifySignature(req.rawBody, req.headers["x-hub-signature-256"] as string)) return res.status(401).send("bad signature");
    res.status(200).send("ok"); // ack fast; Meta retries on non-200
    void this.wa.handleWebhook(req.body);
  }

  // ---- admin (superadmin only) --------------------------------------------------------------
  @Get("admin/whatsapp/status")
  async status(@Req() req: any) {
    this.requireAdmin(req);
    const configured = this.wa.isConfigured();
    const templates = configured ? await this.wa.listTemplates() : { ok: false, error: "not configured" };
    const origin = (process.env.CHESSGURU_PUBLIC_ORIGIN || "https://chessguru.cc").replace(/\/$/, "");
    return {
      configured,
      missing: this.wa.missingConfig(),
      webhookUrl: `${origin}/v2api/api/whatsapp/webhook`,
      definedTemplates: WA_TEMPLATES.map((t) => ({ name: t.name, category: t.category, language: t.language, vars: t.vars })),
      liveTemplates: templates.ok ? templates.templates : [],
      templatesError: templates.ok ? null : templates.error,
    };
  }

  @Post("admin/whatsapp/templates/sync")
  syncTemplates(@Req() req: any) { this.requireAdmin(req); return this.wa.syncTemplates(); }

  @Get("admin/whatsapp/leads/:id/messages")
  messages(@Req() req: any, @Param("id") id: string) { this.requireAdmin(req); return this.wa.recentMessages(id); }

  /** Send a template to a lead. HARD GATE: WhatsApp must be configured AND the lead opted in for
   *  a MARKETING template. Records the send into the lead's follow-up log. */
  @Post("admin/whatsapp/leads/:id/send")
  async send(@Req() req: any, @Param("id") id: string, @Body() body: { template?: string; values?: string[] }) {
    const by = this.requireAdmin(req);
    if (!this.wa.isConfigured()) return { ok: false, error: "WhatsApp is not configured yet — finish the setup checklist first." };
    const def = WA_TEMPLATE_BY_NAME[String(body?.template ?? "")];
    if (!def) return { ok: false, error: "unknown template" };
    let lead: any;
    try { lead = await this.leads().findOne({ _id: new ObjectId(id) }); } catch { return { ok: false, error: "bad id" }; }
    if (!lead) return { ok: false, error: "lead not found" };
    if (def.category === "MARKETING" && !lead.optIn) {
      return { ok: false, error: "This lead has not opted in — a marketing template cannot be sent. Record opt-in first, or call them one-to-one." };
    }
    if (!lead.phones) return { ok: false, error: "no phone number on this lead" };
    const values = Array.isArray(body?.values) && body!.values!.length ? body!.values!.map(String) : def.sample;
    const r = await this.wa.sendTemplate(lead.phones, def.name, values, lead._id);
    const now = new Date();
    await this.leads().updateOne({ _id: lead._id }, {
      $set: { lastContactAt: now, updatedAt: now },
      $push: { activity: { at: now, by, kind: "whatsapp", text: r.ok ? `Sent template ${def.name}` : `WhatsApp send failed: ${r.error}` } },
    } as any);
    return r;
  }

  // ---- academy (a paying academy, scoped to ITSELF) -----------------------------------------
  /** Inbox list: one row per parent number this academy has messaged, newest first. */
  @Get("academy/whatsapp/threads")
  async academyThreads(@Req() req: any) {
    const { academyId } = this.requireAcademy(req);
    return { ok: true, configured: this.wa.isConfigured(), threads: await this.wa.threadsForAcademy(academyId) };
  }

  /** Full message history for this academy. Never returns another academy's rows. */
  @Get("academy/whatsapp/messages")
  async academyMessages(@Req() req: any, @Query("limit") limit?: string) {
    const { academyId } = this.requireAcademy(req);
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    return { ok: true, messages: await this.wa.messagesForAcademy(academyId, n) };
  }

  /** Send a template to one of this academy's own contacts. The academy is stamped on the
   *  message from the SESSION, never from the body, so a send can only ever be attributed to
   *  the academy that made the request. */
  @Post("academy/whatsapp/send")
  async academySend(@Req() req: any, @Body() body: { to?: string; template?: string; values?: string[] }) {
    const { academyId, userId } = this.requireAcademy(req);
    if (!this.wa.isConfigured()) return { ok: false, error: "WhatsApp is not configured yet." };
    const def = WA_TEMPLATE_BY_NAME[String(body?.template ?? "")];
    if (!def) return { ok: false, error: "unknown template" };
    if (def.category === "MARKETING") {
      return { ok: false, error: "Marketing templates are for ChessGuru outreach. An academy may send service templates to its own contacts only." };
    }
    const to = String(body?.to ?? "").trim();
    if (!WhatsappService.toWaNumber(to)) return { ok: false, error: "no valid phone number" };
    const values = Array.isArray(body?.values) && body!.values!.length ? body!.values!.map(String) : def.sample;
    return this.wa.sendTemplate(to, def.name, values, null, { academyId, byUserId: userId });
  }
}
