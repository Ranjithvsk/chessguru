import { useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { destsFromChess } from "../components/Board";

/** Free-play board state (both sides movable) — shared by Opening & Board Editor. */
export function useFreePlay(initialFen?: string) {
  const game = useRef(initialFen ? new Chess(initialFen) : new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [history, setHistory] = useState<string[]>([]);

  const dests = useMemo(() => destsFromChess(game.current as any), [fen]);
  const turnColor: "white" | "black" = game.current.turn() === "w" ? "white" : "black";

  const sync = () => { setFen(game.current.fen()); setHistory(game.current.history()); };

  const onMove = (from: Key, to: Key) => {
    try {
      const mv = game.current.move({ from, to, promotion: "q" });
      if (mv) sync();
    } catch { /* illegal */ }
  };
  const undo = () => { game.current.undo(); sync(); };
  const reset = () => { game.current.reset(); setFen(game.current.fen()); setHistory([]); };
  const load = (f: string): boolean => {
    try { game.current.load(f); setFen(game.current.fen()); setHistory([]); return true; }
    catch { return false; }
  };
  const flip = () => setOrientation((o) => (o === "white" ? "black" : "white"));

  return { game, fen, orientation, turnColor, history, dests, onMove, undo, reset, load, flip };
}
