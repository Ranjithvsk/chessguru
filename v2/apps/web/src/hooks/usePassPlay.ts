import { useCallback, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { Key, Color } from "chessground/types";
import { destsFromChess } from "../components/Board";

export type Promo = "q" | "r" | "b" | "n";

const isPromotion = (game: Chess, from: Key, to: Key): boolean => {
  const piece = game.get(from as Square);
  return piece?.type === "p" && (to[1] === "8" || to[1] === "1");
};

/**
 * A fully local, offline "pass & play" chess game — both colours share one
 * device like a real board. No server, no network: the whole game lives in a
 * single client-side chess.js instance, so it works with no connection.
 */
export function usePassPlay() {
  const game = useRef(new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [turn, setTurn] = useState<Color>("white");
  const [moves, setMoves] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Key; to: Key } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [boardEpoch, setBoardEpoch] = useState(0);

  const sync = useCallback(() => {
    const g = game.current;
    setFen(g.fen());
    setTurn(g.turn() === "w" ? "white" : "black");
    setMoves(g.history());
    if (g.isGameOver()) {
      if (g.isCheckmate()) setResult(`Checkmate — ${g.turn() === "w" ? "Black" : "White"} wins`);
      else if (g.isStalemate()) setResult("Draw — stalemate");
      else if (g.isInsufficientMaterial()) setResult("Draw — insufficient material");
      else if (g.isThreefoldRepetition()) setResult("Draw — threefold repetition");
      else if (g.isDraw()) setResult("Draw — 50-move rule");
      else setResult("Game over");
    } else {
      setResult(null);
    }
  }, []);

  const apply = useCallback((from: Key, to: Key, promotion?: Promo) => {
    try {
      const mv = game.current.move({ from: from as string, to: to as string, promotion: promotion ?? "q" });
      if (!mv) return;
      setLastMove([from, to]);
      sync();
    } catch {
      // illegal move — snap the piece back by forcing a board resync
      setBoardEpoch((n) => n + 1);
    }
  }, [sync]);

  const onMove = useCallback((from: Key, to: Key) => {
    if (game.current.isGameOver()) return;
    if (isPromotion(game.current, from, to)) {
      setPendingPromotion({ from, to });
      return;
    }
    apply(from, to);
  }, [apply]);

  const choosePromotion = useCallback((p: Promo) => {
    setPendingPromotion((pp) => {
      if (pp) apply(pp.from, pp.to, p);
      return null;
    });
  }, [apply]);

  const cancelPromotion = useCallback(() => {
    setPendingPromotion(null);
    setBoardEpoch((n) => n + 1); // remount the board so the dragged pawn snaps back
  }, []);

  const undo = useCallback(() => {
    game.current.undo();
    setLastMove(undefined);
    setPendingPromotion(null);
    setBoardEpoch((n) => n + 1);
    sync();
  }, [sync]);

  const reset = useCallback(() => {
    game.current = new Chess();
    setLastMove(undefined);
    setPendingPromotion(null);
    setBoardEpoch((n) => n + 1);
    sync();
  }, [sync]);

  const dests = useMemo(() => (game.current.isGameOver() ? new Map() : destsFromChess(game.current as any)), [fen]);
  const isCheck = game.current.isCheck();
  const gameOver = game.current.isGameOver();

  return {
    fen, turn, moves, lastMove, pendingPromotion, result, dests, isCheck, gameOver, boardEpoch,
    onMove, choosePromotion, cancelPromotion, undo, reset,
    canUndo: moves.length > 0,
  };
}
