// AcademyShowcase.tsx — experimental modern academy landing at /showcase/:slug.
// Distinct from the stable /academy-page/:slug — this one is the sandbox for
// bold contemporary design: dark hero + animated chess pieces, bento grid,
// count-up stats, glass cards, marquee ticker, tilt on coach cards, gradient
// meshes, scroll-triggered fade-ups.
//
// Reuses the same public API (GET /api/academy-page/:slug) — pure presentation.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

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

// Simple count-up hook — animates 0 → target over `duration` ms, easing quad-out.
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

// Intersection observer — flips `visible` when the element scrolls into view.
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

// Tilt handler — vanilla mousemove → CSS transform. Removed on leave.
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

function CountStat({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  const [ref, seen] = useOnScreen<HTMLDivElement>();
  const n = useCountUp(value, 1300, seen);
  return (
    <div ref={ref} className="text-center">
      <div className="font-display text-5xl md:text-7xl tracking-tight bg-gradient-to-br from-stone-900 via-indigo-700 to-fuchsia-700 bg-clip-text text-transparent">
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
        className="relative rounded-3xl overflow-hidden bg-white backdrop-blur-xl ring-1 ring-stone-200 hover:ring-cyan-400/50 transition-all duration-500 will-change-transform"
      >
        <div className="aspect-[3/4] relative overflow-hidden">
          {cp.photoUrl ? (
            <img src={cp.photoUrl} alt={cp.displayName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
          ) : (
            <div className="w-full h-full grid place-items-center bg-gradient-to-br from-indigo-950 to-fuchsia-950">
              <div className="text-8xl text-white/20">&#9822;</div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
          {cp.titleClass && (
            <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-400 to-rose-500 text-[10px] tracking-widest uppercase font-bold text-stone-900 shadow-lg shadow-rose-500/50">
              {cp.titleClass}
            </div>
          )}
          {cp.elo != null && (
            <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-stone-100 backdrop-blur-md text-xs font-mono text-cyan-300 ring-1 ring-cyan-400/40">
              {cp.elo}
            </div>
          )}
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex items-center gap-2 mb-2 text-xs text-stone-600">
              {isoToFlag(cp.country) && <span className="text-base">{isoToFlag(cp.country)}</span>}
              {cp.yearsTeaching && <><span>{cp.yearsTeaching} yrs</span></>}
            </div>
            <div className="font-display text-2xl md:text-3xl text-stone-900 leading-tight tracking-tight">
              {cp.displayName || c.fullName || c.username}
            </div>
            {cp.tagline && <div className="text-xs text-stone-500 mt-1 line-clamp-2">{cp.tagline}</div>}
            {cp.playingStyles?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {cp.playingStyles.slice(0, 3).map((s) => (
                  <span key={s} className="text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 backdrop-blur-sm ring-1 ring-stone-200">
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
    <div className={`relative rounded-3xl overflow-hidden bg-white backdrop-blur-xl ring-1 ring-stone-200 p-6 md:p-8 ${tint} ${className}`}>
      {children}
    </div>
  );
}

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

  const yearsTeaching = coaches.reduce((mx, c) => Math.max(mx, c.coachProfile.yearsTeaching || 0), 0)
    || (p.foundedYear ? new Date().getFullYear() - p.foundedYear : 0);

  const socialsList: Array<[keyof Socials, string]> = [
    ["website",   p.socials.website   || ""],
    ["twitter",   p.socials.twitter   || ""],
    ["youtube",   p.socials.youtube   || ""],
    ["instagram", p.socials.instagram || ""],
    ["whatsapp",  p.socials.whatsapp  || ""],
  ];

  return (
    <div className="min-h-screen bg-[#faf6ef] text-stone-900 font-sans antialiased overflow-x-hidden">
      <style>{`
        @keyframes cgFloat { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-14px) rotate(3deg); } }
        @keyframes cgSpinSlow { to { transform: rotate(360deg); } }
        @keyframes cgFadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cgMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes cgPulseGlow { 0%,100% { opacity: 0.45; } 50% { opacity: 0.9; } }
        @keyframes cgGradientShift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        .cg-float { animation: cgFloat 6s ease-in-out infinite; }
        .cg-spin-slow { animation: cgSpinSlow 40s linear infinite; }
        .cg-fade-up { animation: cgFadeUp 0.9s ease-out both; }
        .cg-marquee { animation: cgMarquee 40s linear infinite; }
        .cg-pulse-glow { animation: cgPulseGlow 4s ease-in-out infinite; }
        .cg-gradient-shift { background-size: 200% 200%; animation: cgGradientShift 8s ease-in-out infinite; }
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
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 grid place-items-center text-stone-900 font-display text-sm shadow-lg shadow-fuchsia-500/50">
                {displayName[0]?.toUpperCase() || "A"}
              </div>
            )}
            <span className="font-display text-lg tracking-tight">{displayName}</span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-sm text-stone-600">
            <a href="#coaches" className="hover:text-stone-900 transition-colors">Coaches</a>
            <a href="#about" className="hover:text-stone-900 transition-colors">About</a>
            <a href="#milestones" className="hover:text-stone-900 transition-colors">Milestones</a>
            <a href="#faq" className="hover:text-stone-900 transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <Link to="/academy-profile/edit" className="hidden sm:inline-flex px-3 py-1.5 text-xs text-stone-500 hover:text-white">Edit</Link>
            )}
            <a
              href={joinHref}
              {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-stone-900 shadow-lg shadow-fuchsia-500/40 hover:shadow-fuchsia-500/60 hover:scale-105 transition-all"
            >
              {joinLabel}
            </a>
          </div>
        </div>
      </nav>

      {/* ═══════════ HERO — dark, gradient mesh, floating pieces ═══════════ */}
      <header id="top" className="relative pt-32 md:pt-40 pb-28 md:pb-40 overflow-hidden">
        <div className="absolute inset-0 cg-mesh cg-gradient-shift" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(250,246,239,0.7)_75%)]" />

        {/* animated svg chess pieces */}
        <svg viewBox="0 0 24 24" className="absolute left-[6%] top-[22%] w-24 md:w-40 text-fuchsia-400/30 cg-float" fill="currentColor">
          <path d="M12 2l1 2h2l-1 2 1 2h-2l-1 2-1-2h-2l1-2-1-2h2l1-2z"/>
        </svg>
        <div className="absolute right-[8%] top-[18%] w-40 md:w-64 text-cyan-300/25 cg-float" style={{animationDelay:'2s'}}>
          <svg viewBox="0 0 45 45" fill="currentColor"><path d="M22.5 2a3 3 0 013 3v3l2 2v3l3 3v6l-2 4v14h-12V26l-2-4v-6l3-3V9l2-2V5a3 3 0 013-3z"/></svg>
        </div>
        <div className="absolute left-1/2 top-[65%] w-52 md:w-72 text-amber-300/20 cg-float" style={{animationDelay:'4s'}}>
          <svg viewBox="0 0 45 45" fill="currentColor"><path d="M22.5 6c8 0 12 6 12 12 0 4-2 8-6 10v10h-12V28c-4-2-6-6-6-10 0-6 4-12 12-12z"/></svg>
        </div>
        <div className="absolute right-[24%] bottom-[15%] w-8 h-8 rounded-full bg-cyan-400 blur-2xl cg-pulse-glow" />
        <div className="absolute left-[25%] top-[35%] w-12 h-12 rounded-full bg-fuchsia-500 blur-3xl cg-pulse-glow" style={{animationDelay:'1.5s'}} />

        <div className="relative mx-auto max-w-7xl px-6 md:px-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white backdrop-blur-md ring-1 ring-stone-200 text-xs tracking-widest uppercase mb-8 cg-fade-up">
            {isoToFlag(p.country) && <span className="text-base">{isoToFlag(p.country)}</span>}
            <span className="text-stone-700">{p.city || "Online"}</span>
            {p.foundedYear && <><span className="text-stone-300">&middot;</span><span className="text-cyan-300">Since {p.foundedYear}</span></>}
          </div>
          <h1 className="font-display text-6xl md:text-8xl lg:text-[128px] leading-[0.9] tracking-[-0.03em] mb-8 cg-fade-up" style={{animationDelay:'.1s'}}>
            <span className="bg-gradient-to-br from-stone-900 via-indigo-700 to-stone-900 bg-clip-text text-transparent">{displayName.split(" ").slice(0, -1).join(" ") || displayName}</span>
            {displayName.split(" ").length > 1 && (
              <><br/><span className="bg-gradient-to-r from-fuchsia-400 via-rose-400 to-amber-400 bg-clip-text text-transparent cg-gradient-shift" style={{backgroundSize:'200% 200%'}}>{displayName.split(" ").slice(-1)[0]}</span></>
            )}
          </h1>
          {p.tagline && (
            <p className="text-lg md:text-2xl text-stone-500 max-w-2xl mx-auto leading-relaxed mb-12 cg-fade-up" style={{animationDelay:'.2s'}}>
              {p.tagline}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-4 cg-fade-up" style={{animationDelay:'.3s'}}>
            <a
              href={joinHref}
              {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="group relative inline-flex items-center gap-2 px-8 py-4 rounded-full text-base font-bold text-stone-900 overflow-hidden"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-amber-400 cg-gradient-shift" />
              <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-amber-400 blur-xl opacity-60 group-hover:opacity-100 transition-opacity" />
              <span className="relative z-10">{joinLabel}</span>
              <svg className="relative z-10 w-5 h-5 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </a>
            <a href="#coaches" className="inline-flex items-center gap-1.5 px-6 py-4 rounded-full text-sm font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-100 ring-1 ring-stone-200 backdrop-blur-md transition-all">
              Explore &darr;
            </a>
          </div>
        </div>
      </header>

      {/* ═══════════ STATS — count-up ═══════════ */}
      <section className="relative py-16 md:py-24">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-fuchsia-950/10 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-6 md:px-10 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          <CountStat label="Coaches" value={coaches.length} />
          <CountStat label="Years teaching" value={yearsTeaching} suffix="+" />
          <CountStat label="Milestones" value={p.achievements.length} />
          <CountStat label="Testimonials" value={p.testimonials.length} />
        </div>
      </section>

      {/* ═══════════ MARQUEE — playing styles ticker ═══════════ */}
      <section className="relative py-10 overflow-hidden border-y border-stone-200">
        <div className="flex cg-marquee whitespace-nowrap">
          {[...Array(2)].map((_, dupe) => (
            <div key={dupe} className="flex items-center shrink-0">
              {["Openings", "Tactics", "Endgames", "Strategy", "Blitz", "Positional", "Attacking", "Classical", "Memory", "Calculation"].map((w, i) => (
                <span key={`${dupe}-${i}`} className="mx-8 text-3xl md:text-5xl font-display tracking-tight text-white/10 hover:text-stone-400 transition-colors">
                  <span className="mr-8 text-cyan-400/50">&#9822;</span>{w}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════ BENTO — mix of info tiles ═══════════ */}
      <section className="relative py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <div className="mb-14 text-center">
            <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-400 font-semibold mb-3">The academy</div>
            <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">
              A whole world of chess.
            </h2>
          </div>
          <div className="grid gap-4 md:gap-5 grid-cols-2 md:grid-cols-4 auto-rows-[minmax(180px,auto)]">
            {/* HERO cover tile — 2x2 */}
            <BentoTile className="col-span-2 row-span-2 !p-0 group overflow-hidden">
              {p.coverUrl ? (
                <img src={p.coverUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000" />
              ) : (
                <div className="w-full h-full grid place-items-center bg-gradient-to-br from-indigo-900 via-fuchsia-900 to-cyan-900">
                  <div className="text-9xl text-white/20 cg-spin-slow">&#9822;</div>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <div className="text-xs uppercase tracking-widest text-cyan-300 mb-2">Featured</div>
                <div className="font-display text-2xl md:text-3xl leading-tight">Where champions begin.</div>
              </div>
            </BentoTile>

            {/* Tagline tile */}
            <BentoTile tint="bg-gradient-to-br from-fuchsia-500/20 via-fuchsia-500/5 to-transparent">
              <div className="text-4xl mb-3">&#9819;</div>
              <div className="font-display text-xl leading-tight">{p.tagline || "Grandmasters teach here."}</div>
            </BentoTile>

            {/* Country tile */}
            <BentoTile tint="bg-gradient-to-br from-cyan-500/20 via-cyan-500/5 to-transparent">
              <div className="text-5xl mb-3">{isoToFlag(p.country) || "&#127760;"}</div>
              <div className="font-display text-xl">{p.city || "Online"}</div>
              <div className="text-xs text-stone-500 mt-1">{p.country || "Worldwide"}</div>
            </BentoTile>

            {/* Est year tile */}
            {p.foundedYear && (
              <BentoTile tint="bg-gradient-to-br from-amber-500/20 via-amber-500/5 to-transparent">
                <div className="text-xs uppercase tracking-widest text-amber-300 mb-3">Established</div>
                <div className="font-display text-6xl leading-none">{p.foundedYear}</div>
                <div className="text-xs text-stone-500 mt-2">{new Date().getFullYear() - p.foundedYear} years of teaching</div>
              </BentoTile>
            )}

            {/* Trophies tile */}
            <BentoTile tint="bg-gradient-to-br from-rose-500/20 via-rose-500/5 to-transparent">
              <div className="text-4xl mb-3">&#127942;</div>
              <div className="font-display text-4xl leading-none">{p.achievements.length}</div>
              <div className="text-xs text-stone-500 mt-2 uppercase tracking-widest">Milestones</div>
            </BentoTile>
          </div>
        </div>
      </section>

      {/* ═══════════ COACHES — tilt cards ═══════════ */}
      <section id="coaches" className="relative py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6 md:px-10">
          <div className="mb-14 flex items-end justify-between flex-wrap gap-6">
            <div>
              <div className="text-xs tracking-[0.25em] uppercase text-cyan-400 font-semibold mb-3">The roster</div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">
                Meet the masters.
              </h2>
            </div>
            <div className="text-stone-400 text-sm uppercase tracking-widest">{coaches.length} on staff</div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {coaches.map((c) => <CoachTiltCard key={c.userId} c={c} />)}
          </div>
          {coaches.length === 0 && (
            <div className="text-stone-400 text-center py-16">Coach profiles coming soon.</div>
          )}
        </div>
      </section>

      {/* ═══════════ ABOUT — long-form ═══════════ */}
      {p.description && (
        <section id="about" className="relative py-20 md:py-28 border-y border-stone-200">
          <div className="absolute inset-0 cg-mesh opacity-30" />
          <div className="relative mx-auto max-w-4xl px-6 md:px-10 text-center">
            <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-400 font-semibold mb-3">Our story</div>
            <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight mb-10">
              Chess, with heart.
            </h2>
            <div className="text-lg md:text-xl text-stone-600 leading-[1.75] whitespace-pre-line max-w-3xl mx-auto text-left">
              {p.description}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ MILESTONES / ACHIEVEMENTS ═══════════ */}
      {p.achievements.length > 0 && (
        <section id="milestones" className="relative py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-6 md:px-10">
            <div className="mb-14 text-center">
              <div className="text-xs tracking-[0.25em] uppercase text-amber-400 font-semibold mb-3">Milestones</div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">
                Wins we're proud of.
              </h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {p.achievements.map((a, i) => (
                <div key={a.id} className="group relative rounded-3xl overflow-hidden bg-white backdrop-blur-xl ring-1 ring-stone-200 hover:ring-amber-400/40 transition-all hover:-translate-y-2 duration-500 cg-fade-up" style={{animationDelay: `${i * 80}ms`}}>
                  {a.imageUrl && (
                    <div className="aspect-[4/3] overflow-hidden">
                      <img src={a.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                    </div>
                  )}
                  <div className="p-6">
                    {a.year && (
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-mono ring-1 ring-amber-400/40 mb-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        {a.year}
                      </div>
                    )}
                    <div className="font-display text-xl leading-tight mb-2">{a.title}</div>
                    {a.description && <div className="text-sm text-stone-500 leading-relaxed">{a.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ TESTIMONIALS — layered cards ═══════════ */}
      {p.testimonials.length > 0 && (
        <section className="relative py-20 md:py-28 border-y border-stone-200">
          <div className="mx-auto max-w-7xl px-6 md:px-10">
            <div className="mb-14 text-center">
              <div className="text-xs tracking-[0.25em] uppercase text-fuchsia-400 font-semibold mb-3">Loved by</div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">
                Students &amp; parents.
              </h2>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {p.testimonials.map((t, i) => (
                <figure key={t.id} className="relative rounded-3xl bg-white backdrop-blur-xl ring-1 ring-stone-200 p-8 hover:ring-fuchsia-400/40 transition-all cg-fade-up" style={{animationDelay: `${i * 80}ms`}}>
                  <div className="absolute -top-4 left-6 text-8xl font-display leading-none text-fuchsia-500/40">&ldquo;</div>
                  <blockquote className="relative font-display text-lg md:text-xl leading-[1.5] text-stone-800 mb-6">
                    {t.quote}
                  </blockquote>
                  <figcaption className="flex items-center gap-3">
                    {t.imageUrl ? (
                      <img src={t.imageUrl} alt={t.author} className="w-11 h-11 rounded-full object-cover ring-2 ring-fuchsia-400/40" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-fuchsia-400 to-amber-500 grid place-items-center text-stone-900 text-sm font-display">
                        {t.author.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-semibold">{t.author}</div>
                      {t.role && <div className="text-xs text-stone-500">{t.role}</div>}
                    </div>
                    {t.rating && (
                      <div className="ml-auto text-amber-400 text-sm tracking-widest">{"★".repeat(Math.min(5, Math.max(1, Math.round(t.rating))))}</div>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ CLASSES ═══════════ */}
      {upcomingClasses.length > 0 && (
        <section className="relative py-20 md:py-28">
          <div className="mx-auto max-w-5xl px-6 md:px-10">
            <div className="mb-14 text-center">
              <div className="text-xs tracking-[0.25em] uppercase text-cyan-400 font-semibold mb-3">Next up</div>
              <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">
                Upcoming classes.
              </h2>
            </div>
            <div className="space-y-3">
              {upcomingClasses.map((cl, i) => {
                const d = new Date(cl.startAt);
                return (
                  <div key={cl._id} className="group flex items-center gap-5 rounded-2xl bg-white backdrop-blur-md ring-1 ring-stone-200 hover:ring-cyan-400/50 hover:bg-white transition-all p-5 cg-fade-up" style={{animationDelay: `${i * 60}ms`}}>
                    <div className="w-16 shrink-0 text-center">
                      <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-semibold">{d.toLocaleString(undefined, {weekday: 'short'})}</div>
                      <div className="font-display text-3xl leading-none mt-1">{d.getDate()}</div>
                      <div className="text-[10px] text-stone-500 mt-1 uppercase">{d.toLocaleString(undefined, {month: 'short'})}</div>
                    </div>
                    <div className="w-px h-12 bg-stone-100" />
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-lg md:text-xl leading-tight truncate">{cl.title}</div>
                      <div className="text-sm text-stone-500 mt-0.5">
                        {d.toLocaleString(undefined, {hour: '2-digit', minute: '2-digit'})} &middot; {cl.durationMin}min &middot; {cl.coach}
                      </div>
                    </div>
                    <a
                      href={joinHref}
                      {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="hidden sm:inline-flex items-center gap-1 px-4 py-2 rounded-full bg-stone-100 hover:bg-cyan-400/20 text-xs font-semibold text-stone-700 group-hover:text-cyan-300 transition-all"
                    >
                      RSVP &rarr;
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ FAQ / DETAILED INFO ═══════════ */}
      <section id="faq" className="relative py-20 md:py-28 border-y border-stone-200">
        <div className="mx-auto max-w-4xl px-6 md:px-10">
          <div className="mb-14 text-center">
            <div className="text-xs tracking-[0.25em] uppercase text-amber-400 font-semibold mb-3">Answers</div>
            <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">
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
              <details key={i} className="group rounded-2xl bg-white ring-1 ring-stone-200 hover:ring-amber-400/40 transition-all">
                <summary className="cursor-pointer list-none p-6 flex items-center justify-between gap-4">
                  <span className="font-display text-lg md:text-xl leading-tight pr-4">{f.q}</span>
                  <span className="w-8 h-8 shrink-0 rounded-full bg-amber-500/20 grid place-items-center text-amber-300 group-open:rotate-45 transition-transform">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                  </span>
                </summary>
                <div className="px-6 pb-6 text-stone-600 leading-relaxed text-[15px]">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ FINAL CTA — animated gradient ═══════════ */}
      <section className="relative py-24 md:py-40 overflow-hidden">
        <div className="absolute inset-0 cg-mesh cg-gradient-shift" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/40 to-black/80" />
        <div className="relative mx-auto max-w-4xl px-6 md:px-10 text-center">
          <h2 className="font-display text-5xl md:text-7xl lg:text-8xl leading-[1] tracking-[-0.02em] mb-8">
            <span className="bg-gradient-to-r from-stone-900 via-indigo-700 to-fuchsia-700 bg-clip-text text-transparent">Your move.</span>
          </h2>
          <p className="text-lg md:text-2xl text-stone-600 max-w-xl mx-auto mb-12">
            Start with a free assessment class. We'll match you with the right coach.
          </p>
          <a
            href={joinHref}
            {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
            className="group relative inline-flex items-center gap-2 px-10 py-5 rounded-full text-lg font-bold text-stone-900 overflow-hidden"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-amber-400 cg-gradient-shift" />
            <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-amber-400 blur-2xl opacity-70 group-hover:opacity-100 transition-opacity" />
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
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 grid place-items-center text-stone-900 font-display text-xs">
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
    </div>
  );
}
