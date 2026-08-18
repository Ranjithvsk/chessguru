// Period-broken-down performance table used on both:
//   - /dashboard          ("My performance" — self-scope, no studentId)
//   - /academy/students/:id/performance  (coach view — student-scope)
//
// Renders one row per period (Weekly, Monthly, 3 months, 6 months, 1 year,
// Year-to-date, Lifetime) with rating end + delta, puzzles solved, games
// W-D-L, and revision streak in that window. Fires N parallel calls to the
// preview endpoint via useQueries — no new server-side aggregation needed.
//
// Owner ask 2026-08-18: "add weekly monthly 3 month 6 month one year year
// to year lifetime performance ratings to My performance AND Student
// performance". "Year to year" interpreted as YTD (year-to-date) — the
// natural chess-club "this year" cut.
import { useQueries } from "@tanstack/react-query";
import { parentReportsApi, type ReportData } from "../lib/parent-reports-api";

type Scope = { kind: "self" } | { kind: "student"; studentId: string };
type Period = { key: string; label: string; start: () => Date; end: () => Date };

// Anchor "now" once at module load so scrolling / re-render doesn't shift the
// window boundaries by a millisecond. Fine — periods don't need sub-second
// accuracy and cache stability matters more.
const NOW = new Date();
const daysBack = (days: number): (() => Date) => () => {
  const d = new Date(NOW); d.setDate(d.getDate() - days); d.setHours(0, 0, 0, 0); return d;
};
const now = () => NOW;
const jan1 = () => { const d = new Date(NOW); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d; };
const epoch = () => new Date(0);

const PERIODS: Period[] = [
  { key: "week",     label: "Weekly",       start: daysBack(7),   end: now },
  { key: "month",    label: "Monthly",      start: daysBack(30),  end: now },
  { key: "quarter",  label: "3 months",     start: daysBack(90),  end: now },
  { key: "half",     label: "6 months",     start: daysBack(180), end: now },
  { key: "year",     label: "1 year",       start: daysBack(365), end: now },
  { key: "ytd",      label: "Year to date", start: jan1,          end: now },
  { key: "lifetime", label: "Lifetime",     start: epoch,         end: now },
];

function fmtRatingDelta(d: number | null | undefined): { text: string; cls: string } {
  if (d == null) return { text: "—", cls: "text-ink-500" };
  if (d === 0) return { text: "0", cls: "text-ink-300" };
  return d > 0 ? { text: `+${d}`, cls: "text-emerald-300" } : { text: String(d), cls: "text-rose-300" };
}

export function PeriodPerformanceTable({ scope }: { scope: Scope }) {
  // Fan out one preview() per period. Each query is keyed by (scope, key) so
  // switching students or periods doesn't cross-contaminate cache. staleTime
  // is 60s — plenty for a performance snapshot the coach glances at.
  const queries = useQueries({
    queries: PERIODS.map((p) => ({
      queryKey: ["perf-period", scope.kind, scope.kind === "student" ? scope.studentId : "self", p.key],
      queryFn: async (): Promise<ReportData> => {
        const body = { periodStart: p.start().toISOString(), periodEnd: p.end().toISOString() };
        if (scope.kind === "self") return parentReportsApi.previewSelf(body);
        return parentReportsApi.preview({ studentId: scope.studentId, ...body });
      },
      staleTime: 60_000,
      retry: 1,
    })),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-900/40">
      <table className="min-w-full text-sm">
        <thead className="bg-ink-800/70 text-xs uppercase tracking-wide text-ink-400">
          <tr>
            <th className="px-3 py-2 text-left">Period</th>
            <th className="px-3 py-2 text-right">Rating end</th>
            <th className="px-3 py-2 text-right">Δ</th>
            <th className="px-3 py-2 text-right">Puzzles</th>
            <th className="px-3 py-2 text-right">W-L</th>
            <th className="px-3 py-2 text-right">Puzzle %</th>
            <th className="px-3 py-2 text-right">Games (W-D-L)</th>
            <th className="px-3 py-2 text-right">Game win %</th>
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((p, i) => {
            const q = queries[i];
            const d: ReportData | undefined = q?.data;
            const gWon = d?.games.won ?? 0;
            const gDrawn = d?.games.drawn ?? 0;
            const gLost = d?.games.lost ?? 0;
            const gPlayed = d?.games.played ?? 0;
            const gameWin = gPlayed > 0 ? Math.round((gWon / gPlayed) * 100) : null;
            const pWon = d?.puzzles.wonInPeriod ?? 0;
            const pLost = d?.puzzles.lostInPeriod ?? 0;
            const pPlayed = d?.puzzles.inPeriod ?? 0;
            const puzzleWin = pPlayed > 0 ? Math.round((pWon / pPlayed) * 100) : null;
            const delta = fmtRatingDelta(d?.rating.change);
            return (
              <tr key={p.key} className="border-t border-ink-800">
                <td className="px-3 py-2 font-medium text-white">{p.label}</td>
                {q?.isLoading ? (
                  <td colSpan={8} className="px-3 py-2 text-center text-xs text-ink-500">loading…</td>
                ) : q?.error ? (
                  <td colSpan={8} className="px-3 py-2 text-center text-xs text-rose-300" title={String((q.error as any)?.message)}>load failed</td>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums text-brand-200">{d?.rating.current ?? "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${delta.cls}`}>{delta.text}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${pPlayed === 0 ? "text-ink-500" : "text-white"}`}>
                      {pPlayed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-300">
                      {pPlayed === 0 ? <span className="text-ink-500">—</span> : `${pWon}-${pLost}`}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${puzzleWin == null ? "text-ink-500" : puzzleWin >= 60 ? "text-emerald-300" : puzzleWin >= 40 ? "text-ink-300" : "text-rose-300"}`}>
                      {puzzleWin == null ? "—" : `${puzzleWin}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-300">
                      {gPlayed === 0 ? <span className="text-ink-500">—</span> : `${gWon}-${gDrawn}-${gLost}`}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${gameWin == null ? "text-ink-500" : gameWin >= 60 ? "text-emerald-300" : gameWin >= 40 ? "text-ink-300" : "text-rose-300"}`}>
                      {gameWin == null ? "—" : `${gameWin}%`}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
