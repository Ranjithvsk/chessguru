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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { get, api, classRoomPath } from "../lib/api";

type SchedRow = { _id: string; title: string; coach: string; startAt: string; durationMin: number; mine?: boolean; roomKind?: "call"|"meet" };
type Sched = { live: SchedRow[]; upcoming: SchedRow[] };
const DISMISS_KEY = "cg_live_class_dismissed";

/** "End class" button on the LiveClassBanner — visible only when the class
 *  belongs to the current user (SchedRow.mine === true). Hits the existing
 *  POST /api/class/:id/end so a coach can close an abandoned class WITHOUT
 *  re-entering the room. Owner ask 2026-08-18: "for coach, we need option
 *  to close floating class". */
function EndClassButton({ classId }: { classId: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/v2api/api/class/${encodeURIComponent(classId)}/end`, {
        method: "POST", credentials: "include",
      });
      return r.json();
    },
    onSuccess: (j: any) => {
      if (j?.ok) {
        qc.invalidateQueries({ queryKey: ["schedule-live"] });
        qc.invalidateQueries({ queryKey: ["class-live-now"] });
        qc.invalidateQueries({ queryKey: ["academy-schedule"] });
      } else {
        alert(j?.reason === "not-your-class" ? "Only the coach who started this class can end it." : "Couldn't end class.");
      }
    },
  });
  const run = () => {
    if (!confirm("End this class now? Everyone still in the room is kicked out.")) return;
    m.mutate();
  };
  return (
    <button type="button" onClick={run} disabled={m.isPending}
      className="rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/30 disabled:opacity-60"
      title="End this class now (only visible because you started it)">
      {m.isPending ? "Ending…" : "End class"}
    </button>
  );
}

export default function LiveClassBanner() {
  const loc = useLocation();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const loggedIn = !!auth?.loggedIn;

  // Poll aggressively (5s) so a student already on the site is pulled into
  // the class within seconds of the coach going live — owner said the 45s
  // cadence felt like "no notification until refresh". Web Push covers OFFLINE
  // students; this banner covers ONLINE-but-elsewhere students.
  const { data } = useQuery({
    queryKey: ["schedule-live"],
    queryFn: () => get<Sched>("/api/class/schedule"),
    enabled: loggedIn,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 3_000,
  });
  // Ad-hoc "Start now" rooms have no schedule row — this surfaces them too.
  const { data: liveNow } = useQuery({
    queryKey: ["class-live-now"],
    queryFn: () => get<{ live: SchedRow[] }>("/api/class/live-now"),
    enabled: loggedIn,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 3_000,
  });

  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  // Fire an OS-level browser Notification + a soft ding the first time we see
  // a NEW live class in this tab's session. Dedupe by room id so re-polls or
  // an idle-tab refetch don't respawn the popup. Silent no-op when the user
  // hasn't granted Notification permission — Web Push still covers the case
  // where the tab is closed entirely (see class-live.controller.ts going-live).
  const notifiedRef = useRef<Set<string>>(new Set());
  const alertNewClass = (c: SchedRow) => {
    if (notifiedRef.current.has(c._id)) return;
    notifiedRef.current.add(c._id);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const n = new Notification(`🔴 ${c.coach} is live now`, {
          body: `${c.title} — tap to join.`,
          tag: `cg-classlive-${c._id}`,
        });
        n.onclick = () => { window.focus(); location.href = classRoomPath(c.roomKind, c._id, "student"); };
      }
    } catch { /* Safari / Chromium quirks — never break the banner */ }
    // Soft ding — WebAudio short sine so no asset to ship. Best-effort;
    // browsers block audio until first user gesture, so this can silently
    // fail on a cold load. That's fine — the visual banner still shows.
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.55);
      setTimeout(() => { try { ctx.close(); } catch { /* */ } }, 800);
    } catch { /* */ }
  };
  useEffect(() => {
    if (!loggedIn) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      // Ask ONCE per tab session for browser notification permission — no-op
      // if user has already answered. Silent decline is fine (falls back to
      // the in-app banner only).
      try { Notification.requestPermission(); } catch { /* */ }
    }
  }, [loggedIn]);

  if (!loggedIn) return null;
  // Already in a room / on the class hub / on the student dashboard — the
  // banner would double-up with the prominent red LIVE-NOW card there.
  if (loc.pathname.startsWith("/call/") || loc.pathname.startsWith("/class") || loc.pathname.startsWith("/dashboard")) return null;

  // Scheduled-live first, then ad-hoc announcements; dedup by room id.
  const seen = new Set<string>();
  const live = [...(data?.live ?? []), ...(liveNow?.live ?? [])]
    .filter((c) => (seen.has(c._id) ? false : (seen.add(c._id), true)))[0];
  if (!live) return null;
  // Fire the OS notification + ding even if THIS class was dismissed — the
  // owner's own coach class shouldn't ping the coach, but a follower who
  // dismissed then wandered off should still get alerted for a NEW class id.
  // (The dedupe in notifiedRef handles the "same class" case.)
  alertNewClass(live);
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
          to={classRoomPath(live.roomKind, live._id, "student")}
          className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
        >
          Join now →
        </Link>
        {live.mine && <EndClassButton classId={live._id} />}
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
