import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { api, type HistoryItem } from "../lib/api";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };
type Result = "all" | "solved" | "missed";

function dateLabel(d: string) {
  const day = new Date(d); const now = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(day, now)) return "Today";
  if (same(day, y)) return "Yesterday";
  return day.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Pick one representative theme to group a puzzle under (skip broad/length tags).
const GENERIC = new Set(["short", "long", "veryLong", "oneMove", "middlegame", "opening", "endgame", "master", "masterVsMaster", "superGM", "crushing", "advantage", "equality", "mate"]);
function primaryTheme(themes: string[] = []) {
  const m = themes.find((t) => /^mateIn\d/.test(t)); if (m) return m;
  const t = themes.find((x) => !GENERIC.has(x)); if (t) return t;
  return themes[0] ?? "Other";
}

// Compact "8s" / "1m 12s" for the time-badge under each mini board.
function fmtMs(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return `${m}m${r ? ` ${r}s` : ""}`;
}
// Speed tier => background + text color + emoji. Same thresholds as the live timer chip
// on Puzzles.tsx so history badges match what the user saw immediately after solving.
function timeTier(ms: number): { chip: string; emoji: string } {
  if (ms < 10_000) return { chip: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40", emoji: "⚡" };
  if (ms < 30_000) return { chip: "bg-cyan-500/15 text-cyan-200 border-cyan-500/35",           emoji: "🚀" };
  if (ms < 60_000) return { chip: "bg-brand-500/15 text-brand-100 border-brand-500/30",         emoji: "⏱" };
  return                { chip: "bg-amber-500/10 text-amber-100 border-amber-500/25",           emoji: "🐢" };
}

// Start-of-week (Monday, local time) for the "this week" summary — matches how most
// puzzle sites bucket streaks; not tied to the heatmap on Dashboard (which is Sun-first
// GitHub-style — a display choice, not a data choice).
function weekStartLocal(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = x.getDay();                          // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1;            // Mon-start: Sunday counts as 6 back
  x.setDate(x.getDate() - back);
  return x;
}

// Aggregates for one date range — used by the WeekStrip to show "this week vs last week".
type WeekAgg = { solved: number; missed: number; ratingDelta: number; count: number };
function aggregateRange(items: HistoryItem[], from: Date, toExclusive: Date): WeekAgg {
  const agg: WeekAgg = { solved: 0, missed: 0, ratingDelta: 0, count: 0 };
  for (const it of items) {
    const d = new Date(it.date);
    if (d < from || d >= toExclusive) continue;
    agg.count++;
    if (it.win) agg.solved++; else agg.missed++;
    if (typeof it.ratingDiff === "number") agg.ratingDelta += it.ratingDiff;
  }
  return agg;
}

// Colored "this week" strip. Three tiles + one trend arrow vs last week for the count.
function WeekStrip({ items }: { items: HistoryItem[] }) {
  const now = new Date();
  const thisWeek = weekStartLocal(now);
  const lastWeek = new Date(thisWeek); lastWeek.setDate(thisWeek.getDate() - 7);
  const nextWeek = new Date(thisWeek); nextWeek.setDate(thisWeek.getDate() + 7);
  const cur  = aggregateRange(items, thisWeek, nextWeek);
  const prev = aggregateRange(items, lastWeek, thisWeek);
  const trend = cur.count - prev.count;
  const winPct = cur.count ? Math.round((cur.solved / cur.count) * 100) : 0;
  return (
    <div className="rounded-xl2 border border-brand-500/25 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white">📆 This week</span>
        <span className="text-xs text-ink-400">
          {trend > 0 && <span className="text-emerald-300">↑ {trend} vs last week</span>}
          {trend < 0 && <span className="text-rose-300">↓ {Math.abs(trend)} vs last week</span>}
          {trend === 0 && <span className="text-ink-500">same as last week</span>}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg bg-ink-900/60 px-3 py-2">
          <div className="text-lg font-bold tabular-nums text-white">{cur.count}</div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400">played</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2">
          <div className="text-lg font-bold tabular-nums text-emerald-200">{cur.solved}</div>
          <div className="text-[10px] uppercase tracking-wide text-emerald-300/70">solved · {winPct}%</div>
        </div>
        <div className="rounded-lg bg-rose-500/10 px-3 py-2">
          <div className="text-lg font-bold tabular-nums text-rose-200">{cur.missed}</div>
          <div className="text-[10px] uppercase tracking-wide text-rose-300/70">missed</div>
        </div>
        <div className={`rounded-lg px-3 py-2 ${cur.ratingDelta >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
          <div className={`text-lg font-bold tabular-nums ${cur.ratingDelta >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
            {cur.ratingDelta >= 0 ? "+" : "−"}{Math.abs(cur.ratingDelta)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400">rating change</div>
        </div>
      </div>
    </div>
  );
}

// Filter bar — result pill triplet + theme dropdown + reset. Compact so it doesn't
// dominate the page. Theme options are the union of every theme the user has actually
// touched (from the loaded pages) so we never show a picker that returns zero results.
function FilterBar({ result, setResult, theme, setTheme, themes, matched, total }:
  { result: Result; setResult: (r: Result) => void;
    theme: string; setTheme: (t: string) => void;
    themes: string[]; matched: number; total: number }) {
  const pill = (active: boolean, base: string) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active ? base : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`;
  const cleared = result === "all" && theme === "";
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Show</span>
        <button onClick={() => setResult("all")}    className={pill(result === "all",    "border-brand-500/50 bg-brand-500/15 text-brand-100")}>All</button>
        <button onClick={() => setResult("solved")} className={pill(result === "solved", "border-emerald-500/50 bg-emerald-500/15 text-emerald-200")}>✅ Solved</button>
        <button onClick={() => setResult("missed")} className={pill(result === "missed", "border-rose-500/50 bg-rose-500/15 text-rose-200")}>❌ Missed</button>
        <span className="mx-2 h-5 w-px bg-ink-700" />
        <select value={theme} onChange={(e) => setTheme(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-white">
          <option value="">All themes</option>
          {themes.map((t) => <option key={t} value={t}>{prettify(t)}</option>)}
        </select>
        {!cleared && (
          <button onClick={() => { setResult("all"); setTheme(""); }}
            className="ml-1 rounded-lg border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800">Clear</button>
        )}
        <span className="ml-auto text-xs text-ink-500 tabular-nums">
          {matched === total ? `${total} puzzle${total === 1 ? "" : "s"}` : `${matched} of ${total} match`}
        </span>
      </div>
    </div>
  );
}

// Rating-delta chip color: emerald for gain, rose for loss, muted for zero (a hint
// solve or an even swap). Skipped entirely for null (legacy rows without a diff).
function rdChip(rd: number): { chip: string; arrow: string; sign: string } {
  if (rd > 0)  return { chip: "bg-emerald-500/25 text-emerald-100 border-emerald-400/50 ring-1 ring-emerald-400/20", arrow: "↑", sign: "+" };
  if (rd < 0)  return { chip: "bg-rose-500/25 text-rose-100 border-rose-400/50 ring-1 ring-rose-400/20",              arrow: "↓", sign: "−" };
  return           { chip: "bg-ink-700/40 text-ink-300 border-ink-600/50",                                             arrow: "·", sign: "" };
}

/** Mini board, mounted only when scrolled into view; green ring = solved, red = missed.
 *  Corner badges: top-right = rating delta (±N), bottom-right = solve time. Both are
 *  optional — legacy rows without ms/ratingDiff simply omit them.
 *  Clicking navigates to the Puzzles page with ?review=<id> so the puzzle re-opens
 *  in review mode (misses show a red arrow of the wrong move). */
function LazyMini({ it, onOpen }: { it: HistoryItem; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (show || !ref.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setShow(true); io.disconnect(); }
    }, { rootMargin: "300px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [show]);
  const lm = it.lastMove ? ([it.lastMove.slice(0, 2), it.lastMove.slice(2, 4)] as [Key, Key]) : undefined;
  const tTier = typeof it.ms === "number" ? timeTier(it.ms) : null;
  const rd = typeof it.ratingDiff === "number" ? it.ratingDiff : null;
  const rdT = rd != null ? rdChip(rd) : null;
  const hint = it.win ? "Replay this solve" : "Review — see the wrong move + best move";
  return (
    <button ref={ref as unknown as React.RefObject<HTMLButtonElement>} onClick={() => onOpen(it.id)}
      type="button" title={hint}
      className={`group relative overflow-hidden rounded-md border-2 ${it.win ? "border-accent-500" : "border-rose-500"} transition-transform hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-400`}>
      {show && it.fen
        ? <Board fen={it.fen} orientation={it.orientation} lastMove={lm} viewOnly coordinates={false} className="mini" />
        : <div className="aspect-square w-full bg-ink-800" />}
      {/* Hover reveal: subtle "▶ replay" chip so it's obvious the tile is interactive. */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
        {it.win ? "▶ Replay" : "🔍 Review"}
      </span>
      {rdT && rd != null && (
        <span className={`absolute top-1 right-1 flex items-center gap-0.5 rounded-md border ${rdT.chip} px-1.5 py-0.5 text-[10px] font-bold shadow-sm backdrop-blur-sm tabular-nums`}
              title={`Rating ${rd >= 0 ? "gained" : "lost"} on this solve`}>
          <span>{rdT.arrow}</span><span>{rdT.sign}{Math.abs(rd)}</span>
        </span>
      )}
      {tTier && typeof it.ms === "number" && (
        <span className={`absolute bottom-1 right-1 flex items-center gap-0.5 rounded-md border ${tTier.chip} px-1.5 py-0.5 text-[10px] font-semibold shadow-sm backdrop-blur-sm`}
              title="Time to solve this puzzle">
          <span>{tTier.emoji}</span><span className="tabular-nums">{fmtMs(it.ms)}</span>
        </span>
      )}
    </button>
  );
}

export default function HistoryPage() {
  const { rating } = useOutletContext<Ctx>();
  const { data, isLoading } = useQuery({ queryKey: ["me-history"], queryFn: () => api.history(0) });
  const [pages, setPages] = useState<HistoryItem[]>([]);   // appended pages beyond the first
  const [off, setOff] = useState<number | null>(null);      // next offset to fetch (null = none)
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [result, setResult] = useState<Result>("all");
  const [theme,  setTheme]  = useState<string>("");
  const nav = useNavigate();
  // Open a past solve in the Puzzles-page review view. Query-string handoff means
  // deep-links from anywhere (share, browser back) work without wiring extra props.
  const openReview = (id: string) => nav(`/?review=${encodeURIComponent(id)}`);
  useEffect(() => {
    if (data?.loggedIn) { setPages([]); setMore(!!data.hasMore); setOff(data.nextOffset ?? null); }
  }, [data]);
  async function loadMore() {
    if (off == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.history(off);
      setPages((p) => [...p, ...(r.items ?? [])]);
      setMore(!!r.hasMore); setOff(r.nextOffset ?? null);
    } finally { setLoadingMore(false); }
  }

  if (isLoading) return <div className="py-16 text-center text-ink-400">Loading your report…</div>;

  if (!data?.loggedIn) {
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
        <div className="mb-2 text-2xl">📊</div>
        <h1 className="mb-2 font-display text-xl text-white">Your puzzle report</h1>
        <p className="mb-5 text-sm text-ink-400">Sign in to track every puzzle you solve.</p>
        <Link to="/login" className="inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-500">Sign in</Link>
      </div>
    );
  }

  const t = data.totals!;
  const stats = [
    { label: "Attempted", value: t.attempted },
    { label: "Solved", value: t.solved, tone: "text-accent-400" },
    { label: "Missed", value: t.failed, tone: "text-rose-400" },
    { label: "Win rate", value: `${t.winRate}%` },
    { label: "Rating", value: rating ?? "—" },
  ];

  const allItems = [...(data.items ?? []), ...pages];

  // Theme dropdown options — the union of every "primary" theme actually seen in
  // the loaded pages. Keeps the picker honest (never surfaces a theme with 0 matches).
  const availableThemes = useMemo(() => {
    const s = new Set<string>();
    for (const it of allItems) s.add(it.sel && it.sel !== "mix" ? it.sel : primaryTheme(it.themes));
    return [...s].sort((a, b) => prettify(a).localeCompare(prettify(b)));
  }, [allItems]);

  // Filter applied to the flat items list BEFORE re-grouping by day/theme.
  const filtered = useMemo(() => allItems.filter((it) => {
    if (result === "solved" && !it.win) return false;
    if (result === "missed" &&  it.win) return false;
    if (theme) {
      const t = it.sel && it.sel !== "mix" ? it.sel : primaryTheme(it.themes);
      if (t !== theme) return false;
    }
    return true;
  }), [allItems, result, theme]);

  // date groups (items are newest-first, so same-day items are contiguous)
  const dateGroups: { label: string; items: HistoryItem[] }[] = [];
  for (const it of filtered) {
    const label = dateLabel(it.date);
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else dateGroups.push({ label, items: [it] });
  }
  const themeGroupsOf = (items: HistoryItem[]) => {
    const map = new Map<string, HistoryItem[]>();
    for (const it of items) {
      // group by the filter that was played: "All themes" when mix; else the picked theme; fall back to the puzzle's main theme (older solves)
      const label = it.sel === "mix" ? "All themes" : it.sel ? prettify(it.sel) : prettify(primaryTheme(it.themes));
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(it);
    }
    return [...map.entries()].map(([label, items]) => ({ label, items })).sort((a, b) => b.items.length - a.items.length);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-white">Puzzle report</h1>
        <p className="text-sm text-ink-400">Green = solved, red = missed. Grouped by day and theme.</p>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
            <div className={`text-2xl font-bold ${s.tone ?? "text-white"}`}>{s.value}</div>
            <div className="text-xs font-medium text-ink-400">{s.label}</div>
          </div>
        ))}
      </div>

      {allItems.length > 0 && <WeekStrip items={allItems} />}

      {allItems.length > 0 && (
        <FilterBar result={result} setResult={setResult} theme={theme} setTheme={setTheme}
          themes={availableThemes} matched={filtered.length} total={allItems.length} />
      )}

      {t.attempted === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center text-ink-400">
          No solved puzzles yet — <Link to="/" className="text-brand-400 hover:underline">solve your first puzzle</Link> and it’ll show up here.
        </div>
      ) : dateGroups.length === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center text-ink-400">
          No puzzles match those filters —{" "}
          <button onClick={() => { setResult("all"); setTheme(""); }} className="text-brand-400 hover:underline">clear filters</button>
          {" "}to see everything.
        </div>
      ) : (
        <div className="space-y-7">
          {dateGroups.map((g) => (
            <div key={g.label}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-display text-lg text-white">{g.label}</h2>
                <span className="text-xs text-ink-500">{g.items.length}</span>
                <div className="h-px flex-1 bg-ink-800" />
              </div>
              <div className="space-y-4">
                {themeGroupsOf(g.items).map((tg) => (
                  <div key={tg.label}>
                    <h3 className="mb-2 text-sm font-semibold text-ink-300">
                      {tg.label} <span className="font-normal text-ink-500">· {tg.items.length}</span>
                    </h3>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {tg.items.map((it) => <LazyMini key={it.id + it.date} it={it} onOpen={openReview} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {more ? (
            <div className="pt-2 text-center">
              <button onClick={loadMore} disabled={loadingMore}
                className="rounded-lg border border-ink-700 bg-ink-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50">
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-ink-500">That’s all {allItems.length} puzzles.</p>
          )}
        </div>
      )}
    </div>
  );
}
