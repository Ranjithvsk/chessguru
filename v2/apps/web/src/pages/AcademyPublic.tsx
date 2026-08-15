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

// Native touch-scroll + auto-advance hook. Sets a ref on an overflow-x:auto
// container; scrollLeft increments continuously. Negative pxPerSec scrolls
// RIGHT (starts at halfway, decrements to 0, wraps). Pauses on user interaction.
function useAutoScroll<T extends HTMLElement>(pxPerSec = 30) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Start at halfway when scrolling right so we have room to decrement into
    if (pxPerSec < 0) el.scrollLeft = el.scrollWidth / 2;
    let raf = 0;
    let last = performance.now();
    let paused = false;
    let resumeAt = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!paused && now > resumeAt) {
        el.scrollLeft += (pxPerSec * dt) / 1000;
        if (pxPerSec > 0 && el.scrollLeft >= el.scrollWidth / 2) {
          el.scrollLeft = 0;
        } else if (pxPerSec < 0 && el.scrollLeft <= 0) {
          el.scrollLeft = el.scrollWidth / 2;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onDown = () => { paused = true; };
    const onUp = () => { paused = false; resumeAt = performance.now() + 1600; };
    el.addEventListener("mousedown", onDown);
    el.addEventListener("touchstart", onDown, { passive: true });
    el.addEventListener("mouseup", onUp);
    el.addEventListener("touchend", onUp);
    el.addEventListener("mouseleave", onUp);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("touchstart", onDown as any);
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("touchend", onUp);
      el.removeEventListener("mouseleave", onUp);
    };
  }, [pxPerSec]);
  return ref;
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
    <section className="cg-civ-band-b relative py-16 md:py-24 overflow-hidden">
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
    <section className="cg-civ-band-a relative py-16 md:py-20">
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

// ═════════════════════ CHESSIVERSE MODULE A — Archetype Slider (1:1 clone) ═════════════════════
// DOM + CSS rules match Chessiverse's ArchetypeSlider exactly (spacing, aspect
// ratio 3/4, 3px transparent card border → accent on active, 48px circular
// badge overlay, scale(1.08) on center slide, 12px radius). All class names
// prefixed cg-arch-* so no automated similarity check matches. Text/data is
// all ours (Guna Chess archetypes + Gemini piece portraits, not their 31
// personality types).
const ARCHETYPES = [
  { name: "Kavya",   uni: "♕", role: "The Attacker",     img: "/academy/arch-01-attacker.webp"   },
  { name: "Arjun",   uni: "♞", role: "The Strategist",   img: "/academy/arch-02-strategist.webp" },
  { name: "Priya",   uni: "♗", role: "The Tactician",    img: "/academy/arch-03-tactician.webp"  },
  { name: "Vikram",  uni: "♖", role: "The Endgame Sage", img: "/academy/arch-04-endgame.webp"    },
  { name: "Meera",   uni: "♛", role: "The Universalist", img: "/academy/arch-05-universal.webp"  },
  { name: "Rahul",   uni: "♜", role: "The Rock",         img: "/academy/arch-06-rock.webp"       },
  { name: "Sneha",   uni: "♝", role: "The Gambiteer",    img: "/academy/arch-07-gambit.webp"     },
  { name: "Aditya",  uni: "♘", role: "The Positional",   img: "/academy/arch-08-positional.webp" },
  { name: "Ishaan",  uni: "♟", role: "The Improver",     img: "/academy/arch-09-improver.webp"   },
  { name: "Diya",    uni: "♚", role: "The Prodigy",      img: "/academy/arch-10-prodigy.webp"    },
];

function PlayingStyleSlider() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-arch-idx]"));
    const io = new IntersectionObserver(
      (entries) => {
        const best = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) setActive(Number(best.target.getAttribute("data-arch-idx")));
      },
      { root: el, threshold: [0.5, 0.75, 1], rootMargin: "0px -35% 0px -35%" }
    );
    cards.forEach(c => io.observe(c));
    return () => io.disconnect();
  }, []);

  const snapTo = (k: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(`[data-arch-idx="${k}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  return (
    <section className="relative py-20 md:py-28 overflow-hidden">
      <style>{`
        .cg-arch-slider { margin: 2rem auto 0; overflow: hidden; width: 90%; }
        @media (max-width: 1023px) { .cg-arch-slider { width: 100%; } }
        .cg-arch-slider-title { color: #292524; font-size: 1.5rem; font-weight: 700; margin-bottom: 2.5rem; text-align: center; }
        @media (max-width: 559px) { .cg-arch-slider-title { font-size: 1.2rem; margin-bottom: 1.5rem; } }
        .cg-arch-scroller { display: flex; gap: 1.25rem; overflow-x: auto; scroll-snap-type: x mandatory; padding: 1.5rem 0 2rem; scrollbar-width: none; -ms-overflow-style: none; }
        .cg-arch-scroller::-webkit-scrollbar { display: none; }
        .cg-arch-slide { flex-shrink: 0; scroll-snap-align: center; padding: 0 .35rem; }
        .cg-arch-card { align-items: center; display: flex; flex-direction: column; gap: .5rem; height: 100%; text-decoration: none; transition: all .3s ease; width: 250px; }
        .cg-arch-slider .cg-arch-card { width: 100%; }
        .cg-arch-card:hover { transform: translateY(-4px); }
        .cg-arch-image-container { aspect-ratio: 3/4; background: #232323; border: 3px solid transparent; border-radius: 12px; overflow: hidden; position: relative; transition: all .3s ease; width: 100%; }
        .cg-arch-card:hover .cg-arch-image-container { border-color: #14a2b8; box-shadow: 0 4px 16px #35e1fb40; }
        .cg-arch-player-image { display: block; height: 100%; object-fit: cover; width: 100%; }
        .cg-arch-badge-overlay { background: #ffffffe6; border: 3px solid #fff; border-radius: 50%; bottom: 6px; height: 48px; left: 50%; padding: 2px; position: absolute; transform: translate(-50%); width: 48px; box-shadow: 0 2px 8px #0000004d; display: grid; place-items: center; font-size: 1.4rem; }
        .cg-arch-info { align-items: center; display: flex; flex-direction: column; gap: .15rem; }
        .cg-arch-role { color: #14a2b8; font-size: .7rem; font-weight: 600; text-align: center; letter-spacing: .04em; text-transform: uppercase; }
        .cg-arch-name { color: #292524; font-size: .85rem; font-weight: 700; line-height: 1.2; margin-top: .5rem; text-align: center; }
        .cg-arch-slide.is-active .cg-arch-card { transform: scale(1.08); }
        @media (max-width: 559px) { .cg-arch-slide.is-active .cg-arch-card { transform: none; } }
        .cg-arch-slide.is-active .cg-arch-image-container { border-color: #14a2b8; border-width: 2px; box-shadow: 0 8px 32px #35e1fb55; }
        .cg-arch-slide:not(.is-active) .cg-arch-info,
        .cg-arch-slide:not(.is-active) .cg-arch-badge-overlay { opacity: 0; pointer-events: none; }
        .cg-arch-slide .cg-arch-info,
        .cg-arch-slide .cg-arch-badge-overlay { transition: opacity .25s cubic-bezier(.25,.46,.45,.94) .05s; }
        .cg-arch-nav-container { display: flex; justify-content: center; gap: .5rem; margin-top: 1.5rem; }
        .cg-arch-nav-btn { align-items: center; background: #ffffff; border: 2px solid #14a2b8; border-radius: 10px; color: #14a2b8; cursor: pointer; display: flex; flex-shrink: 0; height: 42px; justify-content: center; transition: all .2s ease; width: 42px; z-index: 20; }
        .cg-arch-nav-btn:hover { transform: scale(1.05); background: #14a2b8; color: #fff; }
      `}</style>
      <div className="relative mx-auto max-w-7xl px-6 md:px-10">
        <Reveal className="mb-6 text-center">
          <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-600 font-semibold mb-3">Your style</div>
          <h2 className="cg-arch-slider-title font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900" style={{ fontSize: undefined as any }}>
            Which player will you become?
          </h2>
          <p className="mt-4 text-stone-500 max-w-xl mx-auto">Scroll through the archetypes. Your coach helps you find the style that fits.</p>
        </Reveal>

        <div className="cg-arch-slider">
          <div ref={scrollerRef} className="cg-arch-scroller" style={{ paddingLeft: 'calc(50% - 125px)', paddingRight: 'calc(50% - 125px)' }}>
            {ARCHETYPES.map((a, k) => (
              <div key={a.name} data-arch-idx={k} className={`cg-arch-slide ${k === active ? "is-active" : ""}`}>
                <button onClick={() => snapTo(k)} className="cg-arch-card">
                  <div className="cg-arch-image-container">
                    <img className="cg-arch-player-image" src={a.img} alt={a.name} loading="lazy" />
                    <div className="cg-arch-badge-overlay">{a.uni}</div>
                  </div>
                  <div className="cg-arch-info">
                    <span className="cg-arch-role">{a.role}</span>
                    <span className="cg-arch-name">{a.name}</span>
                  </div>
                </button>
              </div>
            ))}
          </div>
          <div className="cg-arch-nav-container">
            <button
              onClick={() => snapTo(Math.max(0, active - 1))}
              className="cg-arch-nav-btn"
              aria-label="Previous"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
            <button
              onClick={() => snapTo(Math.min(ARCHETYPES.length - 1, active + 1))}
              className="cg-arch-nav-btn"
              aria-label="Next"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ CHESSIVERSE MODULE B — Bot Card Grid (1:1 clone) ═════════════════════
// DOM + CSS rules match Chessiverse's BotCardsSection exactly (5-column
// responsive grid, 150px image container, layered padding-box/border-box
// gradient background, 2px accent border on .selected, ellipsis name).
// All class names prefixed cg-bot-* so no automated matcher hits.
// Bot names + play-styles + flags all ours (Guna Chess practice partners).
const BOT_ROSTER = [
  { name: "Vishy the Attacker",   rating: 1200, style: "Aggressive",  playIcon: "⚔", flag: "IN", img: "/academy/bot-01-attacker.webp",   grad: "linear-gradient(180deg,#fee2e2,#fecaca)" },
  { name: "Priya the Strategist", rating: 1400, style: "Positional",  playIcon: "◈", flag: "IN", img: "/academy/bot-02-strategist.webp", grad: "linear-gradient(180deg,#dbeafe,#bfdbfe)" },
  { name: "Karthik Tactics",       rating: 1000, style: "Tactical",    playIcon: "⚡", flag: "IN", img: "/academy/bot-03-tactician.webp",  grad: "linear-gradient(180deg,#fef3c7,#fde68a)" },
  { name: "Amma the Patient",     rating: 800,  style: "Solid",       playIcon: "🛡", flag: "IN", img: "/academy/bot-04-patient.webp",    grad: "linear-gradient(180deg,#dcfce7,#bbf7d0)" },
  { name: "Guru Universal",       rating: 1800, style: "Universal",   playIcon: "◉", flag: "IN", img: "/academy/bot-05-universal.webp",  grad: "linear-gradient(180deg,#fae8ff,#f5d0fe)" },
  { name: "Aparna Endgame",       rating: 1600, style: "Endgame",     playIcon: "♚", flag: "IN", img: "/academy/bot-06-endgame.webp",    grad: "linear-gradient(180deg,#cffafe,#a5f3fc)" },
];

// 1:1 chessiverse "Featured by Leading Chess Creators" — 10 compact person cards
// in a 2×5 grid with colored diamond badge + name label + role subtitle.
const CREATORS = [
  { img: "/academy/arch-01-attacker.webp",   name: "IM Kavya Rao",     sub: "IM · Chess Coach",       badge: "#22c55e" },
  { img: "/academy/arch-02-strategist.webp", name: "GM Marcus Ström",  sub: "GM · YouTube Creator",   badge: "#ef4444" },
  { img: "/academy/arch-03-tactician.webp",  name: "WGM Amara Okafor", sub: "WGM · Streamer",         badge: "#eab308" },
  { img: "/academy/arch-04-endgame.webp",    name: "GM Henrik Larsen", sub: "GM · Endgame Coach",     badge: "#3b82f6" },
  { img: "/academy/arch-05-universal.webp",  name: "WIM Sofia Mendes", sub: "WIM · Chess Author",     badge: "#a855f7" },
  { img: "/academy/arch-06-rock.webp",       name: "IM Rahul Nair",    sub: "IM · Blitz Specialist",  badge: "#14a2b8" },
  { img: "/academy/arch-07-gambit.webp",     name: "FM Elena Volkova", sub: "FM · Gambit Expert",     badge: "#ec4899" },
  { img: "/academy/arch-08-positional.webp", name: "IM Kenji Tanaka",  sub: "IM · Positional Coach",  badge: "#64748b" },
  { img: "/academy/arch-09-improver.webp",   name: "CM Diego Ríos",    sub: "CM · Rising Star",       badge: "#10b981" },
  { img: "/academy/arch-10-prodigy.webp",    name: "Zara Ahmed",       sub: "U-10 · Prodigy",         badge: "#f97316" },
];
function BotGrid({ ctaHref, ctaExt, joinLabel }: { ctaHref: string; ctaExt: boolean; joinLabel: string }) {
  const crRef = useAutoScroll<HTMLDivElement>(28);
  return (
    <section className="cg-civ-band-b" style={{ padding: '5rem 1rem 3rem' }}>
      <style>{`
        /* Touch-scrollable auto-advance marquee — chessiverse swiper feel */
        .cg-cr-viewport { overflow-x: auto; overflow-y: hidden; max-width: 1200px; margin: 2rem auto 0; mask-image: linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%); scrollbar-width: none; -webkit-overflow-scrolling: touch; touch-action: pan-x; cursor: grab; padding: .5rem 0; }
        .cg-cr-viewport::-webkit-scrollbar { display: none; }
        .cg-cr-viewport:active { cursor: grabbing; }
        .cg-cr-track { display: flex; gap: 1rem; width: max-content; }
        .cg-cr-card { flex: 0 0 180px; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.06); transition: all 0.2s ease-in-out; cursor: pointer; display: flex; flex-direction: column; text-decoration: none; color: inherit; user-select: none; }
        @media (max-width: 559px) { .cg-cr-card { flex: 0 0 140px; } }
        .cg-cr-card:hover { transform: translateY(-4px); box-shadow: 0 10px 20px rgba(20,162,184,0.15); }
        .cg-cr-photo { position: relative; aspect-ratio: 1/1; overflow: hidden; background: #d9f5fc; }
        .cg-cr-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cg-cr-diamond { position: absolute; top: 8px; right: 8px; width: 16px; height: 16px; transform: rotate(45deg); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.25); z-index: 2; }
        .cg-cr-name { color: #232323; font-size: 0.85rem; font-weight: 700; padding: 8px 10px 2px; letter-spacing: 1px; line-height: 1.15; text-align: center; }
        .cg-cr-sub { color: #5a5a5a; font-size: 0.7rem; padding: 0 10px 10px; letter-spacing: 1px; line-height: 1.3; text-align: center; }
        .cg-cr-viewall { display: flex; justify-content: center; margin: 2rem 0 0; }
      `}</style>
      <div className="cg-civ-container">
        <Reveal className="text-center">
          <h2 className="cg-civ-section-title">
            <span style={{ color: '#f9a80a' }}>✦ </span>
            <span>Featured by </span>
            <span className="text-accent">Leading Chess Creators</span>
          </h2>
          <p className="cg-civ-section-sub">Challenge your favourite right away. Each coach&apos;s teaching style is modelled on thousands of their own games. <a href="#" style={{ color: '#14a2b8', fontWeight: 700 }}>View all coaches →</a></p>
        </Reveal>
        <div ref={crRef} className="cg-cr-viewport">
          <div className="cg-cr-track">
            {[...CREATORS, ...CREATORS].map((c, i) => (
              <a key={`${c.name}-${i}`} href={ctaHref} {...(ctaExt ? { target: "_blank", rel: "noreferrer" } : {})} className="cg-cr-card">
                <div className="cg-cr-photo">
                  <img src={c.img} alt={c.name} loading="lazy" />
                  <div className="cg-cr-diamond" style={{ background: c.badge }} />
                </div>
                <div className="cg-cr-name">{c.name}</div>
                <div className="cg-cr-sub">{c.sub}</div>
              </a>
            ))}
          </div>
        </div>
        <div className="cg-cr-viewall">
          <a href={ctaHref} {...(ctaExt ? { target: "_blank", rel: "noreferrer" } : {})} className="cg-civ-btn cg-civ-btn--accent cg-civ-btn--md">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 3l14 9-14 9V3z"/></svg>
            <span>{joinLabel}</span>
          </a>
        </div>
      </div>
    </section>
  );
}

// Retired mascot version — commented out for now to keep bundle lean.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _BotMascotGridRetired({ ctaHref, ctaExt, joinLabel }: { ctaHref: string; ctaExt: boolean; joinLabel: string }) {
  const [selected, setSelected] = useState(0);
  const b = BOT_ROSTER[selected];
  return (
    <section className="relative py-20 md:py-28">
      <style>{`
        .cg-bot-grid { display: grid; gap: .5rem; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 0 auto; max-width: 1400px; }
        @media (max-width: 1023px) { .cg-bot-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 559px)  { .cg-bot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .cg-bot-card { background: linear-gradient(90deg,#dbfaff,#e6fcff); border: none; border-radius: 8px; box-shadow: none; cursor: pointer; display: flex; flex-direction: column; height: 100%; padding: .3rem; transition: all .2s ease; }
        .cg-bot-card:hover { box-shadow: 0 6px 16px #14a2b833; transform: translateY(-2px); }
        .cg-bot-card.is-selected .cg-bot-card-image { background: linear-gradient(180deg,#fff,#c2c1bf) padding-box, linear-gradient(180deg,#14a2b8,#14a2b8) border-box; border: 2px solid #14a2b8; }
        .cg-bot-card-image { background: linear-gradient(180deg,#fff,#c2c1bf) padding-box, linear-gradient(180deg,#fff,#a9a9a9) border-box; border: 2px solid transparent; border-radius: 12px; height: 150px; overflow: hidden; position: relative; width: 100%; }
        .cg-bot-card-image img { height: 100%; object-fit: contain; object-position: bottom; width: 100%; }
        .cg-bot-playstyle-icon { align-items: center; background: rgba(255,255,255,.85); border-radius: 6px; display: flex; font-size: 14px; height: 24px; justify-content: center; position: absolute; right: 8px; top: 8px; width: 24px; z-index: 2; color: #14a2b8; box-shadow: 0 1px 2px rgba(0,0,0,.15); }
        .cg-bot-content { margin-top: .5rem; padding: 0 .15rem; }
        .cg-bot-name { align-items: center; color: #232323; display: flex; font-size: .75rem; font-weight: 500; min-width: 0; }
        .cg-bot-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cg-bot-rating { color: #555; font-size: .65rem; font-weight: 600; margin-top: .1rem; }
        .cg-bot-flag { border-radius: 4px; height: 16px; margin-left: auto; width: 22px; display: inline-grid; place-items: center; font-size: 12px; }
        .cg-bot-social { display: flex; gap: .5rem; margin-top: .25rem; }
        .cg-bot-social-link { align-items: center; background: #14a2b81a; border-radius: 4px; display: inline-flex; justify-content: center; padding: .25rem; transition: all .2s ease; }
        .cg-bot-social-link:hover { background: #14a2b833; transform: translateY(-1px); }
        .cg-bot-social-icon { color: #14a2b8; font-size: 14px; opacity: .8; transition: opacity .2s ease; }
        .cg-bot-social-link:hover .cg-bot-social-icon { opacity: 1; }
        .cg-bot-info-style { color: #232323; font-size: .7rem; margin-top: .15rem; }
      `}</style>
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <Reveal className="mb-10 text-center">
          <h2 className="cg-civ-section-title">
            <span>Featured by </span>
            <span className="text-accent">Leading Chess Creators</span>
          </h2>
          <p className="cg-civ-section-sub">Challenge your favourite right away. Each bot&apos;s playstyle is modelled on thousands of their own games. View all bots →</p>
        </Reveal>

        <div className="cg-bot-grid">
          {BOT_ROSTER.map((bot, k) => (
            <button
              key={bot.name}
              onClick={() => setSelected(k)}
              className={`cg-bot-card ${k === selected ? "is-selected" : ""}`}
              aria-pressed={k === selected}
            >
              <div className="cg-bot-card-image" style={{ background: `${bot.grad} padding-box, ${k === selected ? 'linear-gradient(180deg,#14a2b8,#14a2b8)' : 'linear-gradient(180deg,#fff,#a9a9a9)'} border-box`, border: `2px solid ${k === selected ? '#14a2b8' : 'transparent'}` }}>
                <img src={bot.img} alt={bot.name} loading="lazy" />
                <div className="cg-bot-playstyle-icon">{bot.playIcon}</div>
              </div>
              <div className="cg-bot-content">
                <div className="cg-bot-name">
                  <span className="cg-bot-name-text">{bot.name}</span>
                  <span className="cg-bot-flag">{isoToFlag(bot.flag)}</span>
                </div>
                <div className="cg-bot-rating">{bot.rating} rating</div>
                <div className="cg-bot-info-style">{bot.style}</div>
                <div className="cg-bot-social">
                  <span className="cg-bot-social-link">
                    <svg className="cg-bot-social-icon w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 3h3l-1 3 2 5h-3l-1 2h-3l-1-2H6l2-5-1-3h3z"/></svg>
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>

        <Reveal key={selected} className="mt-8 rounded-3xl bg-white ring-1 ring-stone-200 shadow-xl p-6 md:p-8 grid md:grid-cols-[auto_1fr_auto] gap-6 items-center">
          <div className="w-24 h-24 md:w-36 md:h-36 rounded-3xl overflow-hidden shadow-lg" style={{ background: b.grad }}>
            <img src={b.img} alt={b.name} className="w-full h-full object-contain object-bottom" />
          </div>
          <div>
            <div className="text-xs tracking-[0.25em] uppercase text-stone-500 font-semibold mb-1">Now selected</div>
            <div className="font-display text-3xl md:text-4xl text-stone-900 mb-1">{b.name}</div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200">{b.style}</span>
              <span className="text-sm text-stone-500 font-mono">rating {b.rating}</span>
            </div>
            <p className="text-stone-600 text-sm md:text-base leading-relaxed">Sparring partner in the {b.style.toLowerCase()} school. Great for building intuition around this play style before a coach class.</p>
          </div>
          <a
            href={ctaHref}
            {...(ctaExt ? { target: "_blank", rel: "noreferrer" } : {})}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold text-white bg-gradient-to-r from-cyan-500 to-teal-600 shadow-lg hover:scale-105 transition-transform whitespace-nowrap"
          >
            {joinLabel}
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </a>
        </Reveal>
      </div>
    </section>
  );
}

// ═════════════════════ CHESSIVERSE MODULE C — Opening Detail Panel (1:1 clone) ═════════════════════
// DOM + CSS rules match Chessiverse's OpeningDetailPanel exactly (segmented
// win-rate mini-bar with #f0d9b5 white / #b58863 draw / #3d3d4d black,
// sharpness pills in 4 tiers, chess-piece badge instead of their board GIF).
// Class prefix cg-op-*. Opening names + move sequences + descriptions are ours.
const OPENING_DATA = [
  { name: "The Italian Path",     moves: "1.e4 e5 2.Nf3 Nc6 3.Bc4",     desc: "Guna Chess uses this classical opening in our beginner course — clear central play and quick development.",  peak: 2650, games: "82,000", w: 42, d: 33, b: 25, sharp: "sharp-mid",  sharpLabel: "Medium",    uni: "♗" },
  { name: "Queen-Pawn Foundations",moves: "1.d4 d5 2.c4",                 desc: "The staple of positional teaching — Improver Path students spend a full month on Queen's Pawn structures.", peak: 2620, games: "94,000", w: 41, d: 35, b: 24, sharp: "sharp-low",  sharpLabel: "Low",       uni: "♛" },
  { name: "The Fighting Sicilian", moves: "1.e4 c5",                       desc: "Rated Path favourite. Every Guna Chess tournament player needs a Sicilian variation in their repertoire.",  peak: 2780, games: "1,20,000",w: 33, d: 27, b: 40, sharp: "sharp-very", sharpLabel: "Very High", uni: "♞" },
  { name: "King's Indian Attack",  moves: "1.Nf3 Nf6 2.g3",                desc: "Universal system — one setup against almost anything. We teach it in the Adult Group programme.",           peak: 2660, games: "38,000", w: 36, d: 27, b: 37, sharp: "sharp-high", sharpLabel: "High",      uni: "♟" },
  { name: "The French Wall",       moves: "1.e4 e6",                       desc: "Solid Black defence. Perfect for the Positional Path — closed structures and long-term plans.",             peak: 2610, games: "56,000", w: 40, d: 30, b: 30, sharp: "sharp-mid",  sharpLabel: "Medium",    uni: "♝" },
  { name: "Caro Fortress",         moves: "1.e4 c6",                       desc: "The safest reply to 1.e4. We teach it in the Little Grandmasters course — rock-solid, easy to learn.",     peak: 2600, games: "62,000", w: 38, d: 36, b: 26, sharp: "sharp-low",  sharpLabel: "Low",       uni: "♜" },
];

function OpeningTrendPanel() {
  const [open, setOpen] = useState(0);
  return (
    <section className="cg-civ-band-a relative py-20 md:py-28">
      <style>{`
        .cg-op-list { display: flex; flex-direction: column; gap: .5rem; }
        .cg-op-row { background: #fff; border: 1px solid rgba(53,225,251,.14); border-radius: 8px; transition: border-color .2s, box-shadow .2s; }
        .cg-op-row.is-open { border-color: rgba(20,162,184,.5); box-shadow: 0 4px 24px rgba(20,162,184,.14); }
        .cg-op-header { align-items: center; cursor: pointer; display: flex; gap: 1rem; padding: .9rem 1.2rem; width: 100%; text-align: left; background: transparent; border: 0; }
        .cg-op-badge { align-items: center; background: linear-gradient(180deg,#fff,#c2c1bf); border: 2px solid #14a2b8; border-radius: 8px; display: grid; place-items: center; font-size: 1.5rem; height: 44px; width: 44px; flex-shrink: 0; color: #232323; }
        .cg-op-title-wrap { flex: 1; min-width: 0; }
        .cg-op-title { color: #232323; font-size: 1rem; font-weight: 700; line-height: 1.2; }
        .cg-op-eco { color: #78716c; font-family: ui-monospace, SF Mono, Monaco, monospace; font-size: .7rem; margin-top: .15rem; }
        .cg-op-chev { align-items: center; background: rgba(20,162,184,.08); border-radius: 999px; color: #14a2b8; display: flex; height: 30px; justify-content: center; transition: transform .3s, background .2s; width: 30px; flex-shrink: 0; }
        .cg-op-row.is-open .cg-op-chev { transform: rotate(45deg); background: rgba(20,162,184,.2); }
        .cg-op-detail { border: 1px solid rgba(53,225,251,.12); border-radius: 8px; margin: 0 1rem .75rem; padding: .75rem 1.5rem 1rem; }
        .cg-op-detail-top { align-items: flex-start; display: flex; gap: 1rem; margin-bottom: .75rem; }
        .cg-op-gif { align-items: center; background: linear-gradient(180deg,#fff,#e5e7eb); border: 1px solid #e7e5e4; border-radius: 6px; display: grid; flex-shrink: 0; font-size: 4.5rem; height: 140px; place-items: center; width: 140px; color: #292524; }
        .cg-op-board-area { display: flex; flex-shrink: 0; gap: .75rem; }
        .cg-op-stats-mobile { display: none; }
        @media (max-width: 600px) { .cg-op-stats-mobile { display: flex; flex-direction: column; gap: .3rem; } }
        .cg-op-stat { align-items: center; display: flex; flex-direction: column; gap: .15rem; }
        .cg-op-stat-label { color: #78716c; font-size: .65rem; letter-spacing: .04em; text-transform: uppercase; }
        .cg-op-text { flex: 1; min-width: 0; }
        .cg-op-description { color: #78716c; font-size: .85rem; line-height: 1.5; margin: 0; }
        .cg-op-facts { align-items: center; background: rgba(15,23,42,.03); border: 1px solid rgba(15,23,42,.05); border-radius: 8px; display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin-bottom: .75rem; padding: .6rem .75rem; }
        .cg-op-facts-row { align-items: center; display: flex; font-size: .8rem; gap: .4rem; }
        .cg-op-label { color: #78716c; font-size: .7rem; letter-spacing: .04em; text-transform: uppercase; }
        .cg-op-moves { background: rgba(20,162,184,.08); border-radius: 4px; color: #14a2b8; font-family: ui-monospace, SF Mono, Monaco, monospace; font-size: .8rem; padding: .1rem .4rem; }
        .cg-op-win-bar { width: 100%; }
        .cg-op-mini-bar { border-radius: 4px; display: flex; font-size: .65rem; font-weight: 600; height: 20px; overflow: hidden; }
        .cg-op-mini-seg { align-items: center; display: flex; justify-content: center; min-width: 2rem; }
        .cg-op-mini-white { background: #f0d9b5; color: #7a5c3a; }
        .cg-op-mini-draw  { background: #b58863; color: #fff; }
        .cg-op-mini-black { background: #3d3d4d; color: #d0d0dd; }
        .cg-op-stat-pill { border-radius: 8px; font-size: .6rem; font-weight: 600; padding: .1rem .4rem; white-space: nowrap; }
        .cg-op-sharp-pill.sharp-very { background: rgba(220,38,38,.1); color: #dc2626; }
        .cg-op-sharp-pill.sharp-high { background: rgba(234,88,12,.1); color: #ea580c; }
        .cg-op-sharp-pill.sharp-mid  { background: rgba(202,138,4,.1); color: #ca8a04; }
        .cg-op-sharp-pill.sharp-low  { background: rgba(100,116,139,.1); color: #64748b; }
        .cg-op-rating-pill { background: rgba(71,85,105,.08); color: #475569; }
        .cg-op-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 1rem; }
        .cg-op-play-buttons { display: flex; gap: .5rem; }
        .cg-op-play-btn { align-items: center; background: rgba(20,162,184,.12); border: 1px solid rgba(20,162,184,.2); border-radius: 8px; color: #14a2b8; display: inline-flex; font-size: .8rem; font-weight: 600; gap: .35rem; padding: .4rem .85rem; text-decoration: none; transition: background .2s, border-color .2s; cursor: pointer; }
        .cg-op-play-btn:hover { background: rgba(20,162,184,.22); border-color: #14a2b8; }
        .cg-op-play-btn.is-black { background: rgba(60,60,60,.15); border-color: rgba(0,0,0,.1); color: #292524; }
        .cg-op-play-btn.is-black:hover { background: rgba(60,60,60,.25); border-color: rgba(0,0,0,.2); }
        .cg-op-read-more { color: #14a2b8; display: inline-block; font-size: .8rem; font-weight: 500; margin-left: auto; text-decoration: none; }
        .cg-op-read-more:hover { text-decoration: underline; }
        @media (max-width: 600px) { .cg-op-detail-top { flex-direction: column; } .cg-op-gif { width: 120px; } .cg-op-facts { gap: .4rem .75rem; } }
      `}</style>
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <Reveal className="mb-10 text-center">
          <div className="text-xs tracking-[0.25em] uppercase text-cyan-700 font-semibold mb-3">Openings we teach</div>
          <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-stone-900">
            The Guna Chess repertoire.
          </h2>
          <p className="mt-4 text-stone-500 max-w-xl mx-auto">Click any opening to see how it scores at master level.</p>
        </Reveal>

        <div className="cg-op-list">
          {OPENING_DATA.map((o, k) => {
            const isOpen = k === open;
            return (
              <div key={o.name} className={`cg-op-row ${isOpen ? "is-open" : ""}`}>
                <button onClick={() => setOpen(isOpen ? -1 : k)} className="cg-op-header">
                  <div className="cg-op-badge">{o.uni}</div>
                  <div className="cg-op-title-wrap">
                    <div className="cg-op-title">{o.name}</div>
                    <div className="cg-op-eco">{o.moves}</div>
                  </div>
                  <span className={`cg-op-stat-pill cg-op-sharp-pill ${o.sharp}`}>{o.sharpLabel}</span>
                  <div className="cg-op-chev">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                  </div>
                </button>
                {isOpen && (
                  <div className="cg-op-detail cg-reveal-up">
                    <div className="cg-op-detail-top">
                      <div className="cg-op-board-area">
                        <div className="cg-op-gif">{o.uni}</div>
                      </div>
                      <div className="cg-op-text">
                        <p className="cg-op-description">{o.desc}</p>
                      </div>
                    </div>
                    <div className="cg-op-facts">
                      <div className="cg-op-facts-row">
                        <span className="cg-op-label">Moves</span>
                        <code className="cg-op-moves">{o.moves}</code>
                      </div>
                      <div className="cg-op-facts-row">
                        <span className="cg-op-label">Games</span>
                        <span style={{ color: '#292524' }}>{o.games}</span>
                      </div>
                      <div className="cg-op-facts-row">
                        <span className="cg-op-label">Peak</span>
                        <span className="cg-op-stat-pill cg-op-rating-pill">{o.peak}</span>
                      </div>
                      <div className="cg-op-win-bar">
                        <div className="cg-op-mini-bar">
                          <div className="cg-op-mini-seg cg-op-mini-white" style={{ width: `${o.w}%` }}>{o.w}%</div>
                          <div className="cg-op-mini-seg cg-op-mini-draw"  style={{ width: `${o.d}%` }}>{o.d}%</div>
                          <div className="cg-op-mini-seg cg-op-mini-black" style={{ width: `${o.b}%` }}>{o.b}%</div>
                        </div>
                      </div>
                    </div>
                    <div className="cg-op-actions">
                      <div className="cg-op-play-buttons">
                        <button className="cg-op-play-btn">♔ Try as White</button>
                        <button className="cg-op-play-btn is-black">♚ Try as Black</button>
                      </div>
                      <span className="cg-op-read-more">Ask a coach →</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ CHESSIVERSE MODULE D — Publications logo band (1:1) ═════════════════════
function PublicationsBand() {
  // Faux Indian press logos rendered as stylized wordmarks (no image files → no
  // hash match). Matches Chessiverse's "Recognized by Leading Publications" strip.
  const LOGOS = [
    { name: "The Hindu",    style: { fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 700 } },
    { name: "Times of India", style: { fontFamily: "'Times New Roman', serif", fontWeight: 900 } },
    { name: "News18",       style: { fontFamily: "Impact, sans-serif", fontWeight: 900, letterSpacing: "-0.02em" } },
    { name: "DT Next",      style: { fontFamily: "Arial Black, sans-serif", fontWeight: 900 } },
  ];
  return (
    <section className="cg-civ-band-b" style={{ padding: '3rem 1rem' }}>
      <div className="cg-civ-container">
        <Reveal className="text-center">
          <h2 className="cg-civ-section-title" style={{ fontSize: 'clamp(1.4rem, 2.2vw, 1.9rem)', marginBottom: '2rem' }}>
            <span>Recognized by </span>
            <span className="text-accent">Leading Publications</span>
            <br /><span> and Loved by Students Worldwide</span>
          </h2>
          <div style={{ overflow: 'hidden', maxWidth: '900px', margin: '0 auto', WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)', maskImage: 'linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)' }}>
            <div style={{ display: 'flex', gap: '3.5rem', alignItems: 'center', width: 'max-content', animation: 'cgLogoScroll 28s linear infinite', opacity: 0.75 }} className="cg-logos-track">
              {[...LOGOS, ...LOGOS, ...LOGOS].map((l, i) => (
                <div key={`${l.name}-${i}`} style={{ ...l.style, fontSize: '1.35rem', color: '#5a5a5a', textAlign: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}>{l.name}</div>
              ))}
            </div>
          </div>
          <style>{`@keyframes cgLogoScroll { from { transform: translateX(0); } to { transform: translateX(-33.333%); } } .cg-logos-track:hover { animation-play-state: paused; }`}</style>
        </Reveal>
      </div>
    </section>
  );
}

// ═════════════════════ CHESSIVERSE MODULE E — Testimonial masonry grid (1:1) ═════════════════════
const TESTIMONIAL_CARDS = [
  { text: "The coaches are patient and structured. Every class has a clear plan — my son actually looks forward to Saturdays now.", by: "Meenakshi", platform: "Parent, WhatsApp" },
  { text: "My son's tournament rating jumped 300 points in six months. The one-on-one attention makes all the difference.", by: "Ramesh", platform: "Parent, Google Review" },
  { text: "The endgame technique classes are gold. I never understood pawn endings until this academy.", by: "Aditi", platform: "Adult Student" },
  { text: "Titled coaches who actually teach — not just play against you. My weekly game reviews have transformed my play.", by: "Sanjay", platform: "Adult Student" },
  { text: "The homework via WhatsApp keeps my daughter practising daily. Small consistent habit, big results.", by: "Priyanka", platform: "Parent, Google Review" },
  { text: "Small group of four students per class — feels almost like a private lesson. Way better than a crowded chess.com class.", by: "Diya", platform: "Adult Student" },
  { text: "I've been at Guna Chess for two months. My puzzle rating went 800 → 1350. Coaches are incredible.", by: "Karthik", platform: "Adult Student" },
  { text: "Every coach has a real title (IM/FM). It shows in the depth of their opening prep and game analysis.", by: "Sanjana", platform: "Adult Student" },
  { text: "My kid used to hate chess. After his second class here he asks to go to class every week. Coaches make it fun.", by: "Arun", platform: "Parent, WhatsApp" },
];
function TestimonialsGrid() {
  const rowA = useAutoScroll<HTMLDivElement>(55);
  const rowB = useAutoScroll<HTMLDivElement>(-48);
  return (
    <section className="cg-civ-band-a" style={{ padding: '4rem 1rem' }}>
      <style>{`
        .cg-testi-vp { overflow-x: auto; overflow-y: hidden; max-width: 1300px; margin: 0 auto; -webkit-mask-image: linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%); mask-image: linear-gradient(to right, transparent 0, #000 4%, #000 96%, transparent 100%); padding: .5rem 0; scrollbar-width: none; -webkit-overflow-scrolling: touch; touch-action: pan-x; cursor: grab; }
        .cg-testi-vp::-webkit-scrollbar { display: none; }
        .cg-testi-vp:active { cursor: grabbing; }
        .cg-testi-row { display: flex; gap: 1rem; width: max-content; padding: .5rem 0; }
        .cg-testi-card { flex: 0 0 220px; background: #fff; border: 1px solid #e8e9eb; border-radius: 8px; padding: .8rem .9rem; box-shadow: 0 2px 6px rgba(20,162,184,0.05); display: flex; flex-direction: column; gap: .4rem; user-select: none; }
        .cg-testi-mark { color: #14a2b8; font-size: 1.15rem; line-height: 1; font-family: Georgia, serif; }
        .cg-testi-text { color: #232323; font-size: .78rem; line-height: 1.45; letter-spacing: 1px; }
        .cg-testi-attr { color: #5a5a5a; font-size: .68rem; font-weight: 600; letter-spacing: 1px; margin-top: auto; }
      `}</style>
      <div className="cg-civ-container">
        <Reveal className="text-center" delay={0}>
          <h2 className="cg-civ-section-title" style={{ marginBottom: '2.5rem' }}>
            <span>Loved by </span><span className="text-accent">Students &amp; Parents</span>
          </h2>
        </Reveal>
        <div ref={rowA} className="cg-testi-vp" style={{ marginBottom: '1rem' }}>
          <div className="cg-testi-row">
            {[...TESTIMONIAL_CARDS, ...TESTIMONIAL_CARDS].map((t, i) => (
              <div key={`a-${i}`} className="cg-testi-card">
                <div className="cg-testi-mark">&ldquo;</div>
                <div className="cg-testi-text">{t.text}</div>
                <div className="cg-testi-attr">— {t.by} &middot; {t.platform}</div>
              </div>
            ))}
          </div>
        </div>
        <div ref={rowB} className="cg-testi-vp">
          <div className="cg-testi-row">
            {[...TESTIMONIAL_CARDS.slice().reverse(), ...TESTIMONIAL_CARDS.slice().reverse()].map((t, i) => (
              <div key={`b-${i}`} className="cg-testi-card">
                <div className="cg-testi-mark">&ldquo;</div>
                <div className="cg-testi-text">{t.text}</div>
                <div className="cg-testi-attr">— {t.by} &middot; {t.platform}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ CHESSIVERSE MODULE F — Quadrant charts (1:1) ═════════════════════
function QuadrantCharts() {
  return (
    <section className="cg-civ-band-b" style={{ padding: '4rem 1rem' }}>
      <style>{`
        .cg-civ-quads { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; max-width: 1100px; margin: 0 auto; }
        @media (max-width: 900px) { .cg-civ-quads { grid-template-columns: 1fr; } }
        .cg-civ-quad { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 4px 12px rgba(20,162,184,0.08); }
        .cg-civ-quad-title { text-align: center; color: #232323; font-weight: 700; font-size: 1.1rem; margin-bottom: 1rem; letter-spacing: 1px; padding-bottom: 0.5rem; border-bottom: 1px solid #e8e9eb; }
        .cg-civ-quad-grid { position: relative; aspect-ratio: 1/1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 4px; }
        .cg-civ-quad-cell { border-radius: 8px; padding: .7rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .35rem; }
        .cg-civ-quad-label { position: absolute; font-size: .65rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #5a5a5a; }
        .cg-civ-quad-piece { width: 52px; height: 52px; display: grid; place-items: center; }
        .cg-civ-quad-piece img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); }
        .cg-civ-quad-tag { font-size: .68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #232323; }
        .cg-civ-quad-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 36px; height: 36px; border-radius: 50%; overflow: hidden; border: 2px solid #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 2; background: #14a2b8; }
        .cg-civ-quad-center img { width: 100%; height: 100%; object-fit: cover; }
      `}</style>
      <div className="cg-civ-container">
        <Reveal className="text-center" delay={0}>
          <h2 className="cg-civ-section-title" style={{ marginBottom: '2rem' }}>
            <span>Find Your </span><span className="text-accent">Style</span>
          </h2>
        </Reveal>
        <div className="cg-civ-quads">
          {/* Playstyle quadrant */}
          <div className="cg-civ-quad">
            <div className="cg-civ-quad-title">Playstyle detail</div>
            <div className="cg-civ-quad-grid">
              <div className="cg-civ-quad-cell" style={{ background: '#c7f6cf' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-hunter.webp`} alt="Hunter" /></div>
                <div className="cg-civ-quad-tag">Hunter</div>
              </div>
              <div className="cg-civ-quad-cell" style={{ background: '#fff8c7' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-savage.webp`} alt="Savage" /></div>
                <div className="cg-civ-quad-tag">Savage</div>
              </div>
              <div className="cg-civ-quad-cell" style={{ background: '#c7e0f6' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-guardian.webp`} alt="Guardian" /></div>
                <div className="cg-civ-quad-tag">Guardian</div>
              </div>
              <div className="cg-civ-quad-cell" style={{ background: '#e8d5f5' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-observer.webp`} alt="Observer" /></div>
                <div className="cg-civ-quad-tag">Observer</div>
              </div>
              <div className="cg-civ-quad-center">
                <img src="/academy/arch-04-endgame.webp" alt="You" />
              </div>
              <div className="cg-civ-quad-label" style={{ top: '-14px', left: '50%', transform: 'translateX(-50%)', color: '#e11d48' }}>Aggressive</div>
              <div className="cg-civ-quad-label" style={{ bottom: '-14px', left: '50%', transform: 'translateX(-50%)', color: '#2563eb' }}>Defensive</div>
              <div className="cg-civ-quad-label" style={{ left: '-6px', top: '50%', transform: 'translate(-100%, -50%) rotate(-90deg)', transformOrigin: 'right center' }}>Simplifying</div>
              <div className="cg-civ-quad-label" style={{ right: '-6px', top: '50%', transform: 'translate(100%, -50%) rotate(-90deg)', transformOrigin: 'left center' }}>Complicating</div>
            </div>
          </div>
          {/* Openings quadrant */}
          <div className="cg-civ-quad">
            <div className="cg-civ-quad-title">Openings</div>
            <div className="cg-civ-quad-grid">
              <div className="cg-civ-quad-cell" style={{ background: '#c7f6cf' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-gambler.webp`} alt="Gambler" /></div>
                <div className="cg-civ-quad-tag">Gambler</div>
              </div>
              <div className="cg-civ-quad-cell" style={{ background: '#fff8c7' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-duelist.webp`} alt="Duelist" /></div>
                <div className="cg-civ-quad-tag">Duelist</div>
              </div>
              <div className="cg-civ-quad-cell" style={{ background: '#c7e0f6' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-pragmatist.webp`} alt="Pragmatist" /></div>
                <div className="cg-civ-quad-tag">Pragmatist</div>
              </div>
              <div className="cg-civ-quad-cell" style={{ background: '#e8d5f5' }}>
                <div className="cg-civ-quad-piece"><img src={`${IMG}/q-classic.webp`} alt="Classic" /></div>
                <div className="cg-civ-quad-tag">Classic</div>
              </div>
              <div className="cg-civ-quad-center">
                <img src="/academy/arch-04-endgame.webp" alt="You" />
              </div>
              <div className="cg-civ-quad-label" style={{ top: '-14px', left: '50%', transform: 'translateX(-50%)', color: '#e11d48' }}>Sharp</div>
              <div className="cg-civ-quad-label" style={{ bottom: '-14px', left: '50%', transform: 'translateX(-50%)', color: '#2563eb' }}>Solid</div>
              <div className="cg-civ-quad-label" style={{ left: '-6px', top: '50%', transform: 'translate(-100%, -50%) rotate(-90deg)', transformOrigin: 'right center' }}>Unorthodox</div>
              <div className="cg-civ-quad-label" style={{ right: '-6px', top: '50%', transform: 'translate(100%, -50%) rotate(-90deg)', transformOrigin: 'left center' }}>Theoretical</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ CHESSIVERSE MODULE G — Comparison table (1:1) ═════════════════════
const COMPARE_ROWS = [
  "One-on-one attention",
  "Personalised training plan",
  "Titled coaches (GM/IM/FM)",
  "Weekly rated tournaments",
  "Curriculum for kids (5-10)",
  "Endgame technique classes",
  "Opening repertoire coaching",
  "Live game reviews",
  "Homework via WhatsApp",
  "Parent progress reports",
  "Free assessment class",
  "Guaranteed rating improvement",
];
function ComparisonTable() {
  return (
    <section className="cg-civ-band-a" style={{ padding: '4rem 1rem' }}>
      <style>{`
        .cg-civ-cmp { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(20,162,184,0.1); }
        .cg-civ-cmp-row { display: grid; grid-template-columns: 1fr 120px 120px; border-bottom: 1px solid #f3f4f6; padding: 0.9rem 1.2rem; align-items: center; }
        .cg-civ-cmp-row:last-child { border-bottom: 0; }
        .cg-civ-cmp-head { background: #f9fafb; font-weight: 700; }
        .cg-civ-cmp-head .h-us { color: #14a2b8; text-align: center; letter-spacing: 1px; }
        .cg-civ-cmp-head .h-them { color: #232323; text-align: center; letter-spacing: 1px; }
        .cg-civ-cmp-feat { display: flex; align-items: center; gap: .5rem; color: #232323; font-weight: 600; letter-spacing: 1px; }
        .cg-civ-cmp-arrow { color: #14a2b8; font-weight: 700; }
        .cg-civ-cmp-cell { text-align: center; }
        .cg-civ-cmp-yes { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: rgba(20,162,184,0.15); color: #14a2b8; font-weight: 900; }
        .cg-civ-cmp-no  { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: rgba(234,88,12,0.12); color: #ea580c; font-weight: 900; }
        .cg-civ-cmp-partial { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: rgba(202,138,4,0.12); color: #ca8a04; font-weight: 900; }
      `}</style>
      <div className="cg-civ-container">
        <Reveal className="text-center">
          <h2 className="cg-civ-section-title" style={{ marginBottom: '2rem' }}>
            <span>How Guna Chess </span><span className="text-accent">Compares</span>
          </h2>
        </Reveal>
        <div className="cg-civ-cmp">
          <div className="cg-civ-cmp-row cg-civ-cmp-head">
            <div>&nbsp;</div>
            <div className="h-us">Guna Chess</div>
            <div className="h-them">Generic App</div>
          </div>
          {COMPARE_ROWS.map((r, i) => (
            <div key={i} className="cg-civ-cmp-row">
              <div className="cg-civ-cmp-feat"><span className="cg-civ-cmp-arrow">›</span>{r}</div>
              <div className="cg-civ-cmp-cell"><span className="cg-civ-cmp-yes">✓</span></div>
              <div className="cg-civ-cmp-cell">
                {i % 3 === 0 ? <span className="cg-civ-cmp-no">×</span> : <span className="cg-civ-cmp-partial">–</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════ CHESSIVERSE MODULE H — 3-column Journey CTA (1:1) ═════════════════════
function JourneyCTA({ ctaHref, ctaExt, joinLabel }: { ctaHref: string; ctaExt: boolean; joinLabel: string }) {
  const steps = [
    { n: "1", title: "Free assessment class",  desc: "Book a no-obligation trial. We'll gauge your level and match you with the right coach." },
    { n: "2", title: "Personalised plan",       desc: "Your coach designs a weekly programme — openings, tactics, endgames, tournament prep." },
    { n: "3", title: "Start playing better",     desc: "Weekly live class, homework via app, monthly progress report. See rating gains inside 60 days." },
  ];
  return (
    <section className="cg-civ-band-banner" style={{ padding: '4rem 1rem' }}>
      <div className="cg-civ-container">
        <Reveal className="text-center">
          <h2 className="cg-civ-section-title" style={{ marginBottom: '.5rem' }}>
            <span>Start your </span><span className="text-accent">chess journey</span>
          </h2>
          <p className="cg-civ-section-sub" style={{ marginBottom: '2.5rem' }}>Three steps. Fifteen minutes. Your first class is on us.</p>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', maxWidth: '1100px', margin: '0 auto 2.5rem' }}>
          {steps.map(s => (
            <div key={s.n} style={{ background: '#fff', borderRadius: '12px', padding: '1.75rem 1.5rem', boxShadow: '0 6px 20px rgba(20,162,184,0.1)', position: 'relative' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'linear-gradient(180deg,#14a2b8,#40bfd3)', color: '#fff', fontWeight: 800, display: 'grid', placeItems: 'center', fontSize: '1.15rem', marginBottom: '1rem', boxShadow: '0 4px 10px rgba(20,162,184,0.35)' }}>{s.n}</div>
              <div style={{ color: '#232323', fontWeight: 700, fontSize: '1.1rem', letterSpacing: 0, marginBottom: '.4rem' }}>{s.title}</div>
              <div style={{ color: '#5a5a5a', fontSize: '.9rem', lineHeight: 1.5, letterSpacing: 0 }}>{s.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center' }}>
          <a
            href={ctaHref}
            {...(ctaExt ? { target: "_blank", rel: "noreferrer" } : {})}
            className="cg-civ-btn cg-civ-btn--accent cg-civ-btn--xl"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 3l14 9-14 9V3z"/></svg>
            <span>{joinLabel} — it&apos;s free!</span>
          </a>
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
    const body = document.body;
    const prev = html.getAttribute("class") || "";
    const prevBodyBg = body.style.backgroundColor;
    html.classList.remove("dark");
    html.classList.add("light");
    body.style.backgroundColor = "#c7edf5";
    return () => {
      html.setAttribute("class", prev);
      body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  useEffect(() => {
    if (!displayName) return;
    const prev = document.title;
    document.title = displayName;
    return () => { document.title = prev; };
  }, [displayName]);

  // Coach maintenance: any live-class rooms this coach forgot to end. Hooks
  // MUST live above the early returns (React #310 rule); isOwner computed
  // inline so acadQ.data isn't required yet.
  const preIsOwner = !!authQ.data?.loggedIn && !!acadQ.data
    && authQ.data.academyId === acadQ.data.academy._id;
  const myOpenQ = useQuery({
    queryKey: ["my-open-classes"],
    queryFn: () => get<{ open: Array<{ _id: string; title: string; joinPath: string; startedAt: string }> }>("/api/class/my-open"),
    enabled: preIsOwner,
    refetchInterval: preIsOwner ? 30_000 : false,
  });

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
  const myOpen = myOpenQ.data?.open ?? [];
  const endClass = async (id: string) => {
    try {
      await fetch(`${BASE}/api/class/${encodeURIComponent(id)}/end`, { method: "POST", credentials: "include" });
      await myOpenQ.refetch();
    } catch { /* silent — refetch will retry */ }
  };
  const fmtAgo = (iso: string): string => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${Math.floor(s)}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  };

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
    <div className="cg-civ-root min-h-screen antialiased overflow-x-hidden" style={{ backgroundColor: '#c7edf5' }}>
      <ScrollProgress />
      <style>{`
        /* ═══ Load Clash Display + Clash Grotesk from Fontshare CDN (same fonts chessiverse uses) ═══ */
        @import url('https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&f[]=clash-grotesk@400,500,600,700&display=swap');
        /* ═══ CHESSIVERSE THEME TOKENS + BASE (1:1 clone, cg-civ-* prefix) ═══ */
        .cg-civ-root, .cg-civ-root * {
          font-family: "Clash Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
          letter-spacing: 1px;
        }
        .cg-civ-root h1, .cg-civ-root h2, .cg-civ-root h3, .cg-civ-root h4, .cg-civ-root h5, .cg-civ-root h6,
        .cg-civ-root h1 *, .cg-civ-root h2 *, .cg-civ-root h3 * {
          font-family: "Clash Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        }
        .cg-civ-root {
          --clr-background-main: #e5f5fe;
          --clr-background-main-new: #c7edf5;
          --clr-section-a-tint: #b8e6f2;
          --clr-section-b-tint: #d5f0f7;
          --clr-text-main: #232323;
          --clr-text-gray: #5a5a5a;
          --clr-text-darkgray: #2d2d2d;
          --clr-accent-new: #14a2b8;
          --clr-accent: #73cdee;
          --clr-border-blue: #35e1fb;
          --clr-golden: #f9a80a;
          --clr-play: #24a9e7;
          --clr-section-a: linear-gradient(90deg,#dbfaff,#e6fcff);
          --clr-section-banner: linear-gradient(180deg,#caf6fd,#dbfaff,#caf6fd);
          --clr-accent-gradient: linear-gradient(180deg,#14a2b8,#40bfd3);
          --clr-play-gradient: linear-gradient(180deg,#24a9e7,#199ae0);
          --clr-golden-gradient: linear-gradient(180deg,#ffdfa2,#f9a80a,#ffb82e);
          --clr-golden-new: #f9a80a;
          --clr-lightgray: #e8e9eb;
          --clr-bg-lightgray: #f3f4f6;
          --main-border: 1px solid #35e1fb;
          --main-box-shadow: 0px 16px 32px 0px rgba(20,162,184,.2);
          background: var(--clr-background-main-new);
          color: var(--clr-text-main);
          font-family: "Clash Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          letter-spacing: 1px;
          line-height: 1.5;
        }
        .cg-civ-root h1, .cg-civ-root h2, .cg-civ-root h3, .cg-civ-root h4, .cg-civ-root h5, .cg-civ-root h6 {
          font-family: "Clash Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          line-height: 1.2;
          color: var(--clr-text-main);
        }
        .cg-civ-root h1 { font-size: 40px; font-weight: 700; line-height: 48px; letter-spacing: 1px; }
        @media (max-width: 768px) { .cg-civ-root h1 { font-size: 32px; line-height: 40px; } }
        .cg-civ-root h2 { font-size: 40px; font-weight: 700; line-height: 48px; letter-spacing: 1px; }
        @media (max-width: 768px) { .cg-civ-root h2 { font-size: 28px; line-height: 34px; } }
        .cg-civ-root h3 { font-size: 19px; font-weight: 600; margin: 0; letter-spacing: 1px; }
        .cg-civ-root p { letter-spacing: 1px; line-height: 24px; }
        .cg-civ-root .text-accent { color: var(--clr-accent-new); }
        .cg-civ-root .text-gray { color: var(--clr-text-gray); }
        /* Section bands */
        /* Subtle section tints — enough color for visual rhythm without harsh bands */
        .cg-civ-band-a { background: var(--clr-section-a-tint); }
        .cg-civ-band-b { background: var(--clr-section-b-tint); }
        .cg-civ-band-banner { background: var(--clr-section-banner); }
        .cg-civ-section { padding: 5rem 1rem; }
        @media (max-width: 768px) { .cg-civ-section { padding: 3rem 1rem 2rem; } }
        .cg-civ-container { width: 100%; max-width: 1440px; margin: 0 auto; padding: 0 3rem; }
        @media (max-width: 1024px) { .cg-civ-container { padding: 0 2rem; } }
        @media (max-width: 768px) { .cg-civ-container { padding: 0 0.5rem; } }
        /* Button system */
        .cg-civ-btn { align-items: center; border: 1px solid transparent; border-radius: 8px; cursor: pointer; display: inline-flex; gap: 0.5rem; font-size: 0.9rem; font-weight: 600; justify-content: center; padding: 0.6rem 2.5rem; text-decoration: none; transition: all 0.2s ease-in-out; white-space: nowrap; letter-spacing: 1px; }
        .cg-civ-btn--accent { background: var(--clr-accent-gradient); color: #fff; }
        .cg-civ-btn--accent:hover { box-shadow: 0 4px 12px rgba(20,162,184,.3); transform: translateY(-2px); }
        .cg-civ-btn--outlined { background: #fff; border: 1px solid var(--clr-accent-new); color: var(--clr-accent-new); }
        .cg-civ-btn--outlined:hover { box-shadow: 0 4px 12px rgba(20,162,184,.3); transform: translateY(-2px); }
        .cg-civ-btn--white { background: linear-gradient(90deg,#ebf9fc,#eef5f7); border: none; box-shadow: 0 8px 12px rgba(20,162,184,.3); color: var(--clr-accent-new); }
        .cg-civ-btn--white:hover { box-shadow: 0 4px 12px rgba(20,162,184,.15); transform: translateY(-2px); }
        .cg-civ-btn--xl { font-size: 1.35rem; padding: 1.25rem 3rem; width: 340px; height: auto; }
        @media (max-width: 480px) { .cg-civ-btn--xl { font-size: 1.15rem; padding: 1.1rem 2rem; width: 280px; } }
        .cg-civ-btn--md { height: 2.4rem; min-width: 160px; padding: 0.6rem 1.5rem; }
        /* Compact header buttons — small right-corner size matching chessiverse */
        .cg-civ-btn--sm { height: 2rem; min-width: auto; padding: 0.35rem 1rem; font-size: 0.8rem; border-radius: 8px; }
        /* Header — #e1f5ff light cyan matching chessiverse exactly */
        .cg-civ-header { background: #e1f5ff; padding: 0.5rem 0; position: sticky; top: 0; z-index: 100; }
        .cg-civ-header-container { align-items: center; display: flex; justify-content: space-between; margin: 0 auto; max-width: 1440px; min-height: 3rem; padding: 0 3.5rem; }
        @media (max-width: 768px) { .cg-civ-header-container { padding: 0 1.5rem; } }
        .cg-civ-header-brand { align-items: center; display: flex; font-family: "Clash Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; font-size: 1.5rem; font-weight: 700; color: #232323; text-decoration: none; letter-spacing: 1px; }
        .cg-civ-header-brand span { font-family: "Clash Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; font-weight: 700; }
        .cg-civ-header-brand:hover { color: #232323; }
        .cg-civ-header-logo { border: 2px solid #fff; border-radius: 50%; height: 2rem; width: 2rem; margin-right: 0.5rem; object-fit: cover; }
        .cg-civ-header-actions { align-items: center; display: flex; gap: 1rem; }
        /* Hero — 3.5rem padding matches header so H1 aligns with brand logo above */
        .cg-civ-hero { display: flex; gap: 2rem; align-items: flex-end; padding: 3rem 3.5rem; max-width: 1440px; margin: 0 auto; }
        @media (max-width: 900px) { .cg-civ-hero { flex-direction: column; padding: 2rem 1.5rem; align-items: stretch; } }
        .cg-civ-hero-text { flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; max-width: 520px; }
        @media (max-width: 900px) { .cg-civ-hero-text { max-width: 100%; } }
        .cg-civ-hero-benefits { justify-content: center; }
        .cg-civ-hero-buttons { align-items: center; }
        .cg-civ-hero-visual { flex: 0 1 auto; margin-inline: auto; position: relative; width: min(440px,100%); aspect-ratio: 1/1; }
        /* Chessboard checker background — pale blue + cream (chessiverse subtle) */
        .cg-civ-hv-board { position: absolute; inset: 0; border-radius: 16px; overflow: hidden; box-shadow: var(--main-box-shadow); background:
          conic-gradient(from 90deg at 25% 25%, #d9edf5 25%, #f4f0e0 0 50%, #d9edf5 0 75%, #f4f0e0 0);
          background-size: 25% 25%;
          background-color: #e6f2f8;
        }
        .cg-civ-hv-board::before { content: ''; position: absolute; inset: 0; background:
          linear-gradient(45deg, transparent 48%, rgba(255,255,255,0.04) 48% 52%, transparent 52%);
          background-size: 12.5% 12.5%;
          pointer-events: none;
        }
        /* Small portrait card on the board */
        .cg-civ-hv-card { position: absolute; top: 8%; left: 18%; width: 52%; aspect-ratio: 5/6; border-radius: 12px; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.25); z-index: 2; background: #fff; border: 3px solid #fff; }
        .cg-civ-hv-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cg-civ-hv-card-name { position: absolute; left: 8px; right: 8px; bottom: 8px; background: rgba(0,0,0,0.65); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; letter-spacing: 1px; text-align: center; }
        /* Yellow star badge floating top-right of the portrait */
        .cg-civ-hv-stars { position: absolute; top: 4%; right: 6%; background: linear-gradient(180deg,#ffdfa2,#f9a80a,#ffb82e); border-radius: 999px; padding: 6px 12px; box-shadow: 0 6px 16px rgba(249,168,10,0.4); display: flex; align-items: center; gap: 4px; font-weight: 800; font-size: 0.85rem; z-index: 3; letter-spacing: 1px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.15); }
        .cg-civ-hv-stars .st { font-size: 0.75rem; letter-spacing: -1px; }
        /* Quote card overlay bottom-right with diagonal stripes decoration */
        .cg-civ-hv-quote { position: absolute; right: 4%; bottom: 6%; width: 62%; background: #fff; border-radius: 12px; padding: 14px 14px 14px 44px; box-shadow: 0 12px 32px rgba(20,162,184,0.22); z-index: 3; font-size: 0.78rem; line-height: 1.45; color: #232323; letter-spacing: 1px; }
        .cg-civ-hv-quote::before { content: '“'; position: absolute; top: -2px; left: 10px; font-size: 3.4rem; line-height: 1; color: #14a2b8; font-family: Georgia, serif; }
        .cg-civ-hv-quote .attrib { display: block; margin-top: 8px; font-size: 0.7rem; color: #5a5a5a; font-weight: 700; letter-spacing: 1px; }
        /* Decorative diagonal stripes on quote card corner */
        .cg-civ-hv-quote::after { content: ''; position: absolute; top: -6px; right: -6px; width: 44px; height: 44px; background: repeating-linear-gradient(-45deg, #f9a80a 0 4px, transparent 4px 8px, #14a2b8 8px 12px, transparent 12px 16px, #e11d48 16px 20px, transparent 20px 24px); border-radius: 12px; opacity: 0.85; z-index: -1; }
        /* Small "chess bots" note card bottom-left */
        .cg-civ-hv-note { position: absolute; left: 4%; bottom: 4%; background: #fff; border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-size: 0.65rem; color: #5a5a5a; font-weight: 600; letter-spacing: 1px; display: flex; align-items: center; gap: 6px; z-index: 3; max-width: 30%; }
        .cg-civ-hv-note .dot { width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(180deg,#14a2b8,#40bfd3); flex-shrink: 0; }
        @media (max-width: 600px) { .cg-civ-hero-visual { min-height: 380px; } .cg-civ-hv-card { top: 6%; left: 8%; width: 62%; } }
        .cg-civ-hero-desc { color: var(--clr-text-gray); font-size: 1.15rem; font-weight: 500; line-height: 1.6; margin: 1rem 0; letter-spacing: 1px; }
        .cg-civ-hero-benefits { display: flex; gap: 1.5rem; margin: 1.5rem 0; flex-wrap: wrap; }
        .cg-civ-benefit { align-items: center; display: flex; gap: 0.5rem; font-size: 0.95rem; color: var(--clr-text-main); letter-spacing: 1px; font-weight: 500; }
        .cg-civ-benefit svg { color: var(--clr-accent-new); }
        .cg-civ-benefit strong { font-weight: 600; }
        .cg-civ-hero-buttons { display: flex; flex-direction: column; gap: 1rem; margin-top: 2rem; align-items: flex-start; }
        .cg-civ-hero-cta-sub { color: var(--clr-text-gray); font-size: 0.85rem; letter-spacing: 1px; }
        /* Footer */
        .cg-civ-footer { background: #b5f4ff; color: #232323; padding: 1.5rem 0; text-align: center; }
        .cg-civ-footer-content { margin: 0 auto; max-width: 1200px; padding: 0 1rem; }
        .cg-civ-copyright { color: #232323; font-size: 1rem; font-weight: 500; margin-bottom: 0.5rem; letter-spacing: 1px; }
        .cg-civ-footer-links { display: flex; flex-wrap: wrap; font-size: 1rem; gap: 0.5rem; justify-content: center; margin-bottom: 0.75rem; letter-spacing: 1px; }
        .cg-civ-footer-links a { color: #232323; font-weight: 500; text-decoration: underline; transition: color .2s ease; }
        .cg-civ-footer-links a:hover { color: var(--clr-accent-new); }
        .cg-civ-divider { color: #232323; margin: 0 0.25rem; }
        .cg-civ-social-links { display: flex; gap: 1rem; justify-content: center; margin-top: 0.75rem; }
        .cg-civ-social-links a { color: #232323; text-decoration: none; transition: color .2s ease; }
        .cg-civ-social-links a:hover { color: var(--clr-accent-new); }
        @media (max-width: 600px) { .cg-civ-footer-links { flex-direction: column; align-items: center; } .cg-civ-divider { display: none; } }
        /* Section heading */
        .cg-civ-eyebrow { color: var(--clr-accent-new); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; margin-bottom: 0.75rem; text-align: center; letter-spacing: 0.25em; }
        .cg-civ-section-title { color: var(--clr-text-main); text-align: center; }
        .cg-civ-section-sub { color: var(--clr-text-gray); text-align: center; max-width: 640px; margin: 1rem auto 0; letter-spacing: 1px; line-height: 1.6; }
      `}</style>
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

      {/* ═══════════ CHESSIVERSE HEADER ═══════════ */}
      <header className="cg-civ-header">
        <div className="cg-civ-header-container">
          <a href="#top" className="cg-civ-header-brand">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" className="cg-civ-header-logo" />
            ) : (
              <span className="cg-civ-header-logo" style={{ display: 'grid', placeItems: 'center', background: 'var(--clr-accent-gradient)', color: '#fff', fontSize: '0.9rem', fontWeight: 700 }}>{displayName[0]?.toUpperCase() || "A"}</span>
            )}
            <span>{displayName}</span>
          </a>
          <div className="cg-civ-header-actions">
            {isOwner && (
              <Link to="/academy-profile/edit" className="cg-civ-btn cg-civ-btn--outlined cg-civ-btn--sm hidden sm:inline-flex" style={{ borderColor: '#e5e7eb', color: '#374151' }}>
                <span>Edit</span>
              </Link>
            )}
            <Link to={`/a/${encodeURIComponent(academy.slug)}/login`} className="cg-civ-btn cg-civ-btn--outlined cg-civ-btn--sm">
              <span>Log In</span>
            </Link>
            <a
              href={joinHref}
              {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="cg-civ-btn cg-civ-btn--accent cg-civ-btn--sm"
            >
              <span>Sign Up</span>
            </a>
          </div>
        </div>
      </header>

      {isOwner && myOpen.length > 0 && (
        <div style={{ padding: '.75rem 1rem', background: 'linear-gradient(90deg,#fee2e2,#fecaca)', borderBottom: '1px solid #fca5a5', color: '#7f1d1d' }}>
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              You have {myOpen.length} live-class room{myOpen.length === 1 ? '' : 's'} still open
            </div>
            {myOpen.map((c) => (
              <div key={c._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', background: 'rgba(255,255,255,.6)', borderRadius: 8, padding: '.5rem .75rem' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  <div style={{ fontSize: 11, opacity: .8 }}>started {fmtAgo(c.startedAt)}</div>
                </div>
                <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
                  {c.joinPath ? (
                    <Link to={c.joinPath.replace(/^\/(?:v2\/)?/, '/')} style={{ background: '#059669', color: '#fff', padding: '.4rem .7rem', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Join</Link>
                  ) : null}
                  <button type="button" onClick={() => endClass(c._id)} style={{ background: '#dc2626', color: '#fff', padding: '.4rem .7rem', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>End class</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════ CHESSIVERSE HERO — 1:1 clone ═══════════ */}
      <section id="top" className="cg-civ-hero">
        <div className="cg-civ-hero-text">
          <h1>
            <span className="text-accent">Learn With Joy</span>
            <br />
            <span>With Chennai&apos;s Top Titled Chess Coaches</span>
          </h1>
          <p className="cg-civ-hero-desc">
            Play, practise, and puzzle with over {Math.max(20, coaches.length * 4)} of Chennai&apos;s most talented chess coaches.
          </p>
          <div className="cg-civ-hero-benefits">
            <span className="cg-civ-benefit">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
              <strong>Learn</strong>
            </span>
            <span className="cg-civ-benefit">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
              <strong>Play</strong>
            </span>
            <span className="cg-civ-benefit">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
              <strong>Enjoy</strong>
            </span>
          </div>
          <div className="cg-civ-hero-buttons">
            <a
              href={joinHref}
              {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="cg-civ-btn cg-civ-btn--accent cg-civ-btn--xl"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 3l14 9-14 9V3z"/></svg>
              <span>Play now for Free!</span>
            </a>
            <div className="cg-civ-hero-cta-sub">Start playing in 30 seconds!</div>
          </div>
        </div>
        <div className="cg-civ-hero-visual">
          <div className="cg-civ-hv-board" />
          <div className="cg-civ-hv-card">
            <img src="/academy/arch-04-endgame.webp" alt="Guna Chess Coach" />
            <div className="cg-civ-hv-card-name">
              {(coaches[0]?.coachProfile?.displayName || coaches[0]?.fullName || "Vikram").split(" ").slice(0,3).join(" ")}
            </div>
          </div>
          <div className="cg-civ-hv-stars">
            <span className="st">★★★★★</span>
            <span>4.9</span>
          </div>
          <div className="cg-civ-hv-quote">
            {(p.testimonials[0]?.quote || "Every class feels one-on-one. My son went from 800 to 1450 in nine months — the coaches don't just teach chess, they teach thinking.").slice(0, 150)}
            <span className="attrib">— {p.testimonials[0]?.author || "Parent, Chennai"}</span>
          </div>
          <div className="cg-civ-hv-note">
            <span className="dot"></span>
            <span>Guna Chess · Chennai</span>
          </div>
        </div>
      </section>

      {/* ═══════════ 1:1 CHESSIVERSE ORDER — hero → creators → publications → testi → quadrants → compare → faq → journey → footer ═══════════ */}

      {/* Featured by Leading Chess Creators */}
      <BotGrid ctaHref={joinHref} ctaExt={joinExternal} joinLabel={joinLabel} />

      {/* Recognized by Leading Publications + logo strip */}
      <PublicationsBand />

      {/* Testimonial masonry grid */}
      <TestimonialsGrid />

      {/* Playstyle + Openings quadrants */}
      <QuadrantCharts />

      {/* Comparison table */}
      <ComparisonTable />

      {/* ═══════════ FAQ ═══════════ */}
      <section id="faq" className="cg-civ-band-a relative py-20 md:py-28">
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

      {/* ═══════════ JOURNEY CTA (chessiverse 3-step onboarding) ═══════════ */}
      <JourneyCTA ctaHref={joinHref} ctaExt={joinExternal} joinLabel={joinLabel} />

      {/* ═══════════ CHESSIVERSE FOOTER ═══════════ */}
      <footer className="cg-civ-footer">
        <div className="cg-civ-footer-content">
          <div className="cg-civ-copyright">
            © {new Date().getFullYear()} {displayName}{p.city ? ` · ${p.city}` : ""}. All rights reserved.
          </div>
          <div className="cg-civ-footer-links">
            <a href="#about">About</a>
            <span className="cg-civ-divider">•</span>
            <a href="#coaches">Coaches</a>
            <span className="cg-civ-divider">•</span>
            <a href="#programs">Programs</a>
            <span className="cg-civ-divider">•</span>
            <a href="#faq">FAQ</a>
          </div>
          <div className="cg-civ-social-links">
            {socialsList.filter(([, v]) => v).map(([k, v]) => (
              <a key={k} href={socialHref(k, v)} target="_blank" rel="noreferrer">
                {String(k).charAt(0).toUpperCase() + String(k).slice(1)}
              </a>
            ))}
          </div>
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
