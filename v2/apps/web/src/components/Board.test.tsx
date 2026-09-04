import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { Chessground as realChessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";

// Board never exposes its chessground instance, so wrap the factory to grab it.
const { instances } = vi.hoisted(() => ({ instances: [] as Api[] }));
vi.mock("chessground", async (importOriginal) => {
  const actual = await importOriginal<typeof import("chessground")>();
  return {
    ...actual,
    Chessground: (el: HTMLElement, cfg: any) => {
      const api = actual.Chessground(el, cfg);
      instances.push(api);
      return api;
    },
  };
});

import Board from "./Board";

/** Tap-to-move, the way a student plays: select origin, then select destination.
 *  chessground defers its `after` callback through setTimeout, so flush before asserting. */
async function tapMove(api: Api, from: Key, to: Key) {
  await act(async () => {
    api.selectSquare(from);
    api.selectSquare(to);
    await new Promise((r) => setTimeout(r, 5));
  });
}

beforeEach(() => {
  instances.length = 0;
});

describe("chessground contract", () => {
  // The landmine behind the 2026-09-04 puzzle freeze. If a chessground upgrade ever
  // changes this, the `dests` re-push dance in usePuzzleGame/Board becomes dead code
  // and this test tells you so instead of leaving it silently rotting.
  it("wipes its own movable.dests and flips turnColor after an accepted user move", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const api = realChessground(el, {
      fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
      turnColor: "white",
      movable: { free: false, color: "white", dests: new Map([["a1", ["a7", "a8"]]]) },
      selectable: { enabled: true },
    });

    expect(api.state.movable.dests?.size).toBe(1);
    await tapMove(api, "a1", "a7");

    expect(api.state.movable.dests).toBeUndefined();
    expect(api.state.turnColor).toBe("black");
  });
});

describe("Board dests sync", () => {
  const FEN = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
  const mkDests = () => new Map<Key, Key[]>([["a1", ["a7", "a8"] as Key[]]]);
  // usePuzzleGame re-asserts lastMove with a fresh array on a rollback so Board's
  // fen/lastMove effect re-fires and snaps the piece back. Mirror that here, so the
  // ONLY variable between the two tests below is the dests Map identity.
  const mkLastMove = () => ["b1", "a1"] as [Key, Key];

  // Board's "sync everything but the fen" effect is keyed on the IDENTITY of `dests`.
  // That is the whole contract callers depend on to revive the board after a rollback
  // to the same position, so pin it down from both sides.
  it("re-arms chessground when the parent hands a new dests Map at the same fen", async () => {
    const onMove = vi.fn();
    const { rerender } = render(
      <Board fen={FEN} turnColor="white" movableColor="white" dests={mkDests()} lastMove={mkLastMove()} onMove={onMove} />
    );
    const api = instances[0]!;

    await tapMove(api, "a1", "a7");
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(api.state.movable.dests).toBeUndefined();

    // Same fen (the move was rejected and rolled back), fresh Map.
    rerender(<Board fen={FEN} turnColor="white" movableColor="white" dests={mkDests()} lastMove={mkLastMove()} onMove={onMove} />);

    expect(api.state.movable.dests?.size).toBe(1);
    expect(api.state.turnColor).toBe("white");
    await tapMove(api, "a1", "a8");
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it("stays dead when the parent re-renders with the SAME dests Map identity", async () => {
    const onMove = vi.fn();
    const dests = mkDests(); // reused on purpose — this is the shape of the old bug
    const { rerender } = render(
      <Board fen={FEN} turnColor="white" movableColor="white" dests={dests} lastMove={mkLastMove()} onMove={onMove} />
    );
    const api = instances[0]!;

    await tapMove(api, "a1", "a7");
    rerender(<Board fen={FEN} turnColor="white" movableColor="white" dests={dests} lastMove={mkLastMove()} onMove={onMove} />);

    expect(api.state.movable.dests).toBeUndefined();
    await tapMove(api, "a1", "a8");
    expect(onMove).toHaveBeenCalledTimes(1); // second move never reached the caller
  });
});
