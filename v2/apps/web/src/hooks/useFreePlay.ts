import { useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { destsFromChess } from "../components/Board";

/** Free-play board state (both sides movable) — shared by Opening & Board Editor.
 *  Records a FULL move list independent of the current viewing position so a
 *  user can rewind with ◀/▶ without losing "future" moves (Lichess analysis
 *  semantics). Playing a NEW move while rewound truncates the future and
 *  branches. `history` is the moves currently applied to the board
 *  (= line.slice(0, ply)); consumers that only care about the on-screen
 *  position keep using it. */
export function useFreePlay(initialFen?: string) {
  const game = useRef(initialFen ? new Chess(initialFen) : new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [line, setLine] = useState<string[]>([]);         // full recorded move list
  const [ply, setPly] = useState(0);                       // current viewing position (0..line.length)
  const history = useMemo(() => line.slice(0, ply), [line, ply]);

  const dests = useMemo(() => destsFromChess(game.current as any), [fen]);
  const turnColor: "white" | "black" = game.current.turn() === "w" ? "white" : "black";

  // Replay the first `n` moves of `sans` onto a fresh chess instance and sync
  // fen state. Used by every navigation entry point (goTo, load, loadSans).
  const applyPly = (sans: string[], n: number) => {
    game.current.reset();
    for (let i = 0; i < Math.min(n, sans.length); i++) {
      try { if (!game.current.move(sans[i]!)) break; } catch { break; }
    }
    setFen(game.current.fen());
  };

  const onMove = (from: Key, to: Key) => {
    // Case 1: rewound and the played move matches the "next" recorded move —
    // just advance the cursor, don't touch `line`. Keeps the redo path alive.
    const next = line[ply];
    try {
      const test = new Chess();
      for (let i = 0; i < ply; i++) test.move(line[i]!);
      const mv = test.move({ from, to, promotion: "q" });
      if (!mv) return;                                     // illegal
      if (next && mv.san === next) {
        setPly(ply + 1);
        applyPly(line, ply + 1);
        return;
      }
      // Case 2: NEW move — truncate future, append, advance.
      const nextLine = line.slice(0, ply).concat(mv.san);
      setLine(nextLine);
      setPly(ply + 1);
      applyPly(nextLine, ply + 1);
    } catch { /* illegal */ }
  };
  const goTo = (n: number) => {
    const clamped = Math.max(0, Math.min(line.length, n));
    setPly(clamped);
    applyPly(line, clamped);
  };
  const goPrev = () => goTo(ply - 1);
  const goNext = () => goTo(ply + 1);
  // Legacy undo — kept for callers that expect "step back one move". Lichess
  // analysis behaves the same: undo doesn't discard, it just rewinds.
  const undo = () => goPrev();
  const reset = () => {
    game.current.reset();
    setFen(game.current.fen());
    setLine([]);
    setPly(0);
  };
  const load = (f: string): boolean => {
    try {
      game.current.load(f);
      setFen(game.current.fen());
      setLine([]);
      setPly(0);
      return true;
    } catch { return false; }
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
      setFen(game.current.fen());
      setLine([]);
      setPly(0);
      return true;
    } catch { return false; }
  };
  const flip = () => setOrientation((o) => (o === "white" ? "black" : "white"));
  // Replay a SAN move list from the start position — used by the Openings hub
  // when the user picks a variation from the finder tree; keeps `history`
  // populated so the "🧠 Memorize" handoff still knows what line was reached.
  const loadSans = (sans: string[]): boolean => {
    setLine(sans);
    setPly(sans.length);
    applyPly(sans, sans.length);
    return true;
  };

  return {
    game, fen, orientation, turnColor, history, line, ply,
    dests, onMove, undo, goPrev, goNext, goTo, reset, load, loadPermissive, loadSans, flip,
  };
}
