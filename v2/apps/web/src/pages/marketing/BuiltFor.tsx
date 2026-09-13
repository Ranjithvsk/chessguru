// BuiltFor — /for-academies, /for-coaches, /for-schools (ChessPlay's
// /built-for/* pages). One component, copy from data.ts AUDIENCES.

import { Link, Navigate } from "react-router-dom";
import MarketingShell, { Accent, Card, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, useMarketingTitle, M } from "./MarketingShell";
import { AUDIENCES, type AudienceKey } from "./data";

// react-router only supports whole-segment params, so "for-:audience" never
// matched (it fell through to the catch-all → "/"). Explicit routes pass the key.
export default function BuiltForPage({ audience }: { audience: AudienceKey }) {
  const a = AUDIENCES[audience];
  useMarketingTitle(a ? `ChessGuru for ${a.nav} — one platform, every batch` : "ChessGuru");
  if (!a) return <Navigate to="/signup-academy" replace />;
  const others = (Object.keys(AUDIENCES) as AudienceKey[]).filter((k) => k !== a.key);

  return (
    <MarketingShell>
      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-14 pb-16 md:pt-20 md:pb-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Eyebrow>♟ {a.eyebrow}</Eyebrow>
            <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>
              {a.h1[0]} <Accent>{a.h1[1]}</Accent> {a.h1[2]}
            </h1>
            <p className="mt-6 text-lg leading-relaxed max-w-xl" style={{ color: M.ink2 }}>{a.sub}</p>
            <div className="mt-8 flex flex-wrap gap-3"><PrimaryCTA /><WhatsAppCTA text="Get a free demo" /></div>
          </div>
          <div className="rounded-[28px] border p-3 rotate-1" style={{ background: M.card, borderColor: M.line, boxShadow: "0 30px 80px rgba(124,45,18,0.12)" }}>
            <img src={a.img} alt="" className="rounded-2xl w-full aspect-[4/3] object-cover" />
          </div>
        </div>
      </section>

      {/* the day-to-day, handled */}
      <Section tone="peach">
        <Eyebrow>What you actually need</Eyebrow>
        <div className="mt-4"><H2 sub="Every job on your plate, mapped to a feature that quietly takes it off your hands.">The day-to-day, <Accent>handled.</Accent></H2></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {a.jobs.map((j, i) => (
            <Card key={j.t}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white" style={{ background: M.orange }}>{i + 1}</div>
              <div className="mt-4 text-lg font-black leading-tight">{j.t}</div>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: M.ink2 }}>{j.d}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* three big statements */}
      <Section>
        <div className="space-y-6">
          {a.big.map((b, i) => (
            <div key={b.t} className={`grid md:grid-cols-[1fr_1.2fr] gap-8 items-center rounded-[28px] border p-8 md:p-10 ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`} style={{ borderColor: M.line, background: i % 2 ? M.bg2 : M.card }}>
              <div className="text-7xl md:text-8xl text-center select-none" style={{ color: M.orange, opacity: 0.8 }}>{["♔", "♕", "♖"][i]}</div>
              <div>
                <h3 className="text-2xl md:text-3xl font-black tracking-tight leading-tight">{b.t}</h3>
                <p className="mt-3 text-[15px] leading-relaxed" style={{ color: M.ink2 }}>{b.d}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* quote */}
      <Section tone="white">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-6xl leading-none" style={{ color: M.orange }}>“</div>
          <p className="text-xl md:text-2xl font-semibold leading-relaxed">{a.quote.text}</p>
          <div className="mt-5 text-sm font-bold">{a.quote.who}</div>
          <div className="text-xs" style={{ color: M.ink3 }}>{a.quote.meta}</div>
        </div>
      </Section>

      {/* other audiences */}
      <Section>
        <div className="text-center text-[11px] font-bold tracking-widest uppercase mb-5" style={{ color: M.ink3 }}>Also built for</div>
        <div className="grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {others.map((k) => (
            <Link key={k} to={`/for-${k}`} className="flex items-center gap-4 rounded-3xl border p-4 hover:-translate-y-0.5 transition" style={{ borderColor: M.line, background: M.card }}>
              <img src={AUDIENCES[k].img} alt="" className="w-20 h-20 rounded-2xl object-cover" loading="lazy" />
              <div><div className="font-black">{AUDIENCES[k].nav}</div><div className="text-xs mt-1" style={{ color: M.ink3 }}>{AUDIENCES[k].eyebrow} →</div></div>
            </Link>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}
