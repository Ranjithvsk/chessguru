// Sticky top nav shared by all pages. `right` prop lets each page override the
// right-hand link (default: shows favorites/players when signed in, else Sign in).
import { Link } from "react-router-dom";
import { useMe } from "../lib/useMe";
import ThemeToggle from "./ThemeToggle";

interface Props { badge?: string; right?: React.ReactNode; }
export default function Nav({ badge = "Play", right }: Props) {
  const me = useMe();
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md border-b py-3 px-6"
         style={{ background: "var(--nav-bg)", borderColor: "var(--border)" }}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <span style={{ color: "#fbbf24" }}>♟</span>
          <span>ChessGuru</span>
          <span className="hidden sm:inline text-xs font-normal opacity-60 border rounded-full px-2 py-0.5 ml-1"
                style={{ borderColor: "var(--border-strong)" }}>{badge}</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <ThemeToggle />
          {right ?? (
            <>
              <Link to="/calendar" className="hidden md:inline opacity-80 hover:opacity-100">📅 <span className="hidden lg:inline">Calendar</span></Link>
              <Link to="/map" className="hidden md:inline opacity-80 hover:opacity-100">🗺 <span className="hidden lg:inline">Map</span></Link>
              {me?.loggedIn ? (
                <>
                  <Link to="/me/favorites" className="opacity-80 hover:opacity-100" title="Bookmarks">♥ <span className="hidden md:inline">Saved</span></Link>
                  <Link to="/me/players" className="hidden md:inline opacity-80 hover:opacity-100">Players</Link>
                  <Link to="/submit-tournament" className="hidden xl:inline opacity-80 hover:opacity-100">List a tournament</Link>
                  <span className="hidden md:inline text-xs opacity-60 border border-[color:var(--border-strong)] rounded-full px-2 py-1">{me.username}</span>
                </>
              ) : (
                <>
                  <Link to="/submit-tournament" className="hidden lg:inline opacity-80 hover:opacity-100">List a tournament</Link>
                  <a href={`https://chessguru.cc/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "/")}`}
                     className="rounded-full px-4 py-1.5 border border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]">Sign in</a>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
