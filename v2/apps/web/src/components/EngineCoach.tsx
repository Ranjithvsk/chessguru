// Memory Master 500 — S5 Engine Coach panel.
//
// Given a FEN and (optionally) the "declared move" the theory recommends,
// runs client Stockfish for ~800ms and renders a verdict:
//   - engine eval bar (white-perspective centipawns or mate)
//   - engine's top move as SAN
//   - PV as SAN (first 3 plies)
//   - Verdict: matches theory ✓ / engine prefers X (+N cp)
//
// Engine is created on first click and reused for the component's lifetime,
// then terminated on unmount. No round-trips — WASM Stockfish runs in a
// Web Worker.

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { createEngine, formatEval, toWhiteCp, toWhiteMate, type Analysis, type Engine } from "../lib/engine";

export interface EngineCoachProps {
  fen: string;
  /** Theory move SAN at this position (e.g. mainline move). If provided,
   *  verdict compares engine's top move vs this. */
  declaredSan?: string;
  /** Optional CTA label. Defaults to "Ask engine". */
  ctaLabel?: string;
}

export default function EngineCoach({ fen, declaredSan, ctaLabel = "Ask engine" }: EngineCoachProps) {
  const engineRef = useRef<Engine | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "analysing" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    a: Analysis;
    bestSan: string;
    pvSan: string[];
    sideToMove: "w" | "b";
    declaredIsBest: boolean | null;
    cpLossVsDeclared: number | null;
  } | null>(null);

  useEffect(() => {
    // Reset panel whenever position changes.
    setState("idle");
    setResult(null);
    setErr(null);
  }, [fen]);

  useEffect(() => () => { engineRef.current?.quit(); }, []);

  const run = async () => {
    setErr(null); setState("loading"); setResult(null);
    try {
      if (!engineRef.current) engineRef.current = createEngine();
      await engineRef.current.ready;
      setState("analysing");
      const a = await engineRef.current.analyse(fen, 800);

      const g = new Chess(fen);
      const sideToMove = g.turn();
      let bestSan = "?";
      try {
        const m = g.move({ from: a.bestUci.slice(0, 2), to: a.bestUci.slice(2, 4), promotion: a.bestUci[4] });
        if (m) bestSan = m.san;
      } catch { /* leave as ? */ }

      // Reconstruct PV as SAN (first 3 plies of PV).
      const pvSan: string[] = [];
      const pvG = new Chess(fen);
      for (const uci of a.pvUci.slice(0, 5)) {
        try {
          const m = pvG.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
          if (!m) break;
          pvSan.push(m.san);
        } catch { break; }
      }

      // Verdict: does the declared move match engine's best? If not, replay
      // declared move and re-eval (approx via bestUci cp shift, since we'd
      // need a second analyse call for a precise loss — MVP skips that).
      let declaredIsBest: boolean | null = null;
      let cpLossVsDeclared: number | null = null;
      if (declaredSan) {
        // Replay the declared move on a fresh chess.js and check whether it
        // equals bestSan.
        try {
          const t = new Chess(fen);
          const declaredMv = t.move(declaredSan);
          declaredIsBest = declaredMv?.san === bestSan;
        } catch { declaredIsBest = null; }
      }

      setResult({ a, bestSan, pvSan, sideToMove, declaredIsBest, cpLossVsDeclared });
      setState("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg); setState("error");
    }
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Engine coach</div>
        {result && (
          <div className="text-[10px] text-sky-600">depth {result.a.depth} · Stockfish 16</div>
        )}
      </div>

      {state === "idle" && (
        <button onClick={run}
          className="w-full rounded-lg bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-700">
          🤖 {ctaLabel}
        </button>
      )}
      {state === "loading" && (
        <div className="py-2 text-center text-xs text-sky-700">Loading engine…</div>
      )}
      {state === "analysing" && (
        <div className="py-2 text-center text-xs text-sky-700">Analysing (~1s)…</div>
      )}
      {state === "error" && (
        <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
          Engine unavailable: {err ?? "unknown"}. Try again.
        </div>
      )}
      {state === "done" && result && (
        <div className="space-y-2">
          <EvalStrip a={result.a} sideToMove={result.sideToMove} />

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-ink-900 p-2">
              <div className="text-[9px] font-bold uppercase text-sky-700">Engine's move</div>
              <div className="mt-0.5 font-mono text-base font-bold text-sky-900">{result.bestSan}</div>
              {result.pvSan.length > 1 && (
                <div className="mt-1 font-mono text-[10px] text-sky-600">
                  → {result.pvSan.slice(1, 4).join(" ")}
                </div>
              )}
            </div>
            {declaredSan && (
              <div className="rounded bg-ink-900 p-2">
                <div className="text-[9px] font-bold uppercase text-sky-700">Theory move</div>
                <div className="mt-0.5 font-mono text-base font-bold text-sky-900">{declaredSan}</div>
                <div className="mt-1 text-[10px]">
                  {result.declaredIsBest === true && (
                    <span className="font-bold text-emerald-700">✓ engine top move</span>
                  )}
                  {result.declaredIsBest === false && (
                    <span className="font-bold text-amber-700">≠ engine prefers {result.bestSan}</span>
                  )}
                  {result.declaredIsBest == null && (
                    <span className="text-ink-500">could not compare</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <button onClick={run}
            className="w-full rounded-lg bg-sky-100 py-1.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-200">
            re-analyse (deeper)
          </button>
        </div>
      )}
    </div>
  );
}

function EvalStrip({ a, sideToMove }: { a: Analysis; sideToMove: "w" | "b" }) {
  const whiteCp = toWhiteCp(a, sideToMove);
  const whiteMate = toWhiteMate(a, sideToMove);
  const label = formatEval(whiteCp, whiteMate);
  // Clamp bar to ±5 pawns for the visual meter.
  const clamped = whiteMate != null ? (whiteMate > 0 ? 1 : -1) : Math.max(-1, Math.min(1, (whiteCp ?? 0) / 500));
  const whitePct = 50 + clamped * 45;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] text-sky-800">
        <span className="font-bold">Eval (white)</span>
        <span className="font-mono font-bold">{label}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full bg-white transition-all" style={{ width: `${whitePct}%` }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-ink-600/70" />
      </div>
    </div>
  );
}
