// About — /about (ChessPlay's /about): manifesto, live numbers, house rules, a note.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../../lib/api";
import MarketingShell, { Accent, Card, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, useMarketingTitle, M } from "./MarketingShell";
import { HOUSE_RULES } from "./content";

export default function AboutPage() {
  useMarketingTitle("About ChessGuru — built with chess coaches, for chess coaches");
  const [stats, setStats] = useState<{ academies: number; students: number; coaches: number; puzzlesSolvedWeek: number } | null>(null);
  useEffect(() => { get<any>("/api/public/stats").then(setStats).catch(() => setStats(null)); }, []);
  const n = (v?: number) => (v ?? 0).toLocaleString("en-IN");
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-12 md:pt-20 text-center">
        <Eyebrow>About ChessGuru</Eyebrow>
        <h1 className="font-black tracking-tight leading-[1.02] mt-5 max-w-4xl mx-auto" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>Built with chess coaches, <Accent>for chess coaches.</Accent></h1>
        <p className="mt-6 text-lg leading-relaxed max-w-2xl mx-auto" style={{ color: M.ink2 }}>We're a small team in Tamil Nadu, India, obsessed with one thing: making a chess academy calm to run, a pleasure to use, and priced so that no academy ever has to think twice.</p>
      </section>

      <Section tone="peach">
        <Eyebrow>Our manifesto</Eyebrow>
        <div className="mt-4"><H2>What we <Accent>believe</Accent></H2></div>
        <div className="max-w-3xl mx-auto space-y-4 text-xl md:text-2xl font-semibold leading-relaxed text-center">
          <p>We believe chess deserves better software.</p>
          <p>We believe coaches should coach, not chase fees.</p>
          <p>We believe parents deserve to see real progress, not promises.</p>
          <p>We believe a 200-student academy should run with the calm of a 20-student one.</p>
          <p>And we believe the software should cost less than one student's fee.</p>
        </div>
      </Section>

      <Section>
        <Eyebrow>By the numbers</Eyebrow>
        <div className="mt-4"><H2 sub="Live from chessguru.cc — no rounding up.">A quiet start, <Accent>one academy at a time</Accent></H2></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 text-center">
          {[[n(stats?.students), "Students learning"], [n(stats?.academies), "Academies on ChessGuru"], [n(stats?.coaches), "Coaches teaching"], [n(stats?.puzzlesSolvedWeek), "Puzzles solved this week"]].map(([v, l]) => (
            <Card key={l}><div className="text-4xl font-black" style={{ color: M.orange }}>{v}</div><div className="mt-1 text-sm font-semibold" style={{ color: M.ink2 }}>{l}</div></Card>
          ))}
        </div>
      </Section>

      <Section tone="white">
        <Eyebrow>What we value</Eyebrow>
        <div className="mt-4"><H2 sub="Pinned to the wall. Every roadmap decision passes through these.">The four <Accent>house rules</Accent></H2></div>
        <div className="grid sm:grid-cols-2 gap-5">
          {HOUSE_RULES.map((r) => (
            <div key={r.n} className="rounded-3xl border p-7" style={{ borderColor: M.line, background: M.bg }}>
              <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: M.orange2 }}>{r.n}</div>
              <div className="mt-2 text-xl font-black">{r.t}</div>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: M.ink2 }}>{r.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="max-w-3xl mx-auto rounded-[28px] border p-8 md:p-10" style={{ borderColor: M.line, background: M.card }}>
          <Eyebrow>A note from the team</Eyebrow>
          <p className="mt-5 text-lg leading-relaxed">ChessGuru started as the tool we needed for our own students: a board that followed the coach, homework that graded itself, and a way to turn a drawer of paper scoresheets into games we could actually analyse. It grew into the whole academy — fees, attendance, reports — because those were the evenings we were losing. If you run a chess academy and you're tired of juggling eight tools, we built this for you.</p>
          <div className="mt-6 flex flex-wrap gap-3"><PrimaryCTA /><WhatsAppCTA text="Say hello on WhatsApp" msg="Hi Ranjith, I read the About page — I'd like to talk about ChessGuru for my academy." /></div>
          <div className="mt-5 text-sm" style={{ color: M.ink3 }}>Ranjith and the ChessGuru team · <Link to="/why-chessguru" className="underline underline-offset-2">Read why academies switch</Link></div>
        </div>
      </Section>
    </MarketingShell>
  );
}
