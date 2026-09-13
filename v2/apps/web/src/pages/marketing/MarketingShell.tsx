// MarketingShell — shared chrome for the academy marketing pages
// (/signup-academy, /for-*, /why-chessguru, /compare, /features/*).
//
// Owner 2026-09-13: "read chessplay.io, need academy signup pages like that".
// ChessPlay's site is a warm cream + orange multi-page marketing set: top strip,
// sticky nav with a Features menu, big headline with one orange word, product
// card, logo strip, tabbed platform tour, audience pages, why + compare pages,
// FAQ, CTA banner, three-column footer. This shell gives every page that frame.
// Difference we keep on purpose: ChessPlay is demo-led ("Request a demo");
// ChessGuru is self-serve — every CTA lands on the 30-day trial form.

import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CATEGORY_META, type FeatureCategory } from "../../lib/features";
import { WHATSAPP_DISPLAY, WHATSAPP_URL, TRIAL_HREF } from "./data";

// ── Palette (ChessPlay-like warm light theme) ─────────────────────────────
export const M = {
  bg: "#fff7ed",        // cream
  bg2: "#ffedd5",       // peach
  card: "#ffffff",
  ink: "#1c1917",
  ink2: "#57534e",
  ink3: "#78716c",
  line: "rgba(28,25,23,0.10)",
  orange: "#f97316",
  orange2: "#ea580c",
  orangeSoft: "rgba(249,115,22,0.12)",
  green: "#25D366",
};
export const CTA_STYLE: React.CSSProperties = { background: `linear-gradient(135deg, ${M.orange}, ${M.orange2})`, color: "#fff", boxShadow: "0 10px 24px rgba(249,115,22,0.30)" };

export function useMarketingTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
}

// ── Small building blocks ─────────────────────────────────────────────────
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-bold tracking-widest uppercase" style={{ background: M.orangeSoft, color: M.orange2 }}>
      {children}
    </div>
  );
}
export function Accent({ children }: { children: ReactNode }) {
  return <span style={{ color: M.orange }}>{children}</span>;
}
export function H2({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="text-center max-w-3xl mx-auto mb-12">
      <h2 className="font-black tracking-tight leading-[1.05]" style={{ fontSize: "clamp(30px, 4.6vw, 52px)" }}>{children}</h2>
      {sub && <p className="mt-4 text-base md:text-lg" style={{ color: M.ink2 }}>{sub}</p>}
    </div>
  );
}
export function Section({ children, id, tone = "plain", className = "" }: { children: ReactNode; id?: string; tone?: "plain" | "peach" | "white"; className?: string }) {
  const bg = tone === "peach" ? M.bg2 : tone === "white" ? M.card : "transparent";
  return (
    <section id={id} style={{ background: bg }} className={`py-20 md:py-24 ${className}`}>
      <div className="max-w-6xl mx-auto px-6">{children}</div>
    </section>
  );
}
export function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rounded-3xl border p-6 md:p-7 ${className}`} style={{ background: M.card, borderColor: M.line, boxShadow: "0 12px 40px rgba(124,45,18,0.06)", ...style }}>
      {children}
    </div>
  );
}
export function PrimaryCTA({ children = "Start my 30-day free trial →", href = TRIAL_HREF, className = "" }: { children?: ReactNode; href?: string; className?: string }) {
  return (
    <Link to={href} className={`inline-flex items-center justify-center rounded-full px-7 py-3.5 font-bold text-base hover:brightness-105 transition ${className}`} style={CTA_STYLE}>
      {children}
    </Link>
  );
}
export function SecondaryCTA({ children, href, className = "" }: { children: ReactNode; href: string; className?: string }) {
  const ext = href.startsWith("http");
  const cls = `inline-flex items-center justify-center rounded-full px-7 py-3.5 font-bold text-base border hover:bg-white transition ${className}`;
  const st = { borderColor: "rgba(28,25,23,0.18)", color: M.ink };
  return ext ? <a href={href} target="_blank" rel="noreferrer" className={cls} style={st}>{children}</a> : <Link to={href} className={cls} style={st}>{children}</Link>;
}
export function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
export function WhatsAppCTA({ text = "Book a WhatsApp demo", msg = "Hi Ranjith, I'd like a ChessGuru demo for my academy.", className = "" }: { text?: string; msg?: string; className?: string }) {
  return (
    <a href={WHATSAPP_URL(msg)} target="_blank" rel="noreferrer" className={`inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 font-bold text-base text-white hover:brightness-105 transition ${className}`} style={{ background: M.green }}>
      <WhatsAppIcon /> {text}
    </a>
  );
}
export function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex-none w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ background: M.orange }}>✓</span>
      <span className="text-[15px] leading-relaxed" style={{ color: M.ink2 }}>{children}</span>
    </li>
  );
}

// ── CTA banner (bottom of every page) ────────────────────────────────────
export function CTABanner({ title = <>Ready to run your academy <Accent>smarter</Accent>?</>, body = "Start the 30-day free trial in two minutes. No card, no demo call required — though we're one WhatsApp away if you want one." }: { title?: ReactNode; body?: string }) {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-[32px] px-6 py-14 md:px-16 md:py-20 text-center" style={{ background: `linear-gradient(135deg, ${M.bg2}, #fed7aa)` }}>
        <span className="absolute -left-4 -bottom-6 text-[140px] leading-none select-none opacity-[0.12]">♞</span>
        <span className="absolute -right-2 -top-8 text-[140px] leading-none select-none opacity-[0.12]">♛</span>
        <Eyebrow>Get started today</Eyebrow>
        <h2 className="font-black tracking-tight leading-[1.05] mt-4" style={{ fontSize: "clamp(30px, 4.6vw, 52px)" }}>{title}</h2>
        <p className="mt-4 max-w-2xl mx-auto text-base md:text-lg" style={{ color: M.ink2 }}>{body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PrimaryCTA />
          <WhatsAppCTA />
        </div>
      </div>
    </Section>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────
const NAV_FEATURES: FeatureCategory[] = ["classes", "academy", "puzzles", "study", "play", "analytics", "notifications", "engagement"];
const NAV_LINKS = [
  { to: "/signup-academy", label: "Home" },
  { to: "/why-chessguru", label: "Why ChessGuru" },
  { to: "/compare", label: "Compare" },
  { to: "/signup-academy#pricing", label: "Pricing" },
];

function Nav() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [feat, setFeat] = useState(false);
  useEffect(() => { setOpen(false); setFeat(false); }, [loc.pathname]);
  const active = (to: string) => loc.pathname === to.split("#")[0];
  return (
    <header className="sticky top-0 z-50">
      {/* top strip */}
      <div className="text-center text-[13px] font-semibold text-white py-2 px-4" style={{ background: M.orange }}>
        <span className="opacity-90">🗓 Want a walkthrough first?</span>{" "}
        <a href={WHATSAPP_URL("Hi Ranjith, can we book a ChessGuru walkthrough for my academy?")} target="_blank" rel="noreferrer" className="underline underline-offset-2">Book a WhatsApp demo</a> →
      </div>
      <nav className="border-b backdrop-blur-md" style={{ background: "rgba(255,247,237,0.92)", borderColor: M.line }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/signup-academy" className="flex items-center gap-2 font-black text-xl tracking-tight">
            <span style={{ color: M.orange }}>♟</span> ChessGuru
            <span className="hidden sm:inline text-[10px] font-bold tracking-widest uppercase rounded-full px-2 py-0.5 ml-1" style={{ background: M.orangeSoft, color: M.orange2 }}>for academies</span>
          </Link>
          <div className="hidden lg:flex items-center gap-7 text-[15px] font-semibold" style={{ color: M.ink2 }}>
            <Link to="/signup-academy" className="hover:text-black" style={active("/signup-academy") ? { color: M.orange2 } : {}}>Home</Link>
            <div className="relative" onMouseEnter={() => setFeat(true)} onMouseLeave={() => setFeat(false)}>
              <button className="hover:text-black flex items-center gap-1" style={loc.pathname.startsWith("/features/") ? { color: M.orange2 } : {}} onClick={() => setFeat((v) => !v)}>Features <span className="text-xs">▾</span></button>
              {feat && (
                <div className="absolute left-0 top-full pt-3">
                  <div className="w-72 rounded-2xl border p-2 shadow-2xl" style={{ background: M.card, borderColor: M.line }}>
                    {NAV_FEATURES.map((c) => (
                      <Link key={c} to={`/features/${c}`} className="block rounded-xl px-3 py-2 hover:bg-orange-50">
                        <div className="text-sm font-bold" style={{ color: M.ink }}>{CATEGORY_META[c].label}</div>
                        <div className="text-xs" style={{ color: M.ink3 }}>{CATEGORY_META[c].blurb}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {NAV_LINKS.slice(1).map((l) => (
              <Link key={l.to} to={l.to} className="hover:text-black" style={active(l.to) && !l.to.includes("#") ? { color: M.orange2 } : {}}>{l.label}</Link>
            ))}
            <Link to="/login" className="hover:text-black">Sign in</Link>
            <Link to={TRIAL_HREF} className="rounded-full px-5 py-2.5 font-bold text-sm" style={CTA_STYLE}>Start free trial</Link>
          </div>
          <button className="lg:hidden rounded-full px-4 py-2 text-sm font-bold" style={CTA_STYLE} onClick={() => setOpen((v) => !v)} aria-label="Menu">{open ? "Close" : "Menu"}</button>
        </div>
        {open && (
          <div className="lg:hidden border-t px-6 py-4 space-y-1 text-[15px] font-semibold" style={{ borderColor: M.line, background: M.bg }}>
            {NAV_LINKS.map((l) => <Link key={l.to} to={l.to} className="block py-2">{l.label}</Link>)}
            <div className="pt-2 text-[11px] font-bold tracking-widest uppercase" style={{ color: M.ink3 }}>Features</div>
            {NAV_FEATURES.map((c) => <Link key={c} to={`/features/${c}`} className="block py-1.5 pl-3" style={{ color: M.ink2 }}>{CATEGORY_META[c].label}</Link>)}
            <Link to="/login" className="block py-2">Sign in</Link>
            <Link to={TRIAL_HREF} className="block text-center rounded-full px-5 py-3 font-bold mt-2" style={CTA_STYLE}>Start my 30-day free trial →</Link>
          </div>
        )}
      </nav>
    </header>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────
function Footer() {
  const cols: Array<{ h: string; links: Array<{ to: string; label: string; ext?: boolean }> }> = [
    { h: "Features", links: NAV_FEATURES.slice(0, 6).map((c) => ({ to: `/features/${c}`, label: CATEGORY_META[c].label })) },
    { h: "Built for", links: [{ to: "/for-academies", label: "Chess academies" }, { to: "/for-coaches", label: "Chess coaches" }, { to: "/for-schools", label: "Schools & clubs" }, { to: "/why-chessguru", label: "Why ChessGuru" }, { to: "/compare", label: "Compare" }] },
    { h: "Company", links: [{ to: "/signup-academy#pricing", label: "Pricing" }, { to: "/signup-academy#faq", label: "FAQ" }, { to: "/help", label: "Help" }, { to: "/terms", label: "Terms" }, { to: "/privacy", label: "Privacy" }, { to: "/login", label: "Sign in" }] },
  ];
  return (
    <footer className="border-t" style={{ borderColor: M.line, background: M.bg2 }}>
      <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
        <div>
          <div className="flex items-center gap-2 font-black text-xl"><span style={{ color: M.orange }}>♟</span> ChessGuru</div>
          <p className="mt-3 text-sm leading-relaxed max-w-xs" style={{ color: M.ink2 }}>
            Chess academy software for coaches and academies: live classes, puzzles, homework, fees, attendance, parent reports and scoresheet scanning, in one place.
          </p>
          <a href={WHATSAPP_URL("Hi Ranjith, I'm interested in ChessGuru for my academy.")} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-bold" style={{ color: "#128C7E" }}>
            <WhatsAppIcon size={16} /> WhatsApp {WHATSAPP_DISPLAY}
          </a>
          <div className="mt-1 text-sm" style={{ color: M.ink3 }}><a href="mailto:hello@chessguru.cc" className="hover:underline">hello@chessguru.cc</a></div>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <div className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: M.ink3 }}>{c.h}</div>
            <ul className="space-y-2 text-sm font-semibold" style={{ color: M.ink2 }}>
              {c.links.map((l) => <li key={l.to}><Link to={l.to} className="hover:text-black">{l.label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t text-center text-xs py-5" style={{ borderColor: M.line, color: M.ink3 }}>© {new Date().getFullYear()} ChessGuru · chessguru.cc · Made in India</div>
    </footer>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────
export default function MarketingShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  // hash → scroll (react-router doesn't do it for us on in-app navigation)
  useEffect(() => {
    if (loc.hash) {
      const el = document.getElementById(loc.hash.slice(1));
      if (el) { setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60); return; }
    }
    window.scrollTo({ top: 0 });
  }, [loc.pathname, loc.hash]);
  return (
    <div className="antialiased" style={{ background: M.bg, color: M.ink, minHeight: "100vh", overflowX: "hidden" }}>
      <Nav />
      {children}
      <CTABanner />
      <Footer />
      <a href={WHATSAPP_URL("Hi Ranjith, I'm interested in ChessGuru for my academy.")} target="_blank" rel="noreferrer"
         aria-label={`Chat on WhatsApp ${WHATSAPP_DISPLAY}`} title={`Chat on WhatsApp · ${WHATSAPP_DISPLAY}`}
         className="fixed bottom-5 left-5 z-50 flex items-center justify-center w-14 h-14 rounded-full text-white shadow-2xl hover:scale-105 transition" style={{ background: M.green }}>
        <WhatsAppIcon size={26} />
      </a>
    </div>
  );
}
