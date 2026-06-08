import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "./Board";
import { api, type HistoryItem } from "../lib/api";

/**
 * Today's solved puzzles as a scrollable strip of mini-board thumbnails, below
 * the board. Green ring = first solve succeeded, red = first attempt failed
 * (rating dropped). Tap a box to review that puzzle (with the ◀ ▶ replay).
 * Data is the persistent /api/me/history (server-side), filtered to today.
 */
function isToday(d: string): boolean {
  return new Date(d).toDateString() === new Date().toDateString();
}

function Mini({ it, onClick }: { it: HistoryItem; onClick: () => void }) {
  const lm = it.lastMove ? ([it.lastMove.slice(0, 2), it.lastMove.slice(2, 4)] as [Key, Key]) : undefined;
  const title = `#${it.id} · ${it.win ? "solved" : "missed"}${it.ratingDiff != null ? ` · ${it.ratingDiff >= 0 ? "+" : ""}${it.ratingDiff}` : ""}`;
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ width: 56 }}
      className={`shrink-0 overflow-hidden rounded-md border-2 transition hover:opacity-80 ${it.win ? "border-accent-500" : "border-rose-500"}`}
    >
      {it.fen
        ? <Board fen={it.fen} orientation={it.orientation} lastMove={lm} viewOnly coordinates={false} className="mini" />
        : <div className="aspect-square w-full bg-ink-800" />}
    </button>
  );
}

export default function SolvedStrip({ onSelect }: { onSelect: (id: string) => void }) {
  const { data } = useQuery({ queryKey: ["me-history"], queryFn: api.history });
  const scroller = useRef<HTMLDivElement>(null);

  // Oldest → newest so new solves append on the right (timeline feel).
  const todays = (data?.items ?? []).filter((it) => isToday(it.date)).slice().reverse();

  // Keep the newest box in view as the strip grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [todays.length]);

  if (!data?.loggedIn || todays.length === 0) return null;

  return (
    <div className="min-w-0 rounded-xl2 border border-ink-700 bg-ink-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Today · {todays.length} solved</span>
        <span className="text-[11px] text-ink-500">tap to review</span>
      </div>
      <div ref={scroller} className="flex gap-2 overflow-x-auto pb-1">
        {todays.map((it) => <Mini key={it.id + it.date} it={it} onClick={() => onSelect(it.id)} />)}
      </div>
    </div>
  );
}
