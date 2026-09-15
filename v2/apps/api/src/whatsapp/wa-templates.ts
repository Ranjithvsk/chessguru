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
    // The full pitch (owner 2026-09-15: "should say about puzzle playing, chess play, live class,
    // saving openings, tracking students performance, analysing game play … try login
    // www.chessguru.cc, or ask for demo"). v1 led with the branded app; this one leads with what a
    // coach and a student actually do every day, and invites them to try it themselves.
    name: "academy_intro_v2",
    language: "en",
    category: "MARKETING",
    bodyText:
      "Hello {{1}}, this is {{2}} from ChessGuru \u2014 one platform built only for chess academies, with your own branded app on your own domain.\n\n" +
      "Students solve rated puzzles every day and play real games against classmates and bots. Coaches run live classes where everyone moves the same board, save opening lines as studies and push them straight to a student's board, and read chess books with click-to-play diagrams. Every game is analysed move by move, so you see exactly where it turned. Each child's performance \u2014 rating, attendance, homework and progress \u2014 is tracked in one place, and fees, expenses and coach payments are handled too.\n\n" +
      "Try it yourself at www.chessguru.cc, or reply here and I will arrange a 15-minute demo built around your academy.",
    vars: ["Academy name", "Your name"],
    sample: ["Madras School of Chess", "Ranjith"],
    footer: "Reply STOP to opt out",
    buttons: [{ type: "URL", text: "Try ChessGuru", url: "https://www.chessguru.cc/" }],
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
  {
    // Academy -> its OWN parents. The only template an academy may send (the send route
    // refuses MARKETING for academies), so it carries the academy's own words in {{3}}.
    name: "academy_notice_v1",
    language: "en",
    category: "UTILITY",
    bodyText:
      "Hello {{1}}, this is an update from {{2}} about your child's chess classes.\n\n{{3}}\n\nReply to this message if you have a question, or sign in to your ChessGuru parent account for the full details.",
    vars: ["Parent name", "Academy name", "The notice"],
    sample: ["Ranjith", "Guna Chess Academy", "Sunday's class moves to 10:00 AM at the Avadi branch."],
  },
  {
    // Meta's own pre-approved connectivity test. No variables, nothing academy-specific —
    // it exists so a send can be proved end to end (number registered, token valid, row
    // written, inbox rendering) without waiting on template review.
    name: "hello_world",
    language: "en_US",
    category: "UTILITY",
    bodyText:
      "Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API. Thank you for taking the time to test with us.",
    vars: [],
    sample: [],
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
