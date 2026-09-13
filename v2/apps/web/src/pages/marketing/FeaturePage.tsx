// FeaturePage — /features/:category (ChessPlay's /features/* pages). Driven by
// lib/features.ts so the catalogue stays the single source of truth.

import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { CATEGORY_META, FEATURES, type FeatureCategory } from "../../lib/features";
import MarketingShell, { Accent, Card, Check, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, useMarketingTitle, M } from "./MarketingShell";
import { FEATURE_PAGES } from "./content";

const ART: Partial<Record<FeatureCategory, string>> = {
  puzzles: "/marketing/cat-puzzles.webp", study: "/marketing/cat-study.webp", play: "/marketing/cat-play.webp",
  classes: "/marketing/cat-live.webp", academy: "/marketing/cat-academy.webp", analytics: "/marketing/cat-analytics.webp",
  notifications: "/marketing/persona-student.webp", engagement: "/marketing/hero.webp",
};

export default function FeaturePage() {
  const { category } = useParams<{ category: string }>();
  const cat = category as FeatureCategory;
  const meta = CATEGORY_META[cat];
  useMarketingTitle(meta ? `${meta.label} — ChessGuru for academies` : "ChessGuru");
  if (!meta) return <Navigate to="/signup-academy" replace />;
  const items = FEATURES.filter((f) => f.category === cat);
  const cats = Object.keys(CATEGORY_META) as FeatureCategory[];
  const page = FEATURE_PAGES[cat];
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-12 md:pt-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <Eyebrow>Feature · {meta.label}</Eyebrow>
          <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 66px)" }}>
            {page.h1[0]} <Accent>{page.h1[1]}</Accent>
          </h1>
          <p className="mt-6 text-lg leading-relaxed max-w-xl" style={{ color: M.ink2 }}>{page.sub}</p>
          <div className="mt-8 flex flex-wrap gap-3"><PrimaryCTA /><WhatsAppCTA text="Ask a question" /></div>
        </div>
        <div className="rounded-[28px] border p-3 -rotate-1" style={{ background: M.card, borderColor: M.line, boxShadow: "0 30px 80px rgba(124,45,18,0.12)" }}>
          <img src={ART[cat]} alt="" className="rounded-2xl w-full aspect-[4/3] object-cover" />
        </div>
      </section>

      {/* three blocks (ChessPlay: Key feature / For students / For coaches) */}
      <Section>
        <div className="space-y-6">
          {page.blocks.map((b, i) => (
            <div key={b.title} className={`grid md:grid-cols-2 gap-8 items-center rounded-[28px] border p-8 md:p-10 ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`} style={{ borderColor: M.line, background: i % 2 ? M.bg2 : M.card }}>
              <div className="rounded-2xl overflow-hidden aspect-[4/3]" style={{ background: M.bg2 }}><img src={[ART[cat], "/marketing/persona-student.webp", "/marketing/persona-coach.webp"][i]} alt="" className="w-full h-full object-cover" loading="lazy" /></div>
              <div>
                <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: M.orange2 }}>{b.tag}</div>
                <h3 className="mt-2 text-2xl md:text-3xl font-black tracking-tight leading-tight">{b.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed" style={{ color: M.ink2 }}>{b.body}</p>
                <ul className="mt-5 space-y-3">{b.bullets.map((x) => <Check key={x}>{x}</Check>)}</ul>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="peach">
        <H2 sub={`${items.length} ${items.length === 1 ? "feature" : "features"} in this area, all on the single ₹1,000/month plan.`}>What's <Accent>inside</Accent></H2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it) => (
            <Card key={it.id}>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{it.emoji}</span>
                <div className="font-black leading-tight">{it.title}</div>
                {it.badge && <span className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full text-white" style={{ background: M.orange }}>{it.badge}</span>}
              </div>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: M.ink2 }}>{it.description}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="white">
        <Eyebrow>FAQ</Eyebrow>
        <div className="mt-4"><H2>Frequently asked <Accent>questions</Accent></H2></div>
        <div className="max-w-3xl mx-auto space-y-2">
          {page.faq.map((item, i) => (
            <div key={i} className="rounded-2xl border overflow-hidden" style={{ borderColor: M.line, background: M.card }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-orange-50">
                <span className="font-bold text-[15px]">{item.q}</span><span className="text-xl" style={{ color: M.orange }}>{openFaq === i ? "−" : "+"}</span>
              </button>
              {openFaq === i && <div className="px-5 pb-4 text-sm leading-relaxed" style={{ color: M.ink2 }}>{item.a}</div>}
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="text-center text-[11px] font-bold tracking-widest uppercase mb-5" style={{ color: M.ink3 }}>More features</div>
        <div className="flex flex-wrap justify-center gap-2">
          {cats.filter((c) => c !== cat).map((c) => (
            <Link key={c} to={`/features/${c}`} className="rounded-full border px-4 py-2 text-sm font-bold hover:bg-white transition" style={{ borderColor: M.line, color: M.ink2 }}>{CATEGORY_META[c].label}</Link>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}
