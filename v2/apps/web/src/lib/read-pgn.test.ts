// Board editor PGN loading (owner ask 2026-09-21: "in board editor, option to
// add chess pgn file"). The parse has more edge cases than it looks.
import { describe, it, expect } from "vitest";
import { readPgn, describePgn, listPgnGames } from "./read-pgn";

const ok = (r: ReturnType<typeof readPgn>) => {
  if (!r.ok) throw new Error("expected ok, got " + r.reason);
  return r;
};

describe("readPgn", () => {
  it("reads a full PGN with headers", () => {
    const r = ok(readPgn(`[Event "Test"]\n[White "Carlsen"]\n[Black "Nakamura"]\n\n1. d4 d5 2. Nf3 Nf6 *`));
    expect(r.sans).toEqual(["d4", "d5", "Nf3", "Nf6"]);
    expect(r.white).toBe("Carlsen");
    expect(r.black).toBe("Nakamura");
    expect(r.setupFen).toBeNull();
  });

  it("reads a bare move list with no headers at all", () => {
    const r = ok(readPgn("1. e4 e5 2. Nf3 Nc6"));
    expect(r.sans).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(r.white).toBeNull();
  });

  it("carries the FEN of a game that starts from a custom position", () => {
    // Without this the moves replay onto the standard start and land wrong.
    const r = ok(readPgn(`[SetUp "1"]\n[FEN "8/8/8/4k3/8/4P3/4K3/8 w - - 0 1"]\n\n1. e4 Kd6 *`));
    expect(r.setupFen).toBe("8/8/8/4k3/8/4P3/4K3/8 w - - 0 1");
    expect(r.sans).toEqual(["e4", "Kd6"]);
  });

  it("treats chess.js's \"?\" placeholder as no name, not a player called ?", () => {
    const r = ok(readPgn(`[Event "X"]\n\n1. e4 *`));
    expect(r.white).toBeNull();
    expect(r.black).toBeNull();
  });

  it("rejects empty input", () => {
    expect(readPgn("")).toEqual({ ok: false, reason: "empty" });
    expect(readPgn("   \n  ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects garbage instead of throwing", () => {
    // chess.js 1.4.0 throws here; the helper must absorb it.
    expect(readPgn("this is not a pgn at all")).toEqual({ ok: false, reason: "unparsable" });
  });

  it("rejects a headers-only PGN as having no moves", () => {
    expect(readPgn(`[Event "Empty"]\n[White "A"]\n[Black "B"]\n\n*`)).toEqual({ ok: false, reason: "no-moves" });
  });

  it("takes the first game when a file holds several", () => {
    const two = `[White "A"]\n\n1. e4 e5 1-0\n\n[White "B"]\n\n1. d4 d5 0-1`;
    const r = ok(readPgn(two));
    expect(r.sans).toEqual(["e4", "e5"]);
    expect(r.white).toBe("A");
  });

  it("describes what was loaded", () => {
    expect(describePgn(ok(readPgn(`[White "Carlsen"]\n[Black "Nakamura"]\n\n1. d4 d5 *`))))
      .toBe("Loaded 1 move — Carlsen vs Nakamura.");
    expect(describePgn(ok(readPgn("1. e4 e5 2. Nf3 Nc6")))).toBe("Loaded 2 moves.");
  });
});

describe("listPgnGames — choosing from a multi-game file", () => {
  const TWO = `[Event "City Open"]
[Date "2026.03.01"]
[White "Carlsen"]
[Black "Nakamura"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0

[Event "City Open"]
[White "Ding"]
[Black "Gukesh"]
[Result "0-1"]

1. d4 d5 2. c4 dxc4 3. e3 0-1`;

  it("finds every game, not just the first", () => {
    const g = listPgnGames(TWO);
    expect(g).toHaveLength(2);
    expect(g[0]!.white).toBe("Carlsen");
    expect(g[1]!.white).toBe("Ding");
  });

  it("carries what the picker needs to label each one", () => {
    const [a, b] = listPgnGames(TWO);
    expect(a).toMatchObject({ index: 0, black: "Nakamura", result: "1-0", moves: 2, event: "City Open", date: "2026.03.01" });
    expect(b).toMatchObject({ index: 1, black: "Gukesh", result: "0-1", moves: 3 });
    expect(b!.date).toBeNull();          // no Date header on the second
  });

  it("hands back each game's own text, loadable on its own", () => {
    const g = listPgnGames(TWO);
    const second = readPgn(g[1]!.text);
    expect(second.ok && second.sans).toEqual(["d4", "d5", "c4", "dxc4", "e3"]);
  });

  it("returns a single entry for a one-game file", () => {
    expect(listPgnGames("1. e4 e5")).toHaveLength(1);
  });

  it("returns nothing for an empty file", () => {
    expect(listPgnGames("")).toHaveLength(0);
    expect(listPgnGames("   ")).toHaveLength(0);
  });

  it("still lists a game it cannot parse, so the numbering does not shift", () => {
    const mixed = `[White "Good"]\n\n1. e4 e5 *\n\n[White "Bad"]\n\n1. zz9 qq8 *`;
    const g = listPgnGames(mixed);
    expect(g).toHaveLength(2);
    expect(g[0]!.moves).toBe(1);
    expect(g[1]!.moves).toBe(0);          // unparsable, but still present
  });
});
