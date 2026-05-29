import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Puzzles", end: true },
  { to: "/theme", label: "Themes" },
  { to: "/blindfold", label: "Blindfold" },
];

export default function Navbar({ rating }: { rating?: number }) {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-700/70 bg-ink-900/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <NavLink to="/" className="mr-2 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient text-white shadow-glow">♞</span>
          <span className="font-display text-lg text-white">ChessGuru</span>
        </NavLink>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                isActive ? "bg-brand-600 text-white" : "text-ink-400 hover:bg-ink-800 hover:text-white"
              }`
            }
          >
            {l.label}
          </NavLink>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {rating != null && (
            <span className="rounded-lg bg-ink-800 px-3 py-1.5 text-sm">
              <span className="text-ink-400">Rating </span>
              <span className="font-semibold text-white">{rating}</span>
            </span>
          )}
          <a href="/login" className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white">
            Sign in
          </a>
        </div>
      </nav>
    </header>
  );
}
