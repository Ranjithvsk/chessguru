import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Board from "../components/Board";
import { api } from "../lib/api";
import { usePuzzleGame } from "../hooks/usePuzzleGame";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };
const PC_BANDS = [4, 5, 6, 7, 8, 10, 12, 16, 20, 32];
const PIECE_SYM: Record<string, string> = { p: "", n: "N", b: "B", r: "R", q: "Q", k: "K" };

function piecesFromFen(fen: string) {
  const board = fen.split(" ")[0] ?? "";
  const white: string[] = [];
  const black: string[] = [];
  board.split("/").forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const sq = String.fromCharCode(97 + file) + (8 - r);
      const label = (PIECE_SYM[ch.toLowerCase()] ?? "") + sq;
      (ch === ch.toUpperCase() ? white : black).push(label);
      file++;
    }
  });
  return { white, black };
}

export default function BlindfoldPage() {
  const { userId, rating } = useOutletContext<Ctx>();
  const [theme, setTheme] = useState("mix");
  const [pcIdx, setPcIdx] = useState(6); // default 12 pieces
  const [peek, setPeek] = useState(false);
  const [input, setInput] = useState("");
  const [err, setErr] = useState(false);
  const { data: themes } = useQuery({ queryKey: ["themes"], queryFn: api.themes });

  const g = usePuzzleGame({
    theme, difficulty: "normal", userId, initialRating: rating,
    mode: "blindfold", maxPc: PC_BANDS[pcIdx],
  });

  const pieces = useMemo(() => piecesFromFen(g.fen), [g.fen]);

  const submitInput = () => {
    if (g.tryInput(input)) { setInput(""); setErr(false); }
    else { setErr(true); setTimeout(() => setErr(false), 1200); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <Board
          fen={g.fen} orientation={g.orientation} turnColor={g.turnColor}
          movableColor={g.movableColor} dests={g.dests} lastMove={g.lastMove}
          shapes={g.hintShapes} onMove={g.onMove}
          blindfold className={peek ? "peek" : ""}
        />
        <div className="mt-3 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitInput(); }}
            placeholder="Type a move (e.g. Nf3 or g1f3)"
            className={`flex-1 rounded-lg border bg-ink-800 px-3 py-2.5 text-white outline-none ${err ? "border-rose-500" : "border-ink-600 focus:border-brand-500"}`}
          />
          <button onClick={submitInput} className="rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-500">Go</button>
          <button onMouseDown={() => setPeek(true)} onMouseUp={() => setPeek(false)} onMouseLeave={() => setPeek(false)}
            className="rounded-lg border border-ink-600 px-4 py-2.5 text-sm text-ink-300 hover:bg-ink-800" title="Hold to peek">👁 Peek</button>
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h1 className="font-display text-xl text-white">Blindfold</h1>
          <p className="text-sm text-ink-400">{g.puzzle ? <>#{g.puzzle.id} · Rating {g.puzzle.rating}</> : "Loading…"}</p>
          {g.lastMove && <p className="mt-1 text-sm text-brand-300">Opponent played: {g.lastMove[0]}{g.lastMove[1]}</p>}
          <div className="mt-3 text-sm">
            <div className="font-semibold text-white">{g.fb.title}</div>
            <div className="text-ink-400">{g.fb.sub}</div>
          </div>
          <div className="mt-3 text-sm text-ink-400">
            Blindfold rating <span className="font-semibold text-white">{g.displayRating}</span>
            {g.ratingDiff != null && <span className={g.ratingDiff >= 0 ? "ml-1 text-accent-400" : "ml-1 text-rose-400"}>{g.ratingDiff >= 0 ? "+" : ""}{g.ratingDiff}</span>}
          </div>
          {g.solved && <button onClick={g.next} className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">Next →</button>}
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-xl2 border border-ink-700 bg-ink-900 p-5 text-sm">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">White</div>
            <div className="text-white">{pieces.white.join(", ")}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Black</div>
            <div className="text-white">{pieces.black.join(", ")}</div>
          </div>
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Theme</label>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}
            className="mb-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            <option value="mix">All themes</option>
            {(themes?.themes ?? []).filter((t) => t !== "mix").map((t) => <option key={t} value={t}>{prettify(t)}</option>)}
          </select>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Max pieces: {PC_BANDS[pcIdx]}</label>
          <input type="range" min={0} max={PC_BANDS.length - 1} value={pcIdx}
            onChange={(e) => setPcIdx(Number(e.target.value))} className="w-full accent-brand-500" />
          <div className="mt-3 flex gap-2">
            <button onClick={g.showHint} className="flex-1 rounded-lg border border-gold-500/60 px-3 py-2 text-sm text-gold-400 hover:bg-gold-500/10">💡 Hint</button>
            <button onClick={g.viewSolution} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reveal</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
