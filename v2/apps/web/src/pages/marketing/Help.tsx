// Help — /help: quick-start guides by audience (ChessPlay links out to a help
// centre; ours lives on the same site).
import { useState } from "react";
import MarketingShell, { Accent, Card, Eyebrow, Section, WhatsAppCTA, useMarketingTitle, M } from "./MarketingShell";
import { GUIDES, type Guide } from "./content";

const AUD: Guide["audience"][] = ["Owners", "Coaches", "Students & parents"];

export default function HelpPage() {
  useMarketingTitle("ChessGuru help centre — step-by-step guides");
  const [aud, setAud] = useState<Guide["audience"] | "All">("All");
  const [open, setOpen] = useState<string | null>(GUIDES[0]?.slug ?? null);
  const list = aud === "All" ? GUIDES : GUIDES.filter((g) => g.audience === aud);
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-8 md:pt-20 text-center">
        <Eyebrow>Help centre</Eyebrow>
        <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>Step-by-step, <Accent>in plain words</Accent></h1>
        <p className="mt-6 text-lg leading-relaxed max-w-2xl mx-auto" style={{ color: M.ink2 }}>Guides for owners, coaches, students and parents. Stuck anyway? WhatsApp us — a person answers.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {(["All", ...AUD] as const).map((a) => (
            <button key={a} onClick={() => setAud(a)} className="rounded-full px-4 py-1.5 text-sm font-bold border" style={aud === a ? { background: M.ink, color: "#fff", borderColor: M.ink } : { borderColor: M.line, background: M.card }}>{a}</button>
          ))}
        </div>
      </section>
      <Section>
        <div className="max-w-3xl mx-auto space-y-3">
          {list.map((g) => (
            <Card key={g.slug} className="!p-0 overflow-hidden">
              <button onClick={() => setOpen(open === g.slug ? null : g.slug)} className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 hover:bg-orange-50">
                <div><div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: M.orange2 }}>{g.audience}</div><div className="font-black text-lg leading-tight mt-0.5">{g.title}</div></div>
                <span className="text-2xl" style={{ color: M.orange }}>{open === g.slug ? "−" : "+"}</span>
              </button>
              {open === g.slug && (
                <ol className="px-6 pb-6 space-y-3">
                  {g.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-[15px] leading-relaxed"><span className="flex-none w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ background: M.orange }}>{i + 1}</span><span style={{ color: M.ink2 }}>{s}</span></li>
                  ))}
                </ol>
              )}
            </Card>
          ))}
        </div>
        <div className="text-center mt-10"><WhatsAppCTA text="Still stuck? WhatsApp us" msg="Hi Ranjith, I need help with ChessGuru: " /></div>
      </Section>
    </MarketingShell>
  );
}
