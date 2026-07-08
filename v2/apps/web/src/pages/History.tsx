import { useEffect, useRef, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { api, type HistoryItem } from "../lib/api";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };

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

/** Mini board, mounted only when scrolled into view; green ring = solved, red = missed. */
function LazyMini({ it }: { it: HistoryItem }) {
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
  return (
    <div ref={ref} className={`overflow-hidden rounded-md border-2 ${it.win ? "border-accent-500" : "border-rose-500"}`}>
      {show && it.fen
        ? <Board fen={it.fen} orientation={it.orientation} lastMove={lm} viewOnly coordinates={false} className="mini" />
        : <div className="aspect-square w-full bg-ink-800" />}
    </div>
  );
}

export default function HistoryPage() {
  const { rating } = useOutletContext<Ctx>();
  const { data, isLoading } = useQuery({ queryKey: ["me-history"], queryFn: () => api.history(0) });
  const [pages, setPages] = useState<HistoryItem[]>([]);   // appended pages beyond the first
  const [off, setOff] = useState<number | null>(null);      // next offset to fetch (null = none)
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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
  // date groups (items are newest-first, so same-day items are contiguous)
  const dateGroups: { label: string; items: HistoryItem[] }[] = [];
  for (const it of allItems) {
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

      {t.attempted === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center text-ink-400">
          No solved puzzles yet — <Link to="/" className="text-brand-400 hover:underline">solve your first puzzle</Link> and it’ll show up here.
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
                      {tg.items.map((it) => <LazyMini key={it.id + it.date} it={it} />)}
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
