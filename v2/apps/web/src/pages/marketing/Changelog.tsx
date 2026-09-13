// Changelog — /changelog (ChessPlay's /changelog): releases named after pieces,
// tag filter, entries drawn from real commits (see content.ts CHANGELOG).
import { useState } from "react";
import MarketingShell, { Accent, Eyebrow, useMarketingTitle, M } from "./MarketingShell";
import { CHANGELOG, type ChangeTag } from "./content";

const TAG_STYLE: Record<ChangeTag, { c: string; bg: string }> = {
  New: { c: "#15803d", bg: "#dcfce7" }, Improved: { c: "#1d4ed8", bg: "#dbeafe" }, Fixed: { c: "#b45309", bg: "#fef3c7" }, Design: { c: "#be185d", bg: "#fce7f3" }, Performance: { c: "#6d28d9", bg: "#ede9fe" },
};
const PIECE: Record<string, string> = { Queen: "♛", Rook: "♜", Bishop: "♝", Knight: "♞", Pawn: "♟", King: "♚" };

export default function ChangelogPage() {
  useMarketingTitle("ChessGuru changelog — every move we've made");
  const [tag, setTag] = useState<ChangeTag | null>(null);
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-10 md:pt-20 text-center">
        <Eyebrow>Changelog</Eyebrow>
        <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>Every <Accent>move</Accent> we've made.</h1>
        <p className="mt-6 text-lg leading-relaxed max-w-2xl mx-auto" style={{ color: M.ink2 }}>New features, polish and the small touches that make running a chess academy feel effortless. Shipped openly, named after the pieces.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <button onClick={() => setTag(null)} className="rounded-full px-4 py-1.5 text-sm font-bold border" style={tag === null ? { background: M.ink, color: "#fff", borderColor: M.ink } : { borderColor: M.line, background: M.card }}>All</button>
          {(Object.keys(TAG_STYLE) as ChangeTag[]).map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)} className="rounded-full px-4 py-1.5 text-sm font-bold border" style={tag === t ? { background: TAG_STYLE[t].c, color: "#fff", borderColor: TAG_STYLE[t].c } : { borderColor: M.line, background: M.card, color: TAG_STYLE[t].c }}>{t}</button>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="relative border-l-2 ml-4 md:ml-0 md:pl-0" style={{ borderColor: M.line }}>
          {CHANGELOG.map((r) => {
            const items = tag ? r.items.filter((i) => i.tag === tag) : r.items;
            if (!items.length) return null;
            return (
              <div key={r.v} className="relative pl-8 md:pl-12 pb-12">
                <div className="absolute -left-[13px] top-1 w-6 h-6 rounded-full flex items-center justify-center text-sm" style={{ background: M.orange, color: "#fff" }}>{PIECE[r.piece]}</div>
                <div className="flex flex-wrap items-center gap-3 text-sm"><span className="font-black">{r.v}</span><span style={{ color: M.ink3 }}>{r.month}</span><span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: M.orangeSoft, color: M.orange2 }}>“{r.piece}”</span></div>
                <h2 className="mt-2 text-2xl md:text-3xl font-black tracking-tight">{r.title}</h2>
                <div className="mt-5 space-y-3">
                  {items.map((i) => (
                    <div key={i.t} className="rounded-2xl border p-5 flex gap-4" style={{ borderColor: M.line, background: M.card }}>
                      <span className="flex-none self-start rounded-full px-2.5 py-1 text-[11px] font-black" style={{ background: TAG_STYLE[i.tag].bg, color: TAG_STYLE[i.tag].c }}>{i.tag}</span>
                      <div><div className="font-black">{i.t}</div><p className="mt-1 text-sm leading-relaxed" style={{ color: M.ink2 }}>{i.d}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-center text-sm" style={{ color: M.ink3 }}>That's all the notes, for now. Earlier work (2025 → April 2026) built the puzzle trainer, blindfold mode and the engine pipeline.</p>
      </section>
    </MarketingShell>
  );
}
