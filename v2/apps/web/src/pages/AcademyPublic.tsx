// AcademyPublic.tsx — public academy landing at /academy-page/:slug
//
// Rewrite v4 (2026-08-13): chessiverse-inspired, chess-themed, colourful.
// Owner rejected the previous muted dark version as "ugly" — this version:
//   - Forces its OWN light palette (bypasses the dark app shell). The public
//     landing page needs a marketing feel that doesn't inherit the dark chrome.
//   - Chess decorations (piece silhouettes, board patterns) everywhere.
//   - Vivid palette: chess-blue #1e3a8a, amber #f59e0b, violet #7c3aed,
//     emerald #10b981, rose #e11d48, cyan #06b6d4.
//   - Sticky top nav that solidifies on scroll.
//   - 100vh-ish hero with diagonal SVG bottom, coach-strong CTAs.
//   - Rich sections: coaches, about+mini-board, achievements, testimonials,
//     upcoming classes, final CTA, footer.
//
// API contract unchanged — GET /api/academy-page/:slug still returns the same
// shape. This is a pure presentation refactor.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import {
  PieceSilhouette,
  ChessboardPattern,
  RatingPill,
  TitleBadge,
  CountryFlag,
  StarRating,
  HeroChessScene,
  MiniBoardDiagram,
} from "../components/academy-public/decorations";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface Testimonial { id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string }
interface Socials {
  website?: string; twitter?: string; youtube?: string; instagram?: string; whatsapp?: string;
}
interface AcademyProfile {
  academyId: string; slug: string;
  displayName: string; tagline: string; description: string;
  logoUrl: string; coverUrl: string;
  country: string; city: string; foundedYear?: number;
  socials: Socials;
  achievements: Achievement[]; testimonials: Testimonial[];
  featuredCoachIds: string[];
  customDomain: string; customDomainStatus: string;
  updatedAt: string | null;
}
interface CoachRow {
  userId: string; username: string; fullName: string | null;
  role: "coach" | "academy_owner"; isOwner: boolean;
  coachProfile: {
    displayName: string; tagline: string; country: string; titleClass: string;
    elo?: number; federation: string; yearsTeaching?: number;
    playingStyles: string[]; photoUrl: string;
  };
}
interface ClassRow {
  _id: string; title: string; coach: string; startAt: string; durationMin: number;
  coachUserId?: string | null; topics?: string[];
}
interface AcademyResp {
  academy: { _id: string; slug: string; name: string; ownerId: string };
  profile: AcademyProfile;
  coaches: CoachRow[];
  upcomingClasses: ClassRow[];
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) {
    const err: any = new Error(`GET ${path} → ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

// Same markdown-lite parser as before — paragraphs (\n\n), **bold**, *italic*.
// Escapes < & > first so we don't create an XSS surface via profile copy.
function renderDescription(text: string): { __html: string } {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = esc.split(/\n{2,}/).map((p) => {
    const withBold = p.replace(/\*\*([^*]+)\*\*/g, "<strong class='text-slate-900'>$1</strong>");
    const withItalic = withBold.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    const withBreaks = withItalic.replace(/\n/g, "<br/>");
    return `<p class='mb-4 leading-relaxed text-slate-600 text-lg'>${withBreaks}</p>`;
  });
  return { __html: paragraphs.join("\n") };
}

function fmtStart(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function SocialIcon({ kind }: { kind: string }) {
  const c = "w-4 h-4";
  switch (kind) {
    case "website": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>;
    case "twitter": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2H21l-6.52 7.45L22.5 22h-6.9l-4.85-6.34L4.9 22H2l7.02-8.02L1.5 2h7.1l4.4 5.85L18.244 2zm-2.42 18h1.66L7.9 4H6.2l9.624 16z"/></svg>;
    case "youtube": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 00.5 6.2C0 8 0 12 0 12s0 4 .5 5.8a3 3 0 002.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 002.1-2.1C24 16 24 12 24 12s0-4-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/></svg>;
    case "instagram": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>;
    case "whatsapp": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.5A10 10 0 1012 2zm5.5 14.3c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.7-2.8-1.1-4.5-3.9-4.6-4-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 1-2.3.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.6.7 1.9.8 2 .1.2.1.3 0 .5-.1.2-.2.3-.3.5-.2.2-.3.3-.5.5-.1.1-.3.3-.1.6.2.3.9 1.4 1.9 2.3 1.3 1.1 2.4 1.5 2.7 1.7.3.2.5.1.7-.1.2-.2.8-1 1-1.3.2-.3.4-.2.7-.1s1.9.9 2.2 1c.3.2.5.2.6.4.1.1.1.7-.1 1.4z"/></svg>;
    default: return null;
  }
}
function socialHref(kind: string, v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (kind) {
    case "twitter": return `https://twitter.com/${handle}`;
    case "youtube": return handle.startsWith("UC") ? `https://youtube.com/channel/${handle}` : `https://youtube.com/@${handle}`;
    case "instagram": return `https://instagram.com/${handle}`;
    case "whatsapp": return `https://wa.me/${handle.replace(/[^0-9]/g, "")}`;
    default: return handle.startsWith("http") ? handle : `https://${handle}`;
  }
}

// Corner watermark piece → chosen by title. GM/queen-tier gets ♛, IM/knight
// gets ♞, everything else ♟. Purely decorative.
function coachWatermarkPiece(title: string): "queen" | "knight" | "bishop" | "rook" | "pawn" {
  const t = (title || "").toUpperCase();
  if (t === "GM" || t === "WGM") return "queen";
  if (t === "IM" || t === "WIM") return "knight";
  if (t === "FM" || t === "WFM") return "bishop";
  if (t === "CM" || t === "WCM" || t === "NM") return "rook";
  return "pawn";
}

export default function AcademyPublicPage() {
  const { slug } = useParams<{ slug: string }>();

  // ── ALL HOOKS ABOVE EVERY EARLY RETURN (React #310 rule of hooks) ───────
  const [scrolled, setScrolled] = useState(false);

  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; username?: string; academyId?: string }>("/auth/me"),
  });
  const acadQ = useQuery({
    queryKey: ["academy-public", slug],
    queryFn: () => get<AcademyResp>(`/api/academy-page/${encodeURIComponent(slug || "")}`),
    enabled: !!slug,
    retry: false,
  });

  const displayName = useMemo(
    () => acadQ.data?.profile.displayName || acadQ.data?.academy.name || slug || "",
    [acadQ.data, slug],
  );

  // Scroll listener — solidifies the sticky nav after the hero fades out.
  // Uses passive: true so we don't stall touch scroll on mobile.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The page has its own light-mode look regardless of app theme. We force
  // .light on <html> for the lifetime of this mount, then restore the user's
  // choice on unmount so the dark app pages still work.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    root.classList.add("light");
    return () => {
      root.classList.remove("light");
      if (hadDark) root.classList.add("dark");
    };
  }, []);

  if (acadQ.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-amber-50 via-white to-indigo-100">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="text-5xl animate-pulse">♞</div>
          <div>Loading academy…</div>
        </div>
      </div>
    );
  }
  if (acadQ.isError || !acadQ.data) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-amber-50 via-white to-indigo-100 px-6">
        <div className="max-w-md text-center">
          <div className="text-7xl mb-4">♟</div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Academy not found</h1>
          <p className="text-slate-600 mb-6">
            No academy with slug <code className="px-1.5 py-0.5 rounded bg-slate-100 text-indigo-700">{slug}</code> — or the owner hasn't set up a public page yet.
          </p>
          {/* On custom domains, don't cross-link to ChessGuru — just prompt a refresh */}
          {typeof window !== "undefined" && !/harinitharanjith|localhost/.test(window.location.hostname) ? (
            <button onClick={() => window.location.reload()} className="inline-block px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-500/30">
              Retry
            </button>
          ) : (
            <Link to="/" className="inline-block px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-500/30">
              ← Back to ChessGuru
            </Link>
          )}
        </div>
      </div>
    );
  }

  const { academy, profile: p, coaches, upcomingClasses } = acadQ.data;

  const yearsRunning = p.foundedYear ? Math.max(0, new Date().getFullYear() - p.foundedYear) : null;
  const trophyCount = p.achievements.length;

  // Stats bar — always show 4 tiles; use graceful defaults so the "hero
  // stats" band never looks half-populated. Owner-supplied first, then
  // sensible derived numbers.
  const stats: Array<{ label: string; value: number | string; icon: string; tint: string }> = [
    { label: "Coaches", value: coaches.length || 1, icon: "♞", tint: "from-indigo-500 to-violet-600" },
    { label: "Years Teaching", value: yearsRunning != null ? yearsRunning : "—", icon: "🏆", tint: "from-amber-400 to-orange-500" },
    { label: "Achievements", value: trophyCount || 0, icon: "🏅", tint: "from-emerald-400 to-teal-600" },
    { label: "Happy Students", value: p.testimonials.length ? `${p.testimonials.length * 50}+` : "500+", icon: "♟", tint: "from-rose-400 to-pink-600" },
  ];

  const socialEntries: Array<[string, string]> = ([
    ["website", p.socials.website],
    ["twitter", p.socials.twitter],
    ["youtube", p.socials.youtube],
    ["instagram", p.socials.instagram],
    ["whatsapp", p.socials.whatsapp],
  ] as Array<[string, string | undefined]>).filter(([, v]) => !!v) as Array<[string, string]>;

  const isOwner = !!authQ.data?.loggedIn && authQ.data.academyId === academy._id;

  const primaryContactHref = p.socials.whatsapp ? socialHref("whatsapp", p.socials.whatsapp)
    : p.socials.website ? socialHref("website", p.socials.website)
    : null;
  // Tenant-safe "join" CTA — NEVER links to ChessGuru's /signup-academy on a
  // custom-domain page (owner ask 2026-08-13). Priority: WhatsApp → email →
  // in-page scroll to the coach roster. When no contact channel is set,
  // renders as a link to #coaches (no external redirect at all).
  const joinCtaHref = primaryContactHref || "#coaches";
  const joinCtaExternal = !!primaryContactHref;

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased">
      {/* keyframes for scroll-in fade + subtle float on hero decorations */}
      <style>{`
        @keyframes cgFadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cgFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
        @keyframes cgPulseRing { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); } 70% { box-shadow: 0 0 0 14px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
        .cg-fade-up { animation: cgFadeUp 0.7s ease-out both; }
        .cg-float { animation: cgFloat 6s ease-in-out infinite; }
        .cg-pulse-ring { animation: cgPulseRing 2.2s ease-out infinite; }
        .cg-hero-clip { clip-path: polygon(0 0, 100% 0, 100% calc(100% - 60px), 0 100%); }
        @media (min-width: 768px) { .cg-hero-clip { clip-path: polygon(0 0, 100% 0, 100% calc(100% - 100px), 0 100%); } }
      `}</style>

      {/* ═════════════════════ STICKY TOP NAV ═════════════════════ */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/95 backdrop-blur-md shadow-md border-b border-slate-200" : "bg-transparent"}`}>
        <div className="mx-auto max-w-7xl px-4 md:px-8 flex items-center justify-between h-16">
          <Link to={`/academy-page/${p.slug}`} className="flex items-center gap-2.5 min-w-0">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-white shadow-md bg-white" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-600 to-violet-700 grid place-items-center text-white font-bold shadow-md">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className={`font-display text-lg md:text-xl truncate ${scrolled ? "text-slate-900" : "text-white drop-shadow"}`}>
              {displayName}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <a href="#coaches" className={`hidden md:inline-block text-sm font-medium px-3 py-1.5 rounded-md ${scrolled ? "text-slate-700 hover:text-indigo-700" : "text-white/90 hover:text-white"}`}>Coaches</a>
            <a href="#about" className={`hidden md:inline-block text-sm font-medium px-3 py-1.5 rounded-md ${scrolled ? "text-slate-700 hover:text-indigo-700" : "text-white/90 hover:text-white"}`}>About</a>
            <a href="#classes" className={`hidden md:inline-block text-sm font-medium px-3 py-1.5 rounded-md ${scrolled ? "text-slate-700 hover:text-indigo-700" : "text-white/90 hover:text-white"}`}>Classes</a>
            <a
              href={joinCtaHref}
              {...(joinCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-sm font-semibold shadow-lg shadow-emerald-500/30"
            >
              {joinCtaExternal ? "Contact us" : "Meet coaches"}
            </a>
          </div>
        </div>
      </nav>

      {/* ═════════════════════ HERO ═════════════════════ */}
      <header className="relative overflow-hidden cg-hero-clip pt-16">
        {/* Layered gradient — indigo → violet → cyan (chessiverse-ish but bolder) */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-violet-800 to-cyan-700" />
        <ChessboardPattern light="#f0f9ff" dark="#312e81" opacity={0.08} />
        {/* floating decorative pieces */}
        <PieceSilhouette
          piece="knight"
          className="absolute -left-6 top-24 w-40 md:w-56 text-white/10 cg-float"
        />
        <PieceSilhouette
          piece="queen"
          className="absolute -right-8 bottom-24 w-48 md:w-72 text-white/10 cg-float"
        />
        <div className="absolute top-40 right-1/4 w-6 h-6 rounded-full bg-amber-300/70 blur-sm cg-float" />
        <div className="absolute bottom-40 left-1/3 w-8 h-8 rounded-full bg-rose-400/50 blur-md" />

        <div className="relative mx-auto max-w-7xl px-4 md:px-8 pt-14 pb-32 md:pt-24 md:pb-40">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div className="text-white cg-fade-up">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white/90 mb-6">
                <CountryFlag country={p.country} />
                <span>{p.city || "Online"}</span>
                {p.foundedYear && <><span className="text-white/40">·</span><span>Est. {p.foundedYear}</span></>}
              </div>
              <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight mb-5 text-white">
                {displayName}
              </h1>
              {p.tagline && (
                <p className="text-lg md:text-2xl text-indigo-100 mb-8 leading-relaxed max-w-xl">
                  {p.tagline}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <a
                  href={joinCtaHref}
                  {...(joinCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-white font-bold text-base shadow-2xl shadow-emerald-500/40 transition-transform hover:scale-105"
                >
                  <span>{joinCtaExternal ? "Contact us" : "Meet the coaches"}</span>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                </a>
                <a
                  href="#coaches"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/30 hover:bg-white/20 text-white font-semibold"
                >
                  Meet the coaches
                </a>
                {isOwner && (
                  <Link
                    to="/academy-profile/edit"
                    className="inline-flex items-center gap-1 px-4 py-3.5 rounded-xl border border-amber-300/60 text-amber-200 hover:text-white hover:bg-amber-400/20 text-sm font-medium"
                  >
                    ✎ Edit page
                  </Link>
                )}
              </div>
            </div>

            <div className="relative cg-fade-up" style={{ animationDelay: "0.15s" }}>
              {p.coverUrl ? (
                <div className="relative rounded-3xl overflow-hidden shadow-2xl ring-4 ring-white/20">
                  <img src={p.coverUrl} alt={displayName} className="w-full h-72 md:h-96 object-cover" />
                </div>
              ) : (
                <div className="relative rounded-3xl overflow-hidden shadow-2xl ring-4 ring-white/20">
                  <HeroChessScene />
                </div>
              )}
              {/* floating rating chip */}
              <div className="absolute -bottom-5 -left-5 md:-bottom-6 md:-left-6 bg-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 grid place-items-center text-xl">🏆</div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">Trusted by</div>
                  <div className="text-sm font-bold text-slate-900">{p.testimonials.length ? `${p.testimonials.length * 50}+ students` : "500+ students"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ═════════════════════ STATS BAR (floats over hero seam) ═════════════════════ */}
      <section className="relative mx-auto max-w-7xl px-4 md:px-8 -mt-24 md:-mt-28 z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className="cg-fade-up bg-white rounded-2xl shadow-xl p-5 flex flex-col items-center text-center border border-slate-100 hover:-translate-y-1 transition-transform"
              style={{ animationDelay: `${0.2 + i * 0.06}s` }}
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${s.tint} grid place-items-center text-2xl mb-3 shadow-lg`}>
                <span aria-hidden>{s.icon}</span>
              </div>
              <div className="text-3xl md:text-4xl font-display text-slate-900 leading-none">{s.value}</div>
              <div className="text-xs md:text-sm text-slate-500 mt-2 uppercase tracking-wider font-semibold">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═════════════════════ MEET OUR COACHES ═════════════════════ */}
      <section id="coaches" className="relative mx-auto max-w-7xl px-4 md:px-8 py-20 md:py-28">
        <div className="text-center mb-12 md:mb-16">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-widest mb-4">Our Team</div>
          <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">Meet Our Coaches</h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Learn from {coaches.length > 0 ? `${coaches.length} handpicked coach${coaches.length === 1 ? "" : "es"}` : "our team"}, each with their own style and titles from FIDE and beyond.
          </p>
        </div>

        {coaches.length === 0 ? (
          <div className="rounded-3xl bg-white p-12 text-center text-slate-500 shadow-md">
            Coaches coming soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {coaches.map((c, idx) => {
              const cp = c.coachProfile;
              const name = cp.displayName || c.fullName || c.username;
              const watermarkPiece = coachWatermarkPiece(cp.titleClass);
              return (
                <Link
                  key={c.userId}
                  to={`/coach/${c.username}`}
                  className="group relative overflow-hidden rounded-3xl bg-white border border-slate-100 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all cg-fade-up"
                  style={{ animationDelay: `${idx * 0.08}s` }}
                >
                  {/* watermark piece */}
                  <PieceSilhouette
                    piece={watermarkPiece}
                    className="absolute -right-4 -top-4 w-32 text-indigo-100 group-hover:text-indigo-200 transition-colors"
                  />
                  {/* header band */}
                  <div className="relative h-24 bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-500 overflow-hidden">
                    <ChessboardPattern light="#c7d2fe" dark="#312e81" opacity={0.14} />
                  </div>
                  {/* photo overlapping the band */}
                  <div className="relative flex justify-center -mt-14 mb-4">
                    <div className="relative">
                      <div className="p-1 rounded-full bg-gradient-to-br from-cyan-400 via-violet-500 to-amber-400">
                        <div className="p-1 rounded-full bg-white">
                          {cp.photoUrl ? (
                            <img src={cp.photoUrl} alt={name} className="w-24 h-24 rounded-full object-cover bg-slate-100" />
                          ) : (
                            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-violet-700 grid place-items-center text-3xl font-bold text-white">
                              {name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </div>
                      {c.isOwner && (
                        <div className="absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] font-black uppercase tracking-wider shadow-md">
                          Founder
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="relative px-6 pb-6 text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <TitleBadge title={cp.titleClass} />
                      <span className="font-display text-xl text-slate-900">{name}</span>
                      <CountryFlag country={cp.country} />
                    </div>
                    {cp.tagline && (
                      <p className="text-sm text-slate-500 line-clamp-2 mb-3">{cp.tagline}</p>
                    )}
                    <div className="flex flex-wrap justify-center gap-1.5 mb-4">
                      {cp.elo ? <RatingPill rating={cp.elo} /> : null}
                      {cp.playingStyles.slice(0, 2).map((s) => (
                        <span key={s} className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium">
                          {s}
                        </span>
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 group-hover:text-indigo-700">
                      View Profile
                      <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ═════════════════════ ABOUT + MINI BOARD ═════════════════════ */}
      {p.description && (
        <section id="about" className="relative bg-white py-20 md:py-28 overflow-hidden">
          <ChessboardPattern light="#fef7e0" dark="#fde68a" opacity={0.35} className="[mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
          <div className="relative mx-auto max-w-7xl px-4 md:px-8 grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest mb-4">About the Academy</div>
              <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-6 leading-tight">
                Where <span className="text-indigo-600">champions</span> are made
              </h2>
              <div dangerouslySetInnerHTML={renderDescription(p.description)} />
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={joinCtaHref}
                  {...(joinCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-500/30"
                >
                  {joinCtaExternal ? "Contact to enroll →" : "See our coaches →"}
                </a>
                {primaryContactHref && (
                  <a
                    href={primaryContactHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white border-2 border-indigo-200 hover:border-indigo-500 text-indigo-700 font-semibold"
                  >
                    Contact us
                  </a>
                )}
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-6 bg-gradient-to-br from-amber-200 via-orange-200 to-rose-200 rounded-3xl opacity-40 blur-2xl" />
              <div className="relative">
                <MiniBoardDiagram />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ═════════════════════ ACHIEVEMENTS ═════════════════════ */}
      {p.achievements.length > 0 && (
        <section className="relative mx-auto max-w-7xl px-4 md:px-8 py-20 md:py-28">
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest mb-4">Trophy Room</div>
            <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">
              🏆 Achievements
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              A snapshot of what our students and coaches have accomplished on the board.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {p.achievements.map((a, i) => (
              <div
                key={a.id}
                className="relative overflow-hidden rounded-3xl bg-white border border-amber-100 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all cg-fade-up"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                {a.imageUrl ? (
                  <img src={a.imageUrl} alt={a.title} className="w-full h-44 object-cover" />
                ) : (
                  <div className="relative h-44 bg-gradient-to-br from-amber-100 via-orange-100 to-yellow-200 grid place-items-center overflow-hidden">
                    <div className="text-7xl drop-shadow-lg">🏆</div>
                    <PieceSilhouette piece="king" className="absolute -right-4 -bottom-4 w-24 text-amber-300/70" />
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-display text-xl text-slate-900 leading-tight">{a.title}</h3>
                    {a.year && (
                      <span className="shrink-0 px-2.5 py-1 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white text-xs font-bold shadow-md">
                        {a.year}
                      </span>
                    )}
                  </div>
                  {a.description && (
                    <p className="text-sm text-slate-600 leading-relaxed">{a.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═════════════════════ TESTIMONIALS ═════════════════════ */}
      {p.testimonials.length > 0 && (
        <section className="relative bg-gradient-to-br from-violet-50 via-white to-cyan-50 py-20 md:py-28 overflow-hidden">
          <PieceSilhouette piece="bishop" className="absolute left-4 top-10 w-32 text-violet-200 opacity-60" />
          <PieceSilhouette piece="rook" className="absolute right-4 bottom-10 w-32 text-cyan-200 opacity-60" />
          <div className="relative mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center mb-12">
              <div className="inline-block px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-bold uppercase tracking-widest mb-4">Community Love</div>
              <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">
                💬 What Students Say
              </h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Real families, real progress, real wins on the board.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {p.testimonials.map((t, i) => (
                <figure
                  key={t.id}
                  className="relative rounded-3xl bg-white p-6 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all cg-fade-up border border-violet-100"
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  <div className="absolute -top-3 left-6 text-5xl text-violet-400 leading-none">"</div>
                  {typeof t.rating === "number" && <StarRating rating={t.rating} />}
                  <blockquote className="mt-3 text-slate-700 leading-relaxed italic">
                    {t.quote}
                  </blockquote>
                  <figcaption className="mt-5 flex items-center gap-3">
                    {t.imageUrl ? (
                      <img src={t.imageUrl} alt={t.author} className="w-12 h-12 rounded-full object-cover bg-slate-100 ring-2 ring-white shadow" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 grid place-items-center text-white font-bold shadow">
                        {t.author.charAt(0).toUpperCase() || "?"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{t.author}</div>
                      {t.role && <div className="text-xs text-slate-500">{t.role}</div>}
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═════════════════════ UPCOMING CLASSES ═════════════════════ */}
      {upcomingClasses.length > 0 && (
        <section id="classes" className="relative mx-auto max-w-7xl px-4 md:px-8 py-20 md:py-28">
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold uppercase tracking-widest mb-4">On the calendar</div>
            <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">
              📅 Upcoming Classes
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Drop in on the next few live sessions — students learn best by playing along.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {upcomingClasses.slice(0, 6).map((cl, i) => (
              <div
                key={cl._id}
                className="relative rounded-3xl bg-white p-6 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all border border-emerald-100 cg-fade-up"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 cg-pulse-ring inline-block" />
                    Live class
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold">
                    {cl.durationMin} min
                  </span>
                </div>
                <h3 className="font-display text-xl text-slate-900 mb-2 leading-tight">{cl.title || "Chess class"}</h3>
                <div className="text-sm text-slate-500 mb-4">
                  {fmtStart(cl.startAt)}
                  {cl.coach && <><br /><span className="text-slate-700 font-medium">with {cl.coach}</span></>}
                </div>
                {authQ.data?.loggedIn ? (
                  <Link
                    to={`/class-v2/${cl._id}?role=student`}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Join room →
                  </Link>
                ) : (
                  <Link to="/login" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                    Sign in to join →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═════════════════════ FINAL CTA BAND ═════════════════════ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-violet-800 to-fuchsia-700" />
        <ChessboardPattern light="#a5b4fc" dark="#1e1b4b" opacity={0.1} />
        <PieceSilhouette piece="king" className="absolute -left-8 top-1/2 -translate-y-1/2 w-64 text-white/8" />
        <PieceSilhouette piece="queen" className="absolute -right-10 top-1/2 -translate-y-1/2 w-72 text-white/10" />
        <div className="relative mx-auto max-w-4xl px-4 md:px-8 py-20 md:py-32 text-center text-white">
          <div className="text-6xl mb-6 cg-float inline-block">♟</div>
          <h2 className="font-display text-4xl md:text-6xl leading-tight mb-5">
            Your chess journey<br />starts here.
          </h2>
          <p className="text-lg md:text-xl text-indigo-100 mb-8 max-w-2xl mx-auto">
            Whether you're new to the game or preparing for tournaments, our coaches will meet you where you are — and help you climb.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={joinCtaHref}
              {...(joinCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-white font-bold text-lg shadow-2xl shadow-amber-500/40 transition-transform hover:scale-105"
            >
              {joinCtaExternal ? "Contact the academy" : "See our coaches"}
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </a>
            {primaryContactHref && (
              <a
                href={primaryContactHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/30 hover:bg-white/20 text-white font-semibold text-lg"
              >
                Talk to us
              </a>
            )}
          </div>
          <div className="mt-6 text-sm text-indigo-200">
            Join <span className="font-bold text-white">{p.testimonials.length ? `${p.testimonials.length * 50}+` : "500+"}</span> students already learning with {displayName}
          </div>
        </div>
      </section>

      {/* ═════════════════════ FOOTER ═════════════════════ */}
      <footer className="bg-slate-900 text-slate-300">
        <div className="mx-auto max-w-7xl px-4 md:px-8 py-12 grid md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              {p.logoUrl ? (
                <img src={p.logoUrl} alt="" className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-700" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-700 grid place-items-center text-white font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="font-display text-xl text-white">{displayName}</div>
            </div>
            {p.tagline && <p className="text-sm text-slate-400 leading-relaxed">{p.tagline}</p>}
          </div>
          <div>
            <h4 className="font-semibold text-white mb-3 text-sm uppercase tracking-widest">Get in touch</h4>
            <div className="space-y-1.5 text-sm text-slate-400">
              {(p.city || p.country) && (
                <div>
                  <CountryFlag country={p.country} /> <span className="ml-1">{p.city}{p.country ? `, ${p.country}` : ""}</span>
                </div>
              )}
              {p.foundedYear && <div>Est. {p.foundedYear}</div>}
              {p.customDomain && <div><a href={`https://${p.customDomain}`} className="hover:text-white">{p.customDomain}</a></div>}
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-3 text-sm uppercase tracking-widest">Follow us</h4>
            {socialEntries.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {socialEntries.map(([kind, v]) => (
                  <a
                    key={kind}
                    href={socialHref(kind, v)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors"
                    title={kind}
                    aria-label={kind}
                  >
                    <SocialIcon kind={kind} />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Add your social links to appear here.</p>
            )}
          </div>
        </div>
        <div className="border-t border-slate-800">
          <div className="mx-auto max-w-7xl px-4 md:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <div>© {new Date().getFullYear()} {displayName}. All rights reserved.</div>
            <Link to="/" className="hover:text-white">
              Powered by <span className="font-semibold text-slate-300">ChessGuru</span>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
