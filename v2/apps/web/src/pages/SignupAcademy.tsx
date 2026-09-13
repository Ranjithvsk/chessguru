"use client";
// SignupAcademy — warm painterly landing for /signup-academy. Standalone page
// (routed OUTSIDE the App shell) so no shared navbar / theme toggle / "you're
// not signed in" banner appears on top.
//
// Sections: Nav → Hero → Live-proof → How-it-works (3 persona tabs) →
// Feature Explorer (6 category tiles) → Screenshots → Testimonials → Pricing →
// FAQ → Signup form (fullName + mobile + mobileConsent) → Footer.
//
// Images live in /marketing/*.webp — generated via Gemini 3.1-flash-image, warm
// painterly style, jewel-tone palette. Previous plain form kept at
// SignupAcademyLegacy.tsx for reference; not routed.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FEATURES, type FeatureCategory } from "../lib/features";
import { get } from "../lib/api";

// ── Palette / helpers ──────────────────────────────────────────────────────
const BG = "#0a0f1c";
const INK = "#f4f4f5";

// Category tile art + color pairs (subset — 6 of the 8 categories get big tiles;
// notifications + engagement fold into "Academy" and "Engagement" tiles below).
const TILES: Array<{
  id: FeatureCategory | "engagement-plus"; label: string; blurb: string;
  img: string; grad: string; accent: string;
}> = [
  { id: "puzzles",  label: "Puzzles",           blurb: "Rated tactics that adapt to every student.",       img: "/marketing/cat-puzzles.webp",   grad: "from-amber-500/40 to-fuchsia-600/20",     accent: "amber-400" },
  { id: "study",    label: "Study",             blurb: "Openings, endgames, memory palace.",               img: "/marketing/cat-study.webp",     grad: "from-emerald-500/40 to-teal-600/20",      accent: "emerald-400" },
  { id: "play",     label: "Play",              blurb: "Games, engines, board sandbox.",                   img: "/marketing/cat-play.webp",      grad: "from-sky-500/40 to-cyan-600/20",          accent: "sky-400" },
  { id: "classes",  label: "Live classes",      blurb: "Video coaching + shared board — Dream Meet built in.",  img: "/marketing/cat-live.webp",      grad: "from-rose-500/40 to-pink-600/20",         accent: "rose-400" },
  { id: "academy",  label: "Academy management",blurb: "Coaches, students, invites, fees, attendance.",    img: "/marketing/cat-academy.webp",   grad: "from-amber-600/40 to-orange-600/20",      accent: "orange-400" },
  { id: "analytics",label: "Analytics",         blurb: "Ratings, streaks, per-theme strengths, exports.",  img: "/marketing/cat-analytics.webp", grad: "from-fuchsia-500/40 to-violet-600/20",    accent: "fuchsia-400" },
];

// How-it-works tabs
const PERSONAS = [
  { key: "owner",   label: "For Owners",   img: "/marketing/persona-owner.webp",
    bullets: [
      "Onboard students in seconds — invite links, bulk import, self-signup.",
      "Fees + invoices baked in — track paid / due / waived across the whole roster.",
      "Attendance, coach roster, class calendar — the running of the academy, one dashboard.",
    ] },
  { key: "coach",   label: "For Coaches",  img: "/marketing/persona-coach.webp",
    bullets: [
      "Live classes on your own board — Dream Meet built in, no separate meeting link.",
      "Assign puzzles by theme + difficulty — students get them the moment class ends.",
      "Snap a position from a printed book with your phone → it opens on your board.",
    ] },
  { key: "student", label: "For Students", img: "/marketing/persona-student.webp",
    bullets: [
      "Daily puzzle + streak — the same challenge everyone else is solving today.",
      "Blindfold mode with its own rating — a separate belt to earn.",
      "Play, study, or drill openings — one login, three years of learning ahead.",
    ] },
];

// Owner 2026-09-13: "50 students ₹1000/month, 100 students ₹1500, ₹500 per additional 50, unlimited coaches,
// more than 500 students → quotation". WhatsApp 8248353593 on the page.
const WHATSAPP_NUMBER = "918248353593";
const WHATSAPP_DISPLAY = "+91 82483 53593";
const WHATSAPP_URL = (text: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
/** Monthly price for an academy of n students (null = quotation). */
function priceFor(n: number): number { return n <= 50 ? 1000 : n <= 100 ? 1500 : 1500 + Math.ceil((n - 100) / 50) * 500; }
const PRICING: Array<{ name: string; price: number | null; students: string; note: string; bullets: string[]; highlight?: boolean }> = [
  { name: "Starter", price: 1000, students: "Up to 50 students", note: "For a single-branch academy or a coach with a full roster.",
    bullets: ["Unlimited coaches", "Every feature — live classes, puzzles, fees, attendance", "30 days free, no card"] },
  { name: "Academy", price: 1500, students: "Up to 100 students", note: "Then ₹500 / month for every additional 50 students.", highlight: true,
    bullets: ["Unlimited coaches", "Every feature, every branch", "Grows with you: 150 students ₹2,000 · 200 students ₹2,500", "30 days free, no card"] },
  { name: "Large academy", price: null, students: "More than 500 students", note: "Multi-branch groups and federations — we quote per academy.",
    bullets: ["Unlimited coaches and branches", "Every feature, priority support", "Onboarding help and data migration"] },
];
function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

const FAQ = [
  { q: "Is my card required for the free trial?",
    a: "No. You get 30 days completely free — no card, no risk. After that it's ₹1,000/month for up to 50 students or ₹1,500/month for up to 100, with every feature and unlimited coaches." },
  { q: "How many students and coaches can I add?",
    a: "Coaches are unlimited on every plan. Students set the price: up to 50 for ₹1,000/month, up to 100 for ₹1,500/month, then ₹500/month for every additional 50. Academies with more than 500 students get a custom quotation — WhatsApp +91 82483 53593." },
  { q: "Can we run live classes on ChessGuru?",
    a: "Yes — Dream Meet video is built in, no separate meeting link. The shared chess board syncs live to every student's screen." },
  { q: "Where is the data stored?",
    a: "On our own servers in France + India — never sold, never used to train AI. Full export is one click away, anytime." },
  { q: "What happens after the 30-day trial?",
    a: "You stay on your data. You get an email a week before the trial ends. Add a payment method or pause — no auto-charge without your consent." },
  { q: "Can I cancel any time?",
    a: "Yes. One click. Export your data before you go — we keep nothing." },
];

// Simple count-up animation for the stats strip
function useCountUp(target: number, ms = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!target) { setN(0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function SignupAcademyPage() {
  const nav = useNavigate();

  // Live-proof strip data
  const [stats, setStats] = useState<{ academies: number; students: number; coaches: number; puzzlesSolvedWeek: number } | null>(null);
  useEffect(() => {
    get<any>("/api/public/stats").then(setStats).catch(() => setStats(null));
  }, []);
  const nAcademies = useCountUp(stats?.academies ?? 0);
  const nCoaches   = useCountUp(stats?.coaches   ?? 0);
  const nPuzzles   = useCountUp(stats?.puzzlesSolvedWeek ?? 0);

  // How-it-works tab state
  const [persona, setPersona] = useState<"owner" | "coach" | "student">("owner");

  // Feature explorer expansion state
  const [openTile, setOpenTile] = useState<FeatureCategory | null>(null);

  // FAQ accordion
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Signup form state
  const [f, setF] = useState({ academyName: "", fullName: "", ownerEmail: "", ownerMobile: "", password: "", mobileConsent: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      // BASE prefix (import.meta.env.VITE_API_BASE) is baked into api.ts helpers,
      // so use them so we don't reinvent the /v2api gateway path. post<T> lives in api.ts.
      const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
      const res = await fetch(`${BASE}/auth/signup-academy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(f),
      });
      const j = await res.json();
      if (j?.ok) {
        setMsg({ ok: true, text: "Trial started — taking you to your dashboard…" });
        setTimeout(() => nav("/academy"), 800);
      } else {
        setMsg({ ok: false, text: j?.error || "Signup failed — try again in a moment." });
      }
    } catch (err) {
      setMsg({ ok: false, text: "Network hiccup — check your connection and retry." });
    } finally { setBusy(false); }
  }

  // Sticky nav backdrop after scrolling past hero
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Page title — the shell defaults to "ChessGuru — Puzzle Trainer" which is
  // wrong for a marketing landing. Restore on unmount so back-nav to the app
  // doesn't leave the wrong title behind.
  useEffect(() => {
    const prev = document.title;
    document.title = "ChessGuru for Chess Academies — 30-day free trial";
    return () => { document.title = prev; };
  }, []);

  const featuresByCat = useMemo(() => {
    const map = new Map<FeatureCategory, typeof FEATURES>();
    for (const feat of FEATURES) {
      if (!map.has(feat.category)) map.set(feat.category, []);
      map.get(feat.category)!.push(feat);
    }
    return map;
  }, []);

  return (
    <div style={{ background: BG, color: INK, minHeight: "100vh", overflowX: "hidden" }} className="antialiased selection:bg-amber-400/30">
      <style>{`
        @keyframes cg-blob1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(4vw,-3vh) scale(1.05); } }
        @keyframes cg-blob2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-3vw,4vh) scale(1.08); } }
        @keyframes cg-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes cg-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
        .cg-hero-blob { filter: blur(80px); animation: cg-blob1 22s ease-in-out infinite; }
        .cg-hero-blob-2 { filter: blur(90px); animation: cg-blob2 26s ease-in-out infinite; }
        .cg-float { animation: cg-float 4s ease-in-out infinite; }
      `}</style>

      {/* ── Sticky nav ────────────────────────────────────────────────────── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all ${scrolled ? "backdrop-blur-md bg-black/40 border-b border-white/10" : ""}`}
        style={{ padding: "14px 24px" }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <a href="/signup-academy-v2" className="flex items-center gap-2 font-bold text-lg">
            <span style={{ color: "#fbbf24" }}>♟</span>
            <span>ChessGuru</span>
            <span className="hidden sm:inline text-xs font-normal opacity-60 border border-white/20 rounded-full px-2 py-0.5 ml-1">for Academies</span>
          </a>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <a href="#features" className="opacity-80 hover:opacity-100">Features</a>
            <a href="#pricing" className="opacity-80 hover:opacity-100">Pricing</a>
            <a href="#faq" className="opacity-80 hover:opacity-100">FAQ</a>
            <a href="/login" className="opacity-80 hover:opacity-100">Sign in</a>
            <button onClick={scrollToForm} className="rounded-full px-4 py-2 font-semibold text-black shadow-lg shadow-amber-500/25" style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}>
              Start free trial →
            </button>
          </div>
          <button onClick={scrollToForm} className="md:hidden rounded-full px-3 py-1.5 text-sm font-semibold text-black" style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}>
            Try free
          </button>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ paddingTop: "104px", paddingBottom: "64px" }}>
        {/* Aurora blobs */}
        <div className="absolute -top-20 -left-20 w-[600px] h-[600px] rounded-full opacity-40 cg-hero-blob" style={{ background: "radial-gradient(circle, #a855f7 0%, transparent 65%)" }} />
        <div className="absolute top-40 -right-40 w-[700px] h-[700px] rounded-full opacity-30 cg-hero-blob-2" style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 65%)" }} />

        <div className="relative max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-6 text-xs font-medium border border-amber-400/30" style={{ background: "rgba(251, 191, 36, 0.08)", color: "#fbbf24" }}>
              <span>✨</span> 30 days free · No card required · from ₹1,000/month after
            </div>
            <h1 className="font-black tracking-tight leading-tight mb-6" style={{ fontSize: "clamp(38px, 6vw, 68px)" }}>
              Run your chess academy like a{" "}
              <span style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f472b6 60%, #a855f7 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                champion
              </span>.
            </h1>
            <p className="text-lg md:text-xl opacity-80 mb-8 max-w-xl">
              Coaching, live classes, puzzles, fees, attendance — one platform your students already love using. Built by chess players, priced for real academies.
            </p>
            <div className="flex flex-wrap gap-3 mb-8">
              <button onClick={scrollToForm} className="rounded-full px-6 py-3 font-semibold text-black shadow-xl shadow-amber-500/30 text-base" style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}>
                Start my 30-day trial →
              </button>
              <a href="#features" className="rounded-full px-6 py-3 font-semibold border border-white/20 hover:bg-white/5 transition text-base">
                Explore features
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-6 text-xs opacity-70">
              <span>✓ Unlimited coaches</span>
              <span>✓ Every feature on every plan</span>
              <span>✓ Cancel anytime</span>
            </div>
          </div>

          <div id="signup" ref={formRef} className="relative lg:max-w-xl lg:ml-auto w-full">
    <div className="relative rounded-3xl p-8 md:p-10 border border-white/10 shadow-2xl" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.4))" }}>
              <div className="absolute -top-3 -right-3 rounded-full w-16 h-16 flex items-center justify-center text-2xl font-black text-black shadow-lg" style={{ background: "linear-gradient(135deg, #fbbf24, #f59e0b)" }}>
                30d
              </div>
              <h2 className="text-2xl md:text-3xl font-black mb-2">Start your free trial</h2>
              <p className="text-sm opacity-70 mb-6">30 days on us. No card. Full access.</p>

              <form onSubmit={submit} className="space-y-4">
                <Input label="Academy name" value={f.academyName} onChange={(v) => setF({ ...f, academyName: v })} placeholder="Stephens Chess Academy" required />
                <Input label="Your name" value={f.fullName} onChange={(v) => setF({ ...f, fullName: v })} placeholder="Ranjith VS" required />
                <Input label="Email address" type="email" value={f.ownerEmail} onChange={(v) => setF({ ...f, ownerEmail: v })} placeholder="you@school.com" required />
                <Input
                  label="Mobile number"
                  type="tel"
                  required
                  value={f.ownerMobile}
                  onChange={(v) => setF({ ...f, ownerMobile: v })}
                  placeholder="+91 98765 43210"
                  help="Required — so we can reach you about your academy. Never shown to students."
                />
                {f.ownerMobile && (
                  <label className="flex items-start gap-2 text-xs opacity-80 cursor-pointer">
                    <input type="checkbox" checked={f.mobileConsent} onChange={(e) => setF({ ...f, mobileConsent: e.target.checked })} className="mt-0.5 accent-amber-400" />
                    <span>Yes — send me WhatsApp updates about my trial (no spam, cancel any time)</span>
                  </label>
                )}
                <Input label="Choose a password" type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} placeholder="At least 6 characters" required />

                {msg && (
                  <div className={`text-sm px-4 py-3 rounded-xl border ${msg.ok ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : "border-rose-400/40 bg-rose-500/10 text-rose-300"}`}>
                    {msg.text}
                  </div>
                )}

                <button
                  type="submit" disabled={busy}
                  className="w-full rounded-full py-3.5 font-bold text-black shadow-xl shadow-amber-500/30 text-base disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}
                >
                  {busy ? "Starting your trial…" : "Start my 30-day trial →"}
                </button>

                <p className="text-xs opacity-60 text-center pt-2">
                  Already have an account?{" "}
                  <a href="/login" className="underline underline-offset-2 hover:opacity-100">Sign in</a>
                </p>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live proof strip ─────────────────────────────────────────────── */}
      <section className="border-y border-white/10" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { n: nAcademies, l: "Academies growing on ChessGuru", accent: "#fbbf24" },
            { n: nCoaches, l: "Coaches teaching", accent: "#2dd4bf" },
            { n: nPuzzles.toLocaleString("en-IN"), l: "Puzzles solved this week", accent: "#f472b6" },
            { n: "24 / 7", l: "Live board · anywhere", accent: "#a855f7" },
          ].map((s, i) => (
            <div key={i} className="text-center md:text-left">
              <div className="text-3xl md:text-4xl font-black" style={{ color: s.accent }}>{s.n}</div>
              <div className="text-xs opacity-70 mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works (persona tabs) ──────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-12">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#2dd4bf" }}>How it works</div>
          <h2 className="text-3xl md:text-5xl font-black mt-3">One platform. Three views.</h2>
          <p className="opacity-70 mt-3 max-w-2xl mx-auto">Owners see the roster. Coaches see the class. Students see the game. All the same data, all in real time.</p>
        </div>

        <div className="flex justify-center gap-2 mb-10 flex-wrap">
          {PERSONAS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPersona(p.key as any)}
              className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${persona === p.key ? "text-black shadow-lg" : "border border-white/20 hover:bg-white/5"}`}
              style={persona === p.key ? { background: "linear-gradient(135deg, #fbbf24, #f472b6)" } : {}}
            >
              {p.label}
            </button>
          ))}
        </div>

        {PERSONAS.map((p) => persona === p.key && (
          <div key={p.key} className="grid lg:grid-cols-2 gap-10 items-center">
            <div className="order-2 lg:order-1">
              <ul className="space-y-4">
                {p.bullets.map((b, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1 flex-none w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-black" style={{ background: "linear-gradient(135deg, #fbbf24, #f59e0b)" }}>✓</span>
                    <span className="text-base md:text-lg opacity-90">{b}</span>
                  </li>
                ))}
              </ul>
              <button onClick={scrollToForm} className="mt-8 rounded-full px-5 py-2.5 text-sm font-semibold border border-white/20 hover:bg-white/5">
                Try {p.label.toLowerCase().replace("for ", "").replace("s", "'s")} view →
              </button>
            </div>
            <div className="order-1 lg:order-2 relative">
              <div className="absolute inset-0 rounded-2xl blur-2xl opacity-30" style={{ background: "linear-gradient(135deg, #a855f7, #f472b6)" }} />
              <img src={p.img} alt="" className="relative rounded-2xl shadow-xl w-full" loading="lazy" />
            </div>
          </div>
        ))}
      </section>

      {/* ── Feature explorer (6 category tiles) ──────────────────────────── */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-12">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#f472b6" }}>Everything included</div>
          <h2 className="text-3xl md:text-5xl font-black mt-3">{FEATURES.length}+ features. Every plan.</h2>
          <p className="opacity-70 mt-3 max-w-2xl mx-auto">Click any tile to unfold what's inside.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {TILES.map((t) => {
            const items = featuresByCat.get(t.id as FeatureCategory) || [];
            const isOpen = openTile === t.id;
            return (
              <button
                key={t.id as string}
                onClick={() => setOpenTile(isOpen ? null : t.id as FeatureCategory)}
                className={`group text-left rounded-3xl overflow-hidden relative border border-white/10 hover:border-white/25 transition ${isOpen ? "lg:col-span-3 md:col-span-2" : ""}`}
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div className={`relative ${isOpen ? "aspect-[21/6]" : "aspect-[16/10]"} overflow-hidden`}>
                  <img src={t.img} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                  <div className={`absolute inset-0 bg-gradient-to-br ${t.grad}`} />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(10,15,28,0.9) 0%, transparent 55%)" }} />
                  <div className="absolute bottom-4 left-5 right-5">
                    <div className="text-2xl md:text-3xl font-black">{t.label}</div>
                    <div className="text-sm opacity-80 mt-1">{t.blurb}</div>
                  </div>
                  <div className="absolute top-4 right-4 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}>
                    {items.length} {items.length === 1 ? "feature" : "features"} {isOpen ? "▲" : "▼"}
                  </div>
                </div>
                {isOpen && (
                  <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((it) => (
                      <div key={it.id} className="rounded-xl border border-white/10 p-4 hover:border-white/25 transition" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{it.emoji}</span>
                          <span className="font-semibold">{it.title}</span>
                          {it.badge && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded ml-auto" style={{ background: "#fbbf24", color: "#0a0f1c" }}>{it.badge}</span>}
                        </div>
                        <div className="text-xs opacity-70 leading-relaxed">{it.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Screenshots strip ────────────────────────────────────────────── */}
      <section className="border-y border-white/10" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="text-center mb-10">
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#a855f7" }}>Product tour</div>
            <h2 className="text-3xl md:text-5xl font-black mt-3">Real screens, from the real app.</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { src: "/feature-shots/puzzle-trainer.png", label: "Rated puzzle trainer" },
              { src: "/feature-shots/puzzle-of-the-day.png", label: "Puzzle of the day" },
              { src: "/feature-shots/blindfold.png", label: "Blindfold mode" },
              { src: "/feature-shots/engine-battle.png", label: "Engine battle" },
              { src: "/feature-shots/pass-and-play.png", label: "Pass & play" },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl overflow-hidden border border-white/10 hover:border-amber-400/40 transition" style={{ background: "rgba(0,0,0,0.4)" }}>
                {/* Screenshots are 1200×800 (3:2). object-contain shows the FULL
                    frame; a soft padded backdrop keeps the grid tidy. */}
                <div className="aspect-[3/2] flex items-center justify-center p-3" style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.06), rgba(168,85,247,0.06))" }}>
                  <img src={s.src} alt={s.label} className="max-w-full max-h-full object-contain rounded-lg" loading="lazy"
                       onError={(e) => { const card = e.currentTarget.parentElement?.parentElement as HTMLElement | null; if (card) card.style.display = "none"; }} />
                </div>
                <div className="p-3 text-sm font-semibold">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials (clearly-placeholder) ───────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-12">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#fbbf24" }}>What our early academies say</div>
          <h2 className="text-3xl md:text-5xl font-black mt-3">Real quotes coming soon.</h2>
          <p className="opacity-70 mt-3 max-w-2xl mx-auto text-sm">
            Placeholder previews below — we're collecting real testimonials from our first academies.
            <br />Yours can be here next.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { avatar: "/marketing/avatar-1.webp", quote: "Setting up our roster took an evening. Fees, attendance, live board — everything just worked.", name: "Coming soon", meta: "Academy owner · Chennai" },
            { avatar: "/marketing/avatar-2.webp", quote: "My students actually WANT to open the daily puzzle now. That never happened with our old tool.", name: "Coming soon", meta: "Head coach · Bangalore" },
            { avatar: "/marketing/avatar-3.webp", quote: "Went from three apps to one. The trial gave me time to migrate at my own pace.", name: "Coming soon", meta: "Director · Pune" },
          ].map((t, i) => (
            <div key={i} className="relative rounded-2xl p-6 border border-white/10" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))" }}>
              <div className="absolute -top-3 left-6 text-4xl opacity-30" style={{ color: "#fbbf24" }}>"</div>
              <p className="text-sm opacity-90 leading-relaxed mb-5">{t.quote}</p>
              <div className="flex items-center gap-3">
                <img src={t.avatar} alt="" className="w-11 h-11 rounded-full object-cover border border-white/20" loading="lazy" />
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs opacity-60">{t.meta}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#2dd4bf" }}>Simple pricing</div>
          <h2 className="text-3xl md:text-5xl font-black mt-3">Priced by students. Coaches are free.</h2>
          <p className="text-sm opacity-70 mt-3 max-w-2xl mx-auto">Every plan has every feature and unlimited coaches. You only pay for the size of your academy — and the first 30 days are free on all of them.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {PRICING.map((t) => (
            <div key={t.name} className={`relative rounded-3xl p-7 border shadow-2xl ${t.highlight ? "border-amber-400/50 shadow-amber-500/10" : "border-white/10 shadow-black/30"}`}
                 style={{ background: t.highlight ? "linear-gradient(180deg, rgba(251,191,36,0.07), rgba(0,0,0,0.4))" : "rgba(255,255,255,0.03)" }}>
              {t.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-xs font-bold text-black whitespace-nowrap" style={{ background: "linear-gradient(135deg, #fbbf24, #f59e0b)" }}>Most academies</div>
              )}
              <div className="text-xs font-semibold tracking-widest uppercase opacity-70">{t.name}</div>
              <div className="mt-3 text-4xl font-black">
                {t.price != null ? (
                  <>
                    <span style={{ background: "linear-gradient(135deg, #fbbf24, #f472b6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>₹{t.price.toLocaleString("en-IN")}</span>
                    <span className="text-base opacity-70 font-normal"> / month</span>
                  </>
                ) : (
                  <span style={{ background: "linear-gradient(135deg, #2dd4bf, #a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Quotation</span>
                )}
              </div>
              <div className="text-sm font-semibold mt-1">{t.students}</div>
              <div className="text-xs opacity-60 mt-1">{t.note}</div>
              <ul className="mt-5 space-y-2">
                {t.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm"><span className="text-emerald-400 font-bold">✓</span> {b}</li>
                ))}
              </ul>
              {t.price != null ? (
                <button onClick={scrollToForm} className="mt-6 w-full rounded-full py-3 font-bold text-black text-sm" style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}>
                  Start free — no card →
                </button>
              ) : (
                <a href={WHATSAPP_URL("Hi Ranjith, we are an academy with 500+ students — please send a ChessGuru quotation.")} target="_blank" rel="noreferrer"
                   className="mt-6 w-full rounded-full py-3 font-bold text-white text-sm flex items-center justify-center gap-2" style={{ background: "#25D366" }}>
                  <WhatsAppIcon /> Ask for a quotation
                </a>
              )}
            </div>
          ))}
        </div>
        {/* growth ladder: every extra 50 students is +₹500 */}
        <div className="mt-8 rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-3">Growing past 100 students? Add ₹500 for every extra 50.</div>
          <div className="flex flex-wrap gap-2">
            {[100, 150, 200, 250, 300, 400, 500].map((n) => (
              <div key={n} className="rounded-xl px-3 py-2 text-sm border border-white/10" style={{ background: "rgba(0,0,0,0.3)" }}>
                <span className="opacity-70">{n} students</span> <span className="font-bold">₹{priceFor(n).toLocaleString("en-IN")}</span><span className="opacity-50 text-xs">/mo</span>
              </div>
            ))}
            <div className="rounded-xl px-3 py-2 text-sm border border-teal-400/30" style={{ background: "rgba(45,212,191,0.06)" }}>
              <span className="opacity-70">500+ students</span> <span className="font-bold">custom quotation</span>
            </div>
          </div>
          <div className="text-xs opacity-60 mt-3">Coaches are unlimited on every plan. Prices in INR, billed monthly, cancel anytime. Questions? <a href={WHATSAPP_URL("Hi Ranjith, I have a question about ChessGuru pricing.")} target="_blank" rel="noreferrer" className="underline">WhatsApp {WHATSAPP_DISPLAY}</a>.</div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#c084fc" }}>Answers</div>
          <h2 className="text-3xl md:text-5xl font-black mt-3">Common questions</h2>
        </div>
        <div className="space-y-2">
          {FAQ.map((item, i) => (
            <div key={i} className="rounded-2xl border border-white/10 overflow-hidden">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-white/5">
                <span className="font-semibold text-sm md:text-base">{item.q}</span>
                <span className="opacity-60 text-xl">{openFaq === i ? "−" : "+"}</span>
              </button>
              {openFaq === i && <div className="px-5 pb-4 text-sm opacity-80 leading-relaxed">{item.a}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Image showcase + final CTA (form lives in the hero now — owner ask
          2026-09-10: "start your free trial signup in top itself") ────── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="relative">
          <div className="absolute inset-0 rounded-3xl blur-2xl opacity-40" style={{ background: "linear-gradient(135deg, #f59e0b, #a855f7)" }} />
          <img src="/marketing/hero.webp" alt="A student thinking through a chess position at their study desk"
               className="relative rounded-3xl shadow-2xl w-full h-auto" loading="lazy" />
        </div>
        <div className="mt-10 text-center">
          <h2 className="text-2xl md:text-3xl font-black mb-3">Ready when you are.</h2>
          <p className="text-sm opacity-70 mb-6">30 days on us. No card. Full access.</p>
          <button onClick={scrollToForm} className="rounded-full px-8 py-3.5 font-bold text-black shadow-xl shadow-amber-500/30 text-base" style={{ background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)" }}>
            Start my 30-day trial →
          </button>
        </div>
      </section>

      {/* ── WhatsApp (owner's number, always one tap away) ─────────────── */}
      <a href={WHATSAPP_URL("Hi Ranjith, I'm interested in ChessGuru for my academy.")} target="_blank" rel="noreferrer"
         aria-label={`Chat on WhatsApp ${WHATSAPP_DISPLAY}`} title={`Chat on WhatsApp · ${WHATSAPP_DISPLAY}`}
         className="fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-full pl-3 pr-4 py-3 font-bold text-white shadow-2xl shadow-black/40 hover:scale-105 transition"
         style={{ background: "#25D366" }}>
        <WhatsAppIcon size={22} /> <span className="text-sm">WhatsApp us</span>
      </a>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 mt-10">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-xs opacity-70">
          <div className="flex items-center gap-2 font-semibold">
            <span style={{ color: "#fbbf24" }}>♟</span> ChessGuru
            <span className="opacity-50">· Run your chess academy on ChessGuru</span>
          </div>
          <div className="flex gap-5">
            <a href="/help" className="hover:opacity-100">Help</a>
            <a href="/terms" className="hover:opacity-100">Terms</a>
            <a href="/privacy" className="hover:opacity-100">Privacy</a>
            <a href="mailto:hello@chessguru.cc" className="hover:opacity-100">Contact</a>
            <a href={WHATSAPP_URL("Hi Ranjith, I'm interested in ChessGuru for my academy.")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:opacity-100" style={{ color: "#25D366" }}>
              <WhatsAppIcon size={14} /> WhatsApp {WHATSAPP_DISPLAY}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Small stateless helpers ────────────────────────────────────────────────
function Input({ label, value, onChange, placeholder, type = "text", required = false, help }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; help?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold opacity-80 mb-1.5 block">{label}{required && <span style={{ color: "#f472b6" }}> *</span>}</span>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required}
        className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
      />
      {help && <span className="text-[11px] opacity-60 mt-1 block">{help}</span>}
    </label>
  );
}
