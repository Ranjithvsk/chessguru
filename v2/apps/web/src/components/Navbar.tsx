import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import InstallButton from "./InstallButton";
import { useTheme } from "../hooks/useTheme";

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const label = resolved === "light" ? "Switch to dark mode" : "Switch to light mode";
  return (
    <button onClick={toggle} title={label} aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-ink-300 hover:bg-ink-800 hover:text-white">
      {resolved === "light" ? (
        // moon (currently light → offer dark)
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16.5 12.5A6.5 6.5 0 1 1 7.5 3.5a5.5 5.5 0 0 0 9 9Z" />
        </svg>
      ) : (
        // sun (currently dark → offer light)
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

// Lichess-style grouped navigation (owner 2026-07-08). Desktop (md+) shows four
// dropdown groups; small screens keep the proven flat scrollable row.
type Item = { to: string; label: string; end?: boolean; desc?: string };
type Group = { label: string; items: Item[]; accent: string; icon: string };

/** Split an item label into "<emoji> <rest>" so the drawer can render the
 *  emoji inside a colored badge instead of inline gray text. */
function splitLabel(label: string): { icon: string; text: string } {
  // Match one emoji (possibly grapheme-clustered) then a space then the rest.
  const m = label.match(/^(\S+)\s+(.+)$/u);
  if (m) return { icon: m[1]!, text: m[2]! };
  return { icon: "•", text: label };
}

const GROUPS: Group[] = [
  {
    // Coach/owner tools — surfaced first so academy staff land here fast.
    label: "Academy", accent: "amber", icon: "🏛️",
    items: [
      { to: "/academy", label: "🏛️ My Academy", desc: "Coaches, students, invites, batches" },
      { to: "/academy/leaderboard", label: "🏆 Leaderboard", desc: "Academy ranking, ChessGuru Score, champions, boost weeks" },
      { to: "/academy/performance", label: "📊 Student performance", desc: "Rating, tier, attendance dashboard per student" },
      { to: "/coach-board", label: "🧑‍🏫 Class Board", desc: "Student watchlist + class-plan generator" },
      { to: "/coach-board/reports", label: "📄 Parent reports", desc: "Monthly per-student progress reports" },
      { to: "/parent", label: "👪 Family portal", desc: "For parents — child's progress + billing (sign in with the parent account you were linked to)" },
    ],
  },
  {
    label: "Puzzles", accent: "brand", icon: "🧩",
    items: [
      { to: "/", label: "🧩 Puzzle trainer", end: true, desc: "Rated tactics, all themes" },
      { to: "/daily", label: "🎯 Puzzle of the day", desc: "One puzzle everyone gets today" },
      { to: "/blindfold", label: "🕶️ Blindfold", desc: "Solve without seeing the pieces" },
      { to: "/dashboard", label: "📊 My performance", desc: "Ratings, strengths & progress" },
      { to: "/history", label: "📜 My history", desc: "Every puzzle you've solved" },
      { to: "/settings/accounts", label: "🔗 Linked accounts", desc: "Link Lichess + Chess.com" },
    ],
  },
  {
    label: "Play", accent: "rose", icon: "♟️",
    items: [
      { to: "/play", label: "♟️ Play", desc: "Pass & play on one screen" },
      { to: "/engine-battle", label: "⚔️ Engine battle", desc: "Watch engines fight it out" },
      { to: "/class", label: "🎥 Live class", desc: "Video coaching + shared board" },
      { to: "/class-v2/demo", label: "🚀 Dream Meet", desc: "Live video meetings" },
    ],
  },
  {
    // Curated curriculum — prescribed content, drill-based.
    label: "Learn", accent: "sky", icon: "📚",
    items: [
      { to: "/study", label: "📚 Study", desc: "Endgames, coordinates, memory palace, drills" },
      { to: "/openings", label: "📖 Openings", desc: "Notation, corpus, tree, repertoire, explorer" },
      { to: "/broadcasts", label: "📡 Broadcast games", desc: "Master tournament games" },
      { to: "/book", label: "📕 Book", desc: "Puzzles from the book games" },
    ],
  },
  {
    // User-generated retention loop (Slices 1–6): open-ended, personal.
    label: "Notebook", accent: "emerald", icon: "📓",
    items: [
      { to: "/studies", label: "📓 My Studies", desc: "Analyze games, teach concepts, opening notes" },
      { to: "/books", label: "📚 Books", desc: "Track chapters read, link studies to book positions" },
      { to: "/revise", label: "🎯 Revise", desc: "Daily spaced-repetition drill of your ⭐ positions" },
      { to: "/exams", label: "📝 Exams", desc: "Coach: test students. Student: take assigned exams" },
      { to: "/my-games", label: "🎮 My Games", desc: "Import + Stockfish-analyze your played games" },
      { to: "/my-insights", label: "🔍 My Insights", desc: "Your weaknesses + what to study to fix them" },
    ],
  },
  {
    label: "Tools", accent: "slate", icon: "🛠️",
    items: [
      { to: "/board-editor", label: "📷 Scan position", desc: "Upload/paste/camera → auto-detect FEN (Server AI)" },
      { to: "/board-editor", label: "✏️ Board editor", desc: "Set up any position" },
    ],
  },
];

/** Tailwind classes must be present as full literals so JIT can pick them up.
 *  Add new accents here rather than composing strings dynamically. */
const ACCENT: Record<string, { badgeBg: string; badgeText: string; itemBg: string; itemRing: string; activeBg: string }> = {
  amber:   { badgeBg: "bg-amber-500/20",   badgeText: "text-amber-200",   itemBg: "bg-amber-500/10",   itemRing: "ring-amber-500/30",   activeBg: "bg-amber-500/25" },
  brand:   { badgeBg: "bg-brand-500/20",   badgeText: "text-brand-200",   itemBg: "bg-brand-500/10",   itemRing: "ring-brand-500/30",   activeBg: "bg-brand-500/25" },
  rose:    { badgeBg: "bg-rose-500/20",    badgeText: "text-rose-200",    itemBg: "bg-rose-500/10",    itemRing: "ring-rose-500/30",    activeBg: "bg-rose-500/25" },
  sky:     { badgeBg: "bg-sky-500/20",     badgeText: "text-sky-200",     itemBg: "bg-sky-500/10",     itemRing: "ring-sky-500/30",     activeBg: "bg-sky-500/25" },
  emerald: { badgeBg: "bg-emerald-500/20", badgeText: "text-emerald-200", itemBg: "bg-emerald-500/10", itemRing: "ring-emerald-500/30", activeBg: "bg-emerald-500/25" },
  slate:   { badgeBg: "bg-slate-500/20",   badgeText: "text-slate-200",   itemBg: "bg-slate-500/10",   itemRing: "ring-slate-500/30",   activeBg: "bg-slate-500/25" },
};

/** Collapsible group inside the left drawer. Collapsed by default; auto-opens
 *  when the active route is inside this group so users see where they are. */
function DrawerGroup({ group, currentPath }: { group: Group; currentPath: string }) {
  const active = groupIsActive(group, currentPath);
  const [open, setOpen] = useState(active);
  // Re-open if the user navigates into this group externally.
  useEffect(() => { if (active) setOpen(true); }, [active]);
  const a = ACCENT[group.accent] ?? ACCENT.slate!;
  return (
    <div className="mb-1">
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-ink-800/60">
        <span className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg text-base ring-1 ${a.badgeBg} ${a.badgeText} ${a.itemRing}`}>{group.icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-200">{group.label}</span>
        <span className="ml-1 rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-500">{group.items.length}</span>
        <svg className={`ml-auto h-3.5 w-3.5 text-ink-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="mb-2 ml-1 flex flex-col gap-0.5 border-l border-ink-800 pl-2">
          {group.items.map((i) => {
            const { icon, text } = splitLabel(i.label);
            return (
              <NavLink key={i.to + i.label} to={i.to} end={i.end}
                className={({ isActive }) =>
                  `group flex items-start gap-2.5 rounded-lg px-2 py-2 transition ${isActive ? a.activeBg : "hover:bg-ink-800"}`}>
                <span className={`mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-lg ring-1 ${a.itemBg} ${a.itemRing}`}>{icon}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-white">{text}</span>
                  {i.desc && <span className="text-xs text-ink-400 line-clamp-2">{i.desc}</span>}
                </span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

function groupIsActive(g: Group, path: string): boolean {
  return g.items.some((i) => (i.end ? path === i.to : path === i.to || path.startsWith(i.to + "/")));
}

function Dropdown({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const active = groupIsActive(group, pathname);

  useEffect(() => setOpen(false), [pathname]); // navigating closes the menu
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-haspopup="menu"
        className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          active ? "bg-brand-600 text-white" : "text-ink-300 hover:bg-ink-800 hover:text-white"
        }`}>
        {group.label}
        <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 w-64 pt-1">
          {/* max-h caps the dropdown so long menus (Learn has ~17 items) stay on-screen; overflow-y-auto scrolls the rest. */}
          <div className="max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-xl border border-ink-700 bg-ink-900 shadow-xl shadow-black/40">
            {group.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} role="menuitem"
                className={({ isActive }) =>
                  `block px-4 py-2.5 transition ${isActive ? "bg-brand-600/20" : "hover:bg-ink-800"}`}>
                <span className="block text-sm font-medium text-white">{i.label}</span>
                {i.desc && <span className="block text-xs text-ink-400">{i.desc}</span>}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface Props { rating?: number; username?: string; admin?: boolean; onLogout?: () => void; }

// Detect the tenant slug from the URL (/a/:slug/*) OR from the custom domain
// (gunachess.com → "gunachess"). Returns null when we're on the main ChessGuru
// domain / localhost — no tenant chrome, keep default ChessGuru brand.
function useTenantSlug(): string | null {
  const { pathname } = useLocation();
  // /a/:slug/... — SPA path
  const m = pathname.match(/^\/a\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);
  // Custom domain — anything that isn't chessguru.com / harinitharanjith.com / localhost / bare IP
  if (typeof window !== "undefined") {
    const h = window.location.hostname.toLowerCase();
    if (h && !/^(chessguru\.com|harinitharanjith\.com|localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/.test(h)) {
      // Take first label as the guess slug (gunachess.com → "gunachess"). Backend
      // /api/academy-page/:slug tolerates ownerId lookup for tenants.
      return h.split(".")[0];
    }
  }
  return null;
}

interface Brand { name: string; logoUrl: string | null }
const NAV_API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
const BRAND_CACHE_KEY = "cg.tenant-brand";
function readCachedBrand(slug: string): Brand | null {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const hit = cache?.[slug];
    if (hit && typeof hit.name === "string") return { name: hit.name, logoUrl: hit.logoUrl ?? null };
  } catch { /* ignore */ }
  return null;
}
function writeCachedBrand(slug: string, brand: Brand) {
  try {
    const raw = localStorage.getItem(BRAND_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[slug] = brand;
    localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}
function useTenantBrand(): Brand | null {
  const slug = useTenantSlug();
  // Hydrate synchronously from localStorage so repeat visits don't flash the
  // default "ChessGuru" label while the fetch is in flight. First-visit users
  // still see one flash, but every subsequent load is instant.
  const [brand, setBrand] = useState<Brand | null>(() => slug ? readCachedBrand(slug) : null);
  useEffect(() => {
    if (!slug) { setBrand(null); return; }
    let cancelled = false;
    fetch(`${NAV_API_BASE}/api/academy-page/${encodeURIComponent(slug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => {
        if (cancelled) return;
        const name = j?.profile?.displayName || j?.academy?.name || "";
        const logoUrl = j?.profile?.logoUrl || null;
        if (name) {
          const next = { name, logoUrl };
          setBrand(next);
          writeCachedBrand(slug, next);
        }
      })
      .catch(() => { /* keep cached brand if the refresh fails */ });
    return () => { cancelled = true; };
  }, [slug]);
  return brand;
}

export default function Navbar({ rating, username, admin, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]); // navigating closes the drawer
  const tenantBrand = useTenantBrand();

  const adminLink = (to: string, label: string) => (
    <NavLink to={to}
      className={({ isActive }) =>
        `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          isActive ? "bg-brand-600 text-white" : "text-amber-300 hover:bg-ink-800 hover:text-white"
        }`}>
      {label}
    </NavLink>
  );

  // Lock body scroll while the drawer is open so touching the drawer doesn't
  // scroll the page underneath (and desktop stays put too).
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-ink-700/70 bg-ink-900/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        {/* Hamburger — toggles the left drawer. Icon flips to ✕ when open so
            a second tap on the same spot clearly closes. */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-haspopup="menu"
          className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-ink-200 hover:bg-ink-800">
          {menuOpen ? (
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          )}
        </button>

        <NavLink to="/" className="flex items-center gap-2">
          {tenantBrand?.logoUrl ? (
            <img src={tenantBrand.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover ring-1 ring-white/20" />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient text-white shadow-glow">♞</span>
          )}
          <span className="font-display text-lg text-white">{tenantBrand?.name || "ChessGuru"}</span>
        </NavLink>

        <div className="ml-auto flex items-center gap-3 pl-2">
          <ThemeToggle />
          <InstallButton />
          {rating != null && (
            <span className="hidden rounded-lg bg-ink-800 px-3 py-1.5 text-sm sm:inline">
              <span className="text-ink-400">Rating </span><span className="font-semibold text-white">{rating}</span>
            </span>
          )}
          {username ? (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-sm font-medium text-white">{username}</span>
              <button onClick={onLogout} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white">Sign out</button>
            </div>
          ) : (
            <NavLink to="/login" className="hidden rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white sm:inline-block">Sign in</NavLink>
          )}
        </div>
      </nav>

      {/* Left slide-in drawer + dim backdrop. Renders when open so pathname-close
          in the effect above still cleans up between routes. */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 top-14 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside className="fixed left-0 top-14 z-50 h-[calc(100dvh-3.5rem)] w-72 max-w-[85vw] overflow-y-auto border-r border-ink-700/70 bg-ink-900 shadow-2xl">
            <div className="px-3 py-4">
              {GROUPS.map((g) => (
                <DrawerGroup key={g.label} group={g} currentPath={pathname} />
              ))}
              {(admin || (!username && true) || (username && true)) && (
                <div className="mt-2 border-t border-ink-800 pt-3">
                  {admin && (
                    <>
                      <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-400">Admin</div>
                      <div className="flex flex-col gap-0.5">
                        {adminLink("/admin/users", "Admin — Users")}
                        {adminLink("/admin/mail-log", "Admin — Mail log")}
                        {adminLink("/admin/domains", "Admin — Domains")}
                        {adminLink("/admin", "Admin — Factory")}
                      </div>
                    </>
                  )}
                  {rating != null && (
                    <div className="mt-2 px-1 text-xs text-ink-400">Rating <b className="text-white">{rating}</b></div>
                  )}
                  {username ? (
                    <div className="mt-2 flex items-center justify-between px-1">
                      <span className="text-sm font-medium text-white">{username}</span>
                      <button onClick={onLogout} className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 hover:text-white">Sign out</button>
                    </div>
                  ) : (
                    <NavLink to="/login" className="mt-2 block rounded-lg border border-ink-700 px-3 py-2 text-center text-sm text-ink-300 hover:text-white">Sign in</NavLink>
                  )}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </header>
  );
}
