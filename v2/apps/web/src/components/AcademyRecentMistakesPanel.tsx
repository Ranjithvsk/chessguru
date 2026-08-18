// Academy-wide reteach queue — puzzle + study misses across EVERY student
// in the caller's academy (owner: all, coach: assigned students). Renders
// as a compact grid of mini-board cards on /academy/performance so a coach
// scans "who needs reteaching this week" at a glance.
//
// Owner ask 2026-08-18: "main page small module for coach to see all
// students study mistakes, puzzle mistakes".
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function AcademyRecentMistakesPanel({ enabled = true }: { enabled?: boolean }) {
  // Collapsed by default (owner ask 2026-08-18) so /academy/performance
  // opens with the roster front-and-center; coach expands the reteach queue
  // when they want it. Persisted per browser so a coach who prefers it open
  // gets it open next time.
  const [open, setOpenState] = useState<boolean>(() => {
    try { return localStorage.getItem("cg.academy-mistakes.open") === "1"; }
    catch { return false; }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { localStorage.setItem("cg.academy-mistakes.open", v ? "1" : "0"); } catch { /* */ }
  };
  const [kind, setKind] = useState<"both" | "puzzle" | "study">("both");
  const [periodDays, setPeriodDays] = useState<7 | 30>(7);
  const period = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - periodDays);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, [periodDays]);

  const q = useQuery({
    queryKey: ["academy-mistakes", kind, periodDays],
    queryFn: () => parentReportsApi.academyMistakes({
      kind,
      // Fetch 200 in one shot — client paginates 25/page so page-flips are
      // instant with zero backend hits (owner ask: "should be instant, no
      // loading" even across 1000s of puzzles). Backend caps at 500 as a
      // hard ceiling; when we hit that we'll switch to true server paging.
      limit: 200,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    }),
    enabled: enabled && open,
    // Longer TTL — data is stable for the coach's session; the "🔄" button
    // is the escape hatch when they need a fresh fetch.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const allRows = q.data ?? [];
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  // Reset to page 1 whenever the filter set or period changes so a coach
  // switching filters doesn't stay stranded on page 5 of a smaller result.
  useEffect(() => { setPage(1); }, [kind, periodDays, allRows.length]);
  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const rows = allRows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      {/* Clickable header — the whole strip toggles open/close so the coach
          doesn't have to hunt for a chevron. Filter/refresh buttons stop
          the click propagation so they operate normally. */}
      <button type="button" onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-m-2 mb-1 flex w-full flex-wrap items-center gap-2 rounded-lg p-2 text-left hover:bg-ink-800/40">
        <svg className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 12 12" fill="none">
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">🎯 Recent mistakes across the academy <span className="ml-2 font-normal text-ink-400">{open ? `(${rows.length})` : "· click to open"}</span></h2>
          {open && <p className="mt-0.5 text-xs text-ink-500">Last {periodDays} days · newest first · click a card to reteach.</p>}
        </div>
        {open && (
          <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex overflow-hidden rounded-lg border border-ink-700 text-[11px]">
              {(["both", "puzzle", "study"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`px-2.5 py-1 font-medium ${kind === k ? "bg-brand-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                  {k === "both" ? "All" : k === "puzzle" ? "Puzzles" : "Studies"}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-lg border border-ink-700 text-[11px]">
              {[7, 30].map((d) => (
                <button key={d} type="button" onClick={() => setPeriodDays(d as 7 | 30)}
                  className={`px-2.5 py-1 font-medium ${periodDays === d ? "bg-brand-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                  {d}d
                </button>
              ))}
            </div>
            <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
              className="rounded-md bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700 disabled:opacity-50"
              title="Force-refresh">
              {q.isFetching ? "…" : "🔄"}
            </button>
          </div>
        )}
      </button>
      {!open ? null : (<>

      {q.isLoading ? (
        <div className="text-xs text-ink-500">Loading recent mistakes…</div>
      ) : q.error ? (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          {String((q.error as any)?.message || "Could not load academy mistakes.")}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-xs text-emerald-200">
          🎉 No misses in the academy this week — full clean sweep. Change the filter or window to look deeper.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((m, i) => {
            const side = m.fen ? fenSide(m.fen) : "white";
            const wrongSquares = uciSquares(m.wrongMove);
            const trainerHref = m.kind === "puzzle"
              ? `/?puzzle=${encodeURIComponent(m.puzzleId)}&as=${encodeURIComponent(m.studentUsername)}`
              : `/study/${encodeURIComponent(m.studyType || "")}`;
            const editorHref = m.fen ? `/board-editor?fen=${encodeURIComponent(m.fen)}&orientation=${side}` : null;
            const perfHref = `/academy/students/${encodeURIComponent(m.studentId)}/performance`;
            const kindBadge = m.kind === "puzzle"
              ? { emoji: "🧩", label: "Puzzle", cls: "bg-brand-500/20 text-brand-200" }
              : { emoji: "📚", label: m.studyType || "Study", cls: "bg-amber-500/20 text-amber-200" };
            return (
              <div key={`${m.kind}-${m.studentId}-${m.puzzleId}-${i}`}
                className="flex flex-col overflow-hidden rounded-xl border-2 border-rose-500/60 bg-ink-800/40 transition hover:border-rose-400">
                {m.fen ? (
                  <Board fen={m.fen} orientation={side} lastMove={wrongSquares}
                    viewOnly coordinates={false} className="mini" />
                ) : (
                  <div className="aspect-square w-full grid place-items-center bg-ink-800 text-[11px] text-ink-500">FEN missing</div>
                )}
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <Link to={perfHref} className="truncate font-semibold text-white hover:text-brand-300">{m.studentName}</Link>
                    <span className="shrink-0 text-ink-500">{daysAgo(m.ratedAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${kindBadge.cls}`}>{kindBadge.emoji} {kindBadge.label}</span>
                    {m.rating != null && (
                      <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 font-semibold tabular-nums text-brand-200">★ {m.rating}</span>
                    )}
                  </div>
                  {(m.wrongMove || m.solution?.[0]) && (
                    <div className="flex flex-wrap gap-x-2 text-[10px]">
                      {m.wrongMove && <span><span className="text-ink-500">Their:</span> <span className="font-mono font-semibold text-rose-300">{m.wrongMove}</span></span>}
                      {m.solution?.[0] && <span><span className="text-ink-500">Best:</span> <span className="font-mono font-semibold text-emerald-300">{m.solution[0]}</span></span>}
                    </div>
                  )}
                  <div className="mt-auto flex gap-1 pt-1">
                    {editorHref && (
                      <Link to={editorHref} className="flex-1 rounded-md bg-brand-500/20 px-1.5 py-1 text-center text-[10px] font-semibold text-brand-100 hover:bg-brand-500/30">
                        📷
                      </Link>
                    )}
                    <Link to={trainerHref} className="flex-1 rounded-md bg-emerald-500/20 px-1.5 py-1 text-center text-[10px] font-semibold text-emerald-100 hover:bg-emerald-500/30">
                      🎯 Reteach
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && !q.isLoading && !q.error && allRows.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-400">
          <span>Showing <span className="font-semibold text-white">{(clampedPage - 1) * PAGE_SIZE + 1}–{Math.min(clampedPage * PAGE_SIZE, allRows.length)}</span> of {allRows.length}{allRows.length === 200 ? "+" : ""}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={clampedPage <= 1}
              className="rounded-md bg-ink-800 px-2 py-1 text-ink-200 hover:bg-ink-700 disabled:opacity-40">← Prev</button>
            <span className="px-2 tabular-nums">Page {clampedPage} / {pageCount}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={clampedPage >= pageCount}
              className="rounded-md bg-ink-800 px-2 py-1 text-ink-200 hover:bg-ink-700 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
      </>)}
    </section>
  );
}
