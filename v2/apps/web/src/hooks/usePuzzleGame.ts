import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import type { Difficulty } from "@chessguru/types";
import { api } from "../lib/api";
import { destsFromChess } from "../components/Board";

export type FB = { kind: "wait" | "good" | "bad" | "solved"; title: string; sub: string };

export interface UsePuzzleGameOpts {
  theme: string;
  difficulty: Difficulty;
  userId: string | null;
  initialRating: number;
  mode?: "puzzle" | "blindfold";
  maxPc?: number;
  section?: string;
  player?: string;
}

/** Shared puzzle-solving engine used by Puzzles, Theme and Blindfold pages. */
export function usePuzzleGame(opts: UsePuzzleGameOpts) {
  const { theme, difficulty, userId, initialRating, mode = "puzzle", maxPc, section, player } = opts;
  const [nonce, setNonce] = useState(0);
  const [reviewId, setReviewId] = useState<string | null>(null); // reviewing a past solve (from the solved strip)
  const reviewIdRef = useRef<string | null>(null);
  reviewIdRef.current = reviewId;
  const qc = useQueryClient();
  const STORE_KEY = mode === "blindfold" ? "cg_puzzle_bf" : section === "masters" ? "cg_puzzle_masters" : "cg_puzzle";

  const { data: puzzle, isFetching } = useQuery({
    queryKey: ["puzzle", mode, section ?? "normal", player ?? "", theme, difficulty, maxPc ?? 0, userId ?? "guest", reviewId ?? "", nonce],
    queryFn: () => {
      if (reviewId) return api.puzzleById(reviewId); // reviewing a past solve from the strip
      // Resume the saved (unsolved) puzzle whenever one is stored. Read it live
      // each fetch so it survives the queryKey changing when auth (userId) resolves
      // after the first render — otherwise refresh would load a new random puzzle.
      // Saved entries carry the filters they were fetched under; resume ONLY when
      // they match the current theme/maxPc — otherwise a theme or piece-count change
      // kept re-loading the same stored puzzle and the selectors looked dead
      // (owner-reported on Blindfold, 2026-07-08). Legacy plain-id entries resume once.
      let rid: string | null = null;
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          if (raw.startsWith("{")) {
            const saved = JSON.parse(raw) as { id: string; theme?: string; maxPc?: number };
            if (saved.theme === theme && (saved.maxPc ?? 0) === (maxPc ?? 0)) rid = saved.id;
          } else rid = raw; // legacy format
        }
      } catch { /* */ }
      const rand = () => api.randomPuzzle({ theme, rating: initialRating, difficulty, maxPc, userId, section, player, mode });
      return rid ? api.puzzleById(rid).catch(rand) : rand();
    },
  });

  const game = useRef(new Chess());
  const solution = useRef<string[]>([]);
  const idx = useRef(0);
  const solved = useRef(false);
  const failed = useRef(false);
  const hinted = useRef(false);
  // Solve clock: startedAt stamped when a NEW puzzle loads (skipped for reviews).
  // Frozen into solveMs on first submit so subsequent hint/replay clicks don't reset it.
  const startedAtRef = useRef<number | null>(null);
  const solveMsRef = useRef<number | null>(null);
  const [solveMs, setSolveMs] = useState<number | null>(null);
  // Wrong-move capture: UCI of the FIRST incorrect move played (later misses on the
  // same puzzle are ignored — the player usually retries after the first miss and
  // we already recorded the fail). Stored so history can replay "what went wrong".
  const wrongMoveRef = useRef<string | null>(null);
  // Practice mode: when true, submit() skips the api.complete call so a retry after
  // seeing the analysis doesn't inflate your rating. Reset whenever a fresh puzzle
  // loads (see the useEffect on `puzzle`).
  const practiceRef = useRef(false);
  const [practice, setPractice] = useState(false);

  const [fen, setFen] = useState("start");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const [hintShapes, setHintShapes] = useState<DrawShape[]>([]);
  const [fb, setFb] = useState<FB>({ kind: "wait", title: "Your turn", sub: "Find the best move" });
  const [ratingDiff, setRatingDiff] = useState<number | null>(null);
  // Phase 7n + 7o: milestone hit on this solve (null when none crossed).
  // Cleared on the next puzzle load — the celebration overlay lives on the parent.
  const [milestone, setMilestone] = useState<{ type: "rating" | "count"; milestone: number; firstTime: boolean } | null>(null);
  const [displayRating, setDisplayRating] = useState(initialRating);
  const [, force] = useState(0);
  const [replayPly, setReplayPly] = useState<number | null>(null); // post-solve move replay (null = live)
  const exploreGame = useRef(new Chess());
  const [exploreFen, setExploreFen] = useState<string | null>(null); // post-solve free-play sandbox (null = off)
  const [exploreLast, setExploreLast] = useState<[Key, Key] | undefined>(undefined);

  useEffect(() => setDisplayRating(initialRating), [initialRating]);

  const playerColor = (): "white" | "black" => (game.current.turn() === "w" ? "white" : "black");

  const dests = useMemo(() => (solved.current ? new Map() : destsFromChess(game.current as any)), [fen]);

  useEffect(() => {
    if (!puzzle) return;
    setExploreFen(null); setExploreLast(undefined);
    game.current = new Chess();
    try { game.current.load(puzzle.fen); } catch { /* ignore bad fen */ }
    solution.current = puzzle.solution ?? [];
    failed.current = false;
    hinted.current = false;
    // Fresh puzzle => practice mode off, unless retry() just turned it on (retry
    // doesn't refetch — it re-runs this effect via the puzzle ref, and clears
    // reviewIdRef itself so we land in the "fresh puzzle" branch below).
    if (!practiceRef.current) setPractice(false);
    const pc = playerColor();
    setOrientation(pc);
    setHintShapes([]);
    setRatingDiff(null);
    setMilestone(null);
    if (reviewIdRef.current && puzzle.id === reviewIdRef.current) {
      // Review a past solve: play out the whole line, show the final position,
      // enable replay (back/forward), and never submit (rating untouched).
      for (let i = 0; i < solution.current.length; i++) {
        const mv = solution.current[i];
        if (!mv) break;
        try { game.current.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv[4] as any) || "q" }); } catch { break; }
      }
      idx.current = solution.current.length;
      solved.current = true;
      const lastMv = solution.current[solution.current.length - 1];
      setLastMove(lastMv ? [lastMv.slice(0, 2) as Key, lastMv.slice(2, 4) as Key] : undefined);
      setFen(game.current.fen());
      setReplayPly(solution.current.length);
      setFb({ kind: "solved", title: "Reviewing", sub: "Step through with the arrows" });
    } else {
      idx.current = 0;
      solved.current = false;
      setLastMove(puzzle.lastMove ? [puzzle.lastMove.slice(0, 2) as Key, puzzle.lastMove.slice(2, 4) as Key] : undefined);
      setFen(puzzle.fen);
      setReplayPly(null);
      setFb({ kind: "wait", title: "Your turn", sub: `Find the best move for ${pc}` });
      // Start the solve clock — fresh puzzle only, never on reviews (handled by the
      // reviewIdRef branch above).
      startedAtRef.current = Date.now();
      solveMsRef.current = null;
      setSolveMs(null);
      wrongMoveRef.current = null;
      try { if (puzzle.id) localStorage.setItem(STORE_KEY, JSON.stringify({ id: puzzle.id, theme, maxPc: maxPc ?? 0 })); } catch { /* */ }
    }
  }, [puzzle]);

  const submit = useCallback((win: boolean) => {
    if (!puzzle) return;
    // Freeze the solve time on the FIRST submit — later solves-with-hint / view-solution
    // clicks must not extend the recorded time. null means the timer wasn't started
    // (guest review, edge cases).
    const ms = solveMsRef.current ?? (startedAtRef.current != null ? Date.now() - startedAtRef.current : null);
    if (solveMsRef.current == null && ms != null) { solveMsRef.current = ms; setSolveMs(ms); }
    // Practice mode: retrying a puzzle you've already reviewed shouldn't move your
    // rating (you already know the answer). Freeze the clock display but skip the API.
    if (practiceRef.current) return;
    api.complete(puzzle.id, {
      win, hint: hinted.current, difficulty, userId, theme,
      mode, rating: displayRating, deviation: 200,
      ...(ms != null ? { ms } : {}),
      ...(wrongMoveRef.current ? { wrong: wrongMoveRef.current } : {}),
    }).then((r) => {
      if (typeof r.ratingDiff === "number") setRatingDiff(r.ratingDiff);
      if (r.glicko) setDisplayRating(Math.round(r.glicko.r));
      if (r.milestone) setMilestone(r.milestone);
      qc.invalidateQueries({ queryKey: ["me-rating"] }); // refresh the navbar rating
      qc.invalidateQueries({ queryKey: ["me-history"] }); // refresh the solved strip
      qc.invalidateQueries({ queryKey: ["dashboard"] }); // refresh theme ratings (sidebar + /dashboard)
    }).catch(() => {});
  }, [puzzle, difficulty, userId, mode, displayRating, qc, theme]);

  const finish = useCallback(() => {
    solved.current = true;
    try { localStorage.removeItem(STORE_KEY); } catch { /* */ }
    setFb({ kind: "solved", title: "Solved!", sub: "Well played." });
    if (!failed.current && !hinted.current) submit(true); // award only on a clean solve
    force((n) => n + 1);
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
    setHintShapes([]);
    if (uci === exp || `${uci}q` === exp) {
      game.current.move({ from, to, promotion: (exp[4] as any) || "q" });
      idx.current += 1;
      setLastMove([from, to]);
      setFen(game.current.fen());
      if (idx.current >= solution.current.length) { finish(); return; }
      setFb({ kind: "good", title: "Best move!", sub: "Keep going…" });
      setTimeout(oppReply, 450);
    } else {
      // Lichess rule: ANY move that delivers checkmate solves the puzzle, even when it
      // deviates from the stored line — mate puzzles often have several mates (e.g.
      // #0PlNX ends in both Qxg8# and Rxg8#, but the line records only one of them).
      let mates = false;
      try { const c = new Chess(game.current.fen()); const mv = c.move({ from, to, promotion: "q" }); mates = !!mv && c.isCheckmate(); } catch { mates = false; }
      if (mates) {
        game.current.move({ from, to, promotion: "q" });
        idx.current = solution.current.length;
        setLastMove([from, to]);
        setFen(game.current.fen());
        finish();
        return;
      }
      if (!failed.current && !hinted.current) {
        // Snapshot the wrong UCI BEFORE calling submit() — the ref is read inside
        // api.complete's payload. Later misses on the same puzzle don't overwrite:
        // the first mistake is the diagnostic one, retries are just user recovery.
        wrongMoveRef.current = uci;
        submit(false);
      }
      failed.current = true;
      setFb({ kind: "bad", title: "Not the best", sub: "Try again." });
      // Snap the wrong move back. It was never applied to game.current, so
      // setFen() passes the same string and React skips the re-render -> the
      // Board sync effect never fires and chessground keeps the moved piece.
      // Re-assert lastMove with a fresh array ref so the effect runs and
      // api.set({ fen }) restores the true position.
      setFen(game.current.fen());
      setLastMove((lm) => (lm ? [lm[0], lm[1]] : lm));
      force((n) => n + 1);
    }
  }, [finish, oppReply, submit]);

  /** Parse SAN or UCI text and play it (used by Blindfold's text input). */
  const tryInput = useCallback((raw: string): boolean => {
    const text = raw.trim();
    if (!text || solved.current) return false;
    const tmp = new Chess(game.current.fen());
    let mv: any = null;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(text)) {
      try { mv = tmp.move({ from: text.slice(0, 2), to: text.slice(2, 4), promotion: (text[4]?.toLowerCase() as any) || "q" }); } catch { /* */ }
    }
    if (!mv) { try { mv = tmp.move(text); } catch { /* */ } }
    if (!mv) return false;
    onMove(mv.from as Key, mv.to as Key);
    return true;
  }, [onMove]);

  const showHint = useCallback(() => {
    hinted.current = true;
    const exp = solution.current[idx.current];
    if (exp) {
      setHintShapes([{ orig: exp.slice(0, 2) as Key, brush: "green" }]);
      setFb({ kind: "wait", title: "Hint", sub: `Move the piece on ${exp.slice(0, 2)}` });
    }
    force((n) => n + 1);
  }, []);

  const viewSolution = useCallback(() => {
    hinted.current = true;
    const step = () => {
      if (idx.current >= solution.current.length) {
        solved.current = true; setFb({ kind: "solved", title: "Solution", sub: "" }); force((n) => n + 1); return;
      }
      const mv = solution.current[idx.current];
      if (mv === undefined) return;
      game.current.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv[4] as any) || "q" });
      idx.current += 1;
      setLastMove([mv.slice(0, 2) as Key, mv.slice(2, 4) as Key]);
      setFen(game.current.fen());
      if (idx.current < solution.current.length) setTimeout(step, 500);
      else { solved.current = true; setFb({ kind: "solved", title: "Solution", sub: "" }); force((n) => n + 1); }
    };
    step();
  }, []);

  // Post-solve replay: step through the puzzle's positions with back/forward arrows.
  const replayView = useMemo(() => {
    if (replayPly == null || !puzzle) return null;
    const c = new Chess();
    try { c.load(puzzle.fen); } catch { return null; }
    let last: [Key, Key] | undefined = puzzle.lastMove
      ? [puzzle.lastMove.slice(0, 2) as Key, puzzle.lastMove.slice(2, 4) as Key]
      : undefined;
    for (let i = 0; i < replayPly && i < solution.current.length; i++) {
      const mv = solution.current[i];
      if (!mv) break;
      try {
        c.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: (mv[4] as any) || "q" });
        last = [mv.slice(0, 2) as Key, mv.slice(2, 4) as Key];
      } catch { break; }
    }
    return { fen: c.fen(), lastMove: last };
  }, [replayPly, puzzle]);
  const replayPrev = useCallback(() => setReplayPly((p) => Math.max(0, (p ?? solution.current.length) - 1)), []);
  const replayNext = useCallback(() => setReplayPly((p) => Math.min(solution.current.length, (p ?? solution.current.length) + 1)), []);

  // Post-solve "explore" sandbox: branch from the position currently shown and let
  // the player move BOTH sides to try their own lines (never touches the puzzle/rating).
  const startExplore = useCallback(() => {
    const base = replayPly != null && replayView ? replayView.fen : game.current.fen();
    try { exploreGame.current = new Chess(base); } catch { exploreGame.current = new Chess(); }
    setExploreLast(undefined);
    setExploreFen(exploreGame.current.fen());
  }, [replayPly, replayView]);
  const stopExplore = useCallback(() => { setExploreFen(null); setExploreLast(undefined); }, []);
  const exploreMove = useCallback((from: Key, to: Key) => {
    try { exploreGame.current.move({ from, to, promotion: "q" }); } catch { return; }
    setExploreLast([from, to]);
    setExploreFen(exploreGame.current.fen());
  }, []);
  const exploreUndo = useCallback(() => {
    exploreGame.current.undo();
    const h = exploreGame.current.history({ verbose: true });
    const l = h[h.length - 1] as any;
    setExploreLast(l ? [l.from as Key, l.to as Key] : undefined);
    setExploreFen(exploreGame.current.fen());
  }, []);
  const exploreDests = useMemo(() => (exploreFen ? destsFromChess(exploreGame.current as any) : new Map()), [exploreFen]);

  const next = useCallback(() => { try { localStorage.removeItem(STORE_KEY); } catch { /* */ } setReviewId(null); setNonce((n) => n + 1); practiceRef.current = false; setPractice(false); }, []);
  const review = useCallback((id: string) => { setReplayPly(null); setReviewId(id); practiceRef.current = false; setPractice(false); }, []);
  // Retry the current puzzle in practice mode — resets state locally on the same
  // puzzle object (no refetch, no rating impact). Called from the review view after
  // the player has seen the analysis and wants to attempt the solve themselves.
  const retry = useCallback(() => {
    if (!puzzle) return;
    practiceRef.current = true; setPractice(true);
    // Rebuild the game position from the puzzle's start fen and reset all per-solve flags.
    game.current = new Chess();
    try { game.current.load(puzzle.fen); } catch { /* */ }
    solution.current = puzzle.solution ?? [];
    idx.current = 0;
    solved.current = false;
    failed.current = false;
    hinted.current = false;
    wrongMoveRef.current = null;
    solveMsRef.current = null;
    setSolveMs(null);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setLastMove(puzzle.lastMove ? [puzzle.lastMove.slice(0, 2) as Key, puzzle.lastMove.slice(2, 4) as Key] : undefined);
    setFen(puzzle.fen);
    setReplayPly(null);
    setHintShapes([]);
    setRatingDiff(null);
    setMilestone(null);
    setFb({ kind: "wait", title: "Practice run", sub: "You've seen the answer — now find it yourself" });
    force((n) => n + 1);
  }, [puzzle]);

  const exploring = exploreFen != null;
  return {
    puzzle, isFetching,
    fen: exploring ? exploreFen! : replayView ? replayView.fen : fen,
    orientation,
    turnColor: exploring ? (exploreGame.current.turn() === "w" ? "white" : "black") : playerColor(),
    movableColor: exploring ? ("both" as const) : solved.current ? undefined : playerColor(),
    dests: exploring ? exploreDests : dests,
    lastMove: exploring ? exploreLast : replayView ? replayView.lastMove : lastMove,
    hintShapes: exploring ? [] : hintShapes,
    fb, ratingDiff, displayRating, milestone, clearMilestone: () => setMilestone(null),
    solveMs, practice,
    solved: solved.current, hinted: hinted.current, failed: failed.current,
    onMove: exploring ? exploreMove : onMove, tryInput, showHint, viewSolution, next, review, retry,
    replayPly, replayTotal: solution.current.length, replayPrev, replayNext,
    // Practice mode counts as NOT reviewing — the analysis card + arrows should hide
    // and the player interacts freshly with the same puzzle.
    reviewing: reviewId != null && !practice,
    exploring, startExplore, stopExplore, exploreUndo,
  };
}
