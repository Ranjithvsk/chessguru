import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { useFreePlay } from "../hooks/useFreePlay";
import { fetchExplorer } from "../lib/explorer";

export default function OpeningPage() {
  const fp = useFreePlay();
  const [source, setSource] = useState<"lichess" | "masters">("lichess");
  const { data, isFetching, isError } = useQuery({
    queryKey: ["explorer", fp.fen, source],
    queryFn: () => fetchExplorer(fp.fen, source),
  });

  const total = data ? data.white + data.draws + data.black : 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  // play a move from the explorer table
  const playUci = (uci: string) => fp.onMove(uci.slice(0, 2) as Key, uci.slice(2, 4) as Key);
  useEffect(() => { /* refetch handled by query key */ }, [fp.fen]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        <Board fen={fp.fen} orientation={fp.orientation} turnColor={fp.turnColor}
          movableColor="both" dests={fp.dests} onMove={fp.onMove} />
        <div className="mt-3 flex gap-2">
          <button onClick={fp.undo} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">◀ Undo</button>
          <button onClick={fp.reset} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reset</button>
          <button onClick={fp.flip} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">⇅ Flip</button>
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h1 className="font-display text-xl text-white">Opening explorer</h1>
            <div className="flex rounded-lg border border-ink-700 p-0.5 text-xs">
              {(["lichess", "masters"] as const).map((s) => (
                <button key={s} onClick={() => setSource(s)}
                  className={`rounded-md px-2.5 py-1 capitalize ${source === s ? "bg-brand-600 text-white" : "text-ink-400"}`}>{s}</button>
              ))}
            </div>
          </div>
          {data?.opening && <p className="mb-2 text-sm text-brand-300">{data.opening.eco} · {data.opening.name}</p>}
          {/* win-rate bar */}
          {total > 0 && (
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full">
              <div style={{ width: `${pct(data!.white)}%` }} className="bg-ink-300" />
              <div style={{ width: `${pct(data!.draws)}%` }} className="bg-ink-500" />
              <div style={{ width: `${pct(data!.black)}%` }} className="bg-ink-800" />
            </div>
          )}
          {isFetching && <p className="text-sm text-ink-400">Loading…</p>}
          {isError && <p className="text-sm text-rose-400">Explorer unavailable.</p>}
          <div className="max-h-[420px] overflow-y-auto">
            {(data?.moves ?? []).map((m) => {
              const t = m.white + m.draws + m.black;
              return (
                <button key={m.uci} onClick={() => playUci(m.uci)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-800">
                  <span className="font-medium text-white">{m.san}</span>
                  <span className="text-ink-400">{t.toLocaleString()} games · {t ? Math.round((m.white / t) * 100) : 0}% W</span>
                </button>
              );
            })}
            {data && data.moves.length === 0 && <p className="text-sm text-ink-400">No more book moves.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
