// Triangulation corpus v1 — 11 positions, every one verified with Stockfish
// before it was written down.
//
// Sources: Mark Dvoretsky, "Dvoretsky's Endgame Manual" (Russell Enterprises,
// 2015), chapter "Triangulation" — read from the academy's own chess library
// (gdrive:Chess/Endgame). Two complete examples are reproduced: Dvoretsky's
// introductory K+2P vs K+P position, and H. Neustadtl's 1898 study (the second,
// triangulation-based solution Dvoretsky found in 1968).
//
// Verification: every FEN below was checked with Stockfish. The engine agrees
// with the book on the result AND on the key moves — including Dvoretsky's
// warnings: 1.c6+? throws the win (engine: 0.00 after the book's drawing line),
// and 1.Ke3? in the Neustadtl study draws after 1...Ke5! (engine: 0.00).
//
// Fahrni-Alapin 1912 was recovered the hard way. Dvoretsky prints it as a
// diagram, and the diagram is an image, so the prose alone never says where the
// pawns are — every reconstruction from the moves evaluated as a draw. It was
// found instead in Panchenko's "Theory and Practice of Chess Endings", which
// embeds its diagrams as text in the Informator diagram font; decoded, it gives
// the missing a5/a6 pawns, and the engine then confirms the win.
//
// Yudasin-Osnos 1987, from the same chapter, is still absent for exactly that
// reason: no readable diagram has turned up, and every reconstruction from the
// prose evaluates as a draw where the book claims a win. Better absent than wrong.

export type TriangulationPattern =
  | "triangle"
  | "correspondence"
  | "conversion"
  | "pitfall";

export interface TriangulationPosition {
  id: string;
  name: string;
  pattern: TriangulationPattern;
  fen: string;
  /** Best move in SAN — the "correct" answer for practice mode. */
  bestMoveSan: string;
  /** Best move in UCI (from-to) — what practice mode matches against. */
  bestMoveUci: string;
  /** Other moves that win just as well — practice accepts these too. */
  altMoveUci?: string[];
  source: string;
  mechanism: string;
  /** The book continuation, for the study panel. */
  line?: string;
  /** What the engine said, so a coach can re-check the claim. */
  engine?: string;
  /** Rough "find the move" Elo difficulty (400-2500). */
  difficulty: number;
  /** Text under the answer indicating what happens (win / draw / loss). */
  outcome?: string;
  /** Demonstration positions — shown in Study, never served in Practice. */
  studyOnly?: boolean;
  /** Asked before the answer is shown, so the student thinks first. */
  think?: string;
  /** Short discussion of the answer — the idea, not just the move. */
  discussion?: string;
}

export const TRIANGULATION_PATTERNS: Array<{ id: TriangulationPattern; label: string; blurb: string }> = [
  { id: "triangle",       label: "The king's triangle",  blurb: "Three king moves to return to the same square, so the opponent has to move instead of you." },
  { id: "correspondence", label: "Corresponding squares", blurb: "Work out which squares pair up, then triangulate onto the one that puts the enemy king in zugzwang." },
  { id: "conversion",     label: "Cashing in",            blurb: "The move has been handed over. Now take the key square, or break through." },
  { id: "pitfall",        label: "What it avoids",        blurb: "The natural, tempting move — and the half point it throws away." },
];

export const TRIANGULATION_POSITIONS: TriangulationPosition[] = [
  // ───────── Dvoretsky's introductory example ─────────
  {
    id: "dv-01",
    name: "Dvoretsky's model position — lose a tempo",
    pattern: "triangle",
    fen: "8/1p1k4/1P6/2PK4/8/8/8/8 w - - 0 1",
    bestMoveSan: "Ke5",
    bestMoveUci: "d5e5",
    altMoveUci: ["d5d4"],
    source: "Dvoretsky's Endgame Manual, chapter Triangulation — the opening example.",
    mechanism:
      "d5 and d7 are corresponding squares: whoever stands there needs the OTHER side to move. Black's king is tied down — it must watch the c5-c6 break and must not be pushed to the edge — so it has too few waiting squares. White walks a triangle d5-e5-d4-d5 and arrives back on d5 with Black to move.",
    line: "1.Ke5! Kc6 (1...Ke7 2.c6) 2.Kd4 Kd7 3.Kd5 — same position, Black to move. 3...Kc8 4.Ke6! (diagonal opposition) 4...Kd8 5.Kd6 (now vertical) 5...Kc8 6.Ke7 Kb8 7.Kd7 Ka8 8.c6 wins.",
    engine: "Stockfish: mate in 15. Both 1.Ke5 (the book move) and 1.Kd4 win — they are the same triangle walked in opposite directions.",
    think:
      "White is a pawn up and the black king sits right in front of everything. Ask the harder question first: if it were BLACK to move here, what would he have to give up? Then ask how White gets that.",
    discussion:
      "The position does not need a new plan — it needs the same position one tempo later. Count the squares each king can waste time on before you touch a piece; that count is the whole game.",
    difficulty: 1500,
    outcome: "White wins.",
  },
  {
    id: "dv-02",
    name: "Second corner of the triangle",
    pattern: "triangle",
    fen: "8/1p6/1Pk5/2P1K3/8/8/8/8 w - - 0 1",
    bestMoveSan: "Kd4",
    bestMoveUci: "e5d4",
    source: "Dvoretsky's Endgame Manual, Triangulation — after 1.Ke5 Kc6.",
    mechanism:
      "Black has stepped off d7, so White does not take the e5-d5 route home. Kd4 is the third point of the triangle: it keeps c5 defended, keeps the black king out of d5, and loses exactly the one tempo White needs.",
    line: "2.Kd4! Kd7 3.Kd5 and the starting position is back, with Black to move.",
    engine: "Stockfish: mate in 14, best move Kd4 — the book move.",
    difficulty: 1400,
    outcome: "White wins.",
  },
  {
    id: "dv-03",
    name: "Close the triangle",
    pattern: "triangle",
    fen: "8/1p1k4/1P6/2P5/3K4/8/8/8 w - - 0 1",
    bestMoveSan: "Kd5",
    bestMoveUci: "d4d5",
    source: "Dvoretsky's Endgame Manual, Triangulation — after 2.Kd4 Kd7.",
    mechanism:
      "The triangle closes. White is back on d5 with the black king back on d7 — but this time it is Black who has to move, and every move loses. The whole manoeuvre bought exactly one tempo.",
    line: "3.Kd5 Kc8 4.Ke6! Kd8 5.Kd6 Kc8 6.Ke7 Kb8 7.Kd7 Ka8 8.c6 bxc6 9.b7+.",
    engine: "Stockfish: mate in 12, best move Kd5.",
    difficulty: 1300,
    outcome: "White wins.",
  },
  {
    id: "dv-04",
    name: "The push that throws the win",
    pattern: "pitfall",
    fen: "2k5/1p6/1PP5/3K4/8/8/8/8 w - - 0 1",
    bestMoveSan: "Kd6",
    bestMoveUci: "d5d6",
    studyOnly: true,
    source: "Dvoretsky's Endgame Manual, Triangulation — the refutation of 1.c6+?.",
    mechanism:
      "This is what happens if White grabs at 1.c6+? instead of triangulating. Black answers 1...Kc8! (not 1...bxc6+? 2.Kc5 Kd8 3.Kd6! Kc8 4.Kxc6 Kb8 5.b7 winning) and the win is gone. Pushing the pawn solved Black's problem for him: it gave the black king the squares it was short of.",
    line: "2.Kd6 Kb8! 3.Kd7 bxc6 with a dead draw.",
    engine: "Stockfish: 0.00 after the book's line — a forced mate in 15 turned into a draw by one careless check.",
    difficulty: 1500,
    outcome: "Draw — White has thrown the win away.",
  },
  {
    id: "dv-05",
    name: "Diagonal opposition finishes it",
    pattern: "conversion",
    fen: "2k5/1p6/1P6/2PK4/8/8/8/8 w - - 0 1",
    bestMoveSan: "Ke6",
    bestMoveUci: "d5e6",
    altMoveUci: ["d5d6"],
    source: "Dvoretsky's Endgame Manual, Triangulation — after 3.Kd5 Kc8.",
    mechanism:
      "Triangulation handed over the move; opposition now does the rest. Ke6 takes the diagonal opposition, then Kd6 takes the vertical, and the black king is walked into the corner.",
    line: "4.Ke6! Kd8 5.Kd6 Kc8 6.Ke7 Kb8 7.Kd7 Ka8 8.c6 bxc6 9.b7+ and queens.",
    engine: "Stockfish: mate in 9. The direct 4.Kd6 mates just as fast here; Dvoretsky gives 4.Ke6 because the diagonal-then-vertical opposition is the method worth learning.",
    difficulty: 1600,
    outcome: "White wins.",
  },

  // ───────── Fahrni - Alapin, 1912 ─────────
  {
    id: "fa-01",
    name: "Fahrni – Alapin 1912 — the frozen wing",
    pattern: "correspondence",
    fen: "2k5/8/p1P5/P2K4/8/8/8/8 w - - 0 1",
    bestMoveSan: "Kd4",
    bestMoveUci: "d5d4",
    altMoveUci: ["d5c4"],
    source: "Fahrni – Alapin, 1912. The same diagram was recovered twice over: decoded from Panchenko's diagram font, and read by our board-vision service from Alburt's Just the Facts. Both give the identical position. Analysis from Dvoretsky's Endgame Manual.",
    mechanism:
      "The a-pawns are the whole point. They are frozen against each other, so Black has no spare pawn move and must answer with his king every time — and White's a5-pawn covers b6, taking a square off that king. Two squares of reciprocal zugzwang decide it: d6 against d8, and c5 against c7. White has two waiting squares beside d5, c4 and d4; Black has only d8. So White steps c4, d4 and back to d5, and arrives with Black to move.",
    line: "1.Kc4(d4)! Kd8 2.Kd4(c4)! Kc8 3.Kd5! Kd8 (3…Kc7 4.Kc5 and 5.Kb6) 4.Kd6 Kc8 5.c7 and the pawn queens.",
    engine: "Stockfish: mate in 16, best move Kd4 — the triangle. Kc4 is the same triangle the other way round. The direct 4.Kd6 also wins here, just more slowly; the triangle is the method, and it is what the position was printed to teach.",
    think:
      "Black's king has c7, c8 and d8. White's has c4, d4 and d5. Before calculating anything, count those squares against each other — who runs out of waiting moves first?",
    discussion:
      "The frozen a-pawns are doing quiet work: they give Black no pawn move at all, so every White wait must be answered with the king. That is why counting spare squares, not calculating variations, decides this position.",
    difficulty: 1750,
    outcome: "White wins.",
  },

  {
    id: "sei-01",
    name: "The long way round",
    pattern: "correspondence",
    fen: "8/2k5/p1P5/P1K5/8/8/8/8 w - - 0 1",
    bestMoveSan: "Kd5",
    bestMoveUci: "c5d5",
    source: "Seirawan, Winning Chess Endings — diagram read from the book with our own board-vision service, then confirmed by the engine.",
    think: "Kings on c5 and c7, facing each other. You have the opposition — so why can you not simply walk forward, and what does that tell you about who should be to move?",
    mechanism:
      "c5 against c7 is one of the two reciprocal-zugzwang pairs in this ending: the king standing there needs the OTHER side to move. It is White's move, so the opposition is worth nothing yet. The king steps away to d5, and only comes back to c5 once Black has been made to move first.",
    line: "1.Kd5! Kc8 2.Kc4 Kd8 3.Kd4 Kc8 4.Kd5 Kc7 5.Kc5 — back on c5, and now it is Black to move.",
    engine: "Stockfish: mate in 17, best move Kd5. The engine's own line is the full manoeuvre, ending with the king home on c5 and Black to move.",
    discussion:
      "Notice how long the walk is. A triangle is three moves, but nothing says the shape has to be small — here the king tours d5, c4, d4, d5 and back to c5 before the tempo is won. What matters is not the shape but the arithmetic: White has spare squares and Black, hemmed in by his own frozen a-pawn, does not.",
    difficulty: 1850,
    outcome: "White wins.",
  },

  // ───────── H. Neustadtl, 1898 ─────────
  {
    id: "neu-01",
    name: "Neustadtl 1898 — start the right triangle",
    pattern: "correspondence",
    fen: "8/8/3k1p1p/5P2/4K1PP/8/8/8 w - - 0 1",
    bestMoveSan: "Kf4",
    bestMoveUci: "e4f4",
    altMoveUci: ["e4f3", "e4d4"],
    source: "H. Neustadtl, 1898. Dvoretsky's Endgame Manual, Triangulation — the second solution, found by Dvoretsky in 1968.",
    mechanism:
      "First map the pairs. With the white king on f4 the g4-g5 break is threatened, and only ...Ke7 parries it (not ...Kf7, because then White takes the key square d5) — so f4 pairs with e7, and e4 pairs with d6. Beside those, White has two spare squares, f3 and e3; Black has only one, d7. One spare square against two is the whole game: White triangulates, Black runs out of waiting moves.",
    line: "1.Kf4 Ke7 2.Kf3 Kd7 3.Ke3! Kd6 4.Ke4! Kc6 5.Kf4 Kd6 6.g5 wins. (1.Kd4, seizing the opposition, is the study's original solution and also wins.)",
    engine: "Stockfish: winning for White after 1.Kf4, 1.Kf3 or 1.Kd4 — but 0.00, a dead draw, after 1.Ke3?.",
    think:
      "White threatens g4-g5. Work out which single square parries it, then ask how many OTHER squares each king has to spare. The answer to the study is in that second number.",
    discussion:
      "This is triangulation reduced to arithmetic. Two spare squares against one, so White can always wait one move longer than Black can. Note the trap too: playing Ke3 immediately, before Black is committed, hands Black ...Ke5 with tempo and the win evaporates.",
    difficulty: 2050,
    outcome: "White wins.",
  },
  {
    id: "neu-02",
    name: "Neustadtl — step off to a spare square",
    pattern: "correspondence",
    fen: "8/4k3/5p1p/5P2/5KPP/8/8/8 w - - 0 1",
    bestMoveSan: "Kf3",
    bestMoveUci: "f4f3",
    altMoveUci: ["f4e3"],
    source: "H. Neustadtl, 1898 — after 1.Kf4 Ke7.",
    mechanism:
      "Black has answered correctly, taking the square that pairs with f4. White does not repeat; he steps onto one of his two spare squares and asks Black to find a second waiting move. Black has only d7.",
    line: "2.Kf3 Kd7 3.Ke3! Kd6 4.Ke4! and Black is in zugzwang.",
    engine: "Stockfish: decisive for White; both Kf3 and Ke3 keep the win.",
    difficulty: 1900,
    outcome: "White wins.",
  },
  {
    id: "neu-03",
    name: "Neustadtl — the only square",
    pattern: "correspondence",
    fen: "8/3k4/5p1p/5P2/6PP/5K2/8/8 w - - 0 1",
    bestMoveSan: "Ke3",
    bestMoveUci: "f3e3",
    source: "H. Neustadtl, 1898 — after 2.Kf3 Kd7.",
    mechanism:
      "Black has spent his only spare move. Ke3 is the second spare square: from e3 White reaches e4 next move, and Black can no longer be on d6 when that happens. Note what Ke3 avoids — playing it one move EARLIER, on move one, is the study's only losing try, because then ...Ke5! comes with tempo.",
    line: "3.Ke3! Kd6 4.Ke4! Kc6 5.Kf4 Kd6 6.g5.",
    engine: "Stockfish: decisive for White, best move Ke3 — the book's exclamation mark.",
    difficulty: 2000,
    outcome: "White wins.",
  },
  {
    id: "neu-04",
    name: "Neustadtl — hand over the move",
    pattern: "correspondence",
    fen: "8/8/3k1p1p/5P2/6PP/4K3/8/8 w - - 0 1",
    bestMoveSan: "Ke4",
    bestMoveUci: "e3e4",
    source: "H. Neustadtl, 1898 — after 3.Ke3 Kd6.",
    mechanism:
      "Ke4 restores the exact starting position — same kings, same pawns — except that it is now Black to move instead of White. Three white king moves, e4-f4-f3-e3-e4, have bought one tempo, and the tempo decides the study.",
    line: "4.Ke4! Kc6 5.Kf4 Kd6 6.g5 and the break wins.",
    engine: "Stockfish: decisive for White, best move Ke4.",
    difficulty: 1800,
    outcome: "White wins.",
  },
  {
    id: "neu-05",
    name: "Neustadtl — what the tempo was worth",
    pattern: "pitfall",
    fen: "8/8/3k1p1p/5P2/4K1PP/8/8/8 b - - 0 1",
    bestMoveSan: "Kd7",
    bestMoveUci: "d6d7",
    studyOnly: true,
    source: "H. Neustadtl, 1898 — the starting position, with Black to move.",
    mechanism:
      "Compare this with the first Neustadtl position. Identical pieces on identical squares; only the side to move has changed — and that alone is the difference between a study White has to solve and a study that solves itself. This is what the triangle was for.",
    engine: "Stockfish: the same position it called a hard win with White to move is completely lost for Black to move.",
    difficulty: 1900,
    outcome: "Black is lost — every move gives something away.",
  },
  {
    id: "neu-06",
    name: "Neustadtl — the break",
    pattern: "conversion",
    fen: "8/8/3k1p1p/5P2/5KPP/8/8/8 w - - 0 1",
    bestMoveSan: "g5",
    bestMoveUci: "g4g5",
    source: "H. Neustadtl, 1898 — after 4.Ke4 Kc6 5.Kf4 Kd6.",
    mechanism:
      "The triangulation is over and Black's king has been forced onto the wrong square. Now the break lands: g5 cracks the pawn chain open and White's f-pawn runs. Played one move too early, on move two, the same break only draws — 2.g5? fxg5 and the position empties out.",
    line: "6.g5! hxg5 7.hxg5 and the f-pawn decides.",
    engine: "Stockfish: mate in 19 after 6.g5.",
    difficulty: 1700,
    outcome: "White wins.",
  },
];

export const triangulationById = (id: string): TriangulationPosition | undefined =>
  TRIANGULATION_POSITIONS.find((p) => p.id === id);

export const triangulationByPattern = (pattern: TriangulationPattern): TriangulationPosition[] =>
  TRIANGULATION_POSITIONS.filter((p) => p.pattern === pattern);

/** Positions Practice mode is allowed to serve. */
export const TRIANGULATION_PRACTICE = TRIANGULATION_POSITIONS.filter((p) => !p.studyOnly);
