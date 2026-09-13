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

  // ---- webhook (PUBLIC — no session) --------------------------------------------------------
  @Get("whatsapp/webhook")
  verify(@Query("hub.mode") mode: string, @Query("hub.verify_token") token: string, @Query("hub.challenge") challenge: string, @Res() res: any) {
    const echo = this.wa.verifyChallenge(mode, token, challenge);
    if (echo === null) return res.status(403).send("forbidden");
    return res.status(200).send(echo);
  }

  @Post("whatsapp/webhook")
  async receive(@Req() req: any, @Res() res: any) {
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
}
