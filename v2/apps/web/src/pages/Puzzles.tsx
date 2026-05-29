import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Difficulty } from "@chessguru/types";
import Board from "../components/Board";
import { api } from "../lib/api";
import { usePuzzleGame } from "../hooks/usePuzzleGame";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };
const DIFFS: Difficulty[] = ["easiest", "easier", "normal", "harder", "hardest"];

export default function PuzzlesPage() {
  const { userId, rating } = useOutletContext<Ctx>();
  const [theme, setTheme] = useState("mix");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const { data: themes } = useQuery({ queryKey: ["themes"], queryFn: api.themes });

  const g = usePuzzleGame({ theme, difficulty, userId, initialRating: rating });
  const fbColor = { wait: "text-ink-300", good: "text-accent-400", bad: "text-rose-400", solved: "text-accent-400" }[g.fb.kind];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <Board
          fen={g.fen} orientation={g.orientation} turnColor={g.turnColor}
          movableColor={g.movableColor} dests={g.dests} lastMove={g.lastMove}
          shapes={g.hintShapes} onMove={g.onMove}
        />
      </section>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-gradient text-white">♞</span>
            <div>
              <h1 className="font-display text-xl text-white">{theme === "mix" ? "Mixed puzzles" : prettify(theme)}</h1>
              <p className="text-sm text-ink-400">
                {g.puzzle ? <>#{g.puzzle.id} · Rating {g.puzzle.rating} · Played {g.puzzle.plays ?? 0}</> : "Loading…"}
              </p>
            </div>
          </div>
        </div>

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
          {g.solved && (
            <button onClick={g.next} className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">
              Next puzzle →
            </button>
          )}
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Theme</label>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}
            className="mb-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            <option value="mix">All themes</option>
            {(themes?.themes ?? []).filter((t) => t !== "mix").map((t) => <option key={t} value={t}>{prettify(t)}</option>)}
          </select>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Difficulty</label>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}
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
