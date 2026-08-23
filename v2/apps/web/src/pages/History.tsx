import React, { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { api, type HistoryItem } from "../lib/api";
import { prettify } from "../lib/format";
import ExternalGamesList from "./ExternalGamesList";

type Ctx = { userId: string | null; rating: number };
type Result = "all" | "solved" | "missed";
// Phase 7f timeframe pill. RANGE_DAYS[k]=null → skip the date cutoff (any date).
type Range = "all" | "30d" | "7d";
const RANGE_DAYS: Record<Range, number | null> = { all: null, "30d": 30, "7d": 7 };

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
function FilterBar({ result, setResult, theme, setTheme, range, setRange, themes, matched, total }:
  { result: Result; setResult: (r: Result) => void;
    theme: string; setTheme: (t: string) => void;
    range: Range; setRange: (r: Range) => void;
    themes: string[]; matched: number; total: number }) {
  const pill = (active: boolean, base: string) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active ? base : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`;
  const cleared = result === "all" && theme === "" && range === "all";
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Show</span>
        <button onClick={() => setResult("all")}    className={pill(result === "all",    "border-brand-500/50 bg-brand-500/15 text-brand-100")}>All</button>
        <button onClick={() => setResult("solved")} className={pill(result === "solved", "border-emerald-500/50 bg-emerald-500/15 text-emerald-200")}>✅ Solved</button>
        <button onClick={() => setResult("missed")} className={pill(result === "missed", "border-rose-500/50 bg-rose-500/15 text-rose-200")}>❌ Missed</button>
        <span className="mx-2 h-5 w-px bg-ink-700" />
        {/* Timeframe — cyan tint so it reads as "time" not "category". */}
        <button onClick={() => setRange("all")} className={pill(range === "all", "border-cyan-500/50 bg-cyan-500/15 text-cyan-100")}>Any date</button>
        <button onClick={() => setRange("30d")} className={pill(range === "30d", "border-cyan-500/50 bg-cyan-500/15 text-cyan-100")}>30d</button>
        <button onClick={() => setRange("7d")}  className={pill(range === "7d",  "border-cyan-500/50 bg-cyan-500/15 text-cyan-100")}>7d</button>
        <span className="mx-2 h-5 w-px bg-ink-700" />
        <select value={theme} onChange={(e) => setTheme(e.target.value)}
          className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-white">
          <option value="">All themes</option>
          {themes.map((t) => <option key={t} value={t}>{prettify(t)}</option>)}
        </select>
        {!cleared && (
          <button onClick={() => { setResult("all"); setTheme(""); setRange("all"); }}
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
const LazyMini = React.memo(function LazyMini({ it, onOpen }: { it: HistoryItem; onOpen: (id: string) => void }) {
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
      className={`group relative flex flex-col overflow-hidden rounded-md border-2 ${it.win ? "border-accent-500" : "border-rose-500"} transition-transform hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-400`}>
      <div className="relative">
        {show && it.fen
          ? <Board fen={it.fen} orientation={it.orientation} lastMove={lm} viewOnly coordinates={false} className="mini" />
          : <div className="aspect-square w-full bg-ink-800" />}
        {/* Hover reveal: subtle "▶ replay" chip so it's obvious the tile is interactive. */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
          {it.win ? "▶ Replay" : "🔍 Review"}
        </span>
      </div>
      {/* Caption bar BELOW the board — keeps chips off the chess pieces.
          Owner report 2026-08-23: previous overlay chips sat on top of the
          board obscuring pieces + felt cluttered on small tiles. Now: a
          single row under the board with blindfold badge (left) + rating
          delta + solve time (right). Empty tiles get a thin invisible spacer
          so grid heights stay uniform. */}
      <div className="flex h-6 items-center justify-between gap-1 border-t border-ink-800 bg-ink-900/80 px-1.5 text-[11px] leading-none">
        <span>
          {it.mode === "blindfold" && (
            <span className="rounded border border-violet-400/60 bg-violet-500/25 px-1 py-0.5 text-[10px] font-bold text-violet-200"
                  title="Blindfold puzzle — solved without seeing the board">🙈</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {rdT && rd != null && rd !== 0 && (
            <span className={`flex items-center gap-0.5 tabular-nums font-bold text-[10px] ${rd >= 0 ? "text-emerald-300" : "text-rose-300"}`}
                  title={`Rating ${rd >= 0 ? "gained" : "lost"} on this solve`}>
              <span>{rdT.arrow}</span><span>{rdT.sign}{Math.abs(rd)}</span>
            </span>
          )}
          {tTier && typeof it.ms === "number" && (
            <span className="flex items-center gap-0.5 text-[10px] text-ink-400"
                  title="Time to solve this puzzle">
              <span>{tTier.emoji}</span><span className="tabular-nums">{fmtMs(it.ms)}</span>
            </span>
          )}
        </span>
      </div>
    </button>
  );
});

// Puzzle classification summary — top themes by volume + rating-band spread.
// Themes are filtered to the "meaningful" ones (skip broad tags like "endgame"
// or "short" which appear on almost every puzzle). Clicking a theme applies it
// as the filter so the mini-board grid narrows to just that theme.
function ClassificationPanel({ byTheme, byBand, onPickTheme, activeTheme }:
  { byTheme: { theme: string; total: number; wins: number }[];
    byBand:  { band: string; lo: number; total: number; wins: number }[];
    onPickTheme: (t: string) => void; activeTheme: string; }) {
  const meaningful = byTheme.filter((t) => !GENERIC.has(t.theme)).slice(0, 12);
  const bandMax = Math.max(1, ...byBand.map((b) => b.total));
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-display text-lg text-white">🎯 Puzzle classification</h2>
        <span className="text-xs text-ink-500">{byTheme.length} themes · {byBand.length} rating bands</span>
      </div>

      {meaningful.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Top themes</div>
          <div className="flex flex-wrap gap-1.5">
            {meaningful.map((t) => {
              const wr = t.total ? Math.round((t.wins / t.total) * 100) : 0;
              const on = activeTheme === t.theme;
              return (
                <button key={t.theme}
                  onClick={() => onPickTheme(on ? "" : t.theme)}
                  className={`group flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    on ? "border-brand-500 bg-brand-500/25 text-white"
                       : "border-ink-700 bg-ink-800/60 text-ink-200 hover:bg-ink-800"}`}
                  title={`${t.wins} solved / ${t.total} attempted (${wr}%)`}>
                  <span>{prettify(t.theme)}</span>
                  <span className="tabular-nums text-ink-400 group-hover:text-ink-300">· {t.total}</span>
                  <span className={`tabular-nums ${wr >= 70 ? "text-emerald-300" : wr >= 50 ? "text-amber-300" : "text-rose-300"}`}>· {wr}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {byBand.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Rating bands</div>
          <div className="space-y-1.5">
            {byBand.map((b) => {
              const wr = b.total ? Math.round((b.wins / b.total) * 100) : 0;
              const width = Math.max(4, (b.total / bandMax) * 100);
              return (
                <div key={b.band} className="grid grid-cols-[100px_1fr_60px] items-center gap-2">
                  <span className="text-xs tabular-nums text-ink-300">{b.band}</span>
                  <div className="relative h-4 rounded bg-ink-800">
                    <div className="absolute inset-y-0 left-0 rounded bg-brand-500/40" style={{ width: `${width}%` }} />
                    <span className="absolute inset-0 flex items-center justify-end pr-1.5 text-[10px] tabular-nums text-white">{b.total}</span>
                  </div>
                  <span className={`text-[11px] tabular-nums ${wr >= 70 ? "text-emerald-300" : wr >= 50 ? "text-amber-300" : "text-rose-300"}`}>{wr}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TabBar({ active, onSwitch }: { active: "puzzles"|"external"; onSwitch: (t: "puzzles"|"external") => void }) {
  const tab = (id: "puzzles"|"external", label: string) => (
    <button onClick={() => onSwitch(id)}
      className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
        active === id ? "border-brand-500 text-white" : "border-transparent text-ink-400 hover:text-white"}`}>
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 border-b border-ink-700">
      {tab("puzzles", "🧩 My puzzles")}
      {tab("external", "🌐 External games")}
    </div>
  );
}

export default function HistoryPage() {
  const { rating } = useOutletContext<Ctx>();
  const [sp, setSp] = useSearchParams();
  const as = sp.get("as") || null;   // admin / academy_owner / coach: view another user's history (resolveViewedUser gates it server-side)
  const tab = (sp.get("tab") === "external" ? "external" : "puzzles") as "puzzles"|"external";
  const switchTab = (t: "puzzles"|"external") => {
    const next = new URLSearchParams(sp);
    if (t === "external") next.set("tab", "external"); else next.delete("tab");
    setSp(next, { replace: true });
  };
  const { data, isLoading } = useQuery({ queryKey: ["me-history", as], queryFn: () => api.history(0, as), enabled: tab === "puzzles" });
  const [pages, setPages] = useState<HistoryItem[]>([]);   // appended pages beyond the first
  const [off, setOff] = useState<number | null>(null);      // next offset to fetch (null = none)
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [result, setResult] = useState<Result>("all");
  const [theme,  setTheme]  = useState<string>("");
  // Timeframe persisted per browser so revisits keep the user's chosen window.
  const [range, setRange] = useState<Range>(() => {
    const v = (typeof localStorage !== "undefined" && localStorage.getItem("cg_history_range")) as Range | null;
    return v === "30d" || v === "7d" || v === "all" ? v : "all";
  });
  useEffect(() => { try { localStorage.setItem("cg_history_range", range); } catch { /* private mode */ } }, [range]);
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
      const r = await api.history(off, as);
      setPages((p) => [...p, ...(r.items ?? [])]);
      setMore(!!r.hasMore); setOff(r.nextOffset ?? null);
    } finally { setLoadingMore(false); }
  }

  // IMPORTANT: every hook call MUST run on every render, in the same order.
  // Compute derived data + memos here (before the early returns below) so the
  // hook count is stable whether the page is loading, logged out, or fully
  // rendered. Missing `data` is handled by defensive defaults inside each memo.
  const allItems = useMemo(
    () => [...(data?.items ?? []), ...pages],
    [data, pages],
  );

  // Theme dropdown options — prefer the FULL byTheme classification the server
  // computes over the whole (capped) history, so someone whose first page is
  // dominated by one theme (e.g. 191 smothered-mates in a single session)
  // still gets every theme they've ever solved in the picker. Falls back to
  // deriving from the loaded pages when the response hasn't landed yet.
  const availableThemes = useMemo(() => {
    if (data?.byTheme?.length) {
      const s = new Set<string>();
      // byTheme contains ALL themes (including GENERIC ones like "short", "endgame")
      // — filter to the ones that also survive our primaryTheme() pick so the
      // dropdown doesn't offer buckets the mini-boards never group under.
      for (const it of allItems) s.add(it.sel && it.sel !== "mix" ? it.sel : primaryTheme(it.themes));
      for (const t of data.byTheme) if (!GENERIC.has(t.theme)) s.add(t.theme);
      return [...s].sort((a, b) => prettify(a).localeCompare(prettify(b)));
    }
    const s = new Set<string>();
    for (const it of allItems) s.add(it.sel && it.sel !== "mix" ? it.sel : primaryTheme(it.themes));
    return [...s].sort((a, b) => prettify(a).localeCompare(prettify(b)));
  }, [allItems, data?.byTheme]);

  // Filter applied to the flat items list BEFORE re-grouping by day/theme.
  const filtered = useMemo(() => allItems.filter((it) => {
    if (result === "solved" && !it.win) return false;
    if (result === "missed" &&  it.win) return false;
    if (theme) {
      const t = it.sel && it.sel !== "mix" ? it.sel : primaryTheme(it.themes);
      if (t !== theme) return false;
    }
    // Timeframe: `range="all"` short-circuits the date check. Otherwise drop
    // anything older than the cutoff (RANGE_DAYS gives days-back for the pill).
    const days = RANGE_DAYS[range];
    if (days != null) {
      const cutoff = Date.now() - days * 86_400_000;
      if (new Date(it.date).getTime() < cutoff) return false;
    }
    return true;
  }), [allItems, result, theme, range]);

  // date + theme groups — precomputed ONCE per filtered set, not per render.
  // Must live ABOVE the early returns below so the hook count is stable across
  // loading→loaded transitions (React #310 otherwise).
  const dateGroups = useMemo(() => {
    const groups: { label: string; items: HistoryItem[]; themeGroups: { label: string; items: HistoryItem[] }[] }[] = [];
    for (const it of filtered) {
      const label = dateLabel(it.date);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(it);
      else groups.push({ label, items: [it], themeGroups: [] });
    }
    for (const g of groups) {
      const map = new Map<string, HistoryItem[]>();
      for (const it of g.items) {
        const label = it.sel === "mix" ? "All themes" : it.sel ? prettify(it.sel) : prettify(primaryTheme(it.themes));
        if (!map.has(label)) map.set(label, []);
        map.get(label)!.push(it);
      }
      g.themeGroups = [...map.entries()]
        .map(([label, items]) => ({ label, items }))
        .sort((a, b) => b.items.length - a.items.length);
    }
    return groups;
  }, [filtered]);

  if (tab === "external") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl text-white">Puzzle report</h1>
          <p className="text-sm text-ink-400">Puzzles + imported games from Lichess & Chess.com.</p>
        </div>
        <TabBar active="external" onSwitch={switchTab} />
        <ExternalGamesList />
      </div>
    );
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
  // When admin views another user via ?as=<u>, show THAT user's rating (from
  // the server's viewedRating snapshot), not the admin's own rating.
  const shownRating = data.viewedAs ? (data.viewedRating ?? "—") : (rating ?? "—");
  const stats = [
    { label: "Attempted", value: t.attempted },
    { label: "Solved", value: t.solved, tone: "text-accent-400" },
    { label: "Missed", value: t.failed, tone: "text-rose-400" },
    { label: "Win rate", value: `${t.winRate}%` },
    { label: "Rating", value: shownRating },
  ];

  return (
    <div className="space-y-6">
      {data.viewedAs && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl2 border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
          <span>👀 Viewing <b>{data.viewedAs}</b>'s history</span>
          <Link to="/history" className="ml-auto underline hover:text-white">← view mine</Link>
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl text-white">Puzzle report</h1>
          <p className="text-sm text-ink-400">Green = solved, red = missed. Grouped by day and theme.</p>
        </div>
        {/* CSV export — coach's own history (or ?as= view). Kept as a raw <a>
            so the browser's Save-As dialog / download bar takes over cleanly. */}
        {allItems.length > 0 && (() => {
          const params = new URLSearchParams(window.location.search);
          const asParam = params.get("as");
          const href = `/api/me/history.csv${asParam ? `?as=${encodeURIComponent(asParam)}` : ""}`;
          return (
            <a href={href}
               className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-100 hover:bg-brand-500/20"
               title="Download every round as CSV">
              ⬇ CSV
            </a>
          );
        })()}
      </div>
      <TabBar active="puzzles" onSwitch={switchTab} />

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
            <div className={`text-2xl font-bold ${s.tone ?? "text-white"}`}>{s.value}</div>
            <div className="text-xs font-medium text-ink-400">{s.label}</div>
          </div>
        ))}
      </div>

      {allItems.length > 0 && <WeekStrip items={allItems} />}

      {(data.byTheme?.length ?? 0) > 0 && (
        <ClassificationPanel
          byTheme={data.byTheme!}
          byBand={data.byBand ?? []}
          onPickTheme={setTheme}
          activeTheme={theme}
        />
      )}

      {allItems.length > 0 && (
        <FilterBar result={result} setResult={setResult} theme={theme} setTheme={setTheme}
          range={range} setRange={setRange}
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
                {g.themeGroups.map((tg) => (
                  <div key={tg.label}>
                    <h3 className="mb-2 text-sm font-semibold text-ink-300">
                      {tg.label} <span className="font-normal text-ink-500">· {tg.items.length}</span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
