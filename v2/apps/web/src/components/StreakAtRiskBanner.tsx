// Phase 7k: in-app banner shown when the signed-in user's daily streak is
// about to break. Same trigger as the evening email reminder but lives in the
// app so users who don't check email still get the nudge.
//
// Rules (match StreakReminderService on the backend):
//  * signed in
//  * current streak >= 3 (habit threshold)
//  * no solve yet today
//  * user's LOCAL hour >= 18 (evening — checked in the browser because the
//    server doesn't know the user's timezone)
//
// Dismissible per session: clicking × sets a sessionStorage flag so it doesn't
// keep re-showing on navigation, but reopening the tab tomorrow works fresh.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { get } from "../lib/api";

type StreakStatus = { loggedIn: boolean; streak?: number; solvedToday?: boolean };
const DISMISS_KEY = "cg_streak_banner_dismissed";

export default function StreakAtRiskBanner() {
  const loc = useLocation();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === new Date().toDateString(); }
    catch { return false; }
  });
  // Re-check every 10 min in case the user opens the tab at 5pm and lingers.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10 * 60_000);
    return () => clearInterval(id);
  }, []);

  const { data } = useQuery({
    queryKey: ["streak-status"],
    queryFn: () => get<StreakStatus>("/api/me/streak-status"),
    staleTime: 60_000,
  });

  if (dismissed) return null;
  if (!data?.loggedIn) return null;
  if (!data.streak || data.streak < 3) return null;
  if (data.solvedToday) return null;
  if (now.getHours() < 18) return null;
  // Don't render on the puzzle page itself — user's already there, banner is noise.
  if (loc.pathname === "/") return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, new Date().toDateString()); } catch { /* */ }
    setDismissed(true);
  };

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-orange-400/40 bg-gradient-to-r from-orange-500/15 via-rose-500/10 to-amber-500/5 px-4 py-3 text-sm text-orange-100">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🔥</span>
        <div>
          <div className="font-semibold text-orange-100">
            Your {data.streak}-day streak is at risk
          </div>
          <div className="text-xs text-orange-200/70">
            One quick puzzle keeps it alive.
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          to="/"
          className="rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
        >
          Solve one
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md px-2 py-1 text-xs text-orange-200/60 hover:bg-orange-400/10 hover:text-orange-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
