import { useOutletContext, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { api, type HistoryItem } from "../lib/api";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };

const timeOf = (d: string) => new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
function dateLabel(d: string) {
  const day = new Date(d); const now = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(day, now)) return "Today";
  if (same(day, y)) return "Yesterday";
  return day.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

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

function PuzzleCard({ it }: { it: HistoryItem }) {
  const lm = it.lastMove ? ([it.lastMove.slice(0, 2), it.lastMove.slice(2, 4)] as [Key, Key]) : undefined;
  return (
    <div className="flex gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
      <div className="w-16 shrink-0 sm:w-20">
        {it.fen
          ? <Board fen={it.fen} orientation={it.orientation} lastMove={lm} viewOnly coordinates={false} className="mini" />
          : <div className="aspect-square w-full rounded-md bg-ink-800" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          {it.win
            ? <span className="rounded bg-accent-500/15 px-2 py-0.5 text-xs font-medium text-accent-400">Solved</span>
            : <span className="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-400">Missed</span>}
          <span className={`text-sm font-semibold ${it.ratingDiff == null ? "text-ink-500" : it.ratingDiff >= 0 ? "text-accent-400" : "text-rose-400"}`}>
            {it.ratingDiff == null ? "—" : `${it.ratingDiff >= 0 ? "+" : ""}${it.ratingDiff}`}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {(it.themes || []).slice(0, 3).map((t) => (
            <span key={t} className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300">{prettify(t)}</span>
          ))}
        </div>
        <div className="mt-auto pt-1 text-xs text-ink-500">
          #{it.id} · {it.puzzleRating ?? "—"} · {timeOf(it.date)}
        </div>
      </div>
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

  // group recent items by calendar day (already sorted newest-first by the API)
  const groups: { label: string; items: HistoryItem[] }[] = [];
  for (const it of data.items ?? []) {
    const label = dateLabel(it.date);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-white">Puzzle report</h1>
        <p className="text-sm text-ink-400">Your solving history, rating changes and strengths by theme.</p>
      </div>

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

          <div>
            <h2 className="mb-3 font-display text-lg text-white">Recent puzzles</h2>
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-ink-300">{g.label}</h3>
                    <span className="text-xs text-ink-500">{g.items.length} puzzle{g.items.length > 1 ? "s" : ""}</span>
                    <div className="h-px flex-1 bg-ink-800" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map((it) => <PuzzleCard key={it.id + it.date} it={it} />)}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-500">Showing your {(data.items ?? []).length} most recent puzzles. “—” change = older solve (not recorded).</p>
          </div>
        </>
      )}
    </div>
  );
}
