// Phase 8a: Puzzle of the Day page.
//
// One puzzle everyone gets each day. Deliberately a slim page — no theme
// picker, no history sidebar, no next-puzzle button — just today's puzzle,
// a board, and a result state. If the user has already solved it we skip
// straight to the result view so they don't accidentally re-attempt.
//
// Solve counts through the normal /api/puzzles/:id/complete flow so it
// contributes to rating + streak + milestone crossings just like a random
// puzzle would. That's the point — today's puzzle IS the daily habit anchor.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { get, api } from "../lib/api";
import Board from "../components/Board";
import MilestoneOverlay from "../components/MilestoneOverlay";

type DailyPayload = {
  date: string;
  puzzle: {
    id: string; fen: string; preFen?: string; solution: string[]; themes: string[];
    rating: number; lastMove?: string;
  };
  solvedByMe: boolean;
  myRound: { win: boolean; ms: number | null; ratingDiff: number | null } | null;
  stats?: { attempted: number; solved: number; medianMs: number | null };
  streak?: { current: number; longest: number; lastDate: string | null } | null;
};

const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
  weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
});
const fmtSec = (ms: number | null) => ms == null ? "" : `${(ms / 1000).toFixed(1)}s`;

export default function DailyPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["daily-puzzle"],
    queryFn: () => get<DailyPayload>("/api/puzzles/daily"),
    staleTime: 60_000,
  });

  const [outcome, setOutcome] = useState<null | "win" | "loss">(null);
  const [fb, setFb] = useState<string>("Your turn — find the best move");
  const [milestone, setMilestone] = useState<{ type: "rating" | "count"; milestone: number } | null>(null);
  const [ratingDiff, setRatingDiff] = useState<number | null>(null);

  const game = useRef<Chess | null>(null);
  const idx = useRef(0);
  const [fen, setFen] = useState<string>("");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const startedAt = useRef<number | null>(null);
  const submitted = useRef(false);
  const wrongRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    game.current = new Chess(data.puzzle.fen);
    idx.current = 0;
    setFen(data.puzzle.fen);
    const lm = data.puzzle.lastMove;
    setLastMove(lm ? [lm.slice(0, 2) as Key, lm.slice(2, 4) as Key] : undefined);
    startedAt.current = Date.now();
    submitted.current = false;
    wrongRef.current = null;
    setOutcome(null);
    setRatingDiff(null);
    setMilestone(null);
    setFb("Your turn — find the best move");
  }, [data]);

  const orientation: "white" | "black" = useMemo(() => {
    if (!data) return "white";
    return String(data.puzzle.fen).split(" ")[1] === "w" ? "white" : "black";
  }, [data]);

  const dests = useMemo(() => {
    if (!game.current || outcome) return new Map();
    const d = new Map<Key, Key[]>();
    for (const s of game.current.moves({ verbose: true }) as any[]) {
      const from = s.from as Key;
      if (!d.has(from)) d.set(from, []);
      d.get(from)!.push(s.to as Key);
    }
    return d;
  }, [fen, outcome]);

  const submit = async (win: boolean) => {
    if (submitted.current || !data) return;
    submitted.current = true;
    const ms = startedAt.current ? Date.now() - startedAt.current : null;
    try {
      const r = await api.complete(data.puzzle.id, {
        win, hint: false, difficulty: "normal", userId: null,
        mode: "puzzle", rating: 1500, deviation: 200,
        daily: true,   // Phase 8c: server-verifies against today's dailyPuzzles
        ...(ms != null ? { ms } : {}),
        ...(!win && wrongRef.current ? { wrong: wrongRef.current } : {}),
      });
      if (typeof r.ratingDiff === "number") setRatingDiff(r.ratingDiff);
      if (r.milestone?.firstTime) setMilestone({ type: r.milestone.type ?? "rating", milestone: r.milestone.milestone });
      qc.invalidateQueries({ queryKey: ["daily-puzzle"] });
      qc.invalidateQueries({ queryKey: ["me-rating"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch { /* silent — result already shown */ }
  };

  const onMove = (from: Key, to: Key) => {
    if (!game.current || outcome) return;
    const uci = `${from}${to}`;
    const exp = data!.puzzle.solution[idx.current];
    if (uci === exp || `${uci}q` === exp) {
      game.current.move({ from, to, promotion: (exp?.[4] as any) || "q" });
      idx.current += 1;
      setLastMove([from, to]);
      setFen(game.current.fen());
      if (idx.current >= data!.puzzle.solution.length) {
        setOutcome("win"); setFb("Solved! ✓");
        submit(true);
        return;
      }
      setFb("Best move — keep going…");
      // Opponent reply
      setTimeout(() => {
        const mv = data!.puzzle.solution[idx.current];
        if (!mv || !game.current) return;
        game.current.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv[4] as any) || "q" });
        idx.current += 1;
        setLastMove([mv.slice(0, 2) as Key, mv.slice(2, 4) as Key]);
        setFen(game.current.fen());
        if (idx.current >= data!.puzzle.solution.length) {
          setOutcome("win"); setFb("Solved! ✓");
          submit(true);
        }
      }, 450);
    } else {
      // Lichess rule: any move that mates counts as solved.
      let mates = false;
      try {
        const c = new Chess(game.current.fen());
        const mv = c.move({ from, to, promotion: "q" });
        mates = !!mv && c.isCheckmate();
      } catch { mates = false; }
      if (mates) {
        game.current.move({ from, to, promotion: "q" });
        setLastMove([from, to]);
        setFen(game.current.fen());
        setOutcome("win"); setFb("Solved by mate! ✓");
        submit(true);
        return;
      }
      wrongRef.current = uci;
      setOutcome("loss"); setFb("Not the best — you'll get tomorrow's.");
      submit(false);
    }
  };

  if (isLoading) return <div className="grid h-64 place-items-center text-ink-400">Loading today's puzzle…</div>;
  if (!data) return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">Today's puzzle is unavailable — try again later.</div>;

  const alreadyDoneOutcome = !outcome && data.solvedByMe;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {milestone && (
        <MilestoneOverlay milestone={milestone.milestone} type={milestone.type} onClose={() => setMilestone(null)} />
      )}

      <div className="rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-600/15 via-purple-500/10 to-amber-500/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-300">Puzzle of the day</div>
            <div className="mt-1 font-display text-2xl text-white">{fmt(data.date)}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-300">
              <span className="rounded-md bg-ink-800 px-2 py-0.5">Rating {data.puzzle.rating}</span>
              {data.puzzle.themes.slice(0, 3).map((t) => (
                <span key={t} className="rounded-md bg-ink-800/60 px-2 py-0.5">{t}</span>
              ))}
            </div>
          </div>
          <div className="flex gap-3 text-center">
            {data.streak && (data.streak.current > 0 || data.streak.longest > 0) && (
              <div className={`rounded-lg px-3 py-2 ${data.streak.current > 0 ? "bg-orange-500/10 ring-1 ring-orange-500/30" : "bg-ink-900/60"}`}>
                <div className="text-[10px] uppercase tracking-wide text-ink-400">Daily streak</div>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-lg font-bold tabular-nums text-white">
                  <span className={data.streak.current > 0 ? "text-orange-300" : ""}>{data.streak.current}</span>
                  <span className={data.streak.current > 0 ? "" : "opacity-40 grayscale"}>🔥</span>
                </div>
                <div className="text-[10px] text-ink-500">best {data.streak.longest}</div>
              </div>
            )}
            {data.stats && data.stats.attempted > 0 && (
              <>
                <div className="rounded-lg bg-ink-900/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-ink-400">Solved</div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums text-white">
                    {Math.round((data.stats.solved / data.stats.attempted) * 100)}%
                  </div>
                  <div className="text-[10px] text-ink-500">{data.stats.solved} / {data.stats.attempted}</div>
                </div>
                {data.stats.medianMs != null && (
                  <div className="rounded-lg bg-ink-900/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-ink-400">Median</div>
                    <div className="mt-0.5 text-lg font-bold tabular-nums text-white">{fmtSec(data.stats.medianMs)}</div>
                    <div className="text-[10px] text-ink-500">of winners</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <Board
            fen={fen || data.puzzle.fen}
            orientation={orientation}
            turnColor={orientation}
            movableColor={outcome || alreadyDoneOutcome ? undefined : orientation}
            dests={dests}
            lastMove={lastMove}
            onMove={onMove}
            className="w-full"
          />
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
          {alreadyDoneOutcome ? (
            <>
              <div className="text-xs uppercase tracking-wide text-emerald-300">✓ You've solved today's puzzle</div>
              <div className="mt-2 text-2xl font-semibold text-white">{data.myRound?.win ? "Solved" : "Attempted"}</div>
              {data.myRound?.ms != null && <div className="mt-1 text-sm text-ink-400">in {fmtSec(data.myRound.ms)}</div>}
              {data.myRound?.ratingDiff != null && (
                <div className={`mt-1 text-sm ${data.myRound.ratingDiff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {data.myRound.ratingDiff >= 0 ? "+" : ""}{data.myRound.ratingDiff} rating
                </div>
              )}
              <p className="mt-3 text-xs text-ink-500">Come back tomorrow for a new one.</p>
              <Link to="/" className="mt-4 inline-block rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500">Regular puzzles →</Link>
            </>
          ) : outcome ? (
            <>
              <div className={`text-xs uppercase tracking-wide ${outcome === "win" ? "text-emerald-300" : "text-rose-300"}`}>
                {outcome === "win" ? "✓ Solved" : "✗ Missed"}
              </div>
              <div className="mt-2 text-lg text-white">{fb}</div>
              {ratingDiff != null && (
                <div className={`mt-2 text-sm ${ratingDiff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {ratingDiff >= 0 ? "+" : ""}{ratingDiff} rating
                </div>
              )}
              <p className="mt-3 text-xs text-ink-500">See you tomorrow.</p>
              <Link to="/" className="mt-4 inline-block rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500">Regular puzzles →</Link>
            </>
          ) : (
            <>
              <div className="text-xs uppercase tracking-wide text-ink-400">Live</div>
              <div className="mt-2 text-lg text-white">{fb}</div>
              <p className="mt-3 text-xs text-ink-500">One shot. No hints. Everyone gets the same puzzle today.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
