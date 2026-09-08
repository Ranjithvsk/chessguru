// Two-column notation table — the same look as the Dream Meet class room's
// notation panel (ClassNotationPanel in ClassV2): move number gutter, white and
// black cells, the active ply as a brand pill, click any move to jump there.
// Presentational only: the owner keeps the cursor.
import { useEffect, useRef } from "react";

export interface MoveTableProps {
  sans: string[];
  /** 0 = start position, n = after n plies. */
  ply: number;
  onPick: (ply: number) => void;
  /** Optional think time per ply (ms) — rendered as a faint bar under the move. */
  moveTimes?: number[];
  className?: string;
}

const fmtSecs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`);

export default function MoveTable({ sans, ply, onPick, moveTimes, className = "" }: MoveTableProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [ply]);
  const maxTime = moveTimes && moveTimes.length ? Math.max(...moveTimes, 1) : 1;

  const cell = (i: number) => {
    const san = sans[i];
    if (san === undefined) return <div />;
    const active = ply === i + 1;
    const t = moveTimes?.[i];
    return (
      <button
        type="button"
        ref={active ? activeRef : undefined}
        onClick={() => onPick(i + 1)}
        title={t !== undefined ? `Thought for ${fmtSecs(t)}` : undefined}
        className={`group relative w-full rounded px-1.5 py-0.5 text-left font-mono text-sm transition ${active ? "bg-brand-500/60 text-white" : "text-ink-100 hover:bg-ink-800"}`}
      >
        {san}
        {t !== undefined && (
          <span className="absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-ink-800/80">
            <span className={`block h-full rounded-full ${i % 2 === 0 ? "bg-sky-400/70" : "bg-violet-400/70"}`} style={{ width: `${Math.max(4, (t / maxTime) * 100)}%` }} />
          </span>
        )}
      </button>
    );
  };

  if (!sans.length) {
    return <div className={`px-3 py-2 text-[11px] text-ink-500 ${className}`}>No moves were played in this game.</div>;
  }
  const rows = Math.ceil(sans.length / 2);
  return (
    <div className={`overflow-y-auto ${className}`} data-testid="move-table">
      <button
        type="button"
        onClick={() => onPick(0)}
        className={`mb-1 w-full rounded px-1.5 py-0.5 text-left text-[11px] uppercase tracking-wide ${ply === 0 ? "bg-brand-500/40 text-white" : "text-ink-500 hover:bg-ink-800"}`}
      >
        Start position
      </button>
      <div className="grid grid-cols-[2.25rem_1fr_1fr] gap-x-1 gap-y-0.5">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="contents">
            <div className="py-0.5 pr-1 text-right font-mono text-[11px] tabular-nums text-ink-500">{r + 1}.</div>
            {cell(r * 2)}
            {cell(r * 2 + 1)}
          </div>
        ))}
      </div>
    </div>
  );
}
