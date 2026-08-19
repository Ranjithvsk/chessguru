// Extracted from pages/Opening.tsx so the Explorer can be embedded inline on
// the Openings hub (/openings) instead of hiding behind a card that opens a
// separate page (owner ask 2026-08-19: "show opening explorer open in
// opening, not in a box").
//
// The standalone route /opening still uses this component — it just wraps it
// in a page layout.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "./Board";
import { useFreePlay } from "../hooks/useFreePlay";
import { fetchExplorer } from "../lib/explorer";
import { OPENING_HANDOFF_KEY } from "../lib/openingMemory";

function WdlBar({ w, d, b, className = "" }: { w: number; d: number; b: number; className?: string }) {
  const t = w + d + b || 1;
  const pct = (n: number) => `${(n / t) * 100}%`;
  return (
    <div className={`flex h-full w-full overflow-hidden rounded-[3px] ${className}`} title={`+${w} =${d} -${b}`}>
      <div style={{ width: pct(w) }} className="bg-[#e8e8e8]" />
      <div style={{ width: pct(d) }} className="bg-[#6b7280]" />
      <div style={{ width: pct(b) }} className="bg-[#15181f]" />
    </div>
  );
}

export default function OpeningExplorer() {
  const fp = useFreePlay();
  const navigate = useNavigate();
  const { data, isFetching, isError } = useQuery({
    queryKey: ["explorer", fp.fen],
    queryFn: () => fetchExplorer(fp.fen, "masters"),
  });

  const [opening, setOpening] = useState<{ eco: string; name: string } | null>(null);
  useEffect(() => { if (data?.opening) setOpening(data.opening); }, [data?.opening]);
  useEffect(() => { if (fp.fen.startsWith("rnbqkbnr/pppppppp")) setOpening(null); }, [fp.fen]);

  const memorize = () => {
    if (!fp.history.length) return;
    const name = opening ? `${opening.eco} ${opening.name}` : "Explored line";
    try { sessionStorage.setItem(OPENING_HANDOFF_KEY, JSON.stringify({ name, sans: fp.history })); } catch { /* */ }
    navigate("/study/opening-memory");
  };

  const total = data ? data.white + data.draws + data.black : 0;
  const playUci = (uci: string) => fp.onMove(uci.slice(0, 2) as Key, uci.slice(2, 4) as Key);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section>
        <Board fen={fp.fen} orientation={fp.orientation} turnColor={fp.turnColor}
          movableColor="both" dests={fp.dests} onMove={fp.onMove} />
        <div className="mt-3 flex gap-2">
          <button onClick={fp.undo} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">◀ Undo</button>
          <button onClick={fp.reset} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reset</button>
          <button onClick={fp.flip} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">⇅ Flip</button>
          <button onClick={memorize} disabled={!fp.history.length}
            className="ml-auto rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-40"
            title="Send this line to the Memory Training opening trainer">🧠 Memorize</button>
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-xl text-white">Opening explorer</h2>
            <span className="rounded-md border border-ink-700 px-2 py-0.5 text-xs text-ink-400">Masters</span>
          </div>

          {opening && (
            <p className="mb-3 text-sm">
              <span className="font-mono text-ink-400">{opening.eco}</span>{" "}
              <span className="text-brand-300">{opening.name}</span>
            </p>
          )}

          {total > 0 && (
            <div className="mb-1 flex items-center gap-2">
              <div className="h-3 flex-1"><WdlBar w={data!.white} d={data!.draws} b={data!.black} /></div>
              <span className="w-20 text-right text-xs text-ink-400">{total.toLocaleString()} games</span>
            </div>
          )}
          <div className="mb-3 flex justify-between text-[11px] text-ink-500">
            <span>White {total ? Math.round((data!.white / total) * 100) : 0}%</span>
            <span>Draw {total ? Math.round((data!.draws / total) * 100) : 0}%</span>
            <span>Black {total ? Math.round((data!.black / total) * 100) : 0}%</span>
          </div>

          {isFetching && <p className="text-sm text-ink-400">Loading…</p>}
          {isError && <p className="text-sm text-rose-400">Explorer unavailable.</p>}

          <div className="max-h-[440px] divide-y divide-ink-800/70 overflow-y-auto">
            {(data?.moves ?? []).map((m) => {
              const t = m.white + m.draws + m.black;
              return (
                <button key={m.uci} onClick={() => playUci(m.uci)}
                  className="grid w-full grid-cols-[3rem_4.5rem_1fr] items-center gap-3 px-1 py-2 text-left hover:bg-ink-800">
                  <span className="font-semibold text-white">{m.san}</span>
                  <span className="text-xs text-ink-400">
                    {t.toLocaleString()}
                    <span className="ml-1 text-ink-500">{total ? Math.round((t / total) * 100) : 0}%</span>
                  </span>
                  <span className="h-3.5"><WdlBar w={m.white} d={m.draws} b={m.black} /></span>
                </button>
              );
            })}
            {data && data.moves.length === 0 && (
              <p className="py-3 text-sm text-ink-400">No master games from this position yet.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
