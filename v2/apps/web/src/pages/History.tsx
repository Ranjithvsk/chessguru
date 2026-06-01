import { useOutletContext, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Bar({ wins, total }: { wins: number; total: number }) {
  const pct = total ? Math.round((wins / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div className="h-full rounded-full bg-accent-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs text-ink-400">{pct}%</span>
    </div>
  );
}

export default function HistoryPage() {
  const { rating } = useOutletContext<Ctx>();
  const { data, isLoading } = useQuery({ queryKey: ["me-history"], queryFn: api.history });

  if (isLoading) return <div className="py-16 text-center text-ink-400">Loading your report…</div>;

  if (!data?.loggedIn) {
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
        <div className="mb-2 text-2xl">📊</div>
        <h1 className="mb-2 font-display text-xl text-white">Your puzzle report</h1>
        <p className="mb-5 text-sm text-ink-400">Sign in to track every puzzle you solve, your rating changes, and your strengths by theme.</p>
        <Link to="/login" className="inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-500">Sign in</Link>
      </div>
    );
  }

  const t = data.totals!;
  const stats = [
    { label: "Attempted", value: t.attempted, hint: "puzzles tried" },
    { label: "Solved", value: t.solved, hint: "correct", tone: "text-accent-400" },
    { label: "Failed", value: t.failed, hint: "missed", tone: "text-rose-400" },
    { label: "Win rate", value: `${t.winRate}%`, hint: "success" },
    { label: "Rating", value: rating ?? "—", hint: "current" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-white">Puzzle report</h1>
        <p className="text-sm text-ink-400">Your solving history, rating changes and strengths by theme.</p>
      </div>

      {/* summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
            <div className={`text-2xl font-bold ${s.tone ?? "text-white"}`}>{s.value}</div>
            <div className="text-sm font-medium text-ink-300">{s.label}</div>
            <div className="text-xs text-ink-500">{s.hint}</div>
          </div>
        ))}
      </div>

      {t.attempted === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center text-ink-400">
          No solved puzzles yet — <Link to="/" className="text-brand-400 hover:underline">solve your first puzzle</Link> and it’ll show up here.
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* by theme */}
            <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
              <h2 className="mb-3 font-display text-lg text-white">By theme</h2>
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {(data.byTheme ?? []).map((c) => (
                  <div key={c.theme}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-ink-200">{prettify(c.theme)}</span>
                      <span className="text-ink-400">{c.wins}/{c.total}</span>
                    </div>
                    <Bar wins={c.wins} total={c.total} />
                  </div>
                ))}
              </div>
            </div>

            {/* by difficulty */}
            <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
              <h2 className="mb-3 font-display text-lg text-white">By difficulty (puzzle rating)</h2>
              <div className="space-y-3">
                {(data.byBand ?? []).map((c) => (
                  <div key={c.band}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-ink-200">{c.band}</span>
                      <span className="text-ink-400">{c.wins}/{c.total}</span>
                    </div>
                    <Bar wins={c.wins} total={c.total} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* recent table */}
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 font-display text-lg text-white">Recent puzzles</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Puzzle</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">Themes</th>
                    <th className="py-2 pr-3 font-medium">Rating</th>
                    <th className="py-2 pr-3 font-medium">Result</th>
                    <th className="py-2 pr-3 text-right font-medium">Change</th>
                    <th className="hidden py-2 text-right font-medium sm:table-cell">After</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.items ?? []).map((it) => (
                    <tr key={it.id + it.date} className="border-b border-ink-800/60">
                      <td className="whitespace-nowrap py-2 pr-3 text-ink-400">{fmtDate(it.date)}</td>
                      <td className="py-2 pr-3 font-mono text-ink-300">#{it.id}</td>
                      <td className="hidden py-2 pr-3 text-ink-400 sm:table-cell">
                        {(it.themes || []).slice(0, 2).map((th) => prettify(th)).join(", ")}
                      </td>
                      <td className="py-2 pr-3 text-ink-300">{it.puzzleRating ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {it.win
                          ? <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-medium text-accent-400">Solved</span>
                          : <span className="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-400">Missed</span>}
                      </td>
                      <td className={`py-2 pr-3 text-right font-semibold ${it.ratingDiff == null ? "text-ink-500" : it.ratingDiff >= 0 ? "text-accent-400" : "text-rose-400"}`}>
                        {it.ratingDiff == null ? "—" : `${it.ratingDiff >= 0 ? "+" : ""}${it.ratingDiff}`}
                      </td>
                      <td className="hidden py-2 text-right text-ink-300 sm:table-cell">{it.ratingAfter ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink-500">Showing the most recent {(data.items ?? []).length} puzzles. “—” means the change wasn’t recorded (older solves).</p>
          </div>
        </>
      )}
    </div>
  );
}
