// CoachPublic.tsx — public coach profile at /coach/:username
//
// Rewrite v2 (2026-08-13): chess-themed, colourful, image-rich chessiverse-
// inspired layout, matching the visual language of AcademyPublic.tsx. Owner
// asked for "feature rich, image rich coach page, with lots of details".
//
// Key traits (parity with AcademyPublic):
//   - Forces the .light palette regardless of app-shell theme.
//   - Full-viewport painterly background layer (themeUrl → fixed low-opacity
//     bg with a soft gradient overlay). Chessboard SVG fallback when unset.
//   - Sticky top nav that solidifies on scroll.
//   - 100vh-ish hero, coach photo overlaps the hero seam, floating trophy chip.
//   - Rich sections: stats bar, about + signature opening, coaching style,
//     achievements grid, top students, trophies, upcoming classes, testimonials,
//     final CTA band, footer.
//   - Tenant-safe: no cross-links to ChessGuru marketing pages on custom
//     domains. All CTAs prefer WhatsApp → website → in-page scroll.

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
} from "../components/academy-public/decorations";
import {
  ChessClock,
  CalendarBadge,
  SignatureOpeningCard,
  CoachPhotoFrame,
} from "../components/coach-public/decorations";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface TopStudent  { id: string; name: string; peakRating?: number; note?: string; imageUrl?: string }
interface Trophy      { id: string; name: string; year?: number; imageUrl?: string }
interface Testimonial { id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string }
interface Socials {
  website?: string; twitter?: string; youtube?: string; instagram?: string;
  lichess?: string; chesscom?: string; whatsapp?: string; email?: string;
}
interface CoachProfile {
  userId: string;
  displayName: string; tagline: string; bio: string;
  country: string; city: string;
  titleClass: string; elo?: number; federation: string;
  yearsTeaching?: number; playingStyles: string[];
  photoUrl: string; coverUrl: string; themeUrl: string;
  achievements: Achievement[]; topStudents: TopStudent[]; trophies: Trophy[];
  testimonials?: Testimonial[];
  socials: Socials;
  customDomain: string; customDomainStatus: string;
  updatedAt: string | null;
}
interface CoachResp {
  userId: string;
  username: string;
  role: "coach" | "academy_owner";
  academyId: string | null;
  academyName: string | null;
  fullName: string | null;
  profile: CoachProfile;
}
interface ClassRow {
  _id: string; title: string; coach: string; startAt: string; durationMin: number;
  coachUserId?: string; academyId?: string | null;
}
interface ScheduleResp { live: ClassRow[]; upcoming: ClassRow[] }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) {
    const err: any = new Error(`GET ${path} → ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

// Same markdown-lite parser as AcademyPublic — paragraphs (\n\n), **bold**,
// *italic*. Escapes < & > first so we don't create an XSS surface.
function renderBio(text: string): { __html: string } {
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
    case "lichess": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 8h8v8H8z"/></svg>;
    case "chesscom": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 6l4 4-4 4M16 6l-4 4 4 4"/></svg>;
    case "email": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>;
    default: return null;
  }
}
function socialHref(kind: string, v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  if (kind === "email") return v.startsWith("mailto:") ? v : `mailto:${v}`;
  const handle = v.replace(/^@/, "");
  switch (kind) {
    case "twitter": return `https://twitter.com/${handle}`;
    case "youtube": return handle.startsWith("UC") ? `https://youtube.com/channel/${handle}` : `https://youtube.com/@${handle}`;
    case "instagram": return `https://instagram.com/${handle}`;
    case "whatsapp": return `https://wa.me/${handle.replace(/[^0-9]/g, "")}`;
    case "lichess": return `https://lichess.org/@/${handle}`;
    case "chesscom": return `https://chess.com/member/${handle}`;
    default: return handle.startsWith("http") ? handle : `https://${handle}`;
  }
}

// Human-readable one-liner per playing-style tag. Used in the coaching-style
// section so the page feels handwritten instead of a bag of pills.
const STYLE_BLURB: Record<string, string> = {
  Aggressive: "Sharp lines, sacrifices, king hunts — students learn to seize the initiative.",
  Positional: "Slow squeezing, piece placement, prophylaxis — patience and pressure.",
  Tactical:   "Combinations, forks, pins, discovered attacks — pattern-recognition drills.",
  Solid:      "Rock-solid structures, safe kings, endgame conversions — no early risks.",
  Universal:  "Adapts to the position and the opponent — no one-trick pony.",
};

// Watermark piece per title (parity with AcademyPublic coach card).
function coachWatermarkPiece(title: string): "queen" | "knight" | "bishop" | "rook" | "pawn" {
  const t = (title || "").toUpperCase();
  if (t === "GM" || t === "WGM") return "queen";
  if (t === "IM" || t === "WIM") return "knight";
  if (t === "FM" || t === "WFM") return "bishop";
  if (t === "CM" || t === "WCM" || t === "NM") return "rook";
  return "pawn";
}

export default function CoachPublicPage() {
  const { username } = useParams<{ username: string }>();

  // ── ALL HOOKS ABOVE EVERY EARLY RETURN (React #310 rule of hooks) ───────
  const [scrolled, setScrolled] = useState(false);

  // Guest browsing is a value prop — auth-me is optional. The "Join room"
  // button on live classes still needs to know if the visitor is signed in.
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; username?: string }>("/auth/me"),
  });
  const coachQ = useQuery({
    queryKey: ["coach-public", username],
    queryFn: () => get<CoachResp>(`/api/coach/${encodeURIComponent(username || "")}`),
    enabled: !!username,
    retry: false,
  });
  // Upcoming classes filtered to THIS coach — pulled from the shared schedule
  // endpoint. Guest calls 401 and we render zero classes gracefully.
  const scheduleQ = useQuery({
    queryKey: ["coach-schedule", coachQ.data?.userId, coachQ.data?.academyId],
    queryFn: () => get<ScheduleResp>("/api/class/schedule").catch(() => ({ live: [], upcoming: [] })),
    enabled: !!coachQ.data?.userId,
    retry: false,
  });

  const coachUserId = coachQ.data?.userId;
  const upcoming = useMemo(() => {
    const rows = [
      ...(scheduleQ.data?.live || []),
      ...(scheduleQ.data?.upcoming || []),
    ];
    if (!coachUserId) return [];
    return rows
      .filter((r) => r.coachUserId === coachUserId || r.coach === coachQ.data?.username)
      .slice(0, 3);
  }, [scheduleQ.data, coachUserId, coachQ.data?.username]);

  // Scroll listener — solidifies the sticky nav after the hero fades out.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Force the .light palette regardless of app shell — this is a public
  // marketing page, dark chrome would clash with the painterly background.
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

  if (coachQ.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-amber-50 via-white to-indigo-100">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="text-5xl animate-pulse">♞</div>
          <div>Loading coach…</div>
        </div>
      </div>
    );
  }
  if (coachQ.isError || !coachQ.data) {
    const onTenant = typeof window !== "undefined" && !/harinitharanjith|localhost/.test(window.location.hostname);
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-amber-50 via-white to-indigo-100 px-6">
        <div className="max-w-md text-center">
          <div className="text-7xl mb-4">♟</div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Coach not found</h1>
          <p className="text-slate-600 mb-6">
            No coach with username <code className="px-1.5 py-0.5 rounded bg-slate-100 text-indigo-700">{username}</code> — or they haven't set up a public page yet.
          </p>
          {onTenant ? (
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

  const c = coachQ.data;
  const p = c.profile;
  const displayName = p.displayName || c.fullName || c.username;

  // Stats bar — always 4 tiles; graceful defaults so the band never looks
  // half-populated. Peak Elo (if set) → years coaching → students → trophies.
  const stats: Array<{ label: string; value: number | string; icon: string; tint: string }> = [
    { label: "Peak Elo",        value: p.elo || "—",                                                          icon: "🏅", tint: "from-amber-400 to-orange-500" },
    { label: "Years Coaching",  value: p.yearsTeaching != null && p.yearsTeaching > 0 ? p.yearsTeaching : "—", icon: "📚", tint: "from-indigo-500 to-violet-600" },
    { label: "Students Trained", value: p.topStudents.length > 0 ? `${p.topStudents.length * 20}+` : "50+",   icon: "🎓", tint: "from-violet-500 to-fuchsia-600" },
    { label: "Trophies",        value: p.trophies.length || p.achievements.length || 0,                       icon: "🏆", tint: "from-emerald-400 to-teal-600" },
  ];

  const socialEntries: Array<[string, string]> = ([
    ["website", p.socials.website],
    ["twitter", p.socials.twitter],
    ["youtube", p.socials.youtube],
    ["instagram", p.socials.instagram],
    ["lichess", p.socials.lichess],
    ["chesscom", p.socials.chesscom],
    ["whatsapp", p.socials.whatsapp],
    ["email", p.socials.email],
  ] as Array<[string, string | undefined]>).filter(([, v]) => !!v) as Array<[string, string]>;

  const isMe = !!authQ.data?.loggedIn && authQ.data.username === c.username;
  const testimonials: Testimonial[] = Array.isArray(p.testimonials) ? p.testimonials : [];

  // Tenant-safe primary contact — WhatsApp → email → website. When none of
  // those exist, the CTA scrolls to #contact (which itself becomes the
  // socials strip / final CTA band). NEVER links to /signup or /login on
  // custom-domain builds.
  const primaryContactHref = p.socials.whatsapp
    ? socialHref("whatsapp", p.socials.whatsapp)
    : p.socials.email
      ? socialHref("email", p.socials.email)
      : p.socials.website
        ? socialHref("website", p.socials.website)
        : null;
  const bookCtaHref = primaryContactHref || "#contact";
  const bookCtaExternal = !!primaryContactHref;
  const bookCtaLabel = p.socials.whatsapp ? "Book a lesson (WhatsApp)"
    : p.socials.email ? "Book a lesson (Email)"
    : p.socials.website ? "Book a lesson"
    : "Get in touch";

  const watermarkPiece = coachWatermarkPiece(p.titleClass);
  const styleTags = (p.playingStyles || []).filter(Boolean);
  // Federation-based fed line ("India · 2100 FIDE") — shown near the name
  // when either is set.
  const fedLine = [p.city, p.country && `${p.country}`].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased relative">
      {/* ═════════════════════ FULL-VIEWPORT THEME LAYER ═════════════════════
          Painterly background image (owner-supplied via Gemini "theme" gen).
          Fixed to viewport, sits behind everything at ~18% opacity, gated by
          a soft light-to-white gradient so section text stays readable.
          Falls back to a tiled chessboard SVG when unset. */}
      {p.themeUrl ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center"
            style={{ backgroundImage: `url(${p.themeUrl})`, opacity: 0.18 }}
          />
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-[#fafaf9]/60 via-[#fafaf9]/40 to-[#fafaf9]/70"
          />
        </>
      ) : (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8," +
              encodeURIComponent(
                "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><rect width='40' height='40' fill='%23fef7e0'/><rect x='40' y='40' width='40' height='40' fill='%23fef7e0'/><rect x='40' width='40' height='40' fill='%23c7d2fe'/><rect y='40' width='40' height='40' fill='%23c7d2fe'/></svg>"
              ) +
              "\")",
            backgroundSize: "80px 80px",
            opacity: 0.12,
          }}
        />
      )}

      {/* keyframes — same set as AcademyPublic so both pages animate identically */}
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
          <div className="flex items-center gap-2.5 min-w-0">
            {p.photoUrl ? (
              <img src={p.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-white shadow-md bg-white" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-600 to-violet-700 grid place-items-center text-white font-bold shadow-md">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className={`font-display text-lg md:text-xl truncate ${scrolled ? "text-slate-900" : "text-white drop-shadow"}`}>
              {displayName}
            </span>
            {p.titleClass && <TitleBadge title={p.titleClass} />}
          </div>
          <div className="flex items-center gap-2">
            <a href="#about" className={`hidden md:inline-block text-sm font-medium px-3 py-1.5 rounded-md ${scrolled ? "text-slate-700 hover:text-indigo-700" : "text-white/90 hover:text-white"}`}>About</a>
            <a href="#style" className={`hidden md:inline-block text-sm font-medium px-3 py-1.5 rounded-md ${scrolled ? "text-slate-700 hover:text-indigo-700" : "text-white/90 hover:text-white"}`}>Style</a>
            <a href="#achievements" className={`hidden md:inline-block text-sm font-medium px-3 py-1.5 rounded-md ${scrolled ? "text-slate-700 hover:text-indigo-700" : "text-white/90 hover:text-white"}`}>Highlights</a>
            <a href="#students" className={`hidden md:inline-block text-sm font-medium px-3 py-1.5 rounded-md ${scrolled ? "text-slate-700 hover:text-indigo-700" : "text-white/90 hover:text-white"}`}>Students</a>
            <a
              href={bookCtaHref}
              {...(bookCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-sm font-semibold shadow-lg shadow-emerald-500/30"
            >
              Book a lesson
            </a>
          </div>
        </div>
      </nav>

      {/* ═════════════════════ HERO ═════════════════════ */}
      <header className="relative overflow-hidden cg-hero-clip pt-16">
        {/* Layered gradient — indigo → violet → cyan */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-violet-800 to-cyan-700" />
        {/* Coach cover overlays the gradient at low opacity for texture */}
        {p.coverUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-40"
            style={{ backgroundImage: `url(${p.coverUrl})` }}
          />
        )}
        <ChessboardPattern light="#f0f9ff" dark="#312e81" opacity={0.08} />

        {/* floating decorative pieces */}
        <PieceSilhouette piece="knight" className="absolute -left-6 top-24 w-40 md:w-56 text-white/10 cg-float" />
        <PieceSilhouette piece={watermarkPiece} className="absolute -right-8 bottom-24 w-48 md:w-72 text-white/12 cg-float" />
        <div className="absolute top-40 right-1/4 w-6 h-6 rounded-full bg-amber-300/70 blur-sm cg-float" />
        <div className="absolute bottom-40 left-1/3 w-8 h-8 rounded-full bg-rose-400/50 blur-md" />

        <div className="relative mx-auto max-w-7xl px-4 md:px-8 pt-10 pb-40 md:pt-16 md:pb-48">
          <div className="grid md:grid-cols-[1fr_auto] gap-10 md:gap-14 items-center">
            <div className="text-white cg-fade-up">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white/90 mb-6">
                <CountryFlag country={p.country} />
                <span>{fedLine || "Online coach"}</span>
                {c.academyName && <><span className="text-white/40">·</span><span>{c.academyName}</span></>}
              </div>
              <div className="flex items-center gap-3 mb-4">
                {p.titleClass && (
                  <span className="inline-flex items-center px-3 py-1 rounded-md bg-gradient-to-br from-amber-400 to-yellow-600 text-white text-sm font-black tracking-wider shadow-lg shadow-amber-500/40">
                    {p.titleClass}
                  </span>
                )}
                {p.elo && <RatingPill rating={p.elo} />}
              </div>
              <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight mb-5 text-white">
                {displayName}
              </h1>
              {p.tagline && (
                <p className="text-lg md:text-2xl text-indigo-100 mb-6 leading-relaxed max-w-xl">
                  {p.tagline}
                </p>
              )}
              {styleTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-8">
                  {styleTags.map((s) => (
                    <span key={s} className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/25 text-white/90 text-xs font-semibold uppercase tracking-wider">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <a
                  href={bookCtaHref}
                  {...(bookCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-white font-bold text-base shadow-2xl shadow-emerald-500/40 transition-transform hover:scale-105"
                >
                  <span>{bookCtaLabel}</span>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                </a>
                <a
                  href="#style"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/30 hover:bg-white/20 text-white font-semibold"
                >
                  See coaching style
                </a>
                {isMe && (
                  <Link
                    to="/coach-profile/edit"
                    className="inline-flex items-center gap-1 px-4 py-3.5 rounded-xl border border-amber-300/60 text-amber-200 hover:text-white hover:bg-amber-400/20 text-sm font-medium"
                  >
                    ✎ Edit profile
                  </Link>
                )}
              </div>
            </div>

            {/* Photo column — coach photo overlaps the hero seam via absolute
                positioning on the frame itself. */}
            <div className="relative cg-fade-up flex flex-col items-center md:items-end" style={{ animationDelay: "0.15s" }}>
              <CoachPhotoFrame src={p.photoUrl} name={displayName} size={240} />
              {/* rating chip that pops out of the photo */}
              {(p.elo || p.federation) && (
                <div className="mt-4 md:absolute md:-bottom-6 md:-left-4 bg-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 grid place-items-center text-xl">🏅</div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">FIDE Rated</div>
                    <div className="text-sm font-bold text-slate-900">{p.elo || "—"}{p.federation ? ` · ${p.federation}` : ""}</div>
                  </div>
                </div>
              )}
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

      {/* ═════════════════════ ABOUT + SIGNATURE OPENING ═════════════════════ */}
      <section id="about" className="relative bg-white/70 backdrop-blur-sm py-20 md:py-28 overflow-hidden mt-16">
        <ChessboardPattern light="#fef7e0" dark="#fde68a" opacity={0.3} className="[mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        <div className="relative mx-auto max-w-7xl px-4 md:px-8 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest mb-4">About Me</div>
            <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-6 leading-tight">
              A coach who plays <span className="text-indigo-600">what they teach</span>
            </h2>
            {p.bio ? (
              <div dangerouslySetInnerHTML={renderBio(p.bio)} />
            ) : (
              <p className="mb-4 leading-relaxed text-slate-600 text-lg italic">
                {displayName} hasn't written a bio yet — but you can see plenty of their work below.
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={bookCtaHref}
                {...(bookCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-500/30"
              >
                {bookCtaLabel} →
              </a>
              {p.socials.website && (
                <a
                  href={socialHref("website", p.socials.website)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white border-2 border-indigo-200 hover:border-indigo-500 text-indigo-700 font-semibold"
                >
                  Visit website
                </a>
              )}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 bg-gradient-to-br from-amber-200 via-orange-200 to-rose-200 rounded-3xl opacity-40 blur-2xl" />
            <div className="relative">
              <SignatureOpeningCard
                name={styleTags.includes("Aggressive") ? "Sicilian Najdorf" : styleTags.includes("Positional") ? "King's Indian Attack" : "The Coach's Repertoire"}
                moves={styleTags.includes("Aggressive") ? "1.e4 c5 2.Nf3 d6 3.d4" : styleTags.includes("Positional") ? "1.Nf3 d5 2.g3 c5 3.Bg2" : "1.e4 …"}
                color={p.playingStyles.includes("Solid") ? "Black" : "White"}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════════ COACHING STYLE ═════════════════════ */}
      <section id="style" className="relative mx-auto max-w-7xl px-4 md:px-8 py-20 md:py-28">
        <div className="text-center mb-12 md:mb-16">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-widest mb-4">How I Teach</div>
          <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">🎯 Coaching Style</h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            What a lesson with {displayName.split(" ")[0]} actually looks like.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(styleTags.length > 0 ? styleTags : ["Universal"]).map((s, i) => (
            <div
              key={s}
              className="relative overflow-hidden rounded-3xl bg-white border border-slate-100 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all cg-fade-up p-6"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <PieceSilhouette piece={i % 2 === 0 ? "knight" : "bishop"} className="absolute -right-4 -top-4 w-28 text-indigo-100" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-black uppercase tracking-wider mb-4">
                  <span aria-hidden>{i === 0 ? "♞" : i === 1 ? "♝" : i === 2 ? "♜" : "♛"}</span> {s}
                </div>
                <p className="text-slate-700 leading-relaxed">
                  {STYLE_BLURB[s] || "A well-rounded approach adapted to each student."}
                </p>
              </div>
            </div>
          ))}
          {/* A generic "how a lesson runs" tile so this section never looks bare */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-700 to-cyan-700 text-white shadow-2xl p-6 cg-fade-up" style={{ animationDelay: `${styleTags.length * 0.06}s` }}>
            <ChessClock className="absolute -right-6 -bottom-6 w-40 opacity-40" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-black uppercase tracking-wider mb-4">
                A typical lesson
              </div>
              <ul className="space-y-2 text-white/95 text-sm leading-relaxed list-disc list-inside">
                <li>Warm-up puzzles matched to your rating</li>
                <li>Deep dive on the theme of the week</li>
                <li>Sparring game with live review</li>
                <li>Take-home study assignment</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════════ CAREER HIGHLIGHTS / ACHIEVEMENTS ═════════════════════ */}
      {p.achievements.length > 0 && (
        <section id="achievements" className="relative bg-gradient-to-br from-amber-50 via-white to-orange-50 py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center mb-12">
              <div className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest mb-4">Career Milestones</div>
              <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">🏆 Career Highlights</h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Titles, tournament finishes, and moments that shaped {displayName.split(" ")[0]}'s chess story.
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
          </div>
        </section>
      )}

      {/* ═════════════════════ TOP STUDENTS ═════════════════════ */}
      {p.topStudents.length > 0 && (
        <section id="students" className="relative mx-auto max-w-7xl px-4 md:px-8 py-20 md:py-28">
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-bold uppercase tracking-widest mb-4">Alumni Board</div>
            <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">🎓 Top Students</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              A few players who've climbed the ladder training with {displayName.split(" ")[0]}.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {p.topStudents.map((s, i) => (
              <div
                key={s.id}
                className="relative overflow-hidden rounded-3xl bg-white border border-violet-100 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all cg-fade-up"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                <PieceSilhouette piece="pawn" className="absolute -right-4 -top-4 w-24 text-violet-100" />
                <div className="relative flex justify-center pt-8 pb-2">
                  {s.imageUrl ? (
                    <img src={s.imageUrl} alt={s.name} className="w-28 h-28 rounded-full object-cover ring-4 ring-white shadow-lg bg-slate-100" />
                  ) : (
                    <div className="w-28 h-28 rounded-full ring-4 ring-white shadow-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 grid place-items-center text-4xl font-bold text-white">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="p-5 text-center">
                  <h3 className="font-display text-xl text-slate-900 mb-2">{s.name}</h3>
                  {s.peakRating && (
                    <div className="flex justify-center mb-2">
                      <RatingPill rating={s.peakRating} />
                    </div>
                  )}
                  {s.note && (
                    <p className="text-sm text-slate-600 leading-relaxed">{s.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═════════════════════ TROPHIES ═════════════════════ */}
      {p.trophies.length > 0 && (
        <section className="relative bg-gradient-to-br from-slate-50 via-white to-amber-50 py-20 md:py-28 overflow-hidden">
          <PieceSilhouette piece="rook" className="absolute left-4 top-10 w-32 text-amber-200 opacity-70" />
          <PieceSilhouette piece="king" className="absolute right-4 bottom-10 w-40 text-amber-300 opacity-60" />
          <div className="relative mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center mb-12">
              <div className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-widest mb-4">Trophy Cabinet</div>
              <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">🏅 Trophies</h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Hardware collected along the way.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
              {p.trophies.map((t, i) => (
                <div
                  key={t.id}
                  className="relative rounded-3xl bg-white p-4 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all border border-amber-100 cg-fade-up"
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  {t.imageUrl ? (
                    <img src={t.imageUrl} alt={t.name} className="w-full aspect-square object-cover rounded-2xl mb-3 bg-slate-100" />
                  ) : (
                    <div className="relative w-full aspect-square rounded-2xl mb-3 bg-gradient-to-br from-amber-400 to-yellow-600 grid place-items-center overflow-hidden">
                      <div className="text-6xl drop-shadow-lg">🏅</div>
                      <PieceSilhouette piece="queen" className="absolute -right-3 -bottom-3 w-16 text-white/40" />
                    </div>
                  )}
                  <div className="text-center">
                    <div className="font-display text-lg text-slate-900 truncate">{t.name}</div>
                    {t.year && <div className="text-xs text-slate-500 mt-0.5">{t.year}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═════════════════════ UPCOMING CLASSES ═════════════════════ */}
      {upcoming.length > 0 && (
        <section id="classes" className="relative mx-auto max-w-7xl px-4 md:px-8 py-20 md:py-28">
          <div className="text-center mb-12">
            <div className="inline-block px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold uppercase tracking-widest mb-4">On the calendar</div>
            <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">📅 Upcoming Classes</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Drop in on {displayName.split(" ")[0]}'s next live sessions.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {upcoming.map((cl, i) => (
              <div
                key={cl._id}
                className="relative rounded-3xl bg-white p-6 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all border border-emerald-100 cg-fade-up"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                <CalendarBadge className="absolute -top-4 -right-2 w-14" tint="#10b981" label={new Date(cl.startAt).toLocaleDateString(undefined, { month: "short" }).toUpperCase()} />
                <div className="flex items-start justify-between gap-2 mb-3 pr-14">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 cg-pulse-ring inline-block" />
                    Live class
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold">
                    {cl.durationMin} min
                  </span>
                </div>
                <h3 className="font-display text-xl text-slate-900 mb-2 leading-tight">{cl.title || "Chess class"}</h3>
                <div className="text-sm text-slate-500 mb-4">{fmtStart(cl.startAt)}</div>
                {authQ.data?.loggedIn ? (
                  <Link
                    to={`/class-v2/${cl._id}?role=student`}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Join room →
                  </Link>
                ) : (
                  <a href={bookCtaHref} {...(bookCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                    Book to attend →
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═════════════════════ TESTIMONIALS ═════════════════════ */}
      {testimonials.length > 0 && (
        <section className="relative bg-gradient-to-br from-violet-50 via-white to-cyan-50 py-20 md:py-28 overflow-hidden">
          <PieceSilhouette piece="bishop" className="absolute left-4 top-10 w-32 text-violet-200 opacity-60" />
          <PieceSilhouette piece="rook" className="absolute right-4 bottom-10 w-32 text-cyan-200 opacity-60" />
          <div className="relative mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center mb-12">
              <div className="inline-block px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-bold uppercase tracking-widest mb-4">Student Voices</div>
              <h2 className="font-display text-4xl md:text-5xl text-slate-900 mb-3">💬 Testimonials</h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Real families, real progress, real wins.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {testimonials.map((t, i) => (
                <figure
                  key={t.id}
                  className="relative rounded-3xl bg-white p-6 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all cg-fade-up border border-violet-100"
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  <div className="absolute -top-3 left-6 text-5xl text-violet-400 leading-none">"</div>
                  {typeof t.rating === "number" && <StarRating rating={t.rating} />}
                  <blockquote className="mt-3 text-slate-700 leading-relaxed italic">{t.quote}</blockquote>
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

      {/* ═════════════════════ FINAL CTA BAND ═════════════════════ */}
      <section id="contact" className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-violet-800 to-fuchsia-700" />
        <ChessboardPattern light="#a5b4fc" dark="#1e1b4b" opacity={0.1} />
        <PieceSilhouette piece="king" className="absolute -left-8 top-1/2 -translate-y-1/2 w-64 text-white/8" />
        <PieceSilhouette piece="queen" className="absolute -right-10 top-1/2 -translate-y-1/2 w-72 text-white/10" />
        <div className="relative mx-auto max-w-4xl px-4 md:px-8 py-20 md:py-32 text-center text-white">
          <div className="text-6xl mb-6 cg-float inline-block">♟</div>
          <h2 className="font-display text-4xl md:text-6xl leading-tight mb-5">
            Ready to level up?
          </h2>
          <p className="text-lg md:text-xl text-indigo-100 mb-8 max-w-2xl mx-auto">
            Book a lesson with {displayName.split(" ")[0]} — whether you're new to the game or preparing for a tournament, they'll meet you where you are.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={bookCtaHref}
              {...(bookCtaExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-white font-bold text-lg shadow-2xl shadow-amber-500/40 transition-transform hover:scale-105"
            >
              {bookCtaLabel}
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </a>
            {socialEntries.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 items-center">
                {socialEntries.slice(0, 6).map(([kind, v]) => (
                  <a
                    key={kind}
                    href={socialHref(kind, v)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white/10 backdrop-blur-sm border border-white/30 hover:bg-white/20 text-white transition-colors"
                    title={kind}
                    aria-label={kind}
                  >
                    <SocialIcon kind={kind} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ═════════════════════ FOOTER ═════════════════════ */}
      <footer className="bg-slate-900 text-slate-300 relative z-10">
        <div className="mx-auto max-w-7xl px-4 md:px-8 py-12 grid md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              {p.photoUrl ? (
                <img src={p.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-700" />
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
              {c.academyName && <div>Coaches at <span className="text-slate-200 font-medium">{c.academyName}</span></div>}
              {p.customDomain && <div><a href={`https://${p.customDomain}`} className="hover:text-white">{p.customDomain}</a></div>}
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-3 text-sm uppercase tracking-widest">Follow</h4>
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
              <p className="text-sm text-slate-500">Add social links to appear here.</p>
            )}
          </div>
        </div>
        <div className="border-t border-slate-800">
          <div className="mx-auto max-w-7xl px-4 md:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <div>© {new Date().getFullYear()} {displayName}. All rights reserved.</div>
            {/* On custom-domain tenants we deliberately do NOT link back to
                ChessGuru marketing — just render the credit statically. */}
            <a href="https://harinitharanjith.com" target="_blank" rel="noreferrer" className="hover:text-white">
              Powered by <span className="font-semibold text-slate-300">ChessGuru</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
