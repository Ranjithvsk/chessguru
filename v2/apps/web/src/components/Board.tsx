import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key } from "chessground/types";

export interface BoardProps {
  fen: string;
  orientation: "white" | "black";
  turnColor: "white" | "black";
  movableColor?: "white" | "black";
  dests?: Map<Key, Key[]>;
  lastMove?: [Key, Key];
  onMove?: (from: Key, to: Key) => void;
}

/** Thin React wrapper around chessground. */
export default function Board({
  fen, orientation, turnColor, movableColor, dests, lastMove, onMove,
}: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const config: Config = {
      fen, orientation, turnColor, lastMove,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: movableColor,
        dests,
        events: { after: (from, to) => onMove?.(from, to) },
      },
      drawable: { enabled: true },
    };
    apiRef.current = Chessground(el.current, config);
    return () => apiRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiRef.current?.set({
      fen, orientation, turnColor, lastMove,
      movable: { color: movableColor, dests },
    });
  }, [fen, orientation, turnColor, movableColor, dests, lastMove]);

  return (
    <div className="cg-board-wrap">
      <div ref={el} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
