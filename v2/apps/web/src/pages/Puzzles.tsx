import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Difficulty } from "@chessguru/types";
import Board from "../components/Board";
import SolvedStrip from "../components/SolvedStrip";
import { api } from "../lib/api";
import { usePuzzleGame } from "../hooks/usePuzzleGame";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };
const DIFFS: Difficulty[] = ["easiest", "easier", "normal", "harder", "hardest"];

export default function PuzzlesPage() {
  const { userId, rating } = useOutletContext<Ctx>();
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("cg_theme") || "mix"; } catch { return "mix"; } });
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const { data: themes } = useQuery({ queryKey: ["themes"], queryFn: api.themes });

  const g = usePuzzleGame({ theme, difficulty, userId, initialRating: rating });
  const fbColor = { wait: "text-ink-300", good: "text-accent-400", bad: "text-rose-400", solved: "text-accent-400" }[g.fb.kind];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0">
        <Board
          fen={g.fen} orientation={g.orientation} turnColor={g.turnColor}
          movableColor={g.movableColor} dests={g.dests} lastMove={g.lastMove}
          shapes={g.hintShapes} onMove={g.onMove}
        />
        {g.solved && g.replayTotal > 0 && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button onClick={g.replayPrev} aria-label="Previous move"
              className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-lg text-ink-200 hover:bg-ink-700">◀</button>
            <span className="min-w-[3rem] text-center text-sm tabular-nums text-ink-300">{(g.replayPly ?? g.replayTotal)} / {g.replayTotal}</span>
            <button onClick={g.replayNext} aria-label="Next move"
              className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-lg text-ink-200 hover:bg-ink-700">▶</button>
          </div>
        )}
      </section>

      <aside className="flex min-w-0 flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-gradient text-white">♞</span>
              <div className="min-w-0">
                <h1 className="font-display text-xl text-white">{theme === "mix" ? "Mixed puzzles" : prettify(theme)}</h1>
                <p className="truncate text-sm text-ink-400">
                  {g.puzzle ? <>#{g.puzzle.id} · Rating {g.puzzle.rating} · Played {g.puzzle.plays ?? 0}</> : "Loading…"}
                </p>
              </div>
            </div>
            {g.solved && (
              <button onClick={g.next} disabled={g.isFetching}
                className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {g.isFetching ? "…" : (g.reviewing ? "Back to training →" : "Next →")}
              </button>
            )}
          </div>
        </div>

        <SolvedStrip onSelect={g.review} />

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-400">Your rating</span>
            <span className="text-lg font-semibold text-white">
              {g.displayRating}
              {g.ratingDiff != null && (
                <span className={g.ratingDiff >= 0 ? "ml-2 text-accent-400" : "ml-2 text-rose-400"}>
                  {g.ratingDiff >= 0 ? "+" : ""}{g.ratingDiff}
                </span>
              )}
            </span>
          </div>
          <div className={`mt-4 ${fbColor}`}>
            <div className="text-base font-semibold">{g.fb.title}</div>
            <div className="text-sm text-ink-400">{g.fb.sub}</div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={g.showHint} className="flex-1 rounded-lg border border-gold-500/60 px-3 py-2 text-sm text-gold-400 hover:bg-gold-500/10">💡 Hint</button>
            <button onClick={g.viewSolution} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">View Solution</button>
          </div>
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Theme</label>
          <select value={theme} onChange={(e) => { const t = e.target.value; try { localStorage.setItem("cg_theme", t); localStorage.removeItem("cg_puzzle"); } catch { /* */ } setTheme(t); }}
            className="mb-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            <option value="mix">All themes</option>
            {(themes?.themes ?? []).filter((t) => t !== "mix").map((t) => <option key={t} value={t}>{prettify(t)}</option>)}
          </select>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Difficulty</label>
          <select value={difficulty} onChange={(e) => { try { localStorage.removeItem("cg_puzzle"); } catch { /* */ } setDifficulty(e.target.value as Difficulty); }}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            {DIFFS.map((d) => <option key={d} value={d}>{prettify(d)}</option>)}
          </select>
          <button onClick={g.next} disabled={g.isFetching}
            className="mt-3 w-full rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-50">
            {g.isFetching ? "Loading…" : "New puzzle"}
          </button>
        </div>
      </aside>
    </div>
  );
}
