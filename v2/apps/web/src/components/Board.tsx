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
  shapes?: DrawShape[];                // arrows/circles (hints, engine PV, coach annotations)
  onShapesChange?: (shapes: DrawShape[]) => void; // fires on user draw/clear (right-click)
  onMove?: (from: Key, to: Key) => void;
  onPremove?: (from: Key, to: Key) => void;
  premovable?: boolean;
  /** Show chessground's legal-move dots when a piece is selected. Default false. */
  showDests?: boolean;
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
  onShapesChange,
  onMove,
  onPremove,
  premovable = false,
  onSelect,
  showDests = false,
  className = "",
}: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  // chessground is created once, so its event handlers would capture the
  // first-render callbacks — when the puzzle is still loading, submit() closes
  // over an undefined puzzle and bails. Route events through refs kept current
  // each render so the live onMove/submit always runs.
  const onMoveRef = useRef(onMove);
  const onPremoveRef = useRef(onPremove);
  const onSelectRef = useRef(onSelect);
  const onShapesChangeRef = useRef(onShapesChange);
  useEffect(() => { onMoveRef.current = onMove; onPremoveRef.current = onPremove; onSelectRef.current = onSelect; onShapesChangeRef.current = onShapesChange; });

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
        showDests, // caller opts in (practice pages set true)
        events: { after: (from, to) => onMoveRef.current?.(from, to) },
      },
      premovable: {
        enabled: premovable,
        showDests: true,
        events: { set: (orig, dest) => onPremoveRef.current?.(orig, dest) },
      },
      selectable: { enabled: true },
      events: { select: (key) => onSelectRef.current?.(key) },
      // drawable.onChange fires when the USER draws/erases shapes via right-click.
      // Programmatic setShapes() from the sync effect below does NOT trigger it, so
      // there's no echo loop with remote annotations.
      drawable: { enabled: true, visible: true,
        onChange: (s) => onShapesChangeRef.current?.(s) },
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
    api.current?.cancelPremove();
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
