// Contact — /contact (ChessPlay's /contact). Channels + a message form that
// hands the message to WhatsApp or email (no backend endpoint needed).
import { useState } from "react";
import { Link } from "react-router-dom";
import MarketingShell, { Accent, Card, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, WhatsAppIcon, useMarketingTitle, M, CTA_STYLE } from "./MarketingShell";
import { WHATSAPP_DISPLAY, WHATSAPP_URL } from "./data";

const TOPICS = ["Book a demo", "Product support", "Migration from another platform", "Partnership", "Press / media", "Something else"];

export default function ContactPage() {
  useMarketingTitle("Contact ChessGuru — talk to a real human");
  const [f, setF] = useState({ name: "", email: "", academy: "", topic: TOPICS[0]!, message: "" });
  const text = `Hi Ranjith — ${f.topic}.\nName: ${f.name}\nEmail: ${f.email}\nAcademy: ${f.academy || "-"}\n\n${f.message}`;
  const mailto = `mailto:hello@chessguru.cc?subject=${encodeURIComponent(`[ChessGuru] ${f.topic} — ${f.academy || f.name}`)}&body=${encodeURIComponent(text)}`;
  const ok = f.name.trim() && f.email.trim() && f.message.trim();
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-10 md:pt-20 text-center">
        <Eyebrow>Get in touch</Eyebrow>
        <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>Talk to a <Accent>real human.</Accent></h1>
        <p className="mt-6 text-lg leading-relaxed max-w-2xl mx-auto" style={{ color: M.ink2 }}>Demo, support, migration, partnership or a friendly hello — pick the channel that fits. WhatsApp gets an answer the same day; email within one working day.</p>
      </section>

      <Section>
        <div className="grid md:grid-cols-3 gap-5">
          <Card><div className="text-3xl">💬</div><div className="mt-3 text-lg font-black">WhatsApp</div><p className="mt-1 text-sm" style={{ color: M.ink2 }}>The fastest way. A person who runs classes answers, not a bot.</p><a href={WHATSAPP_URL("Hi Ranjith, I have a question about ChessGuru.")} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 font-bold text-sm" style={{ color: "#128C7E" }}><WhatsAppIcon size={16} /> {WHATSAPP_DISPLAY} →</a></Card>
          <Card><div className="text-3xl">📚</div><div className="mt-3 text-lg font-black">Help centre</div><p className="mt-1 text-sm" style={{ color: M.ink2 }}>Step-by-step guides for owners, coaches, students and parents.</p><Link to="/help" className="mt-4 inline-block font-bold text-sm" style={{ color: M.orange2 }}>Browse guides →</Link></Card>
          <Card><div className="text-3xl">✉️</div><div className="mt-3 text-lg font-black">Email</div><p className="mt-1 text-sm" style={{ color: M.ink2 }}>Reach the team directly. Every email is answered within one working day.</p><a href="mailto:hello@chessguru.cc" className="mt-4 inline-block font-bold text-sm" style={{ color: M.orange2 }}>hello@chessguru.cc →</a></Card>
        </div>
      </Section>

      <Section tone="peach">
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
          <Card>
            <div className="text-2xl font-black">Send us a note</div>
            <p className="mt-1 text-sm" style={{ color: M.ink2 }}>The more you tell us, the better we can help. Nothing here is sold or shared, ever.</p>
            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              <Field label="Your name" v={f.name} set={(v) => setF({ ...f, name: v })} />
              <Field label="Email" type="email" v={f.email} set={(v) => setF({ ...f, email: v })} />
              <Field label="Academy / organisation (optional)" v={f.academy} set={(v) => setF({ ...f, academy: v })} />
              <label className="block"><span className="text-xs font-bold mb-1.5 block" style={{ color: M.ink2 }}>What's this about?</span>
                <select value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} className="w-full rounded-xl border px-4 py-3 text-sm outline-none" style={{ borderColor: "rgba(28,25,23,0.15)", background: "#fffaf5" }}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select></label>
            </div>
            <label className="block mt-4"><span className="text-xs font-bold mb-1.5 block" style={{ color: M.ink2 }}>Your message</span>
              <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={5} className="w-full rounded-xl border px-4 py-3 text-sm outline-none" style={{ borderColor: "rgba(28,25,23,0.15)", background: "#fffaf5" }} placeholder="How many students, what you use today, what you'd like to see…" /></label>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href={ok ? WHATSAPP_URL(text) : undefined} target="_blank" rel="noreferrer" aria-disabled={!ok} className={`inline-flex items-center gap-2 rounded-full px-6 py-3 font-bold text-white ${ok ? "" : "opacity-50 pointer-events-none"}`} style={{ background: "#25D366" }}><WhatsAppIcon /> Send on WhatsApp</a>
              <a href={ok ? mailto : undefined} aria-disabled={!ok} className={`inline-flex items-center rounded-full px-6 py-3 font-bold ${ok ? "" : "opacity-50 pointer-events-none"}`} style={CTA_STYLE}>Send by email</a>
            </div>
            <p className="mt-3 text-xs" style={{ color: M.ink3 }}>By sending you agree to our <Link to="/privacy" className="underline">privacy policy</Link>. The message opens in your WhatsApp or email app — nothing is stored here.</p>
          </Card>
          <div className="space-y-5">
            <Card>
              <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: M.ink3 }}>Response times</div>
              <ul className="mt-3 space-y-2 text-sm">
                {[["WhatsApp", "Same day, usually within the hour"], ["Email", "< 1 working day"], ["Demo booking", "Pick a slot on WhatsApp"], ["Partnerships", "2–3 working days"]].map(([k, v]) => <li key={k} className="flex justify-between gap-4"><span className="font-semibold">{k}</span><span style={{ color: M.ink2 }}>{v}</span></li>)}
              </ul>
            </Card>
            <Card>
              <div className="text-lg font-black">Already a customer?</div>
              <p className="mt-1 text-sm" style={{ color: M.ink2 }}>Skip straight to the guides, or use the ? button inside the app to raise a support ticket.</p>
              <Link to="/help" className="mt-3 inline-block font-bold text-sm" style={{ color: M.orange2 }}>Help centre →</Link>
            </Card>
            <Card>
              <div className="text-lg font-black">Or just see it in action.</div>
              <p className="mt-1 text-sm" style={{ color: M.ink2 }}>Thirty minutes, your questions, our screen — or skip the call and start the trial.</p>
              <div className="mt-4 flex flex-wrap gap-2"><WhatsAppCTA text="Book a demo" className="!px-5 !py-2.5 !text-sm" /><PrimaryCTA className="!px-5 !py-2.5 !text-sm">Start free trial</PrimaryCTA></div>
            </Card>
          </div>
        </div>
      </Section>

      <Section>
        <H2>Quick <Accent>answers</Accent></H2>
        <div className="max-w-3xl mx-auto grid sm:grid-cols-2 gap-5">
          {[["How quickly do you reply?", "Same day on WhatsApp, within one working day by email."], ["Can I migrate from another platform?", "Yes. Send us your student list and fee sheet; most academies are live within a day."], ["Do I need a demo before the trial?", "No. The trial is self-serve and takes two minutes; the demo is there if you want one."], ["Can you help set up my domain?", "Yes — one DNS record from you, the rest is ours."]].map(([q, a]) => (
            <Card key={q}><div className="font-black">{q}</div><p className="mt-2 text-sm" style={{ color: M.ink2 }}>{a}</p></Card>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}

function Field({ label, v, set, type = "text" }: { label: string; v: string; set: (v: string) => void; type?: string }) {
  return (
    <label className="block"><span className="text-xs font-bold mb-1.5 block" style={{ color: M.ink2 }}>{label}</span>
      <input type={type} value={v} onChange={(e) => set(e.target.value)} className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-300" style={{ borderColor: "rgba(28,25,23,0.15)", background: "#fffaf5" }} /></label>
  );
}
