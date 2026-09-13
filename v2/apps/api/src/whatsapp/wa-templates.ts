/** WhatsApp message templates for academy outreach (2026-09-13).
 *
 *  These are the EXACT definitions to register in the WhatsApp Business Account, either by
 *  POSTing them through the Management API (whatsapp.service.createTemplate → the
 *  /whatsapp/templates/sync admin route) or by pasting them into Meta Business Suite →
 *  WhatsApp Manager → Message templates. Names are lowercase+underscore (Meta rule) and
 *  frozen once approved — bump the _vN suffix to change an approved template.
 *
 *  MARKETING templates may only be sent to a lead who has OPTED IN (Lead.optIn) — the send
 *  route enforces it. Meta reviews each template (usually minutes to a few hours) before it
 *  can be used; check status with /whatsapp/status.
 *
 *  Variables are positional ({{1}}, {{2}}…). `sample` values are what Meta shows the reviewer;
 *  `vars` documents what each position means so the send route can map lead fields to them.
 */
export type WaTemplateDef = {
  name: string;
  language: string; // BCP-47-ish code Meta uses, e.g. "en" or "en_US"
  category: "MARKETING" | "UTILITY";
  bodyText: string; // {{1}}-style placeholders
  vars: string[]; // human label per placeholder, in order
  sample: string[]; // sample value per placeholder (for Meta review)
  buttons?: Array<{ type: "URL"; text: string; url: string } | { type: "PHONE_NUMBER"; text: string; phone_number: string } | { type: "QUICK_REPLY"; text: string }>;
  footer?: string;
};

export const WA_TEMPLATES: WaTemplateDef[] = [
  {
    name: "academy_intro_v1",
    language: "en",
    category: "MARKETING",
    bodyText:
      "Hello {{1}}, this is {{2}} from ChessGuru. We give each academy its OWN branded app on its own domain, with all your data kept private to your academy — live video classes, a book reader with click-to-play, fees collection with reminders, and accounting for expenses, rent and coach payments, all in one place. Could I show you a quick 15-minute demo set up for {{1}}?",
    vars: ["Academy name", "Your name"],
    sample: ["Madras School of Chess", "Ranjith"],
    footer: "Reply STOP to opt out",
    buttons: [{ type: "URL", text: "See ChessGuru", url: "https://chessguru.cc/" }],
  },
  {
    name: "academy_demo_followup_v1",
    language: "en",
    category: "MARKETING",
    bodyText:
      "Hi {{1}}, thank you for your time today. Here is the ChessGuru demo we discussed — you can explore classes, puzzles and the coach dashboard yourself. Shall I set up a free trial for {{1}} this week?",
    vars: ["Academy name"],
    sample: ["Madras School of Chess"],
    footer: "Reply STOP to opt out",
    buttons: [{ type: "URL", text: "Open demo", url: "https://chessguru.cc/" }],
  },
  {
    name: "academy_trial_ready_v1",
    language: "en",
    category: "UTILITY",
    bodyText:
      "Hi {{1}}, your ChessGuru trial academy is ready. Sign in at {{2}} with the details we shared. I'll check in after a couple of days — reply here any time if you need help getting your coaches and students set up.",
    vars: ["Academy name", "Sign-in link"],
    sample: ["Madras School of Chess", "https://chessguru.cc/login"],
  },
];

export const WA_TEMPLATE_BY_NAME: Record<string, WaTemplateDef> = Object.fromEntries(WA_TEMPLATES.map((t) => [t.name, t]));

/** Build the components array a send needs, mapping ordered variable values into body params. */
export function bodyComponents(values: string[]) {
  if (!values.length) return [];
  return [{ type: "body", parameters: values.map((v) => ({ type: "text", text: v })) }];
}

/** Shape a definition into the Management API create-template payload. */
export function toCreatePayload(def: WaTemplateDef) {
  const components: any[] = [{ type: "BODY", text: def.bodyText, example: { body_text: [def.sample] } }];
  if (def.footer) components.push({ type: "FOOTER", text: def.footer });
  if (def.buttons?.length) components.push({ type: "BUTTONS", buttons: def.buttons });
  return { name: def.name, language: def.language, category: def.category, components };
}
