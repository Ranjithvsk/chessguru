// Compare — /compare (ChessPlay's /compare). Honest side-by-side. Marks come
// from each product's own public site (checked 2026-09-13); "?" is shown as
// "not stated" rather than as a cross.

import MarketingShell, { Accent, Card, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, useMarketingTitle, M } from "./MarketingShell";
import { COMPARE_COLUMNS, COMPARE_PRICE, COMPARE_ROWS, COMPARE_VERDICTS, type Mark } from "./data";

function MarkCell({ m }: { m: Mark }) {
  const map: Record<Mark, { t: string; c: string; bg: string; title: string }> = {
    yes: { t: "✓", c: "#15803d", bg: "#dcfce7", title: "Full support" },
    partial: { t: "◐", c: "#b45309", bg: "#fef3c7", title: "Partial / add-on" },
    no: { t: "✕", c: "#be123c", bg: "#ffe4e6", title: "Not available" },
    "?": { t: "?", c: M.ink3, bg: "#f5f5f4", title: "Not stated on their public site" },
  };
  const x = map[m];
  return <span title={x.title} className="inline-flex w-8 h-8 rounded-full items-center justify-center font-black" style={{ color: x.c, background: x.bg }}>{x.t}</span>;
}

export default function ComparePage() {
  useMarketingTitle("ChessGuru vs ChessPlay, ChessLang, ChessKid — honest comparison");
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-10 md:pt-20 text-center">
        <Eyebrow>ChessGuru vs the rest</Eyebrow>
        <h1 className="font-black tracking-tight leading-[1.02] mt-5 max-w-4xl mx-auto" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>How ChessGuru compares to <Accent>ChessPlay, ChessLang, ChessKid</Accent> & more</h1>
        <p className="mt-6 text-lg leading-relaxed max-w-2xl mx-auto" style={{ color: M.ink2 }}>Honest, side by side. We built ChessGuru because an Indian academy shouldn't need a dollar subscription and a demo call to run classes, fees and reports.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3"><PrimaryCTA /><WhatsAppCTA text="Ask us anything" /></div>
      </section>

      <Section tone="peach">
        <Eyebrow>Feature comparison</Eyebrow>
        <div className="mt-4"><H2 sub="The capabilities academies depend on every week. ✓ full · ◐ partial or add-on · ✕ not available · ? not stated on their public site.">Everything you need, <Accent>in one place</Accent></H2></div>
        <div className="overflow-x-auto rounded-3xl border" style={{ borderColor: M.line, background: M.card }}>
          <table className="min-w-[860px] w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: M.line }}>
                <th className="text-left p-4 font-bold" style={{ color: M.ink3 }}>Capability</th>
                {COMPARE_COLUMNS.map((c, i) => <th key={c} className="p-4 font-black text-center" style={i === 0 ? { color: M.orange2, background: M.orangeSoft } : {}}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((r) => (
                <tr key={r.cap} className="border-b last:border-0" style={{ borderColor: M.line }}>
                  <td className="p-4 font-semibold" style={{ color: M.ink }}>{r.cap}</td>
                  {r.marks.map((m, i) => <td key={i} className="p-3 text-center" style={i === 0 ? { background: M.orangeSoft } : {}}><MarkCell m={m} /></td>)}
                </tr>
              ))}
              <tr style={{ background: M.bg }}>
                <td className="p-4 font-black">Monthly price, unlimited students</td>
                {COMPARE_COLUMNS.map((c, i) => <td key={c} className="p-3 text-center text-xs font-bold" style={i === 0 ? { color: M.orange2, background: M.orangeSoft } : { color: M.ink2 }}>{COMPARE_PRICE[c]}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-center" style={{ color: M.ink3 }}>Competitor marks reflect their public websites on 13 Sep 2026; tell us if something changed and we'll fix it. ChessPlay.io price converted at ₹84/$.</p>
      </Section>

      <Section>
        <Eyebrow>Tool by tool</Eyebrow>
        <div className="mt-4"><H2 sub="Where each one shines, and where academies outgrow it.">Our honest <Accent>take</Accent></H2></div>
        <div className="grid md:grid-cols-2 gap-5">
          {COMPARE_VERDICTS.map((v) => (
            <Card key={v.name}>
              <div className="text-xl font-black">{v.name}</div>
              <div className="text-sm mt-1" style={{ color: M.ink3 }}>{v.tagline}</div>
              <div className="mt-4 text-[11px] font-bold tracking-widest uppercase" style={{ color: "#15803d" }}>What it does well</div>
              <ul className="mt-1.5 space-y-1 text-sm" style={{ color: M.ink2 }}>{v.good.map((g) => <li key={g}>✓ {g}</li>)}</ul>
              <div className="mt-4 text-[11px] font-bold tracking-widest uppercase" style={{ color: M.orange2 }}>Where ChessGuru wins</div>
              <ul className="mt-1.5 space-y-1 text-sm" style={{ color: M.ink2 }}>{v.wins.map((g) => <li key={g}>♟ {g}</li>)}</ul>
              <div className="mt-4 rounded-2xl p-4 text-sm" style={{ background: M.bg }}><b>Our verdict.</b> {v.verdict}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="white">
        <Eyebrow>Why academies switch</Eyebrow>
        <div className="mt-4"><H2>The ChessGuru <Accent>difference</Accent></H2></div>
        <div className="grid md:grid-cols-3 gap-5">
          {[["One platform, every workflow", "Classes, attendance, homework, reports, fees and parent comms in a single system — no more swivel-chair admin between tabs."],
            ["Built by chess players, in India", "Scoresheet scanning, printed-diagram capture, blindfold rating, Dream Meet on the board — features that come from running real classes."],
            ["Priced for real academies", "₹1,000 a month, flat, unlimited students. Start today with a two-minute self-serve trial, not a demo call."]].map(([t, d]) => (
            <Card key={t}><div className="text-lg font-black">{t}</div><p className="mt-2 text-sm leading-relaxed" style={{ color: M.ink2 }}>{d}</p></Card>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}
