import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key, Color, Dests } from "chessground/types";
import type { DrawShape } from "chessground/draw";

/**
 * The single shared chess board for ChessGuru v2.
 * Every page (Puzzles, Blindfold, Theme, Opening, Engine Battle, Board Editor)
 * renders THIS component and only varies the props.
 */
export interface BoardProps {
  fen: string;
  orientation?: Color;                 // default "white"
  turnColor?: Color;                   // whose move it is
  movableColor?: Color | "both";       // who may move (undefined = nobody)
  dests?: Dests;                       // legal destinations per square
  lastMove?: [Key, Key];
  check?: boolean;                     // highlight the side-to-move's king
  viewOnly?: boolean;                  // spectator (Engine Battle)
  coordinates?: boolean;               // default true
  blindfold?: boolean;                 // hide pieces (Blindfold mode)
  shapes?: DrawShape[];                // arrows/circles (hints, engine PV)
  onMove?: (from: Key, to: Key) => void;
  onSelect?: (key: Key) => void;
  className?: string;
}

export default function Board({
  fen,
  orientation = "white",
  turnColor,
  movableColor,
  dests,
  lastMove,
  check = false,
  viewOnly = false,
  coordinates = true,
  blindfold = false,
  shapes,
  onMove,
  onSelect,
  className = "",
}: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  // create once
  useEffect(() => {
    if (!el.current) return;
    const config: Config = {
      fen,
      orientation,
      turnColor,
      coordinates,
      viewOnly,
      lastMove,
      check: check ? turnColor : undefined,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: movableColor,
        dests,
        showDests: true,
        events: { after: (from, to) => onMove?.(from, to) },
      },
      selectable: { enabled: true },
      events: { select: (key) => onSelect?.(key) },
      drawable: { enabled: true, visible: true },
    };
    api.current = Chessground(el.current, config);
    if (shapes) api.current.setShapes(shapes);
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sync on prop changes
  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      turnColor,
      coordinates,
      viewOnly,
      lastMove,
      check: check ? turnColor : undefined,
      movable: { color: movableColor, dests },
    });
  }, [fen, orientation, turnColor, coordinates, viewOnly, lastMove, check, movableColor, dests]);

  // shapes (hints / engine arrows)
  useEffect(() => {
    api.current?.setShapes(shapes ?? []);
  }, [shapes]);

  return (
    <div className={`cg-board-wrap ${blindfold ? "blindfold" : ""} ${className}`}>
      <div ref={el} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

/** Build chessground dests from a chess.js instance (shared helper). */
export function destsFromChess(game: { moves: (o: { verbose: true }) => Array<{ from: string; to: string }> }): Dests {
  const m: Dests = new Map();
  for (const mv of game.moves({ verbose: true })) {
    const arr = m.get(mv.from as Key) ?? [];
    arr.push(mv.to as Key);
    m.set(mv.from as Key, arr);
  }
  return m;
}
