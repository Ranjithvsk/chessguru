import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Board from "../components/Board";
import { api } from "../lib/api";
import { usePuzzleGame } from "../hooks/usePuzzleGame";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };

// A curated set surfaced as colourful chips; the rest come from the dropdown.
const FEATURED = [
  "fork", "pin", "skewer", "mateIn1", "mateIn2", "backRankMate",
  "sacrifice", "discoveredAttack", "endgame", "promotion", "deflection", "hangingPiece",
];

export default function ThemePage() {
  const { userId, rating } = useOutletContext<Ctx>();
  const [theme, setTheme] = useState("fork");
  const { data: themes } = useQuery({ queryKey: ["themes"], queryFn: api.themes });
  const g = usePuzzleGame({ theme, difficulty: "normal", userId, initialRating: rating });
  const fbColor = { wait: "text-ink-300", good: "text-accent-400", bad: "text-rose-400", solved: "text-accent-400" }[g.fb.kind];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-white">Train by <span className="text-gradient">theme</span></h1>
        <p className="text-sm text-ink-400">Pick a tactical motif and drill it.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {FEATURED.map((t) => (
            <button key={t} onClick={() => setTheme(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                theme === t ? "bg-brand-gradient text-white shadow-glow" : "border border-ink-700 text-ink-300 hover:bg-ink-800"
              }`}>
              {prettify(t)}
            </button>
          ))}
          <select value={theme} onChange={(e) => setTheme(e.target.value)}
            className="rounded-full border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-white">
            {(themes?.themes ?? []).filter((t) => t !== "mix").map((t) => <option key={t} value={t}>{prettify(t)}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Board
          fen={g.fen} orientation={g.orientation} turnColor={g.turnColor}
          movableColor={g.movableColor} dests={g.dests} lastMove={g.lastMove}
          shapes={g.hintShapes} onMove={g.onMove}
        />
        <aside className="flex flex-col gap-4">
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="font-display text-lg text-white">{prettify(theme)}</h2>
            <p className="text-sm text-ink-400">{g.puzzle ? <>#{g.puzzle.id} · Rating {g.puzzle.rating}</> : "Loading…"}</p>
            <div className={`mt-4 ${fbColor}`}>
              <div className="text-base font-semibold">{g.fb.title}</div>
              <div className="text-sm text-ink-400">{g.fb.sub}</div>
            </div>
            <div className="mt-2 text-sm text-ink-400">
              Your rating <span className="font-semibold text-white">{g.displayRating}</span>
              {g.ratingDiff != null && <span className={g.ratingDiff >= 0 ? "ml-1 text-accent-400" : "ml-1 text-rose-400"}>{g.ratingDiff >= 0 ? "+" : ""}{g.ratingDiff}</span>}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={g.showHint} className="flex-1 rounded-lg border border-gold-500/60 px-3 py-2 text-sm text-gold-400 hover:bg-gold-500/10">💡 Hint</button>
              <button onClick={g.viewSolution} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Solution</button>
            </div>
            {g.solved && (
              <button onClick={g.next} className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">Next →</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
