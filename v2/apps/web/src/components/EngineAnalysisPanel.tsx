// Bottom-of-page engine analysis panel — enable toggle + top-3 lines with
// eval (+/- centipawns or "M#"). Uses the client-side Stockfish worker so
// there's no server round-trip; engine spins up on first enable and is
// re-analysed automatically every time the position changes.
//
// Owner ask 2026-08-18: "option to enable engine, in the bottom of the
// page, with 3 best suggested lines of moves, with the +- number points".
import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { createEngine, formatEval, toWhiteCp, toWhiteMate, type Analysis, type Engine } from "../lib/engine";

/** Convert a run of UCI moves to SAN, replayed on a copy of `fen`. Bails at
 *  the first illegal move so a truncated PV still shows what it can. */
function uciPvToSan(fen: string, uciList: string[], plies: number): string[] {
  const g = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciList.slice(0, plies)) {
    try {
      const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) || "q" });
      if (!m) break;
      out.push(m.san);
    } catch { break; }
  }
  return out;
}

export function EngineAnalysisPanel({ fen }: { fen: string }) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("cg.engine.enabled") === "1"; } catch { return false; }
  });
  const setEnable = (v: boolean) => {
    setEnabled(v);
    try { localStorage.setItem("cg.engine.enabled", v ? "1" : "0"); } catch { /* */ }
  };
  const engineRef = useRef<Engine | null>(null);
  const [lines, setLines] = useState<Analysis[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "analysing" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [depthMs, setDepthMs] = useState<number>(1200);

  // Re-analyse when position or enable/depth change. Analysis is debounced by
  // waiting for the previous engine.analyseMulti() to resolve before the next
  // fires (the worker sends one bestmove per go).
  useEffect(() => {
    if (!enabled || !fen) { setStatus("idle"); return; }
    let cancelled = false;
    (async () => {
      try {
        setStatus("loading"); setErr(null);
        if (!engineRef.current) engineRef.current = createEngine();
        await engineRef.current.ready;
        if (cancelled) return;
        setStatus("analysing");
        const arr = await engineRef.current.analyseMulti(fen, 3, depthMs);
        if (cancelled) return;
        setLines(arr);
        setStatus("done");
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, fen, depthMs]);

  useEffect(() => () => { engineRef.current?.quit(); engineRef.current = null; }, []);

  const sideToMove: "w" | "b" = fen.split(" ")[1] === "b" ? "b" : "w";

  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnable(e.target.checked)}
              className="h-4 w-4 accent-brand-500" />
            <span className="font-semibold">🤖 Engine analysis</span>
          </label>
          <span className="text-[11px] text-ink-500">Stockfish 16 · runs in your browser</span>
        </div>
        {enabled && (
          <div className="flex items-center gap-2 text-xs">
            <label className="text-ink-500">Depth:</label>
            <select value={depthMs} onChange={(e) => setDepthMs(Number(e.target.value))}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-white">
              <option value={600}>Fast (0.6s)</option>
              <option value={1200}>Balanced (1.2s)</option>
              <option value={3000}>Deep (3s)</option>
              <option value={8000}>Very deep (8s)</option>
            </select>
          </div>
        )}
      </div>

      {!enabled ? (
        <p className="text-xs text-ink-400">Turn on the checkbox to see Stockfish's top 3 lines with +/- evaluations at the current position. Engine runs in your browser — no data leaves this tab.</p>
      ) : status === "loading" ? (
        <div className="text-xs text-ink-400">Loading engine (first time only)…</div>
      ) : status === "error" ? (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          Engine unavailable: {err}. Refresh and try again.
        </div>
      ) : !lines ? (
        <div className="text-xs text-ink-400">Analysing…</div>
      ) : (
        <div className="space-y-1.5">
          {lines.map((line, i) => {
            const whiteCp = toWhiteCp(line, sideToMove);
            const whiteMate = toWhiteMate(line, sideToMove);
            const label = formatEval(whiteCp, whiteMate);
            const positive = whiteMate != null ? whiteMate > 0 : (whiteCp ?? 0) >= 0;
            const san = uciPvToSan(fen, line.pvUci, 8);
            return (
              <div key={i} className="flex items-baseline gap-3 rounded-lg bg-ink-800/60 px-3 py-2">
                <span className="w-5 shrink-0 text-center font-bold tabular-nums text-ink-400">{i + 1}</span>
                <span className={`w-14 shrink-0 text-right font-mono font-bold tabular-nums ${positive ? "text-emerald-300" : "text-rose-300"}`} title="Evaluation from white's perspective">
                  {label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-white" title={san.join(" ")}>
                  {san.length ? san.join(" ") : "—"}
                </span>
                <span className="shrink-0 text-[10px] text-ink-500 tabular-nums" title="Search depth reached">
                  d{line.depth}
                </span>
              </div>
            );
          })}
          {status === "analysing" && (
            <div className="text-center text-[11px] text-ink-500">re-analysing…</div>
          )}
        </div>
      )}
    </section>
  );
}
