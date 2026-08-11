// In-app banner announcing a LIVE class, so a student already on the site —
// solving puzzles, browsing openings — gets pulled into the room the moment
// their coach goes live, without watching email or the /class page.
//
// It polls the same schedule endpoint the /class hub uses (academy-scoped on
// the server, so a student only ever sees their own academy's classes) every
// 45s, so the banner appears within a minute of a class going live and clears
// itself when the class ends (the row leaves `live[]`).
//
// Dismissible PER CLASS (sessionStorage keyed by class id): × hides THIS class,
// but a different class later still shows. Hidden on the room / class pages
// themselves, where it would just be noise.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { get, api } from "../lib/api";

type SchedRow = { _id: string; title: string; coach: string; startAt: string; durationMin: number; mine?: boolean };
type Sched = { live: SchedRow[]; upcoming: SchedRow[] };
const DISMISS_KEY = "cg_live_class_dismissed";

export default function LiveClassBanner() {
  const loc = useLocation();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const loggedIn = !!auth?.loggedIn;

  const { data } = useQuery({
    queryKey: ["schedule-live"],
    queryFn: () => get<Sched>("/api/class/schedule"),
    enabled: loggedIn,
    refetchInterval: 45_000,      // poll so a class going live shows up within a minute
    refetchOnWindowFocus: true,   // and instantly when the student flips back to the tab
    staleTime: 30_000,
  });

  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  if (!loggedIn) return null;
  // Already in a room / on the class hub — the banner would just be noise there.
  if (loc.pathname.startsWith("/call/") || loc.pathname.startsWith("/class")) return null;

  const live = data?.live?.[0];
  if (!live) return null;
  if (dismissed === live._id) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, live._id); } catch { /* */ }
    setDismissed(live._id);
  };

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/40 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
        </span>
        <div>
          <div className="font-semibold text-emerald-100">
            🔴 Class live now — {live.title}
          </div>
          <div className="text-xs text-emerald-200/70">
            Coach {live.coach} is live. Join to mark your attendance.
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          to={`/call/${encodeURIComponent(live._id)}?board=1`}
          className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
        >
          Join now →
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md px-2 py-1 text-xs text-emerald-200/60 hover:bg-emerald-400/10 hover:text-emerald-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
