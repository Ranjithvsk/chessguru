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
  // Force-populate the board even from an illegal FEN (no king, two kings same
  // side, etc.). Vision pipelines often produce partially-wrong FENs; instead
  // of discarding, we lay down every recognised piece so the coach only fixes
  // the wrong squares. Strict load first (keeps turn/castling metadata when
  // valid); otherwise placement via chess.js put() which bypasses legality.
  const loadPermissive = (f: string): boolean => {
    if (load(f)) return true;
    const boardPart = (f || "").split(" ")[0] || "";
    if (!/^[rnbqkpRNBQKP1-8/]+$/.test(boardPart)) return false;
    if (load(`${boardPart} w - - 0 1`)) return true;
    try {
      game.current.clear();
      const ranks = boardPart.split("/");
      for (let r = 0; r < Math.min(8, ranks.length); r++) {
        let file = 0;
        for (const ch of ranks[r]!) {
          if (ch >= "1" && ch <= "8") { file += ch.charCodeAt(0) - 48; continue; }
          const color = ch === ch.toUpperCase() ? "w" : "b";
          const type = ch.toLowerCase() as "p" | "n" | "b" | "r" | "q" | "k";
          const square = String.fromCharCode(97 + file) + String(8 - r);
          try { game.current.put({ type, color }, square as any); } catch { /* skip bad square */ }
          file++;
        }
      }
      sync();
      return true;
    } catch { return false; }
  };
  const flip = () => setOrientation((o) => (o === "white" ? "black" : "white"));

  return { game, fen, orientation, turnColor, history, dests, onMove, undo, reset, load, loadPermissive, flip };
}
