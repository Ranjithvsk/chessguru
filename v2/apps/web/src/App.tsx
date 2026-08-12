import { Outlet, useLocation, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Navbar from "./components/Navbar";
import StreakAtRiskBanner from "./components/StreakAtRiskBanner";
import LiveClassBanner from "./components/LiveClassBanner";
import HomeworkPendingBanner from "./components/HomeworkPendingBanner";
import { api } from "./lib/api";

export default function App() {
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const { data: rating } = useQuery({ queryKey: ["me-rating"], queryFn: api.myRating });

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
