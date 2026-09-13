// Legal — /terms and /privacy. Plain-language, one component.
import { Link } from "react-router-dom";
import MarketingShell, { Accent, Eyebrow, useMarketingTitle, M } from "./MarketingShell";
import { LEGAL_UPDATED, PRIVACY, TERMS } from "./content";

export default function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const isTerms = kind === "terms";
  useMarketingTitle(isTerms ? "ChessGuru terms of service" : "ChessGuru privacy policy");
  const sections = isTerms ? TERMS : PRIVACY;
  return (
    <MarketingShell>
      <article className="max-w-3xl mx-auto px-6 pt-14 pb-20 md:pt-20">
        <Eyebrow>{isTerms ? "Terms of service" : "Privacy policy"}</Eyebrow>
        <h1 className="font-black tracking-tight leading-[1.05] mt-5" style={{ fontSize: "clamp(32px, 4.8vw, 54px)" }}>{isTerms ? <>Terms, in <Accent>plain words</Accent></> : <>Your data, <Accent>your academy's</Accent></>}</h1>
        <p className="mt-3 text-sm" style={{ color: M.ink3 }}>Last updated {LEGAL_UPDATED}. {isTerms ? <Link to="/privacy" className="underline">Privacy policy</Link> : <Link to="/terms" className="underline">Terms of service</Link>} · <Link to="/contact" className="underline">Contact</Link></p>
        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-xl font-black">{s.h}</h2>
              {s.p.map((p, i) => <p key={i} className="mt-2 text-[15px] leading-relaxed" style={{ color: M.ink2 }}>{p}</p>)}
            </section>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
