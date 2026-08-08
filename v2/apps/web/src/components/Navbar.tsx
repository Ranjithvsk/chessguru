import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import InstallButton from "./InstallButton";

// Lichess-style grouped navigation (owner 2026-07-08). Desktop (md+) shows four
// dropdown groups; small screens keep the proven flat scrollable row.
type Item = { to: string; label: string; end?: boolean; desc?: string };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Puzzles",
    items: [
      { to: "/", label: "🧩 Puzzle trainer", end: true, desc: "Rated tactics, all themes" },
      { to: "/blindfold", label: "🕶️ Blindfold", desc: "Solve without seeing the pieces" },
      { to: "/dashboard", label: "📊 My performance", desc: "Ratings, strengths & progress" },
      { to: "/history", label: "📜 My history", desc: "Every puzzle you've solved" },
    ],
  },
  {
    label: "Play",
    items: [
      { to: "/play", label: "♟️ Play", desc: "Pass & play on one screen" },
      { to: "/engine-battle", label: "⚔️ Engine battle", desc: "Watch engines fight it out" },
      { to: "/class", label: "🎥 Live class", desc: "Video coaching + shared board" },
    ],
  },
  {
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
    label: "Tools",
    items: [{ to: "/board-editor", label: "✏️ Board editor", desc: "Set up any position" }],
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
          <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-xl shadow-black/40">
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

export default function Navbar({ rating, username, admin, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]); // navigating closes the drawer

  const adminLink = (to: string, label: string) => (
    <NavLink to={to}
      className={({ isActive }) =>
        `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          isActive ? "bg-brand-600 text-white" : "text-amber-300 hover:bg-ink-800 hover:text-white"
        }`}>
      {label}
    </NavLink>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-ink-700/70 bg-ink-900/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
        <NavLink to="/" className="mr-2 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient text-white shadow-glow">♞</span>
          <span className="font-display text-lg text-white">ChessGuru</span>
        </NavLink>

        {/* Desktop: grouped dropdowns */}
        <div className="hidden items-center gap-1 md:flex">
          {GROUPS.map((g) => <Dropdown key={g.label} group={g} />)}
          {admin && <>{adminLink("/admin/users", "Admin")}{adminLink("/admin", "Factory")}</>}
        </div>

        <div className="ml-auto flex items-center gap-3 pl-2">
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

          {/* Mobile & tablet: hamburger toggles the grouped drawer (same organization as desktop) */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu" aria-expanded={menuOpen} aria-haspopup="menu"
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-200 hover:bg-ink-800 md:hidden">
            {menuOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile & tablet drawer — mirrors the desktop grouping (Puzzles / Play / Learn / Tools) */}
      {menuOpen && (
        <div className="md:hidden border-t border-ink-700/70 bg-ink-900/95 backdrop-blur">
          <div className="mx-auto max-h-[calc(100dvh-3.5rem)] max-w-6xl overflow-y-auto px-4 py-3">
            {GROUPS.map((g) => (
              <div key={g.label} className="py-1.5">
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{g.label}</div>
                <div className="grid gap-0.5 sm:grid-cols-2">
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
            {(admin || username || rating != null) && (
              <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-ink-800 pt-3">
                {rating != null && (
                  <span className="rounded-lg bg-ink-800 px-3 py-1.5 text-sm sm:hidden">
                    <span className="text-ink-400">Rating </span><span className="font-semibold text-white">{rating}</span>
                  </span>
                )}
                {admin && <>{adminLink("/admin/users", "Admin")}{adminLink("/admin", "Factory")}</>}
                {username ? (
                  <div className="ml-auto flex items-center gap-2 sm:hidden">
                    <span className="text-sm font-medium text-white">{username}</span>
                    <button onClick={onLogout} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white">Sign out</button>
                  </div>
                ) : (
                  <NavLink to="/login" className="ml-auto rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white sm:hidden">Sign in</NavLink>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
