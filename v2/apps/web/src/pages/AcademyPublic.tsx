// AcademyPublic.tsx — day-mode showcase for the public academy landing page.
// Rich chess-themed imagery (Gemini-generated PNGs in /academy/*.webp) weave
// through every section, and interactive modules borrowed from dreamworldplants
// patterns (program-finder quiz, coach filter pills, testimonial carousel,
// weekly schedule tabs, sticky floating CTA) keep the page kinetic.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
const IMG = "/academy";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface Testimonial { id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string }
interface Socials { website?: string; twitter?: string; youtube?: string; instagram?: string; whatsapp?: string }
interface Profile {
  academyId: string; slug: string;
  displayName: string; tagline: string; description: string;
  logoUrl: string; coverUrl: string; themeUrl?: string;
  country: string; city: string; foundedYear?: number;
  socials: Socials;
  achievements: Achievement[]; testimonials: Testimonial[];
}
interface Coach {
  userId: string; username: string; fullName: string | null;
  role: "coach" | "academy_owner"; isOwner: boolean;
  coachProfile: {
    displayName: string; tagline: string; country: string; titleClass: string;
    elo?: number; federation: string; yearsTeaching?: number;
    playingStyles: string[]; photoUrl: string;
  };
}
interface ClassRow { _id: string; title: string; coach: string; startAt: string; durationMin: number; topics?: string[] }
interface Resp {
  academy: { _id: string; slug: string; name: string; ownerId: string };
  profile: Profile;
  coaches: Coach[];
  upcomingClasses: ClassRow[];
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) { const e: any = new Error(`${path} ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

function isoToFlag(cc: string): string {
  if (!cc || cc.length !== 2) return "";
  const OFFSET = 127397;
  const chars = [...cc.toUpperCase()];
  if (!chars.every((c) => c >= "A" && c <= "Z")) return "";
  return String.fromCodePoint(...chars.map((c) => OFFSET + c.charCodeAt(0)));
}

function socialHref(kind: string, v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, "");
  switch (kind) {
    case "twitter":   return `https://twitter.com/${h}`;
    case "youtube":   return h.startsWith("UC") ? `https://youtube.com/channel/${h}` : `https://youtube.com/@${h}`;
    case "instagram": return `https://instagram.com/${h}`;
    case "whatsapp":  return `https://wa.me/${h.replace(/\D/g, "")}`;
    default:          return h.startsWith("http") ? h : `https://${h}`;
  }
}

function useCountUp(target: number, duration = 1400, run = true): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0; const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, run]);
  return v;
}

function useOnScreen<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function useTilt() {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${px * 8}deg) rotateX(${-py * 8}deg) translateZ(0)`;
  };
  const onLeave = () => { const el = ref.current; if (el) el.style.transform = ""; };
  return { ref, onMove, onLeave };
}

// Fires once when the viewport crosses the given fraction of the page height.
// Returns 0..1 (scaled scroll position). Used by <ScrollProgress/>.
function useScrollProgress(): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const y = Math.max(0, Math.min(1, window.scrollY / Math.max(1, h)));
      setP(y);
      raf = 0;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return p;
}

// Thin gradient bar at the very top of the viewport — fills as visitor scrolls.
function ScrollProgress() {
  const p = useScrollProgress();
  return (
    <div className="fixed top-0 inset-x-0 h-[3px] z-[60] pointer-events-none bg-stone-200/40">
      <div
        className="h-full bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-amber-500 origin-left transition-transform duration-100"
        style={{ transform: `scaleX(${p})` }}
      />
    </div>
  );
}

// Soft radial spotlight that follows the cursor inside a container.
function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;
    const onMove = (e: MouseEvent) => {
      const r = parent.getBoundingClientRect();
      el.style.setProperty("--sx", `${e.clientX - r.left}px`);
      el.style.setProperty("--sy", `${e.clientY - r.top}px`);
    };
    parent.addEventListener("mousemove", onMove);
    return () => parent.removeEventListener("mousemove", onMove);
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 opacity-70 mix-blend-plus-lighter"
      style={{
        background: `radial-gradient(240px circle at var(--sx, 50%) var(--sy, 50%), rgba(217,70,239,0.25), transparent 60%)`,
      }}
    />
  );
}

// Reveal — wraps children so they fade+slide in the first time they enter view.
function Reveal({ children, className = "", delay = 0, from = "up" }: { children: React.ReactNode; className?: string; delay?: number; from?: "up" | "left" | "right" }) {
  const [ref, seen] = useOnScreen<HTMLDivElement>();
  const anim = seen ? (from === "left" ? "cg-reveal-left" : from === "right" ? "cg-reveal-right" : "cg-reveal-up") : "";
  return (
    <div ref={ref} className={`${className} ${anim}`} style={seen ? { animationDelay: `${delay}ms` } : { opacity: 0 }}>
      {children}
    </div>
  );
}

// Shine sweep — the DWP category-card hover flourish.
function ShineSweep() {
  return (
    <span
      className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/70 to-transparent opacity-0 group-hover:opacity-100 group-hover:translate-x-[300%] transition-all duration-1000"
    />
  );
}

function CountStat({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  const [ref, seen] = useOnScreen<HTMLDivElement>();
  const n = useCountUp(value, 1300, seen);
  return (
    <div ref={ref} className="text-center">
      <div className="font-display text-5xl md:text-7xl tracking-tight bg-gradient-to-br from-stone-900 via-indigo-700 to-fuchsia-700 bg-clip-text text-transparent tabular-nums">
        {n}{suffix}
      </div>
      <div className="mt-2 text-[10px] md:text-xs tracking-[0.25em] uppercase text-stone-500">{label}</div>
    </div>
  );
}

function CoachTiltCard({ c }: { c: Coach }) {
  const { ref, onMove, onLeave } = useTilt();
  const cp = c.coachProfile;
  return (
    <Link
      to={`/coach/${encodeURIComponent(c.username)}`}
      className="group block"
      onMouseMove={onMove as any}
      onMouseLeave={onLeave}
    >
      <div
        ref={ref}
        className="relative rounded-3xl overflow-hidden bg-white ring-1 ring-stone-200 shadow-sm hover:shadow-xl hover:ring-fuchsia-300 transition-all duration-500 will-change-transform"
      >
        <div className="aspect-[3/4] relative overflow-hidden">
          {cp.photoUrl ? (
            <img src={cp.photoUrl} alt={cp.displayName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
          ) : (
            <div className="w-full h-full grid place-items-center bg-gradient-to-br from-indigo-100 via-fuchsia-100 to-amber-100">
              <div className="text-8xl text-stone-400">&#9822;</div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          {cp.titleClass && (
            <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-400 to-rose-500 text-[10px] tracking-widest uppercase font-bold text-white shadow-lg shadow-rose-500/40">
              {cp.titleClass}
            </div>
          )}
          {cp.elo != null && (
            <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-white/90 backdrop-blur-md text-xs font-mono text-indigo-700 ring-1 ring-indigo-200">
              {cp.elo}
            </div>
          )}
          <div className="absolute bottom-4 left-4 right-4 text-white">
            <div className="flex items-center gap-2 mb-2 text-xs">
              {isoToFlag(cp.country) && <span className="text-base">{isoToFlag(cp.country)}</span>}
              {cp.yearsTeaching && <span className="opacity-80">{cp.yearsTeaching} yrs</span>}
            </div>
            <div className="font-display text-2xl md:text-3xl leading-tight tracking-tight">
              {cp.displayName || c.fullName || c.username}
            </div>
            {cp.tagline && <div className="text-xs opacity-80 mt-1 line-clamp-2">{cp.tagline}</div>}
            {cp.playingStyles?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {cp.playingStyles.slice(0, 3).map((s) => (
                  <span key={s} className="text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/25 backdrop-blur-sm ring-1 ring-white/30">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function BentoTile({ children, className = "", tint = "" }: { children: React.ReactNode; className?: string; tint?: string }) {
  return (
    <div className={`group relative rounded-3xl overflow-hidden bg-white ring-1 ring-stone-200 shadow-sm hover:shadow-lg transition-all p-6 md:p-8 ${tint} ${className}`}>
      <ShineSweep />
      {children}
    </div>
  );
}

// ═════════════════════ INTERACTIVE HERO CAROUSEL ═════════════════════
// 4 hero-image scenes auto-rotate every 5s with cross-fade. Dot indicators,
// prev/next arrows, pause on hover, scene-label under the dots.
const HERO_SCENES = [
  { src: "/academy/hero-b-neon-modern.webp",   label: "Neon" },
  { src: "/academy/hero-a-cinematic.webp",     label: "Cinematic" },
  { src: "/academy/hero-d-topdown-modern.webp",label: "Marble" },
  { src: "/academy/hero-c-crystal.webp",       label: "Crystal" },
];

function HeroCarousel() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setI((v) => (v + 1) % HERO_SCENES.length), 5000);
    return () => clearInterval(id);
  }, [paused]);
  const go = (dir: 1 | -1) => setI((v) => (v + dir + HERO_SCENES.length) % HERO_SCENES.length);
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {HERO_SCENES.map((s, k) => (
        <img
          key={s.src}
          src={s.src}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[1400ms] ease-in-out ${k === i ? "opacity-100" : "opacity-0"}`}
        />
      ))}
      {/* Cream wash + radial center highlight for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#faf6ef]/70 via-[#faf6ef]/55 to-[#faf6ef]/85" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(250,246,239,0.6)_0%,transparent_60%)]" />

      {/* Prev / Next arrows (desktop only) */}
      <button
        onClick={() => go(-1)}
        aria-label="Previous scene"
        className="pointer-events-auto hidden md:grid absolute left-6 top-1/2 -translate-y-1/2 h-11 w-11 place-items-center rounded-full bg-white/80 backdrop-blur-md ring-1 ring-stone-200 shadow-lg text-stone-700 hover:bg-white hover:scale-110 transition-all z-20"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 19l-7-7 7-7"/></svg>
      </button>
      <button
        onClick={() => go(1)}
        aria-label="Next scene"
        className="pointer-events-auto hidden md:grid absolute right-6 top-1/2 -translate-y-1/2 h-11 w-11 place-items-center rounded-full bg-white/80 backdrop-blur-md ring-1 ring-stone-200 shadow-lg text-stone-700 hover:bg-white hover:scale-110 transition-all z-20"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 5l7 7-7 7"/></svg>
      </button>

      {/* Dots + scene label */}
      <div className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-20">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 backdrop-blur-md ring-1 ring-stone-200 shadow-lg">
          {HERO_SCENES.map((s, k) => (
            <button
              key={s.src}
              onClick={() => setI(k)}
              aria-label={`Scene ${k + 1}: ${s.label}`}
              className={`transition-all rounded-full ${k === i ? "w-8 h-2 bg-gradient-to-r from-cyan-500 to-fuchsia-500" : "w-2 h-2 bg-stone-300 hover:bg-stone-500"}`}
            />
          ))}
        </div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-stone-600 font-semibold">
          {HERO_SCENES[i].label}
        </div>
      </div>
    </div>
  );
}

function CyclingTagline() {
  const phrases = [
    { text: "Play. Learn. Win.",       accent: "from-cyan-500 to-indigo-500"   },
    { text: "Every game, a story.",    accent: "from-fuchsia-500 to-rose-500"  },
    { text: "Guided by titled coaches.", accent: "from-amber-500 to-rose-500"  },
    { text: "Your first rating awaits.", accent: "from-emerald-500 to-teal-500" },
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % phrases.length), 3600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="relative h-full">
      {phrases.map((p, k) => (
        <div
          key={k}
          className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${k === i ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
        >
          <span className={`text-base md:text-lg font-bold tracking-tight bg-gradient-to-r ${p.accent} bg-clip-text text-transparent`}>
            {p.text}
          </span>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════ INTERACTIVE MODULE 1 — Program Finder Quiz ═════════════════════
// Three-step wizard: age band → level → goal. Ends with a recommended programme
// and a CTA. Inspired by DWP's plant-finder module.
function ProgramFinder({ ctaHref, ctaExt, joinLabel }: { ctaHref: string; ctaExt: boolean; joinLabel: string }) {
  const [step, setStep] = useState(0);
  const [age, setAge] = useState("");
  const [level, setLevel] = useState("");
  const [goal, setGoal] = useState("");

  const reset = () => { setStep(0); setAge(""); setLevel(""); setGoal(""); };

  const pick = (setter: (v: string) => void, v: string) => {
    setter(v);
    setTimeout(() => setStep((s) => s + 1), 220);
  };

  const rec = useMemo(() => {
    if (level === "advanced") return { name: "Master's Path", tag: "Titled coach · 1-on-1", accent: "from-fuchsia-500 to-rose-500", why: "One-on-one work with a titled coach on your specific tournament weaknesses. Custom homework, game reviews, and prep before every rated event." };
    if (level === "intermediate" && goal === "tournament") return { name: "Rated Path", tag: "Small group · 3-4 students", accent: "from-cyan-500 to-indigo-500", why: "Sharpen tactics, endgames, and openings to break through the 1200-1600 rating barrier. Weekly rated games, coach-led post-mortems." };
    if (level === "intermediate") return { name: "Improver Path", tag: "Small group · Weekly", accent: "from-indigo-500 to-fuchsia-500", why: "Structured curriculum on positional play, calculation, and typical middlegame plans. Perfect for club-level players who want to level up." };
    if (age === "kids") return { name: "Little Grandmasters", tag: "Kids · 5-10 · Story-based", accent: "from-amber-400 to-rose-400", why: "Story-based lessons that teach piece movement, patterns, and first tactics through play. Small groups of 6, weekly homework via app." };
    if (level === "beginner") return { name: "Founder's Path", tag: "Beginner · Group", accent: "from-emerald-500 to-teal-500", why: "For students just starting out. Learn how the pieces move, how to protect your king, and win your first game inside a month." };
    return { name: "Foundations", tag: "All levels · Group", accent: "from-indigo-500 to-cyan-500", why: "A well-rounded programme covering tactics, endgame, opening principles, and chess psychology. Great starting point when you're not sure." };
  }, [age, level, goal]);

  const chip = (v: string, label: string, selected: boolean, setter: (v: string) => void) => (
    <button
      onClick={() => pick(setter, v)}
      className={`group relative overflow-hidden rounded-2xl px-5 py-4 text-left font-semibold ring-1 transition-all ${selected ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white ring-transparent shadow-lg" : "bg-white text-stone-800 ring-stone-200 hover:ring-fuchsia-300 hover:-translate-y-0.5 hover:shadow-md"}`}
    >
      <ShineSweep />
      <span className="relative">{label}</span>
    </button>
  );

  return (
    <section className="relative py-20 md:py-28 overflow-hidden">
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ backgroundImage: `url(${IMG}/pattern-tile.webp)`, backgroundSize: '340px' }} />
      <div className="relative mx-auto max-w-5xl px-6 md:px-10">
        <div className="mb-10 text-center">
          <div className="text-xs tracking-[0.25em] uppercase text-emerald-600 font-semibold mb-3">Find your path</div>
          <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
            Which programme fits you?
          </h2>
          <p className="mt-4 text-stone-500 max-w-xl mx-auto">Answer three quick questions. We&apos;ll match you with the right coach and programme.</p>
        </div>

        <div className="relative rounded-3xl bg-white ring-1 ring-stone-200 shadow-xl overflow-hidden">
          {/* progress bar */}
          <div className="h-1.5 bg-stone-100">
            <div className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-fuchsia-500 transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }} />
          </div>

          <div className="grid md:grid-cols-[220px_1fr]">
            <div className="hidden md:block relative bg-stone-50">
              <img src={`${IMG}/kids-playing.webp`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/70" />
            </div>

            <div className="p-8 md:p-10">
              {step === 0 && (
                <div className="cg-fade-up">
                  <div className="text-xs uppercase tracking-widest text-stone-500 mb-2">Step 1 of 3</div>
                  <div className="font-display text-2xl mb-6">Who is this for?</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {chip("kids", "🧒 Kids (5-10)", age === "kids", setAge)}
                    {chip("teens", "👦 Teens (11-17)", age === "teens", setAge)}
                    {chip("adult", "🧑 Adult (18+)", age === "adult", setAge)}
                  </div>
                </div>
              )}
              {step === 1 && (
                <div className="cg-fade-up">
                  <div className="text-xs uppercase tracking-widest text-stone-500 mb-2">Step 2 of 3</div>
                  <div className="font-display text-2xl mb-6">Current level?</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {chip("beginner", "♙ Beginner", level === "beginner", setLevel)}
                    {chip("intermediate", "♘ Club (800-1600)", level === "intermediate", setLevel)}
                    {chip("advanced", "♛ Advanced (1600+)", level === "advanced", setLevel)}
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="cg-fade-up">
                  <div className="text-xs uppercase tracking-widest text-stone-500 mb-2">Step 3 of 3</div>
                  <div className="font-display text-2xl mb-6">What&apos;s your goal?</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {chip("fun", "🎯 Learn for fun", goal === "fun", setGoal)}
                    {chip("tournament", "🏆 Rated tournaments", goal === "tournament", setGoal)}
                    {chip("master", "👑 Serious mastery", goal === "master", setGoal)}
                  </div>
                </div>
              )}
              {step >= 3 && (
                <div className="cg-fade-up">
                  <div className="text-xs uppercase tracking-widest text-emerald-600 font-semibold mb-2">Perfect fit</div>
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-semibold text-white bg-gradient-to-r ${rec.accent} mb-3`}>{rec.tag}</div>
                  <div className="font-display text-3xl md:text-4xl leading-tight mb-3">{rec.name}</div>
                  <p className="text-stone-600 leading-relaxed mb-6">{rec.why}</p>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={ctaHref}
                      {...(ctaExt ? { target: "_blank", rel: "noreferrer" } : {})}
                      className={`inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r ${rec.accent} text-white font-bold shadow-lg hover:scale-105 transition-transform`}
                    >
                      {joinLabel}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                    </a>
                    <button onClick={reset} className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm font-semibold transition-colors">
                      Start over
                    </button>
                  </div>
                </div>
              )}

              {step > 0 && step < 3 && (
                <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between">
                  <button onClick={() => setStep(step - 1)} className="text-sm text-stone-500 hover:text-stone-900">&larr; Back</button>
                  <div className="text-xs text-stone-400">{step === 1 ? age : level}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ INTERACTIVE MODULE 2 — Testimonial Carousel ═════════════════════
// Auto-advances every 6s, dot navigation, prev/next buttons. Uses figure card.
function TestimonialCarousel({ items }: { items: Testimonial[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || items.length < 2) return;
    const id = setInterval(() => setI((v) => (v + 1) % items.length), 6000);
    return () => clearInterval(id);
  }, [items.length, paused]);

  if (!items.length) return null;
  const t = items[i];

  return (
    <section
      className="relative py-20 md:py-28 border-y border-stone-200 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ backgroundImage: `url(${IMG}/pattern-tile.webp)`, backgroundSize: '300px' }} />
      <div className="relative mx-auto max-w-4xl px-6 md:px-10">
        <div className="mb-10 text-center">
          <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-600 font-semibold mb-3">Loved by</div>
          <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
            Students &amp; parents.
          </h2>
        </div>

        <figure key={t.id} className="relative rounded-3xl bg-white ring-1 ring-stone-200 shadow-xl p-8 md:p-12 cg-fade-up">
          <div className="absolute -top-6 left-8 text-9xl font-display leading-none text-fuchsia-500/25">&ldquo;</div>
          <img src={`${IMG}/notation.webp`} alt="" className="hidden md:block absolute -right-12 -top-12 w-40 h-40 object-cover rounded-full ring-4 ring-white shadow-xl rotate-6" />
          <blockquote className="relative font-display text-xl md:text-3xl leading-[1.4] text-stone-800 mb-8">
            {t.quote}
          </blockquote>
          <figcaption className="flex items-center gap-4">
            {t.imageUrl ? (
              <img src={t.imageUrl} alt={t.author} className="w-14 h-14 rounded-full object-cover ring-2 ring-fuchsia-300" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-fuchsia-400 to-amber-500 grid place-items-center text-white text-base font-display">
                {t.author.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
              </div>
            )}
            <div>
              <div className="text-base font-bold text-stone-900">{t.author}</div>
              {t.role && <div className="text-sm text-stone-500">{t.role}</div>}
            </div>
            {t.rating && (
              <div className="ml-auto text-amber-500 text-base tracking-widest">{"★".repeat(Math.min(5, Math.max(1, Math.round(t.rating))))}</div>
            )}
          </figcaption>
        </figure>

        {items.length > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              onClick={() => setI((v) => (v - 1 + items.length) % items.length)}
              aria-label="Previous"
              className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:bg-stone-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex items-center gap-2">
              {items.map((_, k) => (
                <button
                  key={k}
                  onClick={() => setI(k)}
                  aria-label={`Testimonial ${k + 1}`}
                  className={`transition-all rounded-full ${k === i ? "w-8 h-2.5 bg-gradient-to-r from-fuchsia-500 to-rose-500" : "w-2.5 h-2.5 bg-stone-300 hover:bg-stone-400"}`}
                />
              ))}
            </div>
            <button
              onClick={() => setI((v) => (v + 1) % items.length)}
              aria-label="Next"
              className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:bg-stone-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ═════════════════════ INTERACTIVE MODULE 3 — Weekly Schedule Tabs ═════════════════════
// Bucket upcomingClasses by weekday. Weekday pill selector filters the list.
function WeeklySchedule({ items, joinHref, joinExternal }: { items: ClassRow[]; joinHref: string; joinExternal: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const buckets = useMemo(() => {
    const b: Record<number, ClassRow[]> = {};
    for (const c of items) {
      const wd = new Date(c.startAt).getDay();
      (b[wd] ||= []).push(c);
    }
    return b;
  }, [items]);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const firstDay = active ?? Object.keys(buckets).map(Number).sort((a,b)=>a-b)[0];
  const list = firstDay != null ? (buckets[firstDay] || []) : [];

  if (!items.length) return null;

  return (
    <section className="relative py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-6 md:px-10">
        <div className="mb-10 flex items-end justify-between flex-wrap gap-6">
          <div>
            <div className="text-xs tracking-[0.25em] uppercase text-cyan-600 font-semibold mb-3">This week</div>
            <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
              Class schedule.
            </h2>
          </div>
          <img src={`${IMG}/clock.webp`} alt="" className="hidden md:block w-24 h-24 rounded-2xl object-cover ring-1 ring-stone-200 shadow-sm" />
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {days.map((d, k) => {
            const count = (buckets[k] || []).length;
            const isActive = firstDay === k;
            const isEmpty = count === 0;
            return (
              <button
                key={d}
                onClick={() => !isEmpty && setActive(k)}
                disabled={isEmpty}
                className={`group relative overflow-hidden inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all ring-1 ${isActive ? "bg-gradient-to-r from-cyan-500 to-indigo-500 text-white ring-transparent shadow-lg" : isEmpty ? "bg-stone-50 text-stone-300 ring-stone-100 cursor-not-allowed" : "bg-white text-stone-700 ring-stone-200 hover:ring-cyan-300 hover:-translate-y-0.5"}`}
              >
                {!isEmpty && !isActive && <ShineSweep />}
                <span className="relative">{d}</span>
                {count > 0 && (
                  <span className={`relative text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/25" : "bg-stone-100"}`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {list.map((cl, i) => {
            const d = new Date(cl.startAt);
            return (
              <div key={cl._id} className="group relative overflow-hidden flex items-center gap-5 rounded-2xl bg-white ring-1 ring-stone-200 shadow-sm hover:shadow-lg hover:ring-cyan-300 hover:-translate-y-0.5 transition-all p-5 cg-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                <ShineSweep />
                <div className="w-16 shrink-0 text-center">
                  <div className="text-[10px] uppercase tracking-widest text-cyan-600 font-semibold">{d.toLocaleString(undefined, { weekday: 'short' })}</div>
                  <div className="font-display text-3xl leading-none mt-1 text-stone-900">{d.getDate()}</div>
                  <div className="text-[10px] text-stone-500 mt-1 uppercase">{d.toLocaleString(undefined, { month: 'short' })}</div>
                </div>
                <div className="w-px h-12 bg-stone-200" />
                <div className="flex-1 min-w-0 relative">
                  <div className="font-display text-lg md:text-xl leading-tight truncate text-stone-900">{cl.title}</div>
                  <div className="text-sm text-stone-500 mt-0.5">
                    {d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })} &middot; {cl.durationMin}min &middot; {cl.coach}
                  </div>
                </div>
                <a
                  href={joinHref}
                  {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="hidden sm:inline-flex items-center gap-1 px-4 py-2 rounded-full bg-stone-100 hover:bg-cyan-500 hover:text-white text-xs font-bold text-stone-700 transition-all"
                >
                  RSVP &rarr;
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ INTERACTIVE MODULE 4 — Puzzle Quiz ═════════════════════
// Unicode-piece mini-board + four move options. Auto-cycles or user-picks; shows
// correct/wrong feedback with a colored ring and explanation.
const UNI: Record<string, string> = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

interface Puzzle {
  pieces: Record<string, string>;
  toMove: "White" | "Black";
  prompt: string;
  hint: string;
  options: Array<{ move: string; correct: boolean; why: string }>;
}

const PUZZLES: Puzzle[] = [
  {
    pieces: { g8: "k", f7: "p", g7: "p", h7: "p", d1: "R", g1: "K" },
    toMove: "White",
    prompt: "White to play. Mate in 1?",
    hint: "The 8th rank is undefended.",
    options: [
      { move: "Rd8#",  correct: true,  why: "Rook to d8 delivers check along the 8th rank. King can't escape — every square is blocked by its own pawns or attacked." },
      { move: "Rd7",   correct: false, why: "That's a quiet move — not even check." },
      { move: "Kg2",   correct: false, why: "Passive king move — you missed the mate." },
      { move: "Rh1",   correct: false, why: "You already have a mate available — take it!" },
    ],
  },
  {
    pieces: { a8: "k", a7: "p", c6: "Q", a1: "K" },
    toMove: "White",
    prompt: "White to play. Mate in 1?",
    hint: "Trap the king in the corner along the 8th rank.",
    options: [
      { move: "Qc8#",  correct: true,  why: "Queen to c8 checks. King can't escape: b8 is attacked, a7 is blocked by its own pawn, b7 is attacked along the diagonal." },
      { move: "Qxa7+", correct: false, why: "Queen isn't defended — king just captures. Blunder." },
      { move: "Qb6",   correct: false, why: "Threat, but not mate — king still has b8." },
      { move: "Kb1",   correct: false, why: "You have a mate — don't waste the tempo." },
    ],
  },
  {
    pieces: { h8: "k", g7: "p", h7: "p", h5: "Q", g5: "N", a1: "K" },
    toMove: "White",
    prompt: "White to play. Mate in 1?",
    hint: "The knight guards a critical escape square.",
    options: [
      { move: "Qxh7#", correct: true,  why: "Queen takes h7 with check. King can't take because g5-knight guards h7. No escape squares — mate." },
      { move: "Nf7+",  correct: false, why: "Only check, king simply moves." },
      { move: "Qh6",   correct: false, why: "Not check, and drops the queen to gxh6." },
      { move: "Qxg7+", correct: false, why: "King takes the queen — you lost your queen." },
    ],
  },
];

function MiniBoard({ pieces }: { pieces: Record<string, string> }) {
  const files = ["a","b","c","d","e","f","g","h"];
  const ranks = ["8","7","6","5","4","3","2","1"];
  return (
    <div className="inline-grid grid-cols-8 rounded-xl overflow-hidden ring-1 ring-stone-300 shadow-lg">
      {ranks.map((r, ri) =>
        files.map((f, fi) => {
          const dark = (ri + fi) % 2 === 1;
          const piece = pieces[f + r];
          const isWhite = piece && piece === piece.toUpperCase();
          return (
            <div
              key={f + r}
              className={`w-8 md:w-11 aspect-square grid place-items-center text-2xl md:text-3xl select-none ${dark ? "bg-[#b58863]" : "bg-[#f0d9b5]"}`}
            >
              {piece && (
                <span
                  className={isWhite ? "text-white" : "text-stone-900"}
                  style={{ textShadow: isWhite ? "0 1px 2px rgba(0,0,0,0.6)" : "0 1px 0 rgba(255,255,255,0.6)" }}
                >
                  {UNI[piece]}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function PuzzleQuiz() {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const puz = PUZZLES[i];
  const next = () => { setPicked(null); setI((v) => (v + 1) % PUZZLES.length); };
  const pickedOpt = picked != null ? puz.options[picked] : null;

  return (
    <section className="relative py-20 md:py-28 overflow-hidden">
      <div className="absolute inset-0 opacity-25 pointer-events-none" style={{ backgroundImage: `url(${IMG}/pattern-tile.webp)`, backgroundSize: '340px' }} />
      <div className="relative mx-auto max-w-6xl px-6 md:px-10">
        <Reveal className="mb-10 text-center">
          <div className="text-xs tracking-[0.25em] uppercase text-indigo-600 font-semibold mb-3">Try your tactics</div>
          <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
            Can you find the mate?
          </h2>
          <p className="mt-4 text-stone-500 max-w-xl mx-auto">A live board and four candidate moves. Pick the one that ends it.</p>
        </Reveal>

        <div className="grid md:grid-cols-[auto_1fr] gap-10 items-center">
          <Reveal from="left" className="flex justify-center">
            <MiniBoard pieces={puz.pieces} />
          </Reveal>

          <Reveal delay={200}>
            <div className="mb-4 flex items-center gap-3">
              <span className="text-xs uppercase tracking-widest text-stone-500">Puzzle {i + 1} of {PUZZLES.length}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-mono">{puz.toMove.toLowerCase()} to move</span>
            </div>
            <div className="font-display text-2xl md:text-3xl mb-3 text-stone-900">{puz.prompt}</div>
            <div className="text-sm text-stone-500 italic mb-6">Hint: {puz.hint}</div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {puz.options.map((o, k) => {
                const state = picked == null ? "idle" : k === picked ? (o.correct ? "correct" : "wrong") : o.correct ? "correct-hint" : "dim";
                const cls =
                  state === "idle" ? "bg-white ring-stone-200 hover:ring-indigo-300 hover:-translate-y-0.5 hover:shadow" :
                  state === "correct" ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-transparent shadow-lg" :
                  state === "wrong" ? "bg-gradient-to-br from-rose-500 to-red-600 text-white ring-transparent" :
                  state === "correct-hint" ? "bg-emerald-50 ring-emerald-300 text-emerald-700" :
                  "bg-white/60 ring-stone-100 text-stone-400";
                return (
                  <button
                    key={k}
                    onClick={() => picked == null && setPicked(k)}
                    disabled={picked != null}
                    className={`group relative overflow-hidden rounded-2xl px-5 py-4 text-left font-bold font-mono text-lg ring-1 transition-all ${cls}`}
                  >
                    {picked == null && <ShineSweep />}
                    <span className="relative flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full grid place-items-center text-xs font-sans ${state === "idle" ? "bg-stone-100 text-stone-500" : "bg-white/25 text-current"}`}>
                        {String.fromCharCode(65 + k)}
                      </span>
                      {o.move}
                    </span>
                  </button>
                );
              })}
            </div>

            {pickedOpt && (
              <div className={`rounded-2xl p-5 cg-reveal-up ${pickedOpt.correct ? "bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800" : "bg-rose-50 ring-1 ring-rose-200 text-rose-800"}`}>
                <div className="font-bold mb-1">
                  {pickedOpt.correct ? "✓ Correct — you found it!" : "✗ Not quite."}
                </div>
                <div className="text-sm leading-relaxed opacity-90">{pickedOpt.why}</div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={next}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white text-sm font-bold shadow-lg hover:scale-105 transition-transform"
              >
                Next puzzle
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </button>
              {picked != null && (
                <button
                  onClick={() => setPicked(null)}
                  className="text-sm text-stone-500 hover:text-stone-900"
                >
                  Try again
                </button>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ INTERACTIVE MODULE 5 — Class Countdown ═════════════════════
function useCountdown(target: Date | null): { days: number; hours: number; minutes: number; seconds: number; done: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const diff = Math.max(0, target.getTime() - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds, done: diff === 0 };
}

function CountdownCell({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex-1 min-w-[68px] text-center rounded-2xl bg-white ring-1 ring-stone-200 shadow-sm px-3 py-4">
      <div className="font-display text-4xl md:text-5xl tabular-nums leading-none bg-gradient-to-br from-stone-900 via-indigo-700 to-fuchsia-700 bg-clip-text text-transparent">
        {String(n).padStart(2, "0")}
      </div>
      <div className="mt-1 text-[10px] tracking-[0.25em] uppercase text-stone-500">{label}</div>
    </div>
  );
}

function ClassCountdown({ items, joinHref, joinExternal }: { items: ClassRow[]; joinHref: string; joinExternal: boolean }) {
  const next = useMemo(() => {
    const upcoming = items.filter(c => new Date(c.startAt).getTime() > Date.now()).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return upcoming[0] || null;
  }, [items]);
  const cd = useCountdown(next ? new Date(next.startAt) : null);
  if (!next) return null;

  return (
    <section className="relative py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-6 md:px-10">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-white ring-1 ring-stone-200 shadow-xl p-6 md:p-8">
            <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-gradient-to-br from-cyan-400/30 to-fuchsia-500/30 blur-3xl cg-pulse-glow" />
            <div className="relative grid md:grid-cols-[1fr_auto] gap-6 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold tracking-widest uppercase ring-1 ring-emerald-200 mb-3">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 cg-ping-slow" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  Next class
                </div>
                <div className="font-display text-2xl md:text-3xl leading-tight text-stone-900 mb-1">{next.title}</div>
                <div className="text-sm text-stone-500">
                  {new Date(next.startAt).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {next.durationMin} min · {next.coach}
                </div>
              </div>
              <a
                href={joinHref}
                {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                className="cg-breath inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold shadow-lg hover:scale-105 transition-transform whitespace-nowrap"
              >
                Reserve seat
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </a>
            </div>
            <div className="mt-6 flex gap-3">
              <CountdownCell n={cd.days} label="Days" />
              <CountdownCell n={cd.hours} label="Hours" />
              <CountdownCell n={cd.minutes} label="Min" />
              <CountdownCell n={cd.seconds} label="Sec" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ═════════════════════ INTERACTIVE MODULE 6 — Chess Quotes Carousel ═════════════════════
const QUOTES = [
  { text: "Chess is the gymnasium of the mind.", by: "Blaise Pascal", accent: "from-indigo-500 to-cyan-500" },
  { text: "Every chess master was once a beginner.", by: "Irving Chernev", accent: "from-fuchsia-500 to-rose-500" },
  { text: "When you see a good move, look for a better one.", by: "Emanuel Lasker", accent: "from-amber-500 to-orange-500" },
  { text: "Chess is life in miniature.", by: "Garry Kasparov", accent: "from-emerald-500 to-teal-500" },
  { text: "In life, as in chess, forethought wins.", by: "Charles Buxton", accent: "from-rose-500 to-fuchsia-500" },
];

function QuotesCarousel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % QUOTES.length), 4800);
    return () => clearInterval(id);
  }, []);
  const q = QUOTES[i];
  return (
    <section className="relative py-16 md:py-24 overflow-hidden">
      <div className="absolute inset-0 cg-mesh opacity-40" />
      <div className="relative mx-auto max-w-4xl px-6 md:px-10 text-center">
        <div className="relative h-40 md:h-44">
          {QUOTES.map((qq, k) => (
            <div
              key={k}
              className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-1000 ${k === i ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <blockquote className={`font-display text-2xl md:text-4xl leading-tight tracking-tight bg-gradient-to-r ${qq.accent} bg-clip-text text-transparent mb-4 max-w-3xl`}>
                &ldquo;{qq.text}&rdquo;
              </blockquote>
              <cite className="not-italic text-xs md:text-sm tracking-widest uppercase text-stone-500 font-semibold">— {qq.by}</cite>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          {QUOTES.map((_, k) => (
            <button
              key={k}
              onClick={() => setI(k)}
              aria-label={`Quote ${k + 1}`}
              className={`transition-all rounded-full ${k === i ? "w-6 h-1.5 bg-stone-800" : "w-1.5 h-1.5 bg-stone-300 hover:bg-stone-500"}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ INTERACTIVE MODULE 7 — Piece Hover Strip ═════════════════════
const PIECES = [
  { u: "♔", name: "King",   role: "Move one square any direction. Your king is the game — check-mate ends everything." },
  { u: "♕", name: "Queen",  role: "The most powerful piece. Moves any number of squares along any line — rank, file, or diagonal." },
  { u: "♖", name: "Rook",   role: "Slides along ranks and files. Two rooks working together are a nightmare on open lines." },
  { u: "♗", name: "Bishop", role: "Diagonal only — always stays on its starting color. The bishop pair is a long-term asset." },
  { u: "♘", name: "Knight", role: "Jumps in an L shape. The only piece that can leap over others — deadly in cramped positions." },
  { u: "♙", name: "Pawn",   role: "Forward only. Reach the far rank and promote — usually to a queen. Structure decides many games." },
];

function PieceStrip() {
  const [active, setActive] = useState(0);
  const p = PIECES[active];
  return (
    <section className="relative py-16 md:py-20 border-y border-stone-200 bg-white/50">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <Reveal>
          <div className="text-center mb-8">
            <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-600 font-semibold mb-2">Know your pieces</div>
            <div className="font-display text-2xl md:text-3xl text-stone-900">Hover to learn each one.</div>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-[auto_1fr] items-center gap-8">
          <div className="flex flex-wrap justify-center gap-2 md:gap-3">
            {PIECES.map((pp, k) => (
              <button
                key={k}
                onMouseEnter={() => setActive(k)}
                onClick={() => setActive(k)}
                aria-label={pp.name}
                className={`group relative overflow-hidden w-16 h-16 md:w-20 md:h-20 rounded-2xl grid place-items-center text-4xl md:text-5xl transition-all ring-1 ${active === k ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white ring-transparent shadow-xl scale-110" : "bg-white text-stone-800 ring-stone-200 hover:-translate-y-1 hover:shadow"}`}
              >
                {active !== k && <ShineSweep />}
                <span className="relative">{pp.u}</span>
              </button>
            ))}
          </div>
          <div key={active} className="cg-reveal-left">
            <div className="text-xs tracking-widest uppercase text-fuchsia-600 font-semibold mb-2">The {p.name}</div>
            <div className="text-lg md:text-xl text-stone-700 leading-relaxed">{p.role}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ MAIN PAGE ═════════════════════
export default function AcademyPublicPage() {
  const { slug } = useParams<{ slug: string }>();

  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; academyId?: string }>("/auth/me"),
  });
  const acadQ = useQuery({
    queryKey: ["academy-public-showcase", slug],
    queryFn: () => get<Resp>(`/api/academy-page/${encodeURIComponent(slug || "")}`),
    enabled: !!slug,
    retry: false,
  });

  const displayName = useMemo(
    () => acadQ.data?.profile.displayName || acadQ.data?.academy.name || slug || "",
    [acadQ.data, slug],
  );

  // Coach filter — style pills across the roster.
  const [coachFilter, setCoachFilter] = useState<string>("all");

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.getAttribute("class") || "";
    html.classList.remove("dark");
    html.classList.add("light");
    return () => { html.setAttribute("class", prev); };
  }, []);

  if (acadQ.isLoading || authQ.isLoading) {
    return (
      <div className="min-h-screen bg-[#faf6ef] grid place-items-center text-stone-400 text-sm tracking-widest uppercase">
        Loading
      </div>
    );
  }
  if ((acadQ.error as any)?.status === 404 || !acadQ.data) {
    return (
      <div className="min-h-screen bg-[#faf6ef] text-stone-900 grid place-items-center px-6 text-center">
        <div>
          <div className="text-7xl mb-4">&#9822;</div>
          <h1 className="font-display text-4xl mb-3">Not found</h1>
          <Link to="/" className="px-6 py-3 rounded-full bg-stone-100 hover:bg-stone-200 text-sm">Home</Link>
        </div>
      </div>
    );
  }

  const { academy, profile: p, coaches, upcomingClasses } = acadQ.data;
  const isOwner = !!authQ.data?.loggedIn && authQ.data.academyId === academy._id;

  const primaryContactHref = p.socials.whatsapp ? socialHref("whatsapp", p.socials.whatsapp)
    : p.socials.website ? socialHref("website", p.socials.website)
    : null;
  const joinHref = primaryContactHref || "#coaches";
  const joinExternal = !!primaryContactHref;
  const joinLabel = primaryContactHref ? "Get in touch" : "Meet the coaches";
  const hasWhatsApp = !!p.socials.whatsapp;

  const yearsTeaching = coaches.reduce((mx, c) => Math.max(mx, c.coachProfile.yearsTeaching || 0), 0)
    || (p.foundedYear ? new Date().getFullYear() - p.foundedYear : 0);

  const socialsList: Array<[keyof Socials, string]> = [
    ["website",   p.socials.website   || ""],
    ["twitter",   p.socials.twitter   || ""],
    ["youtube",   p.socials.youtube   || ""],
    ["instagram", p.socials.instagram || ""],
    ["whatsapp",  p.socials.whatsapp  || ""],
  ];

  // Coach filter categories — derived from the roster.
  const coachCats: Array<[string, string, (c: Coach) => boolean]> = [
    ["all",     `All (${coaches.length})`, () => true],
    ["titled",  "Titled (GM/IM/FM)",       (c) => ["GM", "IM", "FM"].includes(c.coachProfile.titleClass)],
    ["kids",    "Kids' coaches",            (c) => c.coachProfile.playingStyles.some(s => /kid|junior|begin/i.test(s))],
    ["1600plus","1600+ Elo",                (c) => (c.coachProfile.elo || 0) >= 1600],
  ];
  const activeFilter = coachCats.find(([k]) => k === coachFilter) || coachCats[0];
  const filteredCoaches = coaches.filter(activeFilter[2]);

  return (
    <div className="min-h-screen bg-[#faf6ef] text-stone-900 font-sans antialiased overflow-x-hidden">
      <ScrollProgress />
      <style>{`
        @keyframes cgFloat { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-14px) rotate(3deg); } }
        @keyframes cgSpinSlow { to { transform: rotate(360deg); } }
        @keyframes cgFadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cgMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes cgPulseGlow { 0%,100% { opacity: 0.35; } 50% { opacity: 0.75; } }
        @keyframes cgGradientShift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes cgPingSlow { 0% { transform: scale(1); opacity: 1; } 75%,100% { transform: scale(2.4); opacity: 0; } }
        @keyframes cgRevealUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cgRevealLeft { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes cgRevealRight { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes cgBreath { 0%,100% { transform: scale(1); box-shadow: 0 12px 40px -10px rgba(217,70,239,0.5); } 50% { transform: scale(1.04); box-shadow: 0 20px 60px -10px rgba(217,70,239,0.75); } }
        @keyframes cgWiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-4deg); } 75% { transform: rotate(4deg); } }
        @keyframes cgTicker { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        .cg-reveal-up   { animation: cgRevealUp 0.9s cubic-bezier(0.16,1,0.3,1) both; }
        .cg-reveal-left { animation: cgRevealLeft 0.9s cubic-bezier(0.16,1,0.3,1) both; }
        .cg-reveal-right{ animation: cgRevealRight 0.9s cubic-bezier(0.16,1,0.3,1) both; }
        .cg-breath      { animation: cgBreath 3.5s ease-in-out infinite; }
        .cg-wiggle      { animation: cgWiggle 3s ease-in-out infinite; }
        /* Scroll-driven bounce on chess-glyph in marquee */
        .cg-hover-lift { transition: transform 0.35s cubic-bezier(0.16,1,0.3,1); }
        .cg-hover-lift:hover { transform: translateY(-4px); }
        .cg-float { animation: cgFloat 6s ease-in-out infinite; }
        .cg-spin-slow { animation: cgSpinSlow 40s linear infinite; }
        .cg-fade-up { animation: cgFadeUp 0.9s ease-out both; }
        .cg-marquee { animation: cgMarquee 40s linear infinite; }
        .cg-pulse-glow { animation: cgPulseGlow 4s ease-in-out infinite; }
        .cg-gradient-shift { background-size: 200% 200%; animation: cgGradientShift 8s ease-in-out infinite; }
        .cg-ping-slow { animation: cgPingSlow 2.4s cubic-bezier(0,0,.2,1) infinite; }
        .cg-mesh {
          background:
            radial-gradient(at 20% 20%, rgba(147,51,234,0.14) 0px, transparent 50%),
            radial-gradient(at 80% 15%, rgba(6,182,212,0.12) 0px, transparent 50%),
            radial-gradient(at 40% 85%, rgba(236,72,153,0.10) 0px, transparent 50%),
            radial-gradient(at 90% 90%, rgba(251,146,60,0.10) 0px, transparent 50%);
        }
      `}</style>

      {/* ═══════════ TOP NAV ═══════════ */}
      <nav className="fixed inset-x-0 top-0 z-50 backdrop-blur-lg bg-white/80 border-b border-stone-200">
        <div className="mx-auto max-w-7xl px-6 md:px-10 h-16 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-3">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-stone-300" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 grid place-items-center text-white font-display text-sm shadow-lg shadow-fuchsia-500/40">
                {displayName[0]?.toUpperCase() || "A"}
              </div>
            )}
            <span className="font-display text-lg tracking-tight">{displayName}</span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm text-stone-600">
            <a href="#coaches" className="hover:text-stone-900 transition-colors">Coaches</a>
            <a href="#programs" className="hover:text-stone-900 transition-colors">Programs</a>
            <a href="#about" className="hover:text-stone-900 transition-colors">About</a>
            <a href="#milestones" className="hover:text-stone-900 transition-colors">Milestones</a>
            <a href="#faq" className="hover:text-stone-900 transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <Link to="/academy-profile/edit" className="hidden sm:inline-flex px-3 py-1.5 text-xs text-stone-500 hover:text-stone-900">Edit</Link>
            )}
            <a
              href={joinHref}
              {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50 hover:scale-105 transition-all"
            >
              {joinLabel}
            </a>
          </div>
        </div>
      </nav>

      {/* ═══════════ HERO — interactive rotating banner ═══════════ */}
      <header id="top" className="relative pt-32 md:pt-40 pb-28 md:pb-40 overflow-hidden">
        <HeroCarousel />
        <CursorSpotlight />

        {/* Subtle neon-glow accents that echo the banner */}
        <div className="absolute right-[18%] top-[35%] w-32 h-32 rounded-full bg-cyan-400/40 blur-3xl cg-pulse-glow" />
        <div className="absolute left-[18%] top-[45%] w-32 h-32 rounded-full bg-fuchsia-500/30 blur-3xl cg-pulse-glow" style={{ animationDelay: '1.5s' }} />

        <div className="relative mx-auto max-w-7xl px-6 md:px-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/80 backdrop-blur-md ring-1 ring-stone-200 shadow-sm text-xs tracking-widest uppercase mb-8 cg-fade-up">
            {isoToFlag(p.country) && <span className="text-base">{isoToFlag(p.country)}</span>}
            <span className="text-stone-700">{p.city || "Online"}</span>
            {p.foundedYear && <><span className="text-stone-300">&middot;</span><span className="text-indigo-600 font-semibold">Since {p.foundedYear}</span></>}
          </div>
          <h1 className="font-display text-6xl md:text-8xl lg:text-[128px] leading-[0.9] tracking-[-0.03em] mb-8 cg-fade-up" style={{ animationDelay: '.1s' }}>
            <span className="bg-gradient-to-br from-stone-900 via-indigo-700 to-stone-900 bg-clip-text text-transparent">{displayName.split(" ").slice(0, -1).join(" ") || displayName}</span>
            {displayName.split(" ").length > 1 && (
              <><br /><span className="bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-500 bg-clip-text text-transparent cg-gradient-shift">{displayName.split(" ").slice(-1)[0]}</span></>
            )}
          </h1>
          {p.tagline && (
            <p className="text-lg md:text-2xl text-stone-500 max-w-2xl mx-auto leading-relaxed mb-2 cg-fade-up" style={{ animationDelay: '.2s' }}>
              {p.tagline}
            </p>
          )}
          {/* Cycling headline underneath — rotates through 4 phrases */}
          <div className="h-8 md:h-10 relative mb-10 cg-fade-up" style={{ animationDelay: '.25s' }}>
            <CyclingTagline />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 cg-fade-up" style={{ animationDelay: '.3s' }}>
            <a
              href={joinHref}
              {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="group relative inline-flex items-center gap-2 px-8 py-4 rounded-full text-base font-bold text-white overflow-hidden cg-breath"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-amber-500 cg-gradient-shift" />
              <span className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-amber-500 blur-xl opacity-60 group-hover:opacity-100 transition-opacity" />
              <ShineSweep />
              <span className="relative z-10">{joinLabel}</span>
              <svg className="relative z-10 w-5 h-5 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </a>
            <a href="#coaches" className="inline-flex items-center gap-1.5 px-6 py-4 rounded-full text-sm font-semibold text-stone-700 hover:text-stone-900 bg-white/70 hover:bg-white ring-1 ring-stone-200 backdrop-blur-md transition-all shadow-sm">
              Explore &darr;
            </a>
          </div>

          {/* Live "training now" ticker — simulated presence, warm human touch */}
          <div className="mt-10 inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/70 backdrop-blur-md ring-1 ring-emerald-200 text-xs text-stone-700 cg-fade-up" style={{ animationDelay: '.4s' }}>
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 cg-ping-slow"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="font-semibold text-emerald-700">Live now</span>
            <span className="text-stone-500">·</span>
            <span>{Math.max(3, Math.min(30, coaches.length * 3 + 5))} students training</span>
          </div>
        </div>

      </header>

      {/* ═══════════ STATS ═══════════ */}
      <section className="relative py-16 md:py-24">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-fuchsia-500/5 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-6 md:px-10 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          <CountStat label="Coaches" value={coaches.length} />
          <CountStat label="Years teaching" value={yearsTeaching} suffix="+" />
          <CountStat label="Milestones" value={p.achievements.length} />
          <CountStat label="Testimonials" value={p.testimonials.length} />
        </div>
      </section>

      {/* ═══════════ CLASS COUNTDOWN (interactive, real-time) ═══════════ */}
      <ClassCountdown items={upcomingClasses} joinHref={joinHref} joinExternal={joinExternal} />

      {/* ═══════════ MARQUEE ═══════════ */}
      <section className="relative py-10 overflow-hidden border-y border-stone-200 bg-white/50">
        <div className="flex cg-marquee whitespace-nowrap">
          {[...Array(2)].map((_, dupe) => (
            <div key={dupe} className="flex items-center shrink-0">
              {["Openings", "Tactics", "Endgames", "Strategy", "Blitz", "Positional", "Attacking", "Classical", "Memory", "Calculation"].map((w, i) => (
                <span key={`${dupe}-${i}`} className="mx-8 text-3xl md:text-5xl font-display tracking-tight text-stone-300 hover:text-stone-800 transition-colors">
                  <span className="mr-8 text-fuchsia-400">&#9822;</span>{w}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════ BENTO ═══════════ */}
      <section id="programs" className="relative py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <Reveal className="mb-14 text-center">
            <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-600 font-semibold mb-3">The academy</div>
            <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
              A whole world of chess.
            </h2>
          </Reveal>
          <div className="grid gap-4 md:gap-5 grid-cols-2 md:grid-cols-4 auto-rows-[minmax(180px,auto)]">
            <BentoTile className="col-span-2 row-span-2 !p-0 overflow-hidden">
              {p.coverUrl ? (
                <img src={p.coverUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000" />
              ) : (
                <img src={`${IMG}/board-corner.webp`} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 text-white">
                <div className="text-xs uppercase tracking-widest text-cyan-200 mb-2">Featured</div>
                <div className="font-display text-2xl md:text-3xl leading-tight">Where champions begin.</div>
              </div>
            </BentoTile>

            <BentoTile tint="bg-gradient-to-br from-fuchsia-100 via-white to-white">
              <img src={`${IMG}/piece-knight.webp`} alt="" className="absolute -right-4 -bottom-4 w-32 h-32 object-contain opacity-70" />
              <div className="relative">
                <div className="text-4xl mb-3">&#9819;</div>
                <div className="font-display text-xl leading-tight text-stone-900">{p.tagline || "Grandmasters teach here."}</div>
              </div>
            </BentoTile>

            <BentoTile tint="bg-gradient-to-br from-cyan-100 via-white to-white">
              <img src={`${IMG}/piece-rook.webp`} alt="" className="absolute -right-4 -bottom-4 w-32 h-32 object-contain opacity-70" />
              <div className="relative">
                <div className="text-5xl mb-3">{isoToFlag(p.country) || "🌐"}</div>
                <div className="font-display text-xl text-stone-900">{p.city || "Online"}</div>
                <div className="text-xs text-stone-500 mt-1">{p.country || "Worldwide"}</div>
              </div>
            </BentoTile>

            {p.foundedYear && (
              <BentoTile tint="bg-gradient-to-br from-amber-100 via-white to-white">
                <img src={`${IMG}/piece-queen.webp`} alt="" className="absolute -right-4 -bottom-4 w-32 h-32 object-contain opacity-70" />
                <div className="relative">
                  <div className="text-xs uppercase tracking-widest text-amber-600 font-semibold mb-3">Established</div>
                  <div className="font-display text-6xl leading-none text-stone-900">{p.foundedYear}</div>
                  <div className="text-xs text-stone-500 mt-2">{new Date().getFullYear() - p.foundedYear} years of teaching</div>
                </div>
              </BentoTile>
            )}

            <BentoTile tint="bg-gradient-to-br from-rose-100 via-white to-white">
              <img src={`${IMG}/trophy.webp`} alt="" className="absolute -right-4 -bottom-4 w-32 h-32 object-contain opacity-80" />
              <div className="relative">
                <div className="text-4xl mb-3">&#127942;</div>
                <div className="font-display text-4xl leading-none text-stone-900">{p.achievements.length}</div>
                <div className="text-xs text-stone-500 mt-2 uppercase tracking-widest">Milestones</div>
              </div>
            </BentoTile>
          </div>
        </div>
      </section>

      {/* ═══════════ PIECE STRIP (interactive hover) ═══════════ */}
      <PieceStrip />

      {/* ═══════════ PROGRAM FINDER (interactive) ═══════════ */}
      <ProgramFinder ctaHref={joinHref} ctaExt={joinExternal} joinLabel={joinLabel} />

      {/* ═══════════ COACHES with filter pills ═══════════ */}
      <section id="coaches" className="relative py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <Reveal className="mb-8 flex items-end justify-between flex-wrap gap-6">
            <div>
              <div className="text-xs tracking-[0.25em] uppercase text-cyan-600 font-semibold mb-3">The roster</div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
                Meet the masters.
              </h2>
            </div>
            <div className="text-stone-500 text-sm uppercase tracking-widest">{filteredCoaches.length} of {coaches.length}</div>
          </Reveal>

          <div className="flex flex-wrap gap-2 mb-10">
            {coachCats.map(([k, label, pred]) => {
              const count = coaches.filter(pred).length;
              const isActive = coachFilter === k;
              const isEmpty = count === 0;
              return (
                <button
                  key={k}
                  onClick={() => !isEmpty && setCoachFilter(k)}
                  disabled={isEmpty}
                  className={`group relative overflow-hidden inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all ring-1 ${isActive ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white ring-transparent shadow-lg" : isEmpty ? "bg-stone-50 text-stone-300 ring-stone-100 cursor-not-allowed" : "bg-white text-stone-700 ring-stone-200 hover:ring-fuchsia-300 hover:-translate-y-0.5"}`}
                >
                  {!isEmpty && !isActive && <ShineSweep />}
                  <span className="relative">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredCoaches.map((c) => <CoachTiltCard key={c.userId} c={c} />)}
          </div>
          {filteredCoaches.length === 0 && (
            <div className="text-stone-400 text-center py-16">No coaches match this filter yet.</div>
          )}
        </div>
      </section>

      {/* ═══════════ PUZZLE QUIZ (interactive) ═══════════ */}
      <PuzzleQuiz />

      {/* ═══════════ WEEKLY SCHEDULE (interactive) ═══════════ */}
      <WeeklySchedule items={upcomingClasses} joinHref={joinHref} joinExternal={joinExternal} />

      {/* ═══════════ ABOUT ═══════════ */}
      {p.description && (
        <section id="about" className="relative py-20 md:py-28 border-y border-stone-200">
          <div className="absolute inset-0 cg-mesh opacity-30" />
          <div className="relative mx-auto max-w-6xl px-6 md:px-10 grid md:grid-cols-[220px_1fr] gap-10 items-start">
            <div className="hidden md:block relative">
              <img src={`${IMG}/board-corner.webp`} alt="" className="rounded-3xl object-cover w-full ring-1 ring-stone-200 shadow-lg" />
              <img src={`${IMG}/strategy-hand.webp`} alt="" className="hidden lg:block absolute -bottom-8 -right-8 w-28 h-28 rounded-2xl object-cover ring-4 ring-white shadow-xl" />
            </div>
            <div>
              <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-600 font-semibold mb-3">Our story</div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight mb-8 text-stone-900">
                Chess, with heart.
              </h2>
              <div className="text-lg md:text-xl text-stone-600 leading-[1.75] whitespace-pre-line">
                {p.description}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ MILESTONES ═══════════ */}
      {p.achievements.length > 0 && (
        <section id="milestones" className="relative py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-6 md:px-10">
            <Reveal className="mb-14 flex items-end justify-between flex-wrap gap-6">
              <div>
                <div className="text-xs tracking-[0.25em] uppercase text-amber-600 font-semibold mb-3">Milestones</div>
                <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
                  Wins we&apos;re proud of.
                </h2>
              </div>
              <img src={`${IMG}/trophy.webp`} alt="" className="hidden md:block w-24 h-24 rounded-2xl object-cover ring-1 ring-stone-200 shadow-sm cg-wiggle" />
            </Reveal>
            <div className="grid gap-5 md:grid-cols-3">
              {p.achievements.map((a, i) => (
                <div key={a.id} className="group relative overflow-hidden rounded-3xl bg-white ring-1 ring-stone-200 shadow-sm hover:shadow-xl hover:ring-amber-300 hover:-translate-y-1 transition-all duration-500 cg-fade-up" style={{ animationDelay: `${i * 80}ms` }}>
                  <ShineSweep />
                  {a.imageUrl ? (
                    <div className="aspect-[4/3] overflow-hidden">
                      <img src={a.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                    </div>
                  ) : (
                    <div className="aspect-[4/3] overflow-hidden">
                      <img src={`${IMG}/trophy.webp`} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                    </div>
                  )}
                  <div className="p-6 relative">
                    {a.year && (
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-mono ring-1 ring-amber-200 mb-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        {a.year}
                      </div>
                    )}
                    <div className="font-display text-xl leading-tight mb-2 text-stone-900">{a.title}</div>
                    {a.description && <div className="text-sm text-stone-600 leading-relaxed">{a.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ TESTIMONIALS carousel (interactive) ═══════════ */}
      <TestimonialCarousel items={p.testimonials} />

      {/* ═══════════ FAQ ═══════════ */}
      <section id="faq" className="relative py-20 md:py-28 border-y border-stone-200">
        <div className="mx-auto max-w-6xl px-6 md:px-10 grid md:grid-cols-[1fr_240px] gap-10 items-start">
          <div>
            <div className="mb-10">
              <div className="text-xs tracking-[0.25em] uppercase text-amber-600 font-semibold mb-3">Answers</div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
                How it works.
              </h2>
            </div>
            <div className="space-y-3">
              {[
                { q: "What ages do you teach?", a: `We coach students from 5 to 75. Our beginner programme starts kids as young as five with story-based lessons; adults join at any level, at any age.` },
                { q: "Do I need to know chess already?", a: `No prior knowledge required. Our beginner track starts with piece movement and works up to your first tournament. Existing players slot into an appropriate rating band after a free assessment class.` },
                { q: "How much does it cost?", a: `Fees depend on the format (group / small-group / one-on-one) and the coach's level. First lesson is free — get in touch and we'll walk you through the options.` },
                { q: "Are classes online or in person?", a: `${p.city ? `${p.city} students can attend in person; ` : ""}online classes run live on our platform with a shared board, video, and homework tracking. Recordings available for missed classes.` },
                { q: "How do I sign up?", a: `${primaryContactHref ? `Tap "Get in touch" above and message us — you'll hear back within a day.` : "Scroll down to see our coaches, pick one that fits, and reach out through their profile."}` },
              ].map((f, i) => (
                <details key={i} className="group rounded-2xl bg-white ring-1 ring-stone-200 shadow-sm hover:shadow-md hover:ring-amber-300 transition-all">
                  <summary className="cursor-pointer list-none p-6 flex items-center justify-between gap-4">
                    <span className="font-display text-lg md:text-xl leading-tight pr-4 text-stone-900">{f.q}</span>
                    <span className="w-8 h-8 shrink-0 rounded-full bg-amber-100 grid place-items-center text-amber-600 group-open:rotate-45 transition-transform">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                    </span>
                  </summary>
                  <div className="px-6 pb-6 text-stone-600 leading-relaxed text-[15px]">{f.a}</div>
                </details>
              ))}
            </div>
          </div>
          <div className="hidden md:block space-y-4 sticky top-24">
            <img src={`${IMG}/notation.webp`} alt="" className="rounded-2xl object-cover w-full aspect-square ring-1 ring-stone-200 shadow-md" />
            <img src={`${IMG}/piece-bishop.webp`} alt="" className="rounded-2xl object-cover w-full aspect-[4/5] ring-1 ring-stone-200 shadow-md" />
          </div>
        </div>
      </section>

      {/* ═══════════ QUOTES CAROUSEL (interactive) ═══════════ */}
      <QuotesCarousel />

      {/* ═══════════ FINAL CTA ═══════════ */}
      <section className="relative py-24 md:py-40 overflow-hidden">
        <div className="absolute inset-0 cg-mesh cg-gradient-shift" />
        <img src={`${IMG}/crown-detail.webp`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-15 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#faf6ef]/60 via-transparent to-[#faf6ef]" />
        <div className="relative mx-auto max-w-4xl px-6 md:px-10 text-center">
          <h2 className="font-display text-5xl md:text-7xl lg:text-8xl leading-[1] tracking-[-0.02em] mb-8">
            <span className="bg-gradient-to-r from-stone-900 via-indigo-700 to-fuchsia-700 bg-clip-text text-transparent">Your move.</span>
          </h2>
          <p className="text-lg md:text-2xl text-stone-600 max-w-xl mx-auto mb-12">
            Start with a free assessment class. We&apos;ll match you with the right coach.
          </p>
          <a
            href={joinHref}
            {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
            className="group relative inline-flex items-center gap-2 px-10 py-5 rounded-full text-lg font-bold text-white overflow-hidden shadow-2xl shadow-fuchsia-500/40"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-amber-500 cg-gradient-shift" />
            <span className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-amber-500 blur-2xl opacity-70 group-hover:opacity-100 transition-opacity" />
            <ShineSweep />
            <span className="relative z-10">{joinLabel}</span>
            <svg className="relative z-10 w-6 h-6 group-hover:translate-x-2 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </a>
        </div>
      </section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="py-12 bg-stone-100 border-t border-stone-200">
        <div className="mx-auto max-w-7xl px-6 md:px-10 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-stone-500">
          <div className="flex items-center gap-3">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 grid place-items-center text-white font-display text-xs">
                {displayName[0]?.toUpperCase() || "A"}
              </div>
            )}
            <span className="text-stone-900 font-display">{displayName}</span>
            {p.city && <span className="hidden sm:inline text-stone-300">&middot; {p.city}</span>}
          </div>
          <div className="flex items-center gap-4">
            {socialsList.filter(([, v]) => v).map(([k, v]) => (
              <a key={k} href={socialHref(k, v)} target="_blank" rel="noreferrer" className="text-xs tracking-widest uppercase hover:text-stone-900 transition-colors">
                {k}
              </a>
            ))}
          </div>
          <div className="text-xs text-stone-300">Powered by ChessGuru</div>
        </div>
      </footer>

      {/* ═══════════ STICKY FLOATING CTA (interactive) ═══════════ */}
      {primaryContactHref && (
        <a
          href={joinHref}
          target="_blank"
          rel="noreferrer"
          className={`fixed bottom-5 right-5 z-40 group inline-flex items-center gap-2 rounded-full pl-4 pr-5 py-3 shadow-2xl ring-2 ring-white hover:scale-105 active:scale-95 transition-all ${hasWhatsApp ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-emerald-500/40" : "bg-gradient-to-r from-fuchsia-500 to-rose-500 text-white shadow-fuchsia-500/40"}`}
          aria-label={joinLabel}
        >
          {hasWhatsApp ? (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 12a10 10 0 11-20 0 10 10 0 0120 0z"/><path d="M8 12l3 3 5-6"/></svg>
          )}
          <span className="text-sm font-bold whitespace-nowrap">{hasWhatsApp ? "Chat with us" : joinLabel}</span>
        </a>
      )}
    </div>
  );
}
