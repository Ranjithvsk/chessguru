// Coach reteach queue — the puzzles a student got WRONG in the current
// period. Each row shows the puzzle rating, themes and the wrong move
// they played, with two coach-side jump-off buttons:
//   - 🎯 Open in trainer — /?puzzle=<id>&as=<username> for a live session
//   - 📷 Board editor — /board-editor?fen=<fen>&orientation=<w|b> to teach
//     the position (add arrows, walk them through the correct idea).
//
// Added 2026-08-18 (owner: "coach can reteach and teach them the technique").
// Backend endpoint: POST /api/parent-reports/mistakes.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { parentReportsApi } from "../lib/parent-reports-api";

type Props = {
  studentId: string;
  studentUsername?: string;
  /** Days-back window matching the parent StudentPerformance page toggle. */
  periodDays: number;
};

/** Extract side-to-move from a FEN's turn field ("w" or "b"). Falls back to
 *  "white" if the FEN is malformed so the deep-link still opens something. */
function fenSide(fen: string): "white" | "black" {
  const parts = fen.split(" ");
  return parts[1] === "b" ? "black" : "white";
}
function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const days = Math.floor((Date.now() - d) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function StudentMistakesPanel({ studentId, studentUsername, periodDays }: Props) {
  const [limit, setLimit] = useState(20);
  const period = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - periodDays);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, [periodDays]);

  const q = useQuery({
    queryKey: ["student-mistakes", studentId, periodDays, limit],
    queryFn: () => parentReportsApi.mistakes({
      studentId,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      limit,
    }),
    enabled: !!studentId,
    // Short TTL — the coach opens this panel to react to something the student
    // JUST did, so we can't sit on 30s-stale cache. Also refetch on focus so
    // switching back to the tab pulls the newest miss automatically.
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const rows = q.data ?? [];

  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">🎯 Puzzles this student missed <span className="ml-2 font-normal text-ink-400">({rows.length}{q.data && rows.length === limit ? "+" : ""})</span></h2>
          <p className="text-xs text-ink-500">Newest wrong-answer first · last {periodDays} days · use the buttons to reteach the position.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => q.refetch()} disabled={q.isFetching}
            className="rounded-md bg-ink-800 px-2 py-1 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-50"
            title="Force-refresh — miss just happened but not showing?">
            {q.isFetching ? "…" : "🔄 Refresh"}
          </button>
          {rows.length === limit && (
            <button onClick={() => setLimit((n) => Math.min(200, n + 20))}
              className="rounded-md bg-ink-800 px-2 py-1 text-xs text-ink-200 hover:bg-ink-700">Load more</button>
          )}
        </div>
      </div>
      {q.isLoading ? (
        <div className="text-xs text-ink-500">Loading missed puzzles…</div>
      ) : q.error ? (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          {String((q.error as any)?.message || "Could not load mistakes.")}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-xs text-emerald-200">
          🎉 No misses in this period — solid work. Try a longer window or a different theme filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-ink-700">
          <table className="min-w-full text-sm">
            <thead className="bg-ink-800/70 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2 text-left">Puzzle</th>
                <th className="px-3 py-2 text-right">Rating</th>
                <th className="px-3 py-2 text-left">Themes</th>
                <th className="px-3 py-2 text-left">Their move</th>
                <th className="px-3 py-2 text-left">Correct</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const side = m.fen ? fenSide(m.fen) : "white";
                const correctFirst = m.solution?.[0] || "—";
                const editorHref = m.fen
                  ? `/board-editor?fen=${encodeURIComponent(m.fen)}&orientation=${side}`
                  : null;
                const trainerHref = `/?puzzle=${encodeURIComponent(m.puzzleId)}${studentUsername ? `&as=${encodeURIComponent(studentUsername)}` : ""}`;
                return (
                  <tr key={m.puzzleId} className="border-t border-ink-800 hover:bg-ink-800/40">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-white">#{m.puzzleId}</div>
                      {m.ratedAt && <div className="text-[10px] text-ink-500">{daysAgo(m.ratedAt)}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-brand-200">{m.rating ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {m.themes.slice(0, 3).map((t) => (
                          <span key={t} className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">{t}</span>
                        ))}
                        {m.themes.length > 3 && <span className="text-[10px] text-ink-500">+{m.themes.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-rose-300">{m.wrongMove || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-300">{correctFirst}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1.5">
                        {editorHref && (
                          <Link to={editorHref}
                            title="Open in board editor — draw arrows and walk through the correct plan"
                            className="rounded-md bg-brand-500/20 px-2 py-1 text-xs font-semibold text-brand-100 hover:bg-brand-500/30">
                            📷 Board
                          </Link>
                        )}
                        <Link to={trainerHref}
                          title="Open in the puzzle trainer to solve it live with the student"
                          className="rounded-md bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30">
                          🎯 Reteach
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
