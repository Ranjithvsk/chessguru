// Opening Trainer analytics strip — 30-day mini-heatmap + streak + 7d/30d
// success % + coach-assigned compliance banner.
//
// Shared by:
//   * /study/daily (the trainer page — student's own view, auto-refresh
//     via nonce query key)
//   * /dashboard (student's overall performance view)
//   * /academy/students/:id/performance (coach's per-student view — pass
//     the rollup fetched via getStudentTrainerRollup)
//
// Rollout step 2 + 3 of the Openings Dashboard plan. Colour palette
// matches the /academy/leaderboard page — gradients + brand/amber/fuchsia
// stops — so the trainer feels part of the same product surface (owner
// ask 2026-08-20: "have nice modern colourful UI like leaderboard").

import type { TrainerRollup } from "../lib/opening-trainer-api";

/** Heat cell colour by first-try-correct %. Uses graduated stops so the
 *  30-day strip reads as a colourful history (leaderboard vibe). */
function cellColor(pct: number, sessions: number): string {
  if (sessions === 0) return "bg-ink-800/40";
  if (pct >= 90) return "bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_0_8px_rgba(52,211,153,0.55)]";
  if (pct >= 70) return "bg-gradient-to-br from-emerald-500 to-teal-500";
  if (pct >= 50) return "bg-gradient-to-br from-lime-500 to-emerald-500";
  if (pct >= 30) return "bg-gradient-to-br from-amber-400 to-orange-500";
  return "bg-gradient-to-br from-rose-500 to-fuchsia-500";
}

/** One stat pill used in the header row. Colour comes from a preset tone. */
function StatPill({ label, value, tone }: { label: string; value: React.ReactNode; tone: "amber" | "emerald" | "brand" | "fuchsia" }) {
  const cls =
    tone === "amber"    ? "from-amber-500/25 to-orange-500/15 ring-amber-500/40 text-amber-200" :
    tone === "emerald"  ? "from-emerald-500/25 to-teal-500/15 ring-emerald-500/40 text-emerald-200" :
    tone === "fuchsia"  ? "from-fuchsia-500/25 to-purple-500/15 ring-fuchsia-500/40 text-fuchsia-200" :
                          "from-brand-500/25 to-indigo-500/15 ring-brand-500/40 text-brand-200";
  return (
    <div className={`flex items-center gap-1.5 rounded-full bg-gradient-to-r ${cls} px-2.5 py-1 text-[11px] font-semibold ring-1`}>
      <span className="opacity-80">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}

export function TrainerStatsStrip({
  rollup,
  title = "Your last 30 days",
  compact: _compact = false,
}: {
  rollup: TrainerRollup;
  title?: string;
  compact?: boolean;
}) {
  const showEmpty = rollup.totals.allSessions === 0;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-950/40 via-fuchsia-950/30 to-ink-900 p-4 shadow-lg">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-fuchsia-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="relative">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="bg-gradient-to-r from-amber-300 via-fuchsia-300 to-brand-300 bg-clip-text font-display text-base font-bold text-transparent">
            📈 {title}
          </h3>
          {!showEmpty && (
            <div className="flex flex-wrap gap-1.5">
              <StatPill label="🔥 streak" value={`${rollup.streak}d`} tone="amber" />
              <StatPill label="7d" value={`${rollup.successPct7}%`} tone="emerald" />
              <StatPill label="30d" value={`${rollup.successPct30}%`} tone="brand" />
              <StatPill label="sessions" value={`${rollup.totals.sessions7}/${rollup.totals.sessions30}`} tone="fuchsia" />
            </div>
          )}
        </div>
        {showEmpty ? (
          <div className="rounded-xl border border-dashed border-brand-500/30 bg-ink-950/50 p-4 text-center">
            <div className="text-2xl">🚀</div>
            <p className="mt-1 text-xs text-ink-300">No drills yet — every session lights up this strip. Ready when you are.</p>
          </div>
        ) : (
          <>
            <div className="flex gap-[3px] rounded-lg bg-ink-950/70 p-1.5 ring-1 ring-ink-800/50">
              {rollup.heat.map((h) => (
                <div key={h.day}
                  className={`h-5 w-full min-w-[6px] rounded-[3px] transition ${cellColor(h.correctPct, h.sessions)}`}
                  title={`${h.day} · ${h.sessions} session${h.sessions === 1 ? "" : "s"} · ${h.moves} moves · ${h.correctPct}% correct`} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wide text-ink-500">
              <span>30 days ago</span>
              <span>today →</span>
            </div>
          </>
        )}
        {rollup.forcedCompliance && rollup.forcedCompliance.assigned > 0 && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent px-3 py-2 text-xs text-amber-100">
            <span>
              🎓 <span className="font-semibold">Coach-assigned:</span>{" "}
              <span className="font-bold tabular-nums">{rollup.forcedCompliance.done}/{rollup.forcedCompliance.assigned}</span> drilled this week
            </span>
            <span className="rounded-full bg-amber-500/25 px-2 py-0.5 text-[10px] font-bold text-amber-100 ring-1 ring-amber-400/40">
              {rollup.forcedCompliance.pct}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
