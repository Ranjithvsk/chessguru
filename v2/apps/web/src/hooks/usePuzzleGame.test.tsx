import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";

// Mate-in-1: Ra1-a8#. a1a7 is legal but wrong — exactly the "legal but not the
// solution" move that froze the board for Harinitha on 2026-09-04.
const PUZZLE = {
  id: "TEST01",
  fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
  solution: ["a1a8"],
  rating: 1500,
  lastMove: "b1a1",
  themes: ["mateIn1"],
};

const complete = vi.fn(async (_id: string, _body: Record<string, unknown>) => ({ ratingDiff: 0 }));
vi.mock("../lib/api", () => ({
  api: {
    randomPuzzle: async () => PUZZLE,
    puzzleById: async () => PUZZLE,
    complete: (...args: unknown[]) => (complete as any)(...args),
  },
}));

// usePuzzleGame drives chessground only through Board's props; grab the live
// instance so the test can play moves the way a student does (tap origin, tap dest).
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

import Board from "../components/Board";
import { usePuzzleGame } from "./usePuzzleGame";

function Harness() {
  const g = usePuzzleGame({ theme: "mix", difficulty: "normal", userId: "u1", initialRating: 1500 });
  return (
    <>
      <div data-testid="pid">{g.puzzle?.id ?? "loading"}</div>
      <div data-testid="fb">{g.fb.title}</div>
      <div data-testid="dests">{g.dests?.size ?? -1}</div>
      <Board
        fen={g.fen}
        orientation={g.orientation}
        turnColor={g.turnColor}
        movableColor={g.movableColor}
        dests={g.dests}
        lastMove={g.lastMove}
        onMove={g.onMove}
      />
    </>
  );
}

/** chessground defers movable.events.after through setTimeout — flush before asserting. */
async function tapMove(from: Key, to: Key) {
  await act(async () => {
    instances[0]!.selectSquare(from);
    instances[0]!.selectSquare(to);
    await new Promise((r) => setTimeout(r, 5));
  });
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>
  );
  await screen.findByText(PUZZLE.id);
  // The fetch resolving and chessground actually holding the puzzle position are two
  // separate commits — wait for the board itself, not just the rendered id.
  await waitFor(() => expect(instances[0]!.state.pieces.get("a1")?.role).toBe("rook"));
}

beforeEach(() => {
  instances.length = 0;
  localStorage.clear();
  complete.mockClear();
});

describe("usePuzzleGame — wrong move must not freeze the board", () => {
  // The 2026-09-04 regression: chessground clears its own movable.dests after every
  // accepted user move. A wrong move rolls back to the SAME fen, so a dests memo keyed
  // only on `fen` handed Board an identical Map, Board's sync effect never fired, and
  // the board was left with no legal destinations — nothing could be moved or even
  // selected. The board must come back armed.
  it("hands Board a fresh, non-empty dests Map after a wrong move", async () => {
    await mount();
    const before = screen.getByTestId("dests").textContent;
    expect(Number(before)).toBeGreaterThan(0);

    await tapMove("a1", "a7");

    expect(screen.getByTestId("fb").textContent).toBe("Not the best");
    expect(instances[0]!.state.movable.dests?.size).toBeGreaterThan(0);
    expect(instances[0]!.state.turnColor).toBe("white");
  });

  it("still solves when the correct move is played after a wrong one", async () => {
    await mount();

    await tapMove("a1", "a7");
    expect(screen.getByTestId("fb").textContent).toBe("Not the best");

    await tapMove("a1", "a8");
    expect(screen.getByTestId("fb").textContent).toBe("Solved!");
  });

  it("survives two wrong moves in a row", async () => {
    await mount();

    await tapMove("a1", "a7");
    await tapMove("a1", "a6");
    expect(screen.getByTestId("fb").textContent).toBe("Not the best");

    await tapMove("a1", "a8");
    expect(screen.getByTestId("fb").textContent).toBe("Solved!");
  });

  // Client half of the double-deduction guard (SAFEGUARD 5 is the server half):
  // only the FIRST miss on a puzzle is reported, so retries in the same session
  // don't charge the rating again.
  it("reports the miss to the server only once per mount", async () => {
    await mount();

    await tapMove("a1", "a7");
    await tapMove("a1", "a6");

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![1]).toMatchObject({ win: false, wrong: "a1a7" });
  });
});
