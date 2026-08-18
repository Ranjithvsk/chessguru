// "Revise the puzzles you got wrong" panel — self-scoped variant of the
// coach-facing StudentMistakesPanel. Rendered on /dashboard so a user can
// pick up their own missed puzzles and try them again.
//
// Owner ask 2026-08-18: "in my performance also show the mistaken puzzle
// to revise those puzzles". Backend: POST /api/parent-reports/mistakes-self.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Key } from "chessground/types";
import Board from "./Board";
import { parentReportsApi } from "../lib/parent-reports-api";

function fenSide(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}
function uciSquares(uci: string | null): [Key, Key] | undefined {
  if (!uci || uci.length < 4) return undefined;
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}
function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function MyMistakesPanel() {
  // Collapsed by default so the dashboard stays scan-friendly; open state
  // persists per browser.
  const [open, setOpenState] = useState<boolean>(() => {
    try { return localStorage.getItem("cg.my-mistakes.open") === "1"; } catch { return false; }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { localStorage.setItem("cg.my-mistakes.open", v ? "1" : "0"); } catch { /* */ }
  };
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
  const period = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - periodDays);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, [periodDays]);

  const q = useQuery({
    queryKey: ["my-mistakes", periodDays],
    queryFn: () => parentReportsApi.mistakesSelf({
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      limit: 24,
    }),
    // Prefetch even while collapsed so the panel opens instantly.
    enabled: true,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const rows = q.data ?? [];

  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <button type="button" onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-m-2 mb-1 flex w-full flex-wrap items-center gap-2 rounded-lg p-2 text-left hover:bg-ink-800/40">
        <svg className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 12 12" fill="none">
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">🔁 Revise your mistakes <span className="ml-2 font-normal text-ink-400">{rows.length > 0 ? `(${rows.length})` : q.isFetching ? "· loading" : "· click to open"}</span></h2>
          {open && <p className="mt-0.5 text-xs text-ink-500">Puzzles you got wrong · last {periodDays} days · click 🔁 to try again.</p>}
        </div>
        {open && (
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-[11px]" onClick={(e) => e.stopPropagation()}>
            {[7, 30, 90].map((d) => (
              <button key={d} type="button" onClick={() => setPeriodDays(d as 7 | 30 | 90)}
                className={`px-2.5 py-1 font-medium ${periodDays === d ? "bg-brand-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                {d}d
              </button>
            ))}
          </div>
        )}
      </button>

      {!open ? null : q.isLoading ? (
        <div className="text-xs text-ink-500">Loading mistakes…</div>
      ) : q.error ? (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          {String((q.error as any)?.message || "Could not load mistakes.")}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-xs text-emerald-200">
          🎉 No missed puzzles in the last {periodDays} days — clean sweep. Nothing to revise.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((m, i) => {
            const side = m.fen ? fenSide(m.fen) : "white";
            const wrongSquares = uciSquares(m.wrongMove);
            const correctFirst = m.solution?.[0] || null;
            const trainerHref = `/?puzzle=${encodeURIComponent(m.puzzleId)}`;
            return (
              <div key={`${m.puzzleId}-${i}`}
                style={{ contentVisibility: "auto", containIntrinsicSize: "280px" } as any}
                className="flex flex-col overflow-hidden rounded-xl border-2 border-rose-500/60 bg-ink-800/40 transition hover:border-rose-400">
                {m.fen ? (
                  <Board fen={m.fen} orientation={side} lastMove={wrongSquares}
                    viewOnly coordinates className="mini" />
                ) : (
                  <div className="aspect-square w-full grid place-items-center bg-ink-800 text-[11px] text-ink-500">FEN missing</div>
                )}
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="font-mono text-ink-400">#{m.puzzleId}</span>
                    <span className="text-ink-500">{daysAgo(m.ratedAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    {m.rating != null && (
                      <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 font-semibold tabular-nums text-brand-200">★ {m.rating}</span>
                    )}
                    {m.themes.slice(0, 3).map((t) => (
                      <span key={t} className="rounded-full bg-ink-800 px-1.5 py-0.5 text-ink-300">{t}</span>
                    ))}
                    {m.themes.length > 3 && <span className="text-ink-500 self-center">+{m.themes.length - 3}</span>}
                  </div>
                  {(m.wrongMove || correctFirst) && (
                    <div className="flex flex-wrap gap-x-2 text-[10px]">
                      {m.wrongMove && <span><span className="text-ink-500">You played:</span> <span className="font-mono font-semibold text-rose-300">{m.wrongMove}</span></span>}
                      {correctFirst && <span><span className="text-ink-500">Correct:</span> <span className="font-mono font-semibold text-emerald-300">{correctFirst}</span></span>}
                    </div>
                  )}
                  <Link to={trainerHref} className="mt-auto rounded-md bg-emerald-500/20 px-2 py-1.5 text-center text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30">
                    🔁 Try again
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
