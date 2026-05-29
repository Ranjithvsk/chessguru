import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
}

/** Shared puzzle-solving engine used by Puzzles, Theme and Blindfold pages. */
export function usePuzzleGame(opts: UsePuzzleGameOpts) {
  const { theme, difficulty, userId, initialRating, mode = "puzzle", maxPc } = opts;
  const [nonce, setNonce] = useState(0);

  const { data: puzzle, isFetching } = useQuery({
    queryKey: ["puzzle", mode, theme, difficulty, maxPc ?? 0, nonce],
    queryFn: () => api.randomPuzzle({ theme, rating: initialRating, difficulty, maxPc }),
  });

  const game = useRef(new Chess());
  const solution = useRef<string[]>([]);
  const idx = useRef(0);
  const solved = useRef(false);
  const failed = useRef(false);
  const hinted = useRef(false);

  const [fen, setFen] = useState("start");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const [hintShapes, setHintShapes] = useState<DrawShape[]>([]);
  const [fb, setFb] = useState<FB>({ kind: "wait", title: "Your turn", sub: "Find the best move" });
  const [ratingDiff, setRatingDiff] = useState<number | null>(null);
  const [displayRating, setDisplayRating] = useState(initialRating);
  const [, force] = useState(0);

  useEffect(() => setDisplayRating(initialRating), [initialRating]);

  const playerColor = (): "white" | "black" => (game.current.turn() === "w" ? "white" : "black");

  const dests = useMemo(() => (solved.current ? new Map() : destsFromChess(game.current as any)), [fen]);

  useEffect(() => {
    if (!puzzle) return;
    game.current = new Chess();
    try { game.current.load(puzzle.fen); } catch { /* ignore bad fen */ }
    solution.current = puzzle.solution ?? [];
    idx.current = 0;
    solved.current = false;
    failed.current = false;
    hinted.current = false;
    const pc = playerColor();
    setOrientation(pc);
    setLastMove(puzzle.lastMove ? [puzzle.lastMove.slice(0, 2) as Key, puzzle.lastMove.slice(2, 4) as Key] : undefined);
    setHintShapes([]);
    setFen(puzzle.fen);
    setRatingDiff(null);
    setFb({ kind: "wait", title: "Your turn", sub: `Find the best move for ${pc}` });
  }, [puzzle]);

  const submit = useCallback((win: boolean) => {
    if (!puzzle) return;
    api.complete(puzzle.id, {
      win, hint: hinted.current, difficulty, userId,
      mode, rating: displayRating, deviation: 200,
    }).then((r) => {
      if (typeof r.ratingDiff === "number") setRatingDiff(r.ratingDiff);
      if (r.glicko) setDisplayRating(Math.round(r.glicko.r));
    }).catch(() => {});
  }, [puzzle, difficulty, userId, mode, displayRating]);

  const finish = useCallback(() => {
    solved.current = true;
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
      if (!failed.current && !hinted.current) submit(false); // deduct once
      failed.current = true;
      setFb({ kind: "bad", title: "Not the best", sub: "Try again." });
      setFen(game.current.fen()); // snap back
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

  const next = useCallback(() => setNonce((n) => n + 1), []);

  return {
    puzzle, isFetching,
    fen, orientation, turnColor: playerColor(),
    movableColor: solved.current ? undefined : playerColor(),
    dests, lastMove, hintShapes,
    fb, ratingDiff, displayRating,
    solved: solved.current, hinted: hinted.current, failed: failed.current,
    onMove, tryInput, showHint, viewSolution, next,
  };
}
