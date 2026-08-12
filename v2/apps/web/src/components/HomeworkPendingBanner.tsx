// Global banner that surfaces open homework on EVERY page except /dashboard
// (which already shows the full My-homework card). Owner 2026-08-12 reported
// ragul-2 landed on the puzzle trainer after the coach assigned work and
// didn't see anything — homework only lived on /dashboard, so a student who
// closed the page had no easy way back into it.
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get, api } from "../lib/api";

type MyHwTask = { kind: "puzzle_pack" | "study_revision" | "opening_revision"; theme?: string; targetCount?: number; targetRating?: number; openingSlug?: string };
type MyHw = { _id: string; title: string; tasks: MyHwTask[]; progress: Record<string, number>; status: "assigned" | "in_progress" | "completed"; dueAt: string };

export default function HomeworkPendingBanner() {
  const loc = useLocation();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const loggedIn = !!auth?.loggedIn;

  const { data } = useQuery({
    queryKey: ["me-homework-banner"],
    queryFn: () => get<MyHw[]>("/api/me/homework"),
    enabled: loggedIn,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  if (!loggedIn) return null;
  // /dashboard has the full card — banner would double up.
  if (loc.pathname.startsWith("/dashboard")) return null;
  // Also hide inside the puzzle trainer WHEN IN HOMEWORK MODE — the trainer's
  // own purple banner is more actionable there.
  if (loc.pathname === "/" && new URLSearchParams(loc.search).get("hw")) return null;

  const open = (data ?? []).filter((h) => h.status !== "completed");
  if (open.length === 0) return null;

  // Sum pending targets across all open homeworks. Human-readable "3 more to do".
  let pendingSections = 0;
  let pendingPuzzles = 0;
  const dueSoon = open.some((h) => {
    const ms = new Date(h.dueAt).getTime() - Date.now();
    return ms >= 0 && ms < 2 * 86_400_000;
  });
  const overdue = open.some((h) => new Date(h.dueAt).getTime() < Date.now());
  for (const h of open) {
    for (let i = 0; i < h.tasks.length; i++) {
      const t = h.tasks[i];
      const done = h.progress?.[String(i)] ?? 0;
      const target = t.kind === "puzzle_pack" ? (t.targetCount || 1) : 1;
      if (done < target) {
        pendingSections++;
        if (t.kind === "puzzle_pack") pendingPuzzles += (target - done);
      }
    }
  }

  const tone = overdue
    ? "border-rose-500/50 bg-gradient-to-r from-rose-500/20 via-rose-500/10 to-transparent"
    : dueSoon
      ? "border-amber-500/50 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent"
      : "border-purple-500/50 bg-gradient-to-r from-purple-500/15 via-fuchsia-500/8 to-transparent";

  return (
    <Link
      to="/dashboard"
      className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm transition hover:brightness-110 ${tone}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-purple-500 text-lg text-white shadow">
          📝
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">
            {overdue ? "Homework overdue" : dueSoon ? "Homework due soon" : "You have homework pending"}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-300">
            {pendingSections} section{pendingSections === 1 ? "" : "s"} left
            {pendingPuzzles > 0 ? ` · ${pendingPuzzles} puzzles` : ""}
            {open.length > 1 ? ` · ${open.length} assignments` : ""}
          </div>
        </div>
      </div>
      <span className="shrink-0 rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20">
        Open →
      </span>
    </Link>
  );
}
