import { useState } from "react";
import type { Color } from "chessground/types";
import Board from "./Board";
import { usePassPlay, type Promo } from "../hooks/usePassPlay";

const PROMO_PIECES: { p: Promo; glyph: string }[] = [
  { p: "q", glyph: "♛" },
  { p: "r", glyph: "♜" },
  { p: "b", glyph: "♝" },
  { p: "n", glyph: "♞" },
];

/**
 * Offline "pass & play": White and Black take turns on the same device, like a
 * real board. Auto-flip rotates the board to the side to move; turn it off to
 * keep one fixed orientation (true over-the-board feel).
 */
export default function PassPlay() {
  const g = usePassPlay();
  const [autoFlip, setAutoFlip] = useState(true);
  const [manualOrient, setManualOrient] = useState<Color>("white");

  const orientation: Color = autoFlip ? g.turn : manualOrient;
  const turnLabel = g.turn === "white" ? "White" : "Black";

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,520px)_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm text-ink-300">
          <span>{orientation === "white" ? "Black" : "White"}</span>
          <span className="text-ink-500">top</span>
        </div>

        <div className="relative">
          <Board
            key={g.boardEpoch}
            fen={g.fen}
            orientation={orientation}
            turnColor={g.turn}
            movableColor={g.gameOver ? undefined : g.turn}
            dests={g.gameOver ? undefined : g.dests}
            lastMove={g.lastMove}
            check={g.isCheck}
            viewOnly={g.gameOver}
            onMove={g.onMove}
          />

          {g.pendingPromotion && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-ink-900/70" data-testid="local-promo-overlay">
              <div className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-center">
                <div className="mb-2 text-sm text-ink-300">Promote to</div>
                <div className="flex gap-2">
                  {PROMO_PIECES.map(({ p: pc, glyph }) => (
                    <button
                      key={pc}
                      onClick={() => g.choosePromotion(pc)}
                      className="grid h-12 w-12 place-items-center rounded-lg bg-ink-800 text-2xl text-white hover:bg-brand-600"
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
                <button onClick={g.cancelPromotion} className="mt-3 text-xs text-ink-400 hover:text-white">
                  cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-sm text-ink-300">
          <span>{orientation}</span>
          <span className="text-ink-500">bottom</span>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-ink-400">Status</div>
          <div className="text-lg font-semibold text-white" data-testid="local-status">
            {g.result ? g.result : `${turnLabel} to move${g.isCheck ? " — check!" : ""}`}
          </div>
          <div className="mt-1 text-sm text-ink-400">
            {g.moves.length} move{g.moves.length === 1 ? "" : "s"} played
          </div>
        </div>

        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <label className="flex items-center justify-between gap-3 text-sm text-ink-200">
            <span>Auto-flip board each turn</span>
            <input
              type="checkbox"
              checked={autoFlip}
              onChange={(e) => setAutoFlip(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setManualOrient((o) => (o === "white" ? "black" : "white"))}
              disabled={autoFlip}
              className="flex-1 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40"
            >
              Flip board
            </button>
            <button
              onClick={g.undo}
              disabled={!g.canUndo}
              className="flex-1 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40"
            >
              Undo
            </button>
          </div>
          <button
            onClick={g.reset}
            className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500"
          >
            New game
          </button>
        </div>

        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-ink-400">Moves</div>
          <ol className="grid grid-cols-2 gap-x-4 font-mono text-sm text-ink-200">
            {g.moves.map((m, i) => (
              <li key={i}>
                {i % 2 === 0 ? `${i / 2 + 1}. ` : ""}
                {m}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
