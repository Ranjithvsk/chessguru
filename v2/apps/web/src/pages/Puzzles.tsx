import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { Difficulty, Puzzle } from "@chessguru/types";
import Board from "../components/Board";
import { api } from "../lib/api";

type Ctx = { userId: string | null; rating: number };
const DIFFS: Difficulty[] = ["easiest", "easier", "normal", "harder", "hardest"];

type FB = { kind: "wait" | "good" | "bad" | "solved"; title: string; sub: string };

export default function PuzzlesPage() {
  const { userId, rating } = useOutletContext<Ctx>();
  const [theme, setTheme] = useState("mix");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [nonce, setNonce] = useState(0); // bump to fetch next puzzle

  const { data: themes } = useQuery({ queryKey: ["themes"], queryFn: api.themes });
  const { data: puzzle, isFetching, refetch } = useQuery({
    queryKey: ["puzzle", theme, difficulty, nonce],
    queryFn: () => api.randomPuzzle(theme, rating, difficulty),
  });

  // --- solving state (refs so handlers see latest without stale closures) ---
  const game = useRef(new Chess());
  const solution = useRef<string[]>([]);
  const idx = useRef(0);
  const solved = useRef(false);
  const failed = useRef(false);
  const hinted = useRef(false);

  const [fen, setFen] = useState("start");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const [fb, setFb] = useState<FB>({ kind: "wait", title: "Your turn", sub: "Find the best move" });
  const [ratingDiff, setRatingDiff] = useState<number | null>(null);
  const [displayRating, setDisplayRating] = useState(rating);

  useEffect(() => setDisplayRating(rating), [rating]);

  const playerColor = (): "white" | "black" => (game.current.turn() === "w" ? "white" : "black");

  const dests = useMemo(() => {
    const m = new Map<Key, Key[]>();
    if (solved.current) return m;
    for (const mv of game.current.moves({ verbose: true }) as any[]) {
      if (!m.has(mv.from)) m.set(mv.from, []);
      m.get(mv.from)!.push(mv.to);
    }
    return m;
  }, [fen]);

  // init a freshly fetched puzzle
  useEffect(() => {
    if (!puzzle) return;
    game.current = new Chess();
    try { game.current.load(puzzle.fen); } catch { /* ignore */ }
    solution.current = puzzle.solution ?? [];
    idx.current = 0;
    solved.current = false;
    failed.current = false;
    hinted.current = false;
    const pc = playerColor();
    setOrientation(pc);
    setLastMove(puzzle.lastMove ? [puzzle.lastMove.slice(0, 2) as Key, puzzle.lastMove.slice(2, 4) as Key] : undefined);
    setFen(puzzle.fen);
    setRatingDiff(null);
    setFb({ kind: "wait", title: "Your turn", sub: `Find the best move for ${pc}` });
  }, [puzzle]);

  const submit = useCallback((win: boolean) => {
    if (!puzzle) return;
    api.complete(puzzle.id, { win, hint: hinted.current, difficulty, userId })
      .then((r) => {
        if (typeof r.ratingDiff === "number") setRatingDiff(r.ratingDiff);
        if (r.glicko) setDisplayRating(Math.round(r.glicko.r));
      })
      .catch(() => {});
  }, [puzzle, difficulty, userId]);

  const finish = useCallback(() => {
    solved.current = true;
    setFb({ kind: "solved", title: "Solved!", sub: "Well played." });
    if (!failed.current && !hinted.current) submit(true); // award only on a clean solve
  }, [submit]);

  const oppReply = useCallback(() => {
    const mv = solution.current[idx.current];
    if (!mv) return;
    game.current.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv[4] as any) || "q" });
    idx.current += 1;
    setLastMove([mv.slice(0, 2) as Key, mv.slice(2, 4) as Key]);
    setFen(game.current.fen());
    if (idx.current >= solution.current.length) finish();
  }, [finish]);

  const onMove = useCallback((from: Key, to: Key) => {
    if (solved.current) return;
    const uci = `${from}${to}`;
    const exp = solution.current[idx.current];
    if (uci === exp || `${uci}q` === exp) {
      game.current.move({ from, to, promotion: (exp[4] as any) || "q" });
      idx.current += 1;
      setLastMove([from, to]);
      setFen(game.current.fen());
      if (idx.current >= solution.current.length) { finish(); return; }
      setFb({ kind: "good", title: "Best move!", sub: "Keep going…" });
      setTimeout(oppReply, 450);
    } else {
      // wrong: deduct exactly once, and never award after a miss
      if (!failed.current && !hinted.current) submit(false);
      failed.current = true;
      setFb({ kind: "bad", title: "Not the best", sub: "Try again." });
      setFen(game.current.fen()); // snap the piece back
    }
  }, [finish, oppReply, submit]);

  const showHint = () => {
    hinted.current = true;
    const exp = solution.current[idx.current];
    if (exp) setFb({ kind: "wait", title: "Hint", sub: `Move the piece on ${exp.slice(0, 2)}` });
  };
  const viewSolution = () => {
    hinted.current = true;
    const step = () => {
      if (idx.current >= solution.current.length) { solved.current = true; setFb({ kind: "solved", title: "Solution", sub: "" }); return; }
      const mv = solution.current[idx.current];
      game.current.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv[4] as any) || "q" });
      idx.current += 1;
      setLastMove([mv.slice(0, 2) as Key, mv.slice(2, 4) as Key]);
      setFen(game.current.fen());
      if (idx.current < solution.current.length) setTimeout(step, 500);
      else { solved.current = true; setFb({ kind: "solved", title: "Solution", sub: "" }); }
    };
    step();
  };
  const next = () => setNonce((n) => n + 1);

  const fbColor = { wait: "text-ink-300", good: "text-accent-400", bad: "text-rose-400", solved: "text-accent-400" }[fb.kind];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Board */}
      <section>
        <Board
          fen={fen}
          orientation={orientation}
          turnColor={playerColor()}
          movableColor={solved.current ? undefined : playerColor()}
          dests={dests}
          lastMove={lastMove}
          onMove={onMove}
        />
      </section>

      {/* Side panel */}
      <aside className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-gradient text-white">♞</span>
            <div>
              <h1 className="font-display text-xl text-white">
                {theme === "mix" ? "Mixed puzzles" : prettify(theme)}
              </h1>
              <p className="text-sm text-ink-400">
                {puzzle ? <>#{puzzle.id} · Rating {puzzle.rating} · Played {puzzle.plays ?? 0}</> : "Loading…"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-400">Your rating</span>
            <span className="text-lg font-semibold text-white">
              {displayRating}
              {ratingDiff != null && (
                <span className={ratingDiff >= 0 ? "ml-2 text-accent-400" : "ml-2 text-rose-400"}>
                  {ratingDiff >= 0 ? "+" : ""}{ratingDiff}
                </span>
              )}
            </span>
          </div>
          <div className={`mt-4 ${fbColor}`}>
            <div className="text-base font-semibold">{fb.title}</div>
            <div className="text-sm text-ink-400">{fb.sub}</div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={showHint} className="flex-1 rounded-lg border border-gold-500/60 px-3 py-2 text-sm text-gold-400 hover:bg-gold-500/10">💡 Hint</button>
            <button onClick={viewSolution} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">View Solution</button>
          </div>
          {solved.current && (
            <button onClick={next} className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">
              Next puzzle →
            </button>
          )}
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Theme</label>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}
            className="mb-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            <option value="mix">All themes</option>
            {(themes?.themes ?? []).filter((t) => t !== "mix").map((t) => (
              <option key={t} value={t}>{prettify(t)}</option>
            ))}
          </select>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Difficulty</label>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            {DIFFS.map((d) => <option key={d} value={d}>{prettify(d)}</option>)}
          </select>
          <button onClick={() => refetch()} disabled={isFetching}
            className="mt-3 w-full rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-50">
            {isFetching ? "Loading…" : "New puzzle"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function prettify(s: string) {
  return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}
