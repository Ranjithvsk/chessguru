// Compact leaderboard embedded directly on the /academy dashboard so the
// competition is visible without a page hop. Full details still on the
// dedicated /academy/leaderboard page — this panel links to it.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, get } from "../lib/api";

type Row = {
  studentId: string;
  username: string;
  name: string | null;
  rank: number;
  score: number;
  deltaRank?: number | null;
  currentRating: number;
  puzzles: number;
  blindfoldPuzzles: number;
  accuracy: number;
  streak: number;
  badgesUnlocked?: number;
};
type LeaderboardResp = {
  period: string;
  studentCount: number;
  rows: Row[];
  champions: any;
};

type Period = "today" | "7d" | "30d" | "lifetime";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today",    label: "Today" },
  { key: "7d",       label: "7d" },
  { key: "30d",      label: "1m" },
  { key: "lifetime", label: "All-time" },
];

function RankPill({ rank }: { rank: number }) {
  const cls =
    rank === 1 ? "bg-gradient-to-br from-amber-300 to-yellow-600 text-amber-950 ring-2 ring-amber-300/60" :
    rank === 2 ? "bg-gradient-to-br from-slate-200 to-slate-500 text-slate-900 ring-2 ring-slate-300/50" :
    rank === 3 ? "bg-gradient-to-br from-orange-300 to-orange-700 text-orange-950 ring-2 ring-orange-400/50" :
                 "bg-ink-800 text-ink-300 ring-1 ring-ink-700";
  const emoji = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold tabular-nums ${cls}`}>
      {emoji ?? rank}
    </span>
  );
}

function scoreGrad(score: number): string {
  return score >= 70 ? "from-amber-400 via-orange-400 to-rose-400" :
         score >= 40 ? "from-brand-500 via-fuchsia-500 to-purple-500" :
                       "from-sky-500 via-cyan-500 to-teal-500";
}

export function LeaderboardPanel() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const [period, setPeriod] = useState<Period>("7d");
  const q = useQuery({
    queryKey: ["academy-leaderboard", period],
    queryFn: () => get<LeaderboardResp>(`/api/academy/leaderboard?period=${period}`),
    enabled: !!auth?.loggedIn && !!auth?.academyId,
    staleTime: 60_000,
  });
  const rows = q.data?.rows ?? [];
  const top10 = rows.slice(0, 10);
  const meRow = rows.find((r) => r.studentId === auth?.userId);
  const meOutside = meRow && meRow.rank > 10 ? meRow : null;

  return (
    <section className="relative overflow-hidden rounded-xl2 border border-amber-500/30 bg-gradient-to-br from-amber-950/40 via-brand-950/40 to-fuchsia-950/40 p-5">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-10 right-0 h-40 w-40 rounded-full bg-amber-500/10 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-10 left-0 h-40 w-40 rounded-full bg-fuchsia-500/10 blur-[80px]" />

      <div className="relative mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl">🏆</span>
          <h2 className="font-display text-lg bg-gradient-to-r from-amber-300 via-fuchsia-300 to-brand-300 bg-clip-text text-transparent">Academy Leaderboard</h2>
          <span className="text-xs text-ink-500">· {q.data?.studentCount ?? 0} students</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-[11px]">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                className={`px-2 py-1 font-medium transition ${period === p.key ? "bg-brand-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <Link to="/academy/leaderboard"
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-400">Full view →</Link>
        </div>
      </div>

      {q.isLoading && <div className="text-xs text-ink-500">Loading…</div>}
      {rows.length === 0 && !q.isLoading && <div className="text-xs text-ink-500">No students yet — invite one to seed the leaderboard.</div>}

      {top10.length > 0 && (
        <div className="relative overflow-hidden rounded-xl border border-ink-800 bg-ink-950/40">
          <table className="min-w-full text-sm">
            <thead className="bg-ink-900/60 text-[10px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-1.5 text-left">#</th>
                <th className="px-3 py-1.5 text-left">Student</th>
                <th className="px-3 py-1.5 text-right">Score</th>
                <th className="hidden sm:table-cell px-3 py-1.5 text-right">Rating</th>
                <th className="hidden md:table-cell px-3 py-1.5 text-right">🧩</th>
                <th className="hidden md:table-cell px-3 py-1.5 text-right">🙈</th>
                <th className="hidden md:table-cell px-3 py-1.5 text-right">🎯</th>
                <th className="hidden md:table-cell px-3 py-1.5 text-right">🔥</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((r) => {
                const isMe = auth?.userId === r.studentId;
                const rowClass =
                  r.rank === 1 ? "bg-gradient-to-r from-amber-500/10 to-transparent" :
                  r.rank === 2 ? "bg-gradient-to-r from-slate-400/10 to-transparent" :
                  r.rank === 3 ? "bg-gradient-to-r from-orange-500/10 to-transparent" :
                                 "";
                return (
                  <tr key={r.studentId} className={`border-t border-ink-800/60 transition hover:bg-ink-800/40 ${isMe ? "bg-brand-900/25" : rowClass}`}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <RankPill rank={r.rank} />
                        {typeof r.deltaRank === "number" && r.deltaRank !== 0 && (
                          <span className={`text-[10px] font-semibold ${r.deltaRank > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {r.deltaRank > 0 ? "▲" : "▼"}{Math.abs(r.deltaRank)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/academy/students/${encodeURIComponent(r.studentId)}/performance`}
                        className="font-semibold text-white hover:text-brand-300">{r.name || r.username}</Link>
                      {isMe && <span className="ml-1 text-[10px] uppercase tracking-wide text-brand-300">you</span>}
                    </td>
                    <td className="px-3 py-2 text-right min-w-[100px]">
                      <div className="tabular-nums font-bold text-brand-200">{r.score.toFixed(1)}</div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-800">
                        <div className={`h-full rounded-full bg-gradient-to-r ${scoreGrad(r.score)}`} style={{ width: `${Math.max(2, Math.min(100, r.score))}%` }} />
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2 text-right tabular-nums text-white">{r.currentRating}</td>
                    <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-emerald-300">{r.puzzles}</td>
                    <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-fuchsia-300">{r.blindfoldPuzzles}</td>
                    <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums">
                      {r.puzzles >= 5 ? <span className={r.accuracy >= 0.75 ? "text-emerald-300" : r.accuracy >= 0.5 ? "text-amber-300" : "text-rose-300"}>{Math.round(r.accuracy*100)}%</span> : <span className="text-ink-600">—</span>}
                    </td>
                    <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-amber-300">{r.streak}d</td>
                  </tr>
                );
              })}
              {meOutside && (
                <tr className="border-t-2 border-brand-500/30 bg-brand-900/20">
                  <td className="px-3 py-2"><RankPill rank={meOutside.rank} /></td>
                  <td className="px-3 py-2">
                    <Link to={`/academy/students/${encodeURIComponent(meOutside.studentId)}/performance`}
                      className="font-semibold text-white hover:text-brand-300">{meOutside.name || meOutside.username}</Link>
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-brand-300">you</span>
                  </td>
                  <td className="px-3 py-2 text-right min-w-[100px]">
                    <div className="tabular-nums font-bold text-brand-200">{meOutside.score.toFixed(1)}</div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-800">
                      <div className={`h-full rounded-full bg-gradient-to-r ${scoreGrad(meOutside.score)}`} style={{ width: `${Math.max(2, Math.min(100, meOutside.score))}%` }} />
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2 text-right tabular-nums text-white">{meOutside.currentRating}</td>
                  <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-emerald-300">{meOutside.puzzles}</td>
                  <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-fuchsia-300">{meOutside.blindfoldPuzzles}</td>
                  <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums">
                    {meOutside.puzzles >= 5 ? <span className={meOutside.accuracy >= 0.75 ? "text-emerald-300" : meOutside.accuracy >= 0.5 ? "text-amber-300" : "text-rose-300"}>{Math.round(meOutside.accuracy*100)}%</span> : <span className="text-ink-600">—</span>}
                  </td>
                  <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-amber-300">{meOutside.streak}d</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
