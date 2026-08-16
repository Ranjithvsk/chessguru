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
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Puzzles",
    items: [
      { to: "/", label: "🧩 Puzzle trainer", end: true, desc: "Rated tactics, all themes" },
      { to: "/daily", label: "🎯 Puzzle of the day", desc: "One puzzle everyone gets today" },
      { to: "/blindfold", label: "🕶️ Blindfold", desc: "Solve without seeing the pieces" },
      { to: "/dashboard", label: "📊 My performance", desc: "Ratings, strengths & progress" },
      { to: "/history", label: "📜 My history", desc: "Every puzzle you've solved" },
      { to: "/settings/accounts", label: "🔗 Linked accounts", desc: "Link Lichess + Chess.com" },
      { to: "/academy", label: "🏛️ My Academy", desc: "Coaches, students, invites" },
    ],
  },
  {
    label: "Play",
    items: [
      { to: "/play", label: "♟️ Play", desc: "Pass & play on one screen" },
      { to: "/engine-battle", label: "⚔️ Engine battle", desc: "Watch engines fight it out" },
      { to: "/class", label: "🎥 Live class", desc: "Video coaching + shared board" },
      { to: "/class-v2/demo", label: "🚀 Dream Meet", desc: "Live video meetings" },
    ],
  },
  {
    // Curated curriculum — prescribed content, drill-based.
    label: "Learn",
    items: [
      { to: "/study", label: "📚 Study", desc: "Guided lessons & drills" },
      { to: "/opening", label: "📖 Openings", desc: "Learn and drill openings" },
      { to: "/broadcasts", label: "📡 Broadcast games", desc: "Master tournament games" },
      { to: "/book", label: "📕 Book", desc: "Puzzles from the book games" },
      { to: "/study/coordinates", label: "🎯 Coordinates", desc: "Name squares at speed" },
      { to: "/study/memory-palace", label: "🏛️ Memory palace", desc: "Board memory training" },
      { to: "/study/promote", label: "👑 Promote One Pawn", desc: "Guided endgame course" },
      { to: "/study/opposition", label: "🤝 Opposition", desc: "Direct, distant & very distant" },
      { to: "/study/endgame", label: "🏁 Endgame trainer", desc: "Rule of the square, K+P vs K" },
      { to: "/study/key-squares", label: "🔑 Key squares", desc: "Tap the king's winning squares" },
    ],
  },
  {
    // User-generated retention loop (Slices 1–6): open-ended, personal.
    label: "Notebook",
    items: [
      { to: "/studies", label: "📓 My Studies", desc: "Analyze games, teach concepts, opening notes" },
      { to: "/books", label: "📚 Books", desc: "Track chapters read, link studies to book positions" },
      { to: "/revise", label: "🎯 Revise", desc: "Daily spaced-repetition drill of your ⭐ positions" },
      { to: "/exams", label: "📝 Exams", desc: "Coach: test students. Student: take assigned exams" },
      { to: "/my-games", label: "🎮 My Games", desc: "Import + Stockfish-analyze your played games" },
      { to: "/my-insights", label: "🔍 My Insights", desc: "Your weaknesses + what to study to fix them" },
      { to: "/coach-board", label: "🧑‍🏫 Class Board", desc: "Coach: student watchlist + class-plan generator" },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/board-editor", label: "📷 Scan position", desc: "Upload/paste/camera → auto-detect FEN (Server AI)" },
      { to: "/board-editor", label: "✏️ Board editor", desc: "Set up any position" },
    ],
  },
];

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
        {/* Hamburger — ALWAYS visible now (was mobile-only). Opens left drawer. */}
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu" aria-expanded={menuOpen} aria-haspopup="menu"
          className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-ink-200 hover:bg-ink-800">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
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
                <div key={g.label} className="mb-3">
                  <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{g.label}</div>
                  <div className="flex flex-col gap-0.5">
                    {g.items.map((i) => (
                      <NavLink key={i.to} to={i.to} end={i.end}
                        className={({ isActive }) =>
                          `flex flex-col rounded-lg px-3 py-2 transition ${isActive ? "bg-brand-600/20" : "hover:bg-ink-800"}`}>
                        <span className="text-sm font-medium text-white">{i.label}</span>
                        {i.desc && <span className="text-xs text-ink-400">{i.desc}</span>}
                      </NavLink>
                    ))}
                  </div>
                </div>
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
