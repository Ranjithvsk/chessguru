// Coach reteach queue — the puzzles a student got WRONG in the current
// period. Each miss renders as a card with a mini board (like /history)
// so the coach can eyeball the position at a glance, then jump into:
//   - 🎯 Reteach — /?puzzle=<id>&as=<username> for a live session
//   - 📷 Board editor — /board-editor?fen=<fen>&orientation=<w|b> to teach
//     the position (add arrows, walk through the correct idea).
//
// Added 2026-08-18 (owner: "coach can reteach and teach them the technique"
// + "if there is a small board like my history, it'll be useful").
// Backend endpoint: POST /api/parent-reports/mistakes.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MiniFenBoard } from "./MiniFenBoard";
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
/** UCI ("e2e4" or "e7e8q") → [from, to] for chessground's lastMove highlight. */
function uciSquares(uci: string | null): [string, string] | undefined {
  if (!uci || uci.length < 4) return undefined;
  return [uci.slice(0, 2), uci.slice(2, 4)];
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
    // Short TTL — coaches open this to react to something the student just
    // did, so we can't sit on 30s-stale cache. Refetch on tab focus too.
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const rows = q.data ?? [];

  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">🎯 Puzzles this student missed <span className="ml-2 font-normal text-ink-400">({rows.length}{q.data && rows.length === limit ? "+" : ""})</span></h2>
          <p className="text-xs text-ink-500">Newest wrong-answer first · last {periodDays} days · yellow squares = their wrong move.</p>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((m) => {
            const side = m.fen ? fenSide(m.fen) : "white";
            const correctFirst = m.solution?.[0] || null;
            const wrongSquares = uciSquares(m.wrongMove);
            const editorHref = m.fen
              ? `/board-editor?fen=${encodeURIComponent(m.fen)}&orientation=${side}`
              : null;
            const trainerHref = `/?puzzle=${encodeURIComponent(m.puzzleId)}${studentUsername ? `&as=${encodeURIComponent(studentUsername)}` : ""}`;
            return (
              <div key={m.puzzleId} className="flex flex-col overflow-hidden rounded-xl2 border-2 border-rose-500/60 bg-ink-800/40 transition hover:border-rose-400">
                {/* Mini board — pure inline SVG (no Chessground mount cost).
                    Wrong-move squares highlighted yellow. */}
                {m.fen ? (
                  <MiniFenBoard fen={m.fen} orientation={side} highlight={wrongSquares as [string, string] | undefined} />
                ) : (
                  <div className="aspect-square w-full bg-ink-800 text-center text-xs text-ink-500 grid place-items-center">
                    puzzle FEN missing
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] text-ink-400">#{m.puzzleId}</span>
                    <div className="flex items-center gap-2 text-[11px]">
                      {m.rating != null && (
                        <span className="rounded-full bg-brand-500/15 px-2 py-0.5 font-semibold tabular-nums text-brand-200">★ {m.rating}</span>
                      )}
                      <span className="text-ink-500">{daysAgo(m.ratedAt)}</span>
                    </div>
                  </div>

                  {/* Themes */}
                  {m.themes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.themes.slice(0, 4).map((t) => (
                        <span key={t} className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">{t}</span>
                      ))}
                      {m.themes.length > 4 && <span className="text-[10px] text-ink-500 self-center">+{m.themes.length - 4}</span>}
                    </div>
                  )}

                  {/* Their move vs correct — compact one-liner. */}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                    <span><span className="text-ink-500">Their move:</span> <span className="font-mono font-semibold text-rose-300">{m.wrongMove || "—"}</span></span>
                    {correctFirst && (
                      <span><span className="text-ink-500">Correct:</span> <span className="font-mono font-semibold text-emerald-300">{correctFirst}</span></span>
                    )}
                  </div>

                  <div className="mt-auto flex gap-1.5 pt-1">
                    {editorHref && (
                      <Link to={editorHref}
                        title="Open in board editor — draw arrows and walk through the correct plan"
                        className="flex-1 rounded-md bg-brand-500/20 px-2 py-1.5 text-center text-xs font-semibold text-brand-100 hover:bg-brand-500/30">
                        📷 Board
                      </Link>
                    )}
                    <Link to={trainerHref}
                      title="Open in the puzzle trainer to solve it live with the student"
                      className="flex-1 rounded-md bg-emerald-500/20 px-2 py-1.5 text-center text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30">
                      🎯 Reteach
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
