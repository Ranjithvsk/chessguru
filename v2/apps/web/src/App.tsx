import { Outlet, useLocation, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import Navbar from "./components/Navbar";
import StreakAtRiskBanner from "./components/StreakAtRiskBanner";
import LiveClassBanner from "./components/LiveClassBanner";
import HomeworkPendingBanner from "./components/HomeworkPendingBanner";
import { api } from "./lib/api";

// Hostnames that always render the main ChessGuru site (never redirect to a
// coach page). Anything else triggers the custom-domain shim below.
const CANONICAL_HOSTS = new Set([
  "harinitharanjith.com",
  "www.harinitharanjith.com",
  "admin.harinitharanjith.com",
  "localhost",
  "127.0.0.1",
]);

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export default function App() {
  // Hooks always first — before any early return (React #310 rule).
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const { data: rating } = useQuery({ queryKey: ["me-rating"], queryFn: api.myRating });
  const shimRan = useRef(false);

  // Custom-domain shim — on mount, if the hostname isn't ours AND we're at the
  // root path, look up which coach owns this domain and route to their page.
  // Fires exactly once per SPA load. Fails silently on 404 (unknown domain =
  // show the normal root, which will 302 → /v2/ per nginx).
  useEffect(() => {
    if (shimRan.current) return;
    shimRan.current = true;
    if (typeof window === "undefined") return;
    const host = window.location.hostname.toLowerCase();
    if (CANONICAL_HOSTS.has(host)) return;
    const path = window.location.pathname;
    // Only redirect from the "landing" paths. Deep links like /login shouldn't
    // get bounced off — the coach can still access /login etc. on their host.
    if (path !== "/" && path !== "/v2/" && path !== "/v2") return;
    fetch(`${API_BASE}/api/coach/by-domain/${encodeURIComponent(host)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { username?: string } | null) => {
        if (j?.username) navigate(`/coach/${j.username}`, { replace: true });
      })
      .catch(() => { /* silent — normal root will render */ });
  }, [navigate]);

  const logout = async () => { await api.logout(); await qc.invalidateQueries(); };
  const userId = auth?.loggedIn ? auth.userId ?? null : rating?.userId ?? null;
  const loc = useLocation();
  const showGuestWarn = !!auth && !auth.loggedIn && !["/login", "/register"].includes(loc.pathname);

  return (
    <div className="min-h-screen">
      <Navbar
        rating={rating?.rating}
        username={auth?.loggedIn ? auth.username : undefined}
        admin={auth?.loggedIn ? !!auth.admin : false}
        onLogout={logout}
      />
      <main className="mx-auto max-w-6xl px-4 py-6">
        {showGuestWarn && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span>⚠️ You’re not signed in — your puzzle progress won’t be saved.</span>
            <Link to="/login" className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-ink-900 hover:bg-amber-400">Sign in</Link>
          </div>
        )}
        <LiveClassBanner />
        <StreakAtRiskBanner />
        <HomeworkPendingBanner />
        <Outlet context={{ userId, rating: rating?.rating ?? 1500 }} />
      </main>
      {/* Global "📷 Scan chess position" FAB. Fixed bottom-left so it's
          always one tap away on phone. Hidden on /board-editor itself
          to avoid redundancy. */}
      {loc.pathname !== "/board-editor" && (
        <Link
          to="/board-editor"
          title="Scan chess position from image (camera or file)"
          className="fixed bottom-4 left-4 z-30 flex items-center gap-2 rounded-full border border-brand-400/50 bg-gradient-to-br from-brand-500 to-accent-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:from-brand-400 hover:to-accent-400"
        >
          <span className="text-lg leading-none">📷</span>
          <span className="hidden sm:inline">Scan position</span>
        </Link>
      )}
    </div>
  );
}
