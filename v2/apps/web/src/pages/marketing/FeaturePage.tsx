// FeaturePage — /features/:category (ChessPlay's /features/* pages). Driven by
// lib/features.ts so the catalogue stays the single source of truth.

import { Link, Navigate, useParams } from "react-router-dom";
import { CATEGORY_META, FEATURES, type FeatureCategory } from "../../lib/features";
import MarketingShell, { Accent, Card, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, useMarketingTitle, M } from "./MarketingShell";

const ART: Partial<Record<FeatureCategory, string>> = {
  puzzles: "/marketing/cat-puzzles.webp", study: "/marketing/cat-study.webp", play: "/marketing/cat-play.webp",
  classes: "/marketing/cat-live.webp", academy: "/marketing/cat-academy.webp", analytics: "/marketing/cat-analytics.webp",
  notifications: "/marketing/persona-student.webp", engagement: "/marketing/hero.webp",
};
const LEAD: Record<FeatureCategory, string> = {
  puzzles: "Rated tactics, a shared daily puzzle and blindfold training — the practice engine that keeps students opening ChessGuru between classes.",
  study: "A beginner-to-club curriculum your coaches can assign week by week: coordinates, openings, endgames, memory palace, opening tree.",
  play: "Games, engines and a board editor for students; a tournament arbiter with Swiss pairings and a scoresheet scanner for the academy.",
  classes: "Dream Meet video built into the board. Recurring classes, arrows, snap-position, recording, captions, attendance — no separate meeting link.",
  academy: "Coaches, students, batches, invites, fees over UPI and attendance. The running of the academy, on one dashboard.",
  analytics: "Ratings, per-theme strengths, heatmaps, personal bests and exports — for the student, the coach, and the parent report.",
  notifications: "Weekly digests, streak-save reminders, class reminders and browser push — nudges that respect the student.",
  engagement: "Streaks, milestones and celebrations that turn daily practice into a habit kids actually keep.",
};

export default function FeaturePage() {
  const { category } = useParams<{ category: string }>();
  const cat = category as FeatureCategory;
  const meta = CATEGORY_META[cat];
  useMarketingTitle(meta ? `${meta.label} — ChessGuru for academies` : "ChessGuru");
  if (!meta) return <Navigate to="/signup-academy" replace />;
  const items = FEATURES.filter((f) => f.category === cat);
  const cats = Object.keys(CATEGORY_META) as FeatureCategory[];

  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-12 md:pt-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <Eyebrow>Feature · {meta.label}</Eyebrow>
          <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 66px)" }}>
            <Accent>{meta.label}</Accent> — {meta.blurb.toLowerCase()}
          </h1>
          <p className="mt-6 text-lg leading-relaxed max-w-xl" style={{ color: M.ink2 }}>{LEAD[cat]}</p>
          <div className="mt-8 flex flex-wrap gap-3"><PrimaryCTA /><WhatsAppCTA text="Ask a question" /></div>
        </div>
        <div className="rounded-[28px] border p-3 -rotate-1" style={{ background: M.card, borderColor: M.line, boxShadow: "0 30px 80px rgba(124,45,18,0.12)" }}>
          <img src={ART[cat]} alt="" className="rounded-2xl w-full aspect-[4/3] object-cover" />
        </div>
      </section>

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
