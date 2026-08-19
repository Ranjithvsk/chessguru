// Extracted from pages/Opening.tsx so the Explorer can be embedded inline on
// the Openings hub (/openings) instead of hiding behind a card that opens a
// separate page (owner ask 2026-08-19: "show opening explorer open in
// opening, not in a box").
//
// The standalone route /opening still uses this component — it just wraps it
// in a page layout.

import { useCallback, useEffect, useState } from "react";
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

/** Optional prop lets the Openings hub share ONE freeplay state between the
 *  Explorer and the Family/Opening/Variation drilldown — picking a variation
 *  updates the board here without a second useFreePlay instance.
 *  `asideExtra` renders ABOVE the masters table (used by the hub to slot the
 *  name drilldown into the right rail so the board stays Lichess-analysis-big). */
export default function OpeningExplorer(
  { fp: externalFp, asideExtra }: { fp?: ReturnType<typeof useFreePlay>; asideExtra?: React.ReactNode } = {},
) {
  const ownFp = useFreePlay();
  const fp = externalFp ?? ownFp;
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

  // Left/Right arrow keys navigate the move list — matches Lichess analysis.
  // Ignored while an input/textarea has focus so typing in the finder search
  // doesn't accidentally scrub the board.
  const onKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); fp.goPrev(); }
    if (e.key === "ArrowRight") { e.preventDefault(); fp.goNext(); }
    if (e.key === "Home") { e.preventDefault(); fp.goTo(0); }
    if (e.key === "End")  { e.preventDefault(); fp.goTo(fp.line.length); }
  }, [fp]);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section>
        <Board fen={fp.fen} orientation={fp.orientation} turnColor={fp.turnColor}
          movableColor="both" dests={fp.dests} onMove={fp.onMove} />
        {/* Nav row: ⏮ start · ◀ prev · ▶ next · ⏭ end · Reset · Flip · Memorize.
            Prev/Next are enabled only when there's somewhere to go on the
            recorded line (Lichess analysis semantics — rewinding doesn't
            discard the future). */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => fp.goTo(0)} disabled={fp.ply === 0}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Jump to start">⏮</button>
          <button onClick={fp.goPrev} disabled={fp.ply === 0}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Previous move (←)">◀</button>
          <button onClick={fp.goNext} disabled={fp.ply >= fp.line.length}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Next move (→)">▶</button>
          <button onClick={() => fp.goTo(fp.line.length)} disabled={fp.ply >= fp.line.length}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40"
            title="Jump to end">⏭</button>
          <button onClick={fp.reset} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reset</button>
          <button onClick={fp.flip} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">⇅ Flip</button>
          <button onClick={memorize} disabled={!fp.line.length}
            className="ml-auto rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-40"
            title="Send this line to the Memory Training opening trainer">🧠 Memorize</button>
        </div>

        {/* Clickable PGN move list — each SAN button jumps the board to that
            ply (Lichess analysis /analysis/pgn/... behaviour). The current
            ply is highlighted; playing a new move while rewound branches
            (see useFreePlay.onMove). Owner ask 2026-08-19. */}
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Moves</div>
          {fp.line.length === 0 ? (
            <div className="font-mono text-xs text-ink-500">Play a move on the board to start the line…</div>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono text-sm">
              {Array.from({ length: Math.ceil(fp.line.length / 2) }).map((_, i) => {
                const wIdx = i * 2, bIdx = i * 2 + 1;
                const w = fp.line[wIdx], b = fp.line[bIdx];
                const wActive = fp.ply === wIdx + 1;
                const bActive = fp.ply === bIdx + 1;
                return (
                  <span key={i} className="whitespace-nowrap">
                    <span className="text-ink-500">{i + 1}.</span>{" "}
                    {w && (
                      <button onClick={() => fp.goTo(wIdx + 1)}
                        className={`rounded px-1 ${wActive ? "bg-brand-500/40 text-white" : "text-ink-100 hover:bg-ink-800"}`}>
                        {w}
                      </button>
                    )}
                    {b && (
                      <button onClick={() => fp.goTo(bIdx + 1)}
                        className={`rounded px-1 ${bActive ? "bg-brand-500/40 text-white" : "text-ink-100 hover:bg-ink-800"}`}>
                        {b}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        {/* Explorer moves table on top, then the "Find an opening" tree
            (asideExtra). Halved max-height on the moves table so both fit
            side-by-side without either scrolling for pages. Owner ask
            2026-08-19: "half size, opening explorer on top". */}
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

          <div className="max-h-[220px] divide-y divide-ink-800/70 overflow-y-auto">
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
        {asideExtra}
      </aside>
    </div>
  );
}
