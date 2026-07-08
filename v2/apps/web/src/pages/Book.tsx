import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key, Color } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";

// CL-9155: "Book" tab — a scanned tactics book rendered like a book, with each
// puzzle clickable into a playable board (the shared ChessGuru chessground board).
// Pilot data = 2000 Tactical Chess Part 4 (Endings), book p.8 (6 pawn-ending
// puzzles), hand-extracted + Stockfish 18 validated. Page images in public/bookimg/.
// Engine lines / Maia notes are baked (the live tab will call the engine API).
// See PROJECT_MASTER/knowledge/11-book-tab-and-engines.md.

const BASE = import.meta.env.BASE_URL; // "/" or "/v2/"

type Puz = {
  n: number; fen: string; side: "w" | "b"; diff: string;
  bb: [number, number, number, number]; sol: string[];
  sf: string; maia: string; idea: string; note: string;
};
const PUZZLES: Record<number, Puz[]> = {
  9: [
    { n: 1, fen: "7k/5P2/8/5K2/8/8/8/8 w - - 0 1", side: "w", diff: "Cadet · #3", bb: [15.6, 12.6, 31.4, 21.8],
      sol: ["f5f6", "h8h7", "f7f8r", "h7h6", "f8h8"], sf: "Mate in 3", maia: "f8=Q",
      idea: "Mate in 3 — but the natural 2.f8=Q is stalemate! March the king up and underpromote: 1.Kf6 Kh7 2.f8=R! Kh6 3.Rh8#.",
      note: "Every Maia level (1100/1500/1900) plays f8=Q — into the stalemate trap, missing the rook underpromotion." },
    { n: 2, fen: "8/ppp5/8/PPP5/3k4/8/8/7K w - - 0 1", side: "w", diff: "Cadet", bb: [59.6, 12.6, 31.2, 21.8],
      sol: ["b5b6", "a7b6", "c5c6", "b7c6", "a5a6", "c6c5", "a6a7", "b6b5", "a7a8q"], sf: "+4.8 (winning)", maia: "c6",
      idea: "The breakthrough: 1.b6! axb6 2.c6! bxc6 3.a6 and the outside pawn queens — the king on d4 is too far.",
      note: "Maia plays 1.c6 first — but only 1.b6! cracks the wall." },
    { n: 3, fen: "5k2/5P2/4K3/7p/8/6P1/8/8 w - - 0 1", side: "w", diff: "Cadet", bb: [15.5, 39.4, 31.4, 21.8],
      sol: ["e6f6", "h5h4", "g3g4", "h4h3", "g4g5", "h3h2", "g5g6", "h2h1b", "g6g7"], sf: "Mate in 5", maia: "Kf6",
      idea: "Two fronts: the king escorts f7 home (1.Kf6) while g4-g5-g6 outruns Black's h-pawn; White queens first.",
      note: "Maia finds 1.Kf6 — human instinct is correct here. ✓" },
    { n: 4, fen: "k7/2P5/1p6/K7/8/8/8/8 w - - 0 1", side: "w", diff: "Cadet", bb: [59.5, 39.4, 31.3, 21.8],
      sol: ["a5a6", "b6b5", "c7c8q"], sf: "Mate in 2", maia: "Kb6",
      idea: "King first! 1.Ka6 removes the escape squares, then 1…b5 2.c8=Q#. (1.c8=Q+? only checks.)",
      note: "Maia plays 1.Kb6 — the wrong king square; the mate needs 1.Ka6." },
    { n: 5, fen: "8/8/4p3/3kp1p1/7P/3K1P2/8/8 b - - 0 1", side: "b", diff: "Cadet · Black to move", bb: [15.5, 66.2, 31.4, 21.8],
      sol: ["g5h4", "d3d2", "h4h3", "d2c3", "h3h2", "c3b4", "h2h1q"], sf: "Black wins (+11)", maia: "…gxh4",
      idea: "Black to move and win: 1…gxh4 and the h-pawn runs, escorted by the active king.",
      note: "Maia matches — the capture is the natural move. ✓" },
    { n: 6, fen: "8/5p2/5p2/8/8/3P1k2/P7/5K2 w - - 0 1", side: "w", diff: "Cadet", bb: [59.5, 66.2, 31.4, 21.8],
      sol: ["a2a4", "f3e3", "a4a5", "f6f5", "a5a6", "f5f4", "a6a7", "f4f3", "a7a8q"], sf: "+5.5 (winning)", maia: "a4",
      idea: "The outside passer decides: 1.a4! and the a-pawn queens while Black's king is stuck on the kingside.",
      note: "Maia finds 1.a4 — correct. ✓" },
  ],
};
// CL-9156 v3: PRECOMPUTED calibrated difficulty rating. A gradient-boosted model trained
// on ChessGuru's 5.88M real-rated puzzles (features = Stockfish eval/only-move + Maia
// 1100/1300/1500/1700/1900 policy probability + strong Leela policy) — held-out MAE 256 Elo
// / R² 0.75, vs the old heuristic's 419. `profile` = Maia policy % for the key move per band
// ("how likely each rating level plays it"). Scored offline by book-engine/score_book.py.
const RATINGS: Record<number, { rating: number; band: string; profile: Record<number, number>; maiaSolved: number[] }> = {
  1: { rating: 2095, band: "Expert", profile: { 1100: 23.0, 1300: 12.3, 1500: 15.5, 1700: 18.0, 1900: 15.1 }, maiaSolved: [] },
  2: { rating: 2564, band: "Expert", profile: { 1100: 22.7, 1300: 33.2, 1500: 32.7, 1700: 43.5, 1900: 37.0 }, maiaSolved: [] },
  3: { rating: 2471, band: "Expert", profile: { 1100: 65.3, 1300: 62.4, 1500: 64.0, 1700: 76.2, 1900: 84.0 }, maiaSolved: [] },
  4: { rating: 1948, band: "Advanced", profile: { 1100: 10.6, 1300: 5.6, 1500: 4.8, 1700: 7.2, 1900: 11.9 }, maiaSolved: [] },
  5: { rating: 1511, band: "Club", profile: { 1100: 83.8, 1300: 90.0, 1500: 93.6, 1700: 93.7, 1900: 97.6 }, maiaSolved: [1100, 1300, 1500, 1700, 1900] },
  6: { rating: 1314, band: "Club", profile: { 1100: 51.0, 1300: 62.5, 1500: 57.1, 1700: 72.9, 1900: 65.5 }, maiaSolved: [1100, 1300, 1500, 1700, 1900] },
};
const BANDS = [1100, 1300, 1500, 1700, 1900];
const uci = (m: string) => ({ from: m.slice(0, 2) as Key, to: m.slice(2, 4) as Key, promotion: m.length > 4 ? m[4] : undefined });

export default function BookPage() {
  const [page, setPage] = useState(9);
  const [cur, setCur] = useState<Puz | null>(null);
  const game = useRef(new Chess());
  const [ply, setPly] = useState(0);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const [fb, setFb] = useState<{ t: string; k: string }>({ t: "Your move.", k: "" });
  const [, force] = useState(0);
  const rerender = () => force((x) => x + 1);
  const solving = useRef(false);

  // CL-9155: live engine analysis (Stockfish 18 + Lc0/Maia) via the isolated
  // /book-engine microservice. Off by default so it doesn't spoil the puzzle.
  const [showAn, setShowAn] = useState(false);
  const [an, setAn] = useState<{ sf: { move: string | null; score: { type: string; val: number } | null }; maia: { move: string | null; level: number } } | null>(null);
  useEffect(() => {
    if (!cur || !showAn) { setAn(null); return; }
    const fen = game.current.fen(); let cancelled = false; setAn(null);
    fetch(`/book-engine/analyze?fen=${encodeURIComponent(fen)}`).then((r) => r.json()).then((d) => { if (!cancelled) setAn(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [cur, ply, showAn]); // eslint-disable-line
  const shapes = useMemo(() => {
    if (!showAn || !an) return [] as { orig: Key; dest: Key; brush: string }[];
    const out: { orig: Key; dest: Key; brush: string }[] = [];
    if (an.sf?.move && an.sf.move.length >= 4) out.push({ orig: an.sf.move.slice(0, 2) as Key, dest: an.sf.move.slice(2, 4) as Key, brush: "green" });
    if (an.maia?.move && an.maia.move.length >= 4 && an.maia.move.slice(0, 4) !== an.sf?.move?.slice(0, 4)) out.push({ orig: an.maia.move.slice(0, 2) as Key, dest: an.maia.move.slice(2, 4) as Key, brush: "yellow" });
    return out;
  }, [showAn, an]);
  const evalStr = an?.sf?.score ? (an.sf.score.type === "mate" ? `M${an.sf.score.val}` : (an.sf.score.val / 100).toFixed(2)) : "";

  // CL-9156 v3: calibrated difficulty rating, precomputed by the trained model (see RATINGS).
  const rateData = cur ? RATINGS[cur.n] : undefined;
  const finalRating = rateData ? rateData.rating : null;
  const finalBand = rateData ? rateData.band : "";

  function start(p: Puz) {
    setCur(p); game.current = new Chess(p.fen); setPly(0); setLastMove(undefined); solving.current = false;
    setFb({ t: `Your move (${p.side === "w" ? "White" : "Black"}).`, k: "" }); rerender();
  }
  function lineSAN(toPly: number): string {
    if (!cur) return "";
    const g = new Chess(cur.fen); const out: string[] = [];
    for (let i = 0; i < toPly; i++) { const mv = cur.sol[i]!; try { out.push(g.move(uci(mv)).san); } catch { out.push(mv); } }
    let s = ""; for (let i = 0; i < out.length; i++) { if (i % 2 === 0) s += `${Math.floor(i / 2) + 1}. `; s += out[i] + " "; } return s.trim();
  }
  function handleMove(from: Key, to: Key) {
    if (!cur || solving.current) return;
    const exp = cur.sol[ply] || ""; const want = exp.slice(0, 4);
    if (from + to === want) {
      const promo = exp.length > 4 ? exp[4] : undefined;
      try { game.current.move({ from, to, promotion: promo as any }); } catch { rerender(); return; }
      setLastMove([from, to]); const np = ply + 1; setPly(np);
      setFb(promo && promo !== "q" ? { t: "Underpromotion! (avoids stalemate)", k: "good" } : { t: "✓ Correct!", k: "good" });
      rerender();
      if (np >= cur.sol.length) { setFb({ t: "✓ Solved! 🎉", k: "good" }); return; }
      solving.current = true;
      setTimeout(() => {
        const m = uci(cur.sol[np]!); try { game.current.move(m); } catch { /* */ }
        setLastMove([m.from, m.to]); const n2 = np + 1; setPly(n2); solving.current = false; rerender();
        if (n2 >= cur.sol.length) setFb({ t: "✓ Solved! 🎉", k: "good" });
      }, 480);
    } else {
      setFb({ t: "✗ Not the puzzle move — try again.", k: "bad" }); rerender(); // fen unchanged → board snaps back
    }
  }
  function showSolution() {
    if (!cur) return; game.current = new Chess(cur.fen); setPly(0); setLastMove(undefined); solving.current = true; rerender();
    let i = 0;
    const step = () => {
      if (!cur || i >= cur.sol.length) { solving.current = false; setFb({ t: "Solution shown.", k: "good" }); return; }
      const m = uci(cur.sol[i]!); try { game.current.move(m); } catch { /* */ }
      setLastMove([m.from, m.to]); setPly(i + 1); i++; rerender(); setTimeout(step, 560);
    };
    setTimeout(step, 300);
  }

  const solverColor: Color = cur?.side === "b" ? "black" : "white";
  const turnColor: Color = game.current.turn() === "w" ? "white" : "black";
  const myTurn = !!cur && !solving.current && turnColor === solverColor && ply < (cur?.sol.length || 0);

  return (
    <div>
      <h1 className="mb-1 font-display text-xl text-white">Book</h1>
      <p className="mb-4 text-sm text-ink-400">2000 Tactical Chess · Part 4: Chess Endings — preview (pp.1–10). Click a diagram on a puzzle page to play it.</p>

      {!cur ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white disabled:opacity-40">‹ Prev</button>
            <span className="text-sm text-ink-400">Page {page} / 10 (book p.{page - 1})</span>
            <button disabled={page >= 10} onClick={() => setPage(page + 1)} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white disabled:opacity-40">Next ›</button>
          </div>
          <div className="relative inline-block w-full max-w-xl">
            <img src={`${BASE}bookimg/p${page}.png`} alt={`book page ${page}`} className="w-full rounded-lg bg-white" />
            {(PUZZLES[page] || []).map((pz) => (
              <button key={pz.n} onClick={() => start(pz)} title={`Play puzzle #${pz.n}`}
                style={{ left: `${pz.bb[0]}%`, top: `${pz.bb[1]}%`, width: `${pz.bb[2]}%`, height: `${pz.bb[3]}%` }}
                className="group absolute rounded-md border-2 border-transparent transition hover:border-brand-500 hover:bg-brand-500/20">
                <span className="absolute left-1 top-1 rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white opacity-90">▶ #{pz.n}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {/* PINNED puzzle — stays on top while the book page scrolls under it */}
          <div className="sticky top-14 z-20 -mx-4 border-b border-ink-700 bg-ink-900/95 px-4 py-2 backdrop-blur">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <button onClick={() => setCur(null)} className="text-brand-400 hover:text-brand-300">‹ Back to book</button>
              <span className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-ink-300">#{cur.n} · {cur.side === "w" ? "White" : "Black"} to move</span>
              <span className="rounded-full bg-brand-900/60 px-2 py-0.5 text-xs text-brand-200">{cur.diff}</span>
              <button onClick={() => start(cur)} className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:text-white">↺ Reset</button>
              <button onClick={showSolution} className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:text-white">Show solution</button>
              <button onClick={() => setShowAn((v) => !v)} className={`rounded-lg border px-2.5 py-1 text-xs ${showAn ? "border-emerald-500 text-emerald-300" : "border-ink-700 text-ink-300 hover:text-white"}`}>{showAn ? "Engine ✓" : "Engine ▷"}</button>
              <span className={`ml-auto font-semibold ${fb.k === "good" ? "text-emerald-400" : fb.k === "bad" ? "text-rose-400" : "text-ink-300"}`}>{fb.t}</span>
            </div>
            <div className="mx-auto w-full max-w-[300px]">
              <Board
                fen={game.current.fen()}
                orientation={solverColor}
                turnColor={turnColor}
                movableColor={myTurn ? solverColor : undefined}
                dests={myTurn ? destsFromChess(game.current) : new Map()}
                lastMove={lastMove}
                onMove={handleMove}
                shapes={shapes}
                className="mini"
              />
            </div>
            <p className="mt-1 text-center font-mono text-xs text-ink-300">{ply > 0 ? lineSAN(ply) : "— your move, or Show solution"}</p>
          </div>

          {/* SCROLLABLE below: the idea + the book page */}
          {/* Puzzle difficulty rating — calibrated model (Stockfish + Maia + Leela), precomputed */}
          <div className="mt-4 rounded-xl border border-brand-700/60 bg-brand-900/20 p-4 text-sm">
            <div className="flex items-baseline gap-3">
              <span className="text-ink-400">Difficulty rating</span>
              <span className="text-2xl font-bold text-white">{finalRating ?? "…"}</span>
              {finalRating != null && <span className="rounded-full bg-brand-700/60 px-2 py-0.5 text-xs text-brand-100">{finalBand}</span>}
            </div>
            {rateData && (
              <>
                <p className="mb-1 mt-3 text-xs text-ink-400">Chance a player at each level plays the key move:</p>
                <div className="flex items-end gap-2">
                  {BANDS.map((b) => {
                    const pct = rateData.profile[b] ?? 0;
                    return (
                      <div key={b} className="flex flex-1 flex-col items-center">
                        <span className="mb-0.5 text-[10px] text-ink-400">{Math.round(pct)}%</span>
                        <div className="flex h-14 w-full items-end rounded bg-ink-800/70">
                          <div className="w-full rounded bg-brand-500" style={{ height: `${Math.max(3, Math.min(100, pct))}%` }} />
                        </div>
                        <span className="mt-1 text-[10px] text-ink-300">{b}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-ink-400">
                  {rateData.maiaSolved.length
                    ? <>Human levels that find the whole line: <b className="text-ink-200">{rateData.maiaSolved.join(", ")}</b>.</>
                    : <>No human level (1100–1900) reliably finds the full line — counter‑intuitive.</>}
                  <span className="text-ink-500"> Model: GBM trained on 5.88M rated puzzles (±256 Elo).</span>
                </p>
              </>
            )}
          </div>
          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-800/60 p-4 text-sm">
            <p className="mb-2 text-ink-200"><span className="text-ink-400">Idea — </span>{cur.idea}</p>
            <p className="mb-1 text-sky-300"><span className="text-ink-400">Best (Stockfish 18) — </span>{cur.sf}</p>
            <p className="text-amber-300"><span className="text-ink-400">Human (Maia) — </span>plays {cur.maia}. <span className="text-ink-400">{cur.note}</span></p>
            {showAn && (
              <p className="mt-2 border-t border-ink-700 pt-2 text-emerald-300"><span className="text-ink-400">Live engine — </span>
                Stockfish: <b>{an?.sf?.move ?? "…"}</b>{evalStr && ` (${evalStr})`} · Leela/Maia‑1500: <b>{an?.maia?.move ?? "…"}</b>
                <span className="text-ink-500"> — green arrow = best, yellow = likely human</span></p>
            )}
          </div>
          <p className="mb-2 mt-4 text-xs text-ink-500">Book page — scroll to read; click any other diagram to switch (the pinned board above updates instantly):</p>
          <div className="relative mx-auto w-full max-w-xl">
            <img src={`${BASE}bookimg/p${page}.png`} alt="book page" className="w-full rounded-lg bg-white" />
            {(PUZZLES[page] || []).map((pz) => (
              <button key={pz.n} onClick={() => start(pz)} title={`Play puzzle #${pz.n}`}
                style={{ left: `${pz.bb[0]}%`, top: `${pz.bb[1]}%`, width: `${pz.bb[2]}%`, height: `${pz.bb[3]}%` }}
                className={`group absolute rounded-md border-2 transition ${cur.n === pz.n ? "border-brand-500 bg-brand-500/10" : "border-transparent hover:border-brand-500 hover:bg-brand-500/20"}`}>
                <span className="absolute left-1 top-1 rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white opacity-90">▶ #{pz.n}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
