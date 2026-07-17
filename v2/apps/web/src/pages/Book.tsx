import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key, Color } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";

// "Book" tab — chess books rendered playable. Two books now:
//  • 2000 Tactical Chess (pilot) — scanned pages with clickable diagram hotspots.
//  • Dvoretsky's Endgame Manual — positions read straight off the diagrams (vision),
//    Stockfish-18 + KPK-oracle verified, and rated by the Maia play-it-out endgame
//    rater (book-engine/endgame_rater.py). Presented as a position list.
// See PROJECT_MASTER/knowledge/11-book-tab-and-engines.md.

const BASE = import.meta.env.BASE_URL; // "/" or "/v2/"

type EmRate = { anchor: number | null; themes: string[]; confidence: string;
  signals: { onlyMoves: number; trap: boolean; sfSubtle: boolean; dtm: number; reciprocalZugzwang: boolean } };
type Puz = {
  n: number; num?: string; fen: string; side: "w" | "b"; diff: string;
  page?: number; bb?: [number, number, number, number]; sol: string[];
  sf: string; maia: string; idea: string; note: string;
  goal?: "win" | "draw"; rating?: number; band?: string; emRate?: EmRate;
};

type Book = { slug: string; title: string; subtitle: string; mode: "pages"; pages: number; imgBase: string; initialPage: number; defaultAspect: string };
const BOOKS: Book[] = [
  { slug: "2000-tactical", title: "2000 Tactical Chess", subtitle: "Part 4: Chess Endings — preview (pp.1–10)", mode: "pages", pages: 10, imgBase: "bookimg/", initialPage: 9, defaultAspect: "750 / 1125" },
  { slug: "endgame-manual", title: "Dvoretsky's Endgame Manual", subtitle: "Chapter 1 · Pawn Endgames — flip through the book; click any diagram with a ▶ to play it (engine-verified, Maia-rated)", mode: "pages", pages: 120, imgBase: "bookimg/endgame-manual/", initialPage: 18, defaultAspect: "1240 / 1755" },
];

const PUZZLES: Record<number, Puz[]> = {
  9: [
    { n: 1, fen: "7k/5P2/8/5K2/8/8/8/8 w - - 0 1", side: "w", diff: "Cadet · #3", bb: [15.6, 12.6, 31.4, 21.8],
      sol: ["f5f6", "h8h7", "f7f8r", "h7h6", "f8h8"], sf: "Mate in 3", maia: "f8=Q",
      idea: "Mate in 3 — but the natural 2.f8=Q is stalemate! March the king up and underpromote: 1.Kf6 Kh7 2.f8=R! Kh6 3.Rh8#.",
      note: "Every Maia level (1100/1500/1900) plays f8=Q — into the stalemate trap, missing the rook underpromotion." },
    { n: 2, fen: "8/ppp5/8/PPP5/3k4/8/8/7K w - - 0 1", side: "w", diff: "Cadet", bb: [59.6, 12.6, 31.2, 21.8],
      sol: ["b5b6", "a7b6", "c5c6", "b7c6", "a5a6", "c6c5", "a6a7", "b6b5", "a7a8q"], sf: "+4.8 (winning)", maia: "c6",
      idea: "The breakthrough: 1.b6! axb6 2.c6! bxc6 3.a6 and the outside pawn queens — the king on d4 is too far.",
      note: "Maia plays 1.c6 first — but only 1.b6! cracks the wall." },
    { n: 3, fen: "5k2/5P2/4K3/7p/8/6P1/8/8 w - - 0 1", side: "w", diff: "Cadet", bb: [15.5, 39.4, 31.4, 21.8],
      sol: ["e6f6", "h5h4", "g3g4", "h4h3", "g4g5", "h3h2", "g5g6", "h2h1b", "g6g7"], sf: "Mate in 5", maia: "Kf6",
      idea: "Two fronts: the king escorts f7 home (1.Kf6) while g4-g5-g6 outruns Black's h-pawn; White queens first.",
      note: "Maia finds 1.Kf6 — human instinct is correct here. ✓" },
    { n: 4, fen: "k7/2P5/1p6/K7/8/8/8/8 w - - 0 1", side: "w", diff: "Cadet", bb: [59.5, 39.4, 31.3, 21.8],
      sol: ["a5a6", "b6b5", "c7c8q"], sf: "Mate in 2", maia: "Kb6",
      idea: "King first! 1.Ka6 removes the escape squares, then 1…b5 2.c8=Q#. (1.c8=Q+? only checks.)",
      note: "Maia plays 1.Kb6 — the wrong king square; the mate needs 1.Ka6." },
    { n: 5, fen: "8/8/4p3/3kp1p1/7P/3K1P2/8/8 b - - 0 1", side: "b", diff: "Cadet · Black to move", bb: [15.5, 66.2, 31.4, 21.8],
      sol: ["g5h4", "d3d2", "h4h3", "d2c3", "h3h2", "c3b4", "h2h1q"], sf: "Black wins (+11)", maia: "…gxh4",
      idea: "Black to move and win: 1…gxh4 and the h-pawn runs, escorted by the active king.",
      note: "Maia matches — the capture is the natural move. ✓" },
    { n: 6, fen: "8/5p2/5p2/8/8/3P1k2/P7/5K2 w - - 0 1", side: "w", diff: "Cadet", bb: [59.5, 66.2, 31.4, 21.8],
      sol: ["a2a4", "f3e3", "a4a5", "f6f5", "a5a6", "f5f4", "a6a7", "f4f3", "a7a8q"], sf: "+5.5 (winning)", maia: "a4",
      idea: "The outside passer decides: 1.a4! and the a-pawn queens while Black's king is stuck on the kingside.",
      note: "Maia finds 1.a4 — correct. ✓" },
  ],
};
const RATINGS: Record<number, { rating: number; band: string; profile: Record<number, number>; maiaSolved: number[] }> = {
  1: { rating: 2095, band: "Expert", profile: { 1100: 23.0, 1300: 12.3, 1500: 15.5, 1700: 18.0, 1900: 15.1 }, maiaSolved: [] },
  2: { rating: 2564, band: "Expert", profile: { 1100: 22.7, 1300: 33.2, 1500: 32.7, 1700: 43.5, 1900: 37.0 }, maiaSolved: [] },
  3: { rating: 2471, band: "Expert", profile: { 1100: 65.3, 1300: 62.4, 1500: 64.0, 1700: 76.2, 1900: 84.0 }, maiaSolved: [] },
  4: { rating: 1948, band: "Advanced", profile: { 1100: 10.6, 1300: 5.6, 1500: 4.8, 1700: 7.2, 1900: 11.9 }, maiaSolved: [] },
  5: { rating: 1511, band: "Club", profile: { 1100: 83.8, 1300: 90.0, 1500: 93.6, 1700: 93.7, 1900: 97.6 }, maiaSolved: [1100, 1300, 1500, 1700, 1900] },
  6: { rating: 1314, band: "Club", profile: { 1100: 51.0, 1300: 62.5, 1500: 57.1, 1700: 72.9, 1900: 65.5 }, maiaSolved: [1100, 1300, 1500, 1700, 1900] },
};
const BANDS = [1100, 1300, 1500, 1700, 1900];

// Dvoretsky's Endgame Manual — Chapter 1 (Pawn Endgames). FENs read from the diagrams,
// verified by Stockfish 18 + the KPK oracle; ratings from the Maia play-it-out rater.
const EM_PUZZLES: Puz[] = [
  { n: 1, num: "1-1", fen: "8/3k4/8/3K4/3P4/8/8/8 w - - 0 1", page: 19, bb: [35.6, 49, 36, 25.4], side: "w", diff: "Key squares · draw", goal: "draw",
    sol: ["d5e5", "d7e7", "e5d5", "e7d7"], sf: "Draw (½–½)", maia: "—",
    idea: "The king on d5 does NOT stand on a key square, so with White to move it is only a draw: 1.Kc5 Kc7 or 1.Ke5 Ke7. The key squares for the d4-pawn are c6, d6 and e6 — only Black-to-move would have to cede one.",
    note: "Chapter 1 — Key Squares. (Ties into the Key-Squares trainer.)",
    rating: 950, band: "Beginner", emRate: { anchor: 1100, themes: ["K+P vs K", "opposition"], confidence: "high", signals: { onlyMoves: 0, trap: false, sfSubtle: false, dtm: 4, reciprocalZugzwang: false } } },
  { n: 2, num: "1-2", fen: "1k6/8/1K6/1P6/8/8/8/8 w - - 0 1", page: 20, bb: [35.6, 3, 36, 25.4], side: "w", diff: "Win", goal: "win",
    sol: ["b6a6", "b8a8", "b5b6", "a8b8", "b6b7"], sf: "White wins", maia: "—",
    idea: "1.Ka6! seizes the key square (the opposition). After 1…Ka8 2.b6 Kb8 3.b7 the pawn queens next move. The tempting 1.Kc6? runs into 1…Ka7! and White has to start over.",
    note: "Chapter 1 — a knight-pawn's key squares. Maia: only the 1900 level converts it against perfect defense.",
    rating: 1879, band: "Advanced", emRate: { anchor: 1900, themes: ["K+P vs K", "opposition"], confidence: "high", signals: { onlyMoves: 2, trap: false, sfSubtle: false, dtm: 15, reciprocalZugzwang: false } } },
  { n: 3, num: "1-3", fen: "5k2/8/8/8/1P6/8/8/2K5 w - - 0 1", page: 20, bb: [35.2, 38.1, 36, 25.4], side: "w", diff: "Win · study", goal: "win",
    sol: ["c1c2", "f8e7", "c2b3", "e7d6", "b3a4", "d6c6", "a4a5", "c6b7", "a5b5"], sf: "White wins", maia: "—",
    idea: "J. Moravec, 1952. Head for the key square FARTHEST from the enemy king: 1.Kc2! (not 1.Kb2? or 1.Kd2?). Then 1…Ke7 2.Kb3 Kd6 3.Ka4 Kc6 4.Ka5 Kb7 5.Kb5 and White wins the race for b5.",
    note: "Chapter 1 — outflanking. Even Maia-1900 fails to win this against best defense.",
    rating: 2373, band: "Expert", emRate: { anchor: null, themes: ["king march / outflanking"], confidence: "high", signals: { onlyMoves: 2, trap: true, sfSubtle: true, dtm: 24, reciprocalZugzwang: false } } },
  { n: 4, num: "1-4", fen: "2k5/8/8/7p/8/8/6P1/5K2 w - - 0 1", page: 21, bb: [35.6, 2.7, 36, 25.4], side: "w", diff: "Win · study", goal: "win",
    sol: ["f1f2", "h5h4", "f2g1", "h4h3", "g2g3", "c8d7", "g1h2", "d7e6", "h2h3", "e6f5", "h3h4", "f5g6", "h4g4"], sf: "White wins", maia: "—",
    idea: "White wins by tempo and key squares. 1.Kf2! (not 1.Kg1? Kd7 and Black holds the pawn). If 1…h4 2.Kg1!! (the natural 2.Kf3? h3! draws) 2…h3 3.g3! — now the g3-pawn's key squares (f5/g5/h5) are near White's king. 3…Kd7 4.Kh2 Ke6 5.Kxh3 Kf5 6.Kh4 Kg6 7.Kg4 and White wins.",
    note: "Chapter 1 — the waiting move & key squares. Tablebase: 1.Kf2 is the UNIQUE win (every other move only draws).",
    rating: 2075, band: "Expert", emRate: { anchor: null, themes: ["K+P vs K", "key squares", "reciprocal zugzwang"], confidence: "medium", signals: { onlyMoves: 2, trap: true, sfSubtle: true, dtm: 13, reciprocalZugzwang: true } } },
  { n: 5, num: "1-5", fen: "8/8/3p4/3P4/5k2/3K4/8/8 w - - 0 1", page: 21, bb: [35.6, 57, 36, 25.4], side: "w", diff: "Tragicomedy · hold the draw", goal: "draw",
    sol: ["d3e2", "f4e4", "e2d2", "e4d5", "d2d3"], sf: "Draw (½–½)", maia: "—",
    idea: "Coull–Stanciu, Saloniki 1988. White resigned, fearing the loss of the d5-pawn — but it's a DRAW! After 1.Ke2 Ke4 2.Kd2 Kxd5 3.Kd3 the white king holds the opposition and stops the lone d-pawn. Dvoretsky: \"No comment needed!\"",
    note: "Chapter 1 — Tragicomedy: a drawn position resigned. Tablebase-confirmed draw.",
    rating: 1100, band: "Beginner", emRate: { anchor: null, themes: ["opposition", "defensive hold"], confidence: "medium", signals: { onlyMoves: 0, trap: false, sfSubtle: false, dtm: 0, reciprocalZugzwang: false } } },
  { n: 6, num: "1-6", fen: "8/8/5pk1/5r2/R7/5K2/8/8 w - - 0 1", page: 22, bb: [35.2, 2.7, 36, 25.4], side: "w", diff: "Tragicomedy · hold the draw", goal: "draw",
    sol: ["f3e2", "f5b5", "a4a1", "f6f5", "a1c1", "f5f4", "c1a1"], sf: "Draw (½–½)", maia: "—",
    idea: "A rook-ending tragicomedy. The game went 1.Rf4?? Kg5 and White resigned — the rook is lost (attacked by the king AND the rook, defended only by Kf3). But it's a DRAW: keep the king active and the rook behind the pawn — 1.Ke2! Rb5 2.Ra1 f5 3.Rc1 f4 4.Ra1 and Black can't break through.",
    note: "Chapter 1 — Tragicomedy: 1.Rf4?? threw a draw. Tablebase: draw (and Rf4 loses).",
    rating: 1400, band: "Club", emRate: { anchor: null, themes: ["rook ending", "defensive hold"], confidence: "medium", signals: { onlyMoves: 0, trap: true, sfSubtle: false, dtm: 0, reciprocalZugzwang: false } } },
  { n: 7, num: "1-7", fen: "2k5/8/2p5/2K5/1P1P4/8/8/8 b - - 0 1", page: 23, bb: [35.2, 2.7, 36, 25.4], side: "b", diff: "Hold the draw", goal: "draw",
    sol: ["c8c7", "b4b5", "c6b5", "c5b5", "c7d6"], sf: "Draw (½–½)", maia: "—",
    idea: "White has the opposition, but two pawns on the same file can't break a well-defended king. 1…Kc7! keeps the opposition. If 2.b5 cxb5 3.Kxb5 Kd6 the king reaches the square in front of the d-pawn — draw. (1…Ka7? loses.)",
    note: "Chapter 1 — opposition & the defender's resources.",
    rating: 1175, band: "Beginner", emRate: { anchor: 1300, themes: ["opposition", "defensive hold"], confidence: "high", signals: { onlyMoves: 2, trap: false, sfSubtle: false, dtm: 5, reciprocalZugzwang: false } } },
  { n: 8, num: "1-8", fen: "8/8/8/4p1p1/8/5P2/7K/3k4 w - - 0 1", page: 23, bb: [35.6, 65.1, 36, 25.4], side: "w", diff: "Hold the draw · study", goal: "draw",
    sol: ["h2h1", "d1d2", "h1h2", "d2d3", "h2h3"], sf: "Draw (½–½)", maia: "—",
    idea: "H. Neustadtl, 1890. White is lost unless he grabs the DISTANT opposition: 1.Kh1!! is the ONLY move (every other loses!). 1…Kd2 2.Kh2 Kd3 3.Kh3 — White mirrors the black king along the rank, keeping the distant opposition. Draw. (1…g4 2.Kg2! Kd2 3.fxg4=.)",
    note: "Chapter 1 — distant opposition as the only defence. Tablebase: 1.Kh1 is the UNIQUE saving move; everything else loses.",
    rating: 1600, band: "Advanced", emRate: { anchor: null, themes: ["distant opposition", "defensive hold"], confidence: "medium", signals: { onlyMoves: 1, trap: true, sfSubtle: true, dtm: 0, reciprocalZugzwang: true } } },
  { n: 9, num: "1-9", fen: "8/5p2/8/5PPk/8/8/8/7K w - - 0 1", page: 24, bb: [35.6, 13.7, 36, 25.4], side: "w", diff: "Hold the draw · study", goal: "draw",
    sol: ["g5g6", "f7g6", "f5g6", "h5g6", "h1g2"], sf: "Draw (½–½)", maia: "—",
    idea: "H. Mattison, 1918. The pawns are lost, but White saves himself with the distant opposition: 1.g6! fxg6 2.f5! gxf5 3.Kg1! and Black — though he holds the distant opposition — cannot convert it into the close opposition. Draw.",
    note: "Chapter 1 — distant opposition as a drawing resource.",
    rating: 950, band: "Beginner", emRate: { anchor: 1100, themes: ["distant opposition", "defensive hold"], confidence: "high", signals: { onlyMoves: 1, trap: false, sfSubtle: false, dtm: 5, reciprocalZugzwang: false } } },
  { n: 10, num: "1-10", fen: "5k2/8/4p3/4P3/3P4/8/8/4K3 w - - 0 1", page: 24, bb: [36, 67.6, 36, 25.4], side: "w", diff: "Win · study", goal: "win",
    sol: ["e1d2", "f8e7", "d2c3", "e7d7", "c3b4", "d7c6", "b4c4", "c6b6", "d4d5"], sf: "White wins", maia: "—",
    idea: "J. Drtina, 1907. Taking the distant opposition with 1.Ke1? only draws. White wins by OUTFLANKING: 1.Kd2! marches the king around (Kc3-Kb4-Kc4) to force through d4-d5 — the enemy king can't cover both breakthroughs.",
    note: "Chapter 1 — outflanking beats mere opposition. Even Maia-1900 misplays it.",
    rating: 2203, band: "Expert", emRate: { anchor: null, themes: ["king march / outflanking"], confidence: "high", signals: { onlyMoves: 2, trap: true, sfSubtle: false, dtm: 9, reciprocalZugzwang: false } } },
  { n: 11, num: "1-11", fen: "8/8/2p5/k1p3K1/p1P5/P7/8/8 w - - 0 1", page: 25, bb: [36, 40.5, 36, 25.4], side: "w", diff: "Win · study", goal: "win",
    sol: ["g5f5", "a5b6", "f5f6", "b6b7", "f6f7", "b7b6", "f7e8", "b6a7", "e8e7", "a7a8", "e7d6", "a8b7", "d6d7", "b7b6", "d7c8"], sf: "White wins", maia: "—",
    idea: "F. Sackmann, 1913. Black is a pawn up, but his pawns are fixed and weak. White wins by OUTFLANKING with the king: 1.Kf5! (the only move — every other king move draws) …Kb6 2.Kf6 Kb7 3.Kf7 Kb6 4.Ke8! Ka7 5.Ke7 Ka8 6.Kd6 Kb7 7.Kd7 Kb6 8.Kc8 and the king breaks through to the weak queenside pawns.",
    note: "Chapter 1 — outflanking a pawn-up defender. Tablebase: 1.Kf5 is the UNIQUE win.",
    rating: 2220, band: "Expert", emRate: { anchor: null, themes: ["king march / outflanking", "distant opposition"], confidence: "high", signals: { onlyMoves: 3, trap: false, sfSubtle: false, dtm: 32, reciprocalZugzwang: false } } },
  { n: 19, num: "1-19", fen: "8/3k4/8/2Pp3p/7P/3K4/8/8 w - - 0 1", page: 29, bb: [36, 2.7, 36, 25.4], side: "w", diff: "Mined squares · hold the draw", goal: "draw",
    sol: ["d3c3", "d7c7", "c3d3", "c7d7"], sf: "Draw (½–½)", maia: "—",
    idea: "\"Untouchable pawns.\" The squares c4 and b6 are MINED — step on one first and you fall into zugzwang. White's king just shuttles b3-c3-d3 while Black's shuttles c7-b7-a7; neither can ever attack the pawn. Draw.",
    note: "Chapter 1 — Mined Squares. Tablebase-confirmed draw.",
    rating: 1300, band: "Club", emRate: { anchor: null, themes: ["mined squares", "reciprocal zugzwang", "defensive hold"], confidence: "medium", signals: { onlyMoves: 0, trap: true, sfSubtle: false, dtm: 0, reciprocalZugzwang: true } } },
  { n: 20, num: "1-20", fen: "8/8/1k1p4/3P1K2/8/8/8/8 w - - 0 1", page: 29, bb: [36, 36.3, 36, 25.4], side: "w", diff: "Mined squares · win", goal: "win",
    sol: ["f5f6", "b6b5", "f6e7", "b5c5", "e7e6", "c5b4", "e6d6", "b4c4", "d6c6"], sf: "White wins", maia: "—",
    idea: "Reciprocal zugzwang: with the kings on e6 and c5, whoever is to move loses. White forces Black onto the mined square first: 1.Kf6! Kb5 2.Ke7! Kc5 3.Ke6! and Black must give way — the king penetrates to win the d6-pawn.",
    note: "Chapter 1 — Mined Squares. Tablebase: White wins with 1.Kf6.",
    rating: 1700, band: "Advanced", emRate: { anchor: null, themes: ["mined squares", "reciprocal zugzwang", "outflanking"], confidence: "medium", signals: { onlyMoves: 1, trap: true, sfSubtle: false, dtm: 7, reciprocalZugzwang: true } } },
  { n: 21, num: "1-21", fen: "8/8/k1p5/2P5/K7/P7/8/8 w - - 0 1", page: 30, bb: [36, 2.7, 36, 25.4], side: "w", diff: "Corresponding squares · win", goal: "win",
    sol: ["a4b4", "a6a7", "b4c3", "a7a6", "c3d3", "a6b7", "d3d4", "b7c7", "a3a4", "c7d7", "a4a5", "d7c7", "a5a6"], sf: "White wins", maia: "—",
    idea: "Corresponding squares. The only winning try is to get the king to d6 — but the d4-square is mined (reciprocal zugzwang vs Black's b5). The first pair of corresponding squares is a6↔b4. White manoeuvres to hand Black the zugzwang, marches the king to d6 to win the c6-pawn, and queens the c-pawn. (In the book it's Black to move — Black is already in zugzwang.)",
    note: "Chapter 1 — Corresponding squares. Tablebase-verified win.",
    rating: 2100, band: "Expert", emRate: { anchor: null, themes: ["corresponding squares", "reciprocal zugzwang", "outflanking"], confidence: "medium", signals: { onlyMoves: 2, trap: true, sfSubtle: true, dtm: 15, reciprocalZugzwang: true } } },
  { n: 12, num: "1-12", fen: "8/8/8/1p1k4/pR6/PP6/3q4/1K6 b - - 0 1", page: 26, bb: [36, 7.8, 35.6, 25.2], side: "b", diff: "Avoid the pawn-ending trap · win", goal: "win",
    sol: ["a4b3"], sf: "Black wins (+4.4)", maia: "…Qxb4?? (the trap)",
    idea: "Yates–Tartakower, Bad Homburg 1927. Black is winning — but NOT by trading into the pawn ending! The game blundered 1…Q×b4?? 2.a×b4 a×b3 3.Kb2 Kc4 4.Ka3! b2 5.Ka2! and it's a DRAW — Black can never make progress. Keep the queen: 1…a×b3! (or 1…Qc3!?) stays a winning queen-vs-rook.",
    note: "Chapter 1 — Tragicomedy: Tartakower liquidated into a \"won\" pawn ending that was only a draw.",
    rating: 1900, band: "Advanced" },
  { n: 13, num: "1-13", fen: "8/5p2/4k1p1/6Rp/3K3P/5rP1/8/8 b - - 0 1", page: 26, bb: [36, 52.7, 35.6, 25.2], side: "b", diff: "Find the winning plan · win", goal: "win",
    sol: ["f3a3", "d4e4", "f7f5"], sf: "Black wins (+4.3)", maia: "…Rf5?? (only drew)",
    idea: "Yusupov–Ljubojevic, Linares 1992. White's rook is tied to g3. 1…Ra3! stops the white king from reaching the pawns — 2.Ke4 f5+! 3.Kf4 and …Kf6-g7, …f6 wins. Instead Ljubojevic played 1…Rf5?? 2.Ke4 R×g5 3.h×g5 f6 4.g×f6 K×f6 5.Kf4! and White held the opposition — draw.",
    note: "Chapter 1 — Tragicomedy: a won rook ending thrown away by a hasty rook trade.",
    rating: 2150, band: "Expert" },
  { n: 14, num: "1-14", fen: "8/8/1p6/1p6/k7/2P5/PK6/8 b - - 0 1", page: 27, bb: [36, 6.4, 35.6, 25.2], side: "b", diff: "Exercise 1/1 · can Black win?", goal: "draw",
    sol: ["b5b4", "c3b4", "a4b4", "a2a3", "b4a4", "b2a2"], sf: "Draw (½–½)", maia: "—",
    idea: "Exercise (Black to move): the extra pawn does NOT win. After 1…b4 2.c×b4 K×b4 3.a3+ Ka4 4.Ka2 the white king just shuffles and Black can never break through — a draw.",
    note: "Chapter 1 — Exercise 1/1. Tablebase-confirmed draw.",
    rating: 1450, band: "Club" },
  { n: 15, num: "1-15", fen: "8/8/8/1p4k1/1P3p2/5K2/6P1/8 w - - 0 1", page: 27, bb: [36.3, 33.2, 36, 25.1], side: "w", diff: "Exercise 1/2 · win", goal: "win",
    sol: ["f3e4", "g5g4", "e4d5", "g4h5", "d5c5", "h5g5", "c5c6"], sf: "White wins", maia: "—",
    idea: "Exercise (White to move): the b-pawns are locked, so it is decided by the KING, not a pawn race. 1.Ke4! heads for b5 — 1…g4 2.Kd5 Kh5 3.Kc5 Kg5 4.Kc6 and 5.K×b5, and the passed b-pawn queens while the black f-pawn is too slow. (1.g3? f×g3 2.K×g3 Kf5 only draws.)",
    note: "Chapter 1 — Exercise 1/2. Tablebase-verified win (dtz 23).",
    rating: 1850, band: "Advanced" },
  { n: 16, num: "1-16", fen: "3b4/p6k/8/2R5/8/5P2/1r3N1K/8 w - - 0 1", page: 27, bb: [36, 60, 36, 25.2], side: "w", diff: "Exercise 1/3 · hold the balance", goal: "draw",
    sol: ["h2g3"], sf: "≈ equal (draw)", maia: "Kg3",
    idea: "Exercise (White to move): rook+knight vs rook+bishop with level pawns — the position is balanced. 1.Kg3! calmly centralises the king and holds; grabbing material with the rook or knight walks into tactics.",
    note: "Chapter 1 — Exercise 1/3. Engine assessment: dead level (≈0.0).",
    rating: 2250, band: "Expert" },
  { n: 17, num: "1-17", fen: "k7/2p5/8/KP3p2/8/8/6P1/8 w - - 0 1", page: 28, bb: [36, 2.7, 35.8, 25.2], side: "w", diff: "Exercise 1/4 · win", goal: "win",
    sol: ["a5a6", "a8b8", "g2g3", "b8a8", "b5b6", "a8b8", "a6b5"], sf: "White wins", maia: "—",
    idea: "Exercise (White to move): 1.Ka6! takes the opposition and outflanks. The g2-pawn is a priceless reserve tempo — 1…Kb8 2.g3! Ka8 3.b6! and Black is in zugzwang; White breaks through with the king and queens the b-pawn.",
    note: "Chapter 1 — Exercise 1/4. Tablebase-verified win — the spare g-pawn tempo is the key.",
    rating: 2000, band: "Expert" },
  { n: 18, num: "1-18", fen: "k7/8/8/8/8/8/8/K1R5 w - - 0 1", page: 28, bb: [36.1, 29.5, 35.8, 25.2], side: "w", diff: "Exercise 1/5 · mate", goal: "win",
    sol: ["c1b1", "a8a7", "b1b2", "a7a6", "a1a2", "a6a5", "a2a3"], sf: "White wins (mate)", maia: "—",
    idea: "Exercise (White to move): the basic K+R vs K mate. Cut the king to the edge with the rook (1.Rb1! confines it to the a-file), march your own king up to take the opposition, and finish with a single rook move that mates on the back rank.",
    note: "Chapter 1 — Exercise 1/5. Tablebase-optimal mating technique.",
    rating: 1000, band: "Beginner" },
  { n: 22, num: "1-22", fen: "8/4k3/8/1p2Pp2/p7/P1K1P3/1P6/8 w - - 0 1", page: 30, bb: [36, 51.3, 35.8, 25.1], side: "w", diff: "Mined squares · win", goal: "win",
    sol: ["c3d3", "e7d7", "e3e4", "f5f4", "d3e2", "d7e6", "e2f2"], sf: "White wins", maia: "—",
    idea: "Alekhine–Yates, Hamburg 1910. Corresponding (mined) squares. 1.Kd3! (not 1.Kd4? Ke6 or 1.Kb4? Ke6). 1…Kd7 2.e4! f4 3.Ke2! Ke6 4.Kf2!! — now f3 and e5 are mined; White sidesteps f3, and Black has no waiting move (his own e5… blocked by White's e5-pawn). Zugzwang — Black resigned.",
    note: "Chapter 1 — Mined Squares (Alekhine).",
    rating: 2050, band: "Expert" },
  { n: 23, num: "1-23", fen: "8/8/7p/4K1pk/8/7P/2B5/8 w - - 0 1", page: 31, bb: [35.8, 11.1, 35.8, 25.1], side: "w", diff: "Tragicomedy · hold the draw", goal: "draw",
    sol: ["c2d1"], sf: "Draw (½–½)", maia: "—",
    idea: "Kobese–Tu Hoang Thai, Yerevan ol 1996. The position is a DRAW, but White sets a last trap: 1.Bd1+!? Kh4?? (1…Kg6! was necessary — 2.Bg4 h5 3…g4=) 2.Bg4! h5 3.Kf5! h×g4 4.h×g4 and Black, astonishingly, is lost — his king is cut off from the pawns. Black resigned. With 1…Kg6! it is only a draw.",
    note: "Chapter 1 — Tragicomedy. Tablebase: objectively drawn; White wins only if Black steps into the trap.",
    rating: 1750, band: "Advanced" },
  { n: 24, num: "1-24", fen: "3r4/3P4/p1k5/1p3pp1/1P5p/P4P1P/3r1KP1/8 b - - 0 1", page: 31, bb: [36, 59.7, 35.8, 25.1], side: "b", diff: "Exercise 1/6 · win (should Black simplify?)", goal: "win",
    sol: ["d8d7"], sf: "Black is winning (+8.5)", maia: "…R×d7",
    idea: "Exercise (Black to move, difficult): Black is up material — two rooks against White's far-advanced d7-pawn. Dvoretsky's question: should Black liquidate into the pawn endgame? Weigh 1…R×d7 (and a later rook trade) against keeping rooks on, and calculate the resulting pawn races carefully before simplifying.",
    note: "Chapter 1 — Exercise 1/6 (difficult). Engine: Black is winning; the point is choosing the right technique.",
    rating: 2400, band: "Expert" },
];

// Group Endgame Manual puzzles by their PDF page → clickable hotspots on the page view.
const EM_BY_PAGE: Record<number, Puz[]> = {};
for (const p of EM_PUZZLES) { if (p.page != null) (EM_BY_PAGE[p.page] ??= []).push(p); }

const uci = (m: string) => ({ from: m.slice(0, 2) as Key, to: m.slice(2, 4) as Key, promotion: m.length > 4 ? m[4] : undefined });
const pieceCount = (fen: string) => ((fen.split(" ")[0] || "").match(/[a-zA-Z]/g) || []).length;
const tbUrl = (fen: string) => `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const PIECE: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
function kingSq(fen: string, color: "w" | "b"): { f: number; r: number } | null {
  const rows = (fen.split(" ")[0] || "").split("/"); const t = color === "w" ? "K" : "k";
  for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[7 - r] || "") { if (/\d/.test(ch)) { f += +ch; continue; } if (ch === t) return { f, r }; f++; } }
  return null;
}
// Plain-language description of a move (with the concept it embodies).
function describeMove(fenBefore: string, muci: string): string {
  let g = new Chess(fenBefore), mv: any;
  try { mv = g.move(uci(muci)); } catch { return muci; }
  const to = mv.to;
  if (mv.promotion) return `${to}=${mv.promotion.toUpperCase()} — promotes`;
  if (mv.captured) return `${cap(PIECE[mv.piece] || "piece")} takes on ${to}, winning a ${PIECE[mv.captured] || "pawn"}`;
  if (mv.piece === "p") return `pawn to ${to} — advances the passed pawn`;
  if (mv.piece === "k") {
    const a = kingSq(g.fen(), "w"), b = kingSq(g.fen(), "b");
    if (a && b) {
      const fg = Math.abs(a.f - b.f), rg = Math.abs(a.r - b.r);
      if ((fg === 0 && rg === 2) || (rg === 0 && fg === 2)) return `K${to} — takes the opposition`;
    }
    return `K${to} — the king marches in`;
  }
  return `${cap(PIECE[mv.piece] || "")}${to}`;
}
type Tier = "win" | "draw" | "loss";
const tier = (cat: string, solverToMove: boolean): Tier => {
  const w = cat === "win" || cat === "cursed-win", l = cat === "loss" || cat === "blessed-loss";
  return solverToMove ? (w ? "win" : l ? "loss" : "draw") : (w ? "loss" : l ? "win" : "draw");
};
const RANK: Record<Tier, number> = { loss: 0, draw: 1, win: 2 };
const dist = (d: any) => d?.dtm ? ` (mate in ${Math.abs(d.dtm)})` : d?.dtz != null ? ` (dtz ${Math.abs(d.dtz)})` : "";
// Assess the solver's move + pick the engine's best reply, with human commentary for both.
async function assessMove(fenBefore: string, muci: string, fenAfter: string, goal: "win" | "draw"):
  Promise<{ you: string; eng: string; engineMove: string | null; fb: { t: string; k: string }; onTrack: boolean }> {
  const desc = describeMove(fenBefore, muci);
  try {
    if (pieceCount(fenAfter) <= 7) {
      const [tb0, tb1] = await Promise.all([fetch(tbUrl(fenBefore)).then((r) => r.json()), fetch(tbUrl(fenAfter)).then((r) => r.json())]);
      const bestUci = tb0.moves?.[0]?.uci;
      const before = tier(tb0.category, true), after = tier(tb1.category, false);
      const isBest = muci === bestUci;
      const status = after === "win" ? `you're winning${dist(tb1)}` : after === "draw" ? "it's a draw" : "you're now losing";
      let you: string, k: string, onTrack: boolean;
      if (RANK[after] < RANK[before]) {                       // threw it
        onTrack = false; k = "bad";
        const bestDesc = bestUci ? describeMove(fenBefore, bestUci) : "the only move";
        you = `✗ ${desc}. This ${before === "win" ? "throws the win" : "loses the draw"} — ${status}. Needed: ${bestDesc}.`;
      } else if (isBest) {
        onTrack = after !== "loss"; k = onTrack ? "good" : "bad";
        you = `✓ Best. ${desc} — ${status}.`;
      } else {
        onTrack = after !== "loss"; k = onTrack ? "good" : "bad";
        const bestDesc = bestUci ? describeMove(fenBefore, bestUci) : "";
        you = `✓ ${desc} — still ${after === "win" ? "winning" : after === "draw" ? "holding" : "lost"}${after === before ? `, though ${bestDesc || "the top move"} was cleaner` : ""}. ${status}.`;
      }
      const engineMove = tb1.moves?.[0]?.uci ?? null;
      const eng = engineMove ? `Engine (best defence): ${describeMove(fenAfter, engineMove)}.` : "";
      const fb = { t: onTrack ? (goal === "draw" ? "✓ Holding — your move." : "✓ On track — your move.") : "✗ Off track — play on, or Restart.", k };
      return { you, eng, engineMove, fb, onTrack };
    }
    // >7 pieces: Stockfish via book-engine, eval-based commentary
    const [a0, a1] = await Promise.all([
      fetch(`/book-engine/analyze?fen=${encodeURIComponent(fenBefore)}`).then((r) => r.json()),
      fetch(`/book-engine/analyze?fen=${encodeURIComponent(fenAfter)}`).then((r) => r.json()),
    ]);
    const ev = (s: any) => s?.score ? (s.score.type === "mate" ? (s.score.val > 0 ? 99 : -99) : s.score.val / 100) : 0;
    const before = ev(a0.sf), after = -ev(a1.sf); // a1 is opponent-to-move → negate for solver
    const you = `${after < before - 0.8 ? "✗" : "✓"} ${desc}. Stockfish: ${after >= 3 ? "you're winning" : after <= -3 ? "you're losing" : "roughly level"} (${after.toFixed(1)}).`;
    return { you, eng: a1.sf?.move ? `Engine defends: ${a1.sf.move}.` : "", engineMove: a1.sf?.move ?? null, fb: { t: after >= before - 0.8 ? "✓ Your move." : "✗ Play on, or Restart.", k: after >= before - 0.8 ? "good" : "bad" }, onTrack: after >= before - 0.8 };
  } catch { return { you: desc, eng: "", engineMove: null, fb: { t: "Your move.", k: "" }, onTrack: true }; }
}

export default function BookPage() {
  const [bookSlug, setBookSlug] = useState(BOOKS[0]!.slug);
  const book = BOOKS.find((b) => b.slug === bookSlug)!;
  const bookPuzzles = bookSlug === "endgame-manual" ? EM_BY_PAGE : PUZZLES;
  const [page, setPage] = useState(BOOKS[0]!.initialPage);
  const [cur, setCur] = useState<Puz | null>(null);
  const game = useRef(new Chess());
  const [ply, setPly] = useState(0);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>(undefined);
  const [fb, setFb] = useState<{ t: string; k: string }>({ t: "Your move.", k: "" });
  const [, force] = useState(0);
  const rerender = () => force((x) => x + 1);
  const solving = useRef(false);   // engine is thinking / demo is running
  const done = useRef(false);      // puzzle reached a terminal (win/draw/loss)
  const [comment, setComment] = useState<{ you: string; eng: string }>({ you: "", eng: "" }); // per-move reasoning
  const [viewPly, setViewPly] = useState(0);   // which ply of the played line is on the board (browse ◀ ▶)

  // Preload neighbouring pages so Prev/Next feels instant.
  useEffect(() => {
    for (const p of [page + 1, page + 2, page + 3, page - 1]) {
      if (p >= 1 && p <= book.pages) { const im = new Image(); im.src = `${BASE}${book.imgBase}p${p}.png`; }
    }
  }, [page, book.imgBase, book.pages]);

  // Page-image loading + aspect (read from the actual image so the browser is common to
  // any book, whatever the page dimensions; keeps the box stable → no layout shift).
  const [imgLoaded, setImgLoaded] = useState(false);
  const [aspect, setAspect] = useState(book.defaultAspect);
  const imgRef = useRef<HTMLImageElement>(null);
  const onImg = () => {
    setImgLoaded(true);
    const im = imgRef.current;
    if (im?.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`);
  };
  useEffect(() => { setAspect(book.defaultAspect); }, [bookSlug, book.defaultAspect]);
  useEffect(() => {
    setImgLoaded(false);
    const t = setTimeout(() => { if (imgRef.current?.complete) onImg(); }, 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, bookSlug]);

  // Keyboard ← → to flip pages while browsing.
  useEffect(() => {
    if (cur) return;
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
      else if (e.key === "ArrowRight") setPage((p) => Math.min(book.pages, p + 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cur, book.pages]);

  // Flat list of playable diagrams (for the quick-jump strip).
  const playable = Object.entries(bookPuzzles).flatMap(([pg, arr]) => arr.map((pz) => ({ pz, pg: +pg }))).sort((a, b) => a.pz.n - b.pz.n);

  const [showAn, setShowAn] = useState(false);
  const [an, setAn] = useState<{ sf: { move: string | null; score: { type: string; val: number } | null }; maia: { move: string | null; level: number } } | null>(null);
  useEffect(() => {
    if (!cur || !showAn) { setAn(null); return; }
    const fen = game.current.fen(); let cancelled = false; setAn(null);
    fetch(`/book-engine/analyze?fen=${encodeURIComponent(fen)}`).then((r) => r.json()).then((d) => { if (!cancelled) setAn(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [cur, ply, showAn]); // eslint-disable-line
  const shapes = useMemo(() => {
    if (!showAn || !an) return [] as { orig: Key; dest: Key; brush: string }[];
    const out: { orig: Key; dest: Key; brush: string }[] = [];
    if (an.sf?.move && an.sf.move.length >= 4) out.push({ orig: an.sf.move.slice(0, 2) as Key, dest: an.sf.move.slice(2, 4) as Key, brush: "green" });
    if (an.maia?.move && an.maia.move.length >= 4 && an.maia.move.slice(0, 4) !== an.sf?.move?.slice(0, 4)) out.push({ orig: an.maia.move.slice(0, 2) as Key, dest: an.maia.move.slice(2, 4) as Key, brush: "yellow" });
    return out;
  }, [showAn, an]);
  const evalStr = an?.sf?.score ? (an.sf.score.type === "mate" ? `M${an.sf.score.val}` : (an.sf.score.val / 100).toFixed(2)) : "";

  // rating: endgame puzzles carry their own (Maia rater); tactics use the RATINGS map.
  const tacticData = cur && cur.rating == null ? RATINGS[cur.n] : undefined;
  const finalRating = cur?.rating ?? tacticData?.rating ?? null;
  const finalBand = cur?.band ?? tacticData?.band ?? "";

  const solverSide = (cur?.side === "b" ? "b" : "w") as "w" | "b";
  // The board the user SEES = the played line up to `viewPly` (browse with ◀ ▶).
  const fullLen = cur ? game.current.history().length : 0;
  const view = (() => {
    if (!cur) return new Chess();
    const g = new Chess(cur.fen);
    const ms = game.current.history();
    for (let i = 0; i < Math.min(viewPly, ms.length); i++) { try { g.move(ms[i]!); } catch { /* */ } }
    return g;
  })();
  const atLive = viewPly >= fullLen;
  const viewLastMove: [Key, Key] | undefined = (() => {
    if (!cur || viewPly === 0) return undefined;
    const m = (game.current.history({ verbose: true })[viewPly - 1]) as any;
    return m ? [m.from as Key, m.to as Key] : undefined;
  })();

  function start(p: Puz) {
    setCur(p); game.current = new Chess(p.fen); setViewPly(0); setPly(0); setLastMove(undefined); solving.current = false; done.current = false;
    setComment({ you: "", eng: "" });
    setFb({ t: `You play ${p.side === "w" ? "White" : "Black"}. ${p.goal === "draw" ? "Hold the draw." : "Win it."}`, k: "" }); rerender();
  }
  function undo() {
    if (!cur || solving.current || game.current.history().length === 0) return;
    game.current.undo();
    if (game.current.turn() !== solverSide && game.current.history().length > 0) game.current.undo();
    done.current = false; setViewPly(game.current.history().length);
    setComment({ you: "", eng: "" }); setFb({ t: "↶ Take-back — your move.", k: "" }); rerender();
  }
  const moveSAN = () => game.current.history();  // SAN array of the whole line
  function adjudicate(): "win" | "draw" | "loss" | null {
    const g = game.current, solW = cur?.side === "w";
    if (g.isCheckmate()) return (g.turn() === "w") === solW ? "loss" : "win";
    if (g.isStalemate() || g.isInsufficientMaterial() || g.isThreefoldRepetition() || g.isDraw()) return "draw";
    const board = g.fen().split(" ")[0] ?? "";
    const wq = (board.match(/Q/g) || []).length, bq = (board.match(/q/g) || []).length;
    if (wq || bq) return (solW ? wq > 0 : bq > 0) ? "win" : "loss";
    if (!/[PpRrBbNnQq]/.test(board)) return "draw";
    return null;
  }
  function finish(res: "win" | "draw" | "loss") {
    done.current = true;
    const goal = cur?.goal ?? "win";
    const msg = goal === "win"
      ? (res === "win" ? "✓ Solved — you won it! 🎉" : res === "draw" ? "½ Only a draw — the defence held. ↶ Take back or ↺ Restart." : "✗ You lost it. ↶ Take back or ↺ Restart.")
      : (res === "draw" ? "✓ Draw held! 🛡️" : "✗ You lost the draw. ↶ Take back or ↺ Restart.");
    setFb({ t: msg, k: res === goal ? "good" : "bad" }); rerender();
  }
  // Free play with move-browsing: playing from a browsed position BRANCHES from there.
  async function handleMove(from: Key, to: Key) {
    if (!cur || solving.current) return;
    const g = new Chess(cur.fen); const ms = game.current.history();
    for (let i = 0; i < Math.min(viewPly, ms.length); i++) { try { g.move(ms[i]!); } catch { /* */ } }
    if (g.turn() !== solverSide) return;                      // only on your turn
    const fenBefore = g.fen();
    let mv: any = null;
    try { mv = g.move({ from, to, promotion: "q" }); } catch { mv = null; }
    if (!mv) { rerender(); return; }
    game.current = g; done.current = false;                   // branch: this line replaces the future
    const muci = mv.from + mv.to + (mv.promotion || "");
    setViewPly(g.history().length); solving.current = true; setFb({ t: "…", k: "" }); setComment({ you: "", eng: "" }); rerender();
    const term0 = adjudicate();
    const a = await assessMove(fenBefore, muci, game.current.fen(), cur.goal ?? "win");
    if (!term0 && a.engineMove) { const m = uci(a.engineMove); try { game.current.move(m); } catch { /* */ } }
    solving.current = false; setViewPly(game.current.history().length);
    setComment({ you: a.you, eng: term0 ? "" : a.eng });
    const term = adjudicate();
    if (term) { finish(term); return; }
    setFb(a.fb); rerender();
  }
  function showSolution() {
    if (!cur) return; game.current = new Chess(cur.fen); setViewPly(0); solving.current = true; done.current = true; rerender();
    let i = 0;
    const step = () => {
      if (!cur || i >= cur.sol.length) { solving.current = false; setFb({ t: "Solution shown — ↶ take back or ↺ Restart to play it.", k: "good" }); rerender(); return; }
      try { game.current.move(uci(cur.sol[i]!)); } catch { /* */ }
      setViewPly(i + 1); i++; rerender(); setTimeout(step, 620);
    };
    setTimeout(step, 300);
  }

  const solverColor: Color = solverSide === "b" ? "black" : "white";
  const turnColor: Color = view.turn() === "w" ? "white" : "black";
  const myTurn = !!cur && !solving.current && view.turn() === solverSide && !view.isGameOver() && !(done.current && atLive);

  const selectBook = (slug: string) => { const b = BOOKS.find((x) => x.slug === slug)!; setBookSlug(slug); setCur(null); setPage(b.initialPage); };

  return (
    <div>
      <h1 className="mb-1 font-display text-xl text-white">Book</h1>
      {/* Book selector */}
      <div className="mb-3 flex flex-wrap gap-2">
        {BOOKS.map((b) => (
          <button key={b.slug} onClick={() => selectBook(b.slug)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${b.slug === bookSlug ? "border-brand-500 bg-brand-600/20 text-white" : "border-ink-700 text-ink-300 hover:text-white"}`}>
            {b.title}
          </button>
        ))}
      </div>
      <p className="mb-4 text-sm text-ink-400">{book.subtitle}</p>

      {/* ── PAGES mode: flip through the book, click a ▶ diagram to play ── */}
      {!cur && (
        <div className="mx-auto w-full max-w-xl">
          {/* nav bar: First / Prev / jump / Next / Last */}
          <div className="mb-2 flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(1)} title="First page" className="rounded-lg border border-ink-700 px-2 py-1.5 text-sm text-ink-300 hover:text-white disabled:opacity-30">«</button>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white disabled:opacity-30">‹ Prev</button>
            <div className="flex items-center gap-1 text-sm text-ink-400">
              <input type="number" min={1} max={book.pages} value={page}
                onChange={(e) => { const v = Math.max(1, Math.min(book.pages, Number(e.target.value) || 1)); setPage(v); }}
                className="w-14 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-center text-ink-100 focus:border-brand-500 focus:outline-none" />
              <span>/ {book.pages}</span>
            </div>
            <button disabled={page >= book.pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white disabled:opacity-30">Next ›</button>
            <button disabled={page >= book.pages} onClick={() => setPage(book.pages)} title="Last page" className="rounded-lg border border-ink-700 px-2 py-1.5 text-sm text-ink-300 hover:text-white disabled:opacity-30">»</button>
            <span className="ml-auto hidden text-[11px] text-ink-600 sm:inline">← → to flip</span>
          </div>

          {/* quick-jump to the playable diagrams */}
          {playable.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-500">Jump to diagram:</span>
              {playable.map(({ pz, pg }) => (
                <button key={pz.n} onClick={() => setPage(pg)} title={`Go to ${pz.num ?? "#" + pz.n} (page ${pg})`}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition ${page === pg ? "border-brand-500 bg-brand-600/30 text-white" : "border-brand-700/50 bg-brand-900/25 text-brand-200 hover:bg-brand-600/25"}`}>
                  ▶ {pz.num ?? "#" + pz.n}
                </button>
              ))}
            </div>
          )}

          {/* the page — full quality, fixed aspect so no layout shift, spinner while loading */}
          <div className="relative w-full overflow-hidden rounded-lg bg-white shadow-lg shadow-black/30" style={{ aspectRatio: aspect }}>
            {!imgLoaded && <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-900/10"><div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>}
            <img ref={imgRef} key={page} src={`${BASE}${book.imgBase}p${page}.png`} alt={`page ${page}`}
              onLoad={onImg} className="absolute inset-0 h-full w-full object-contain" />
            {(bookPuzzles[page] || []).map((pz) => (
              <button key={pz.n} onClick={() => start(pz)} title={`Play ${pz.num ?? "#" + pz.n}`}
                style={{ left: `${pz.bb![0]}%`, top: `${pz.bb![1]}%`, width: `${pz.bb![2]}%`, height: `${pz.bb![3]}%` }}
                className="group absolute z-20 rounded-md border-2 border-brand-500/50 bg-brand-500/5 transition hover:border-brand-500 hover:bg-brand-500/25">
                <span className="absolute left-1 top-1 rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white shadow">▶ {pz.num ?? "#" + pz.n}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-ink-500">
            {(bookPuzzles[page]?.length ?? 0) > 0
              ? <span className="text-brand-400">▶ {bookPuzzles[page]!.length} playable diagram{bookPuzzles[page]!.length > 1 ? "s" : ""} on this page — click to solve</span>
              : "Flip with ‹ Prev / Next › or the arrow keys · use the chips above to jump to a playable diagram"}
          </p>
        </div>
      )}

      {/* ── shared play panel ── */}
      {cur && (
        <div>
          <div className="sticky top-14 z-20 -mx-4 border-b border-ink-700 bg-ink-900/95 px-4 py-2 backdrop-blur">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <button onClick={() => setCur(null)} className="text-brand-400 hover:text-brand-300">‹ Back to book</button>
              <span className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-ink-300">{cur.num ? `${cur.num} · ` : `#${cur.n} · `}{cur.side === "w" ? "White" : "Black"} to move</span>
              <span className="rounded-full bg-brand-900/60 px-2 py-0.5 text-xs text-brand-200">{cur.diff}</span>
              <button onClick={() => start(cur)} className="rounded-lg border border-brand-600/60 bg-brand-900/30 px-2.5 py-1 text-xs font-semibold text-brand-200 hover:bg-brand-600/30">↺ Restart</button>
              <button onClick={showSolution} className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:text-white">Show solution</button>
              <button onClick={() => setShowAn((v) => !v)} className={`rounded-lg border px-2.5 py-1 text-xs ${showAn ? "border-emerald-500 text-emerald-300" : "border-ink-700 text-ink-300 hover:text-white"}`}>{showAn ? "Engine ✓" : "Engine ▷"}</button>
              <span className={`ml-auto font-semibold ${fb.k === "good" ? "text-emerald-400" : fb.k === "bad" ? "text-rose-400" : "text-ink-300"}`}>{fb.t}</span>
            </div>
            <div className="mx-auto w-full max-w-[300px]">
              <Board
                fen={view.fen()}
                orientation={solverColor}
                turnColor={turnColor}
                movableColor={myTurn ? solverColor : undefined}
                dests={myTurn ? destsFromChess(view) : new Map()}
                lastMove={viewLastMove}
                onMove={handleMove}
                shapes={shapes}
                className="mini"
              />
            </div>
            {/* move browser: ⏮ ◀ ▶ ⏭ + Undo. Playing from a browsed position continues from there. */}
            <div className="mt-1.5 flex items-center justify-center gap-1 text-xs">
              <button onClick={() => setViewPly(0)} disabled={viewPly <= 0} title="Start" className="rounded border border-ink-700 px-1.5 py-0.5 text-ink-300 hover:text-white disabled:opacity-30">⏮</button>
              <button onClick={() => setViewPly((p) => Math.max(0, p - 1))} disabled={viewPly <= 0} title="Back" className="rounded border border-ink-700 px-2 py-0.5 text-ink-300 hover:text-white disabled:opacity-30">◀</button>
              <span className="min-w-[68px] text-center font-mono text-ink-400">{fullLen ? `move ${viewPly}/${fullLen}` : "start"}</span>
              <button onClick={() => setViewPly((p) => Math.min(fullLen, p + 1))} disabled={viewPly >= fullLen} title="Forward" className="rounded border border-ink-700 px-2 py-0.5 text-ink-300 hover:text-white disabled:opacity-30">▶</button>
              <button onClick={() => setViewPly(fullLen)} disabled={viewPly >= fullLen} title="Latest" className="rounded border border-ink-700 px-1.5 py-0.5 text-ink-300 hover:text-white disabled:opacity-30">⏭</button>
              <button onClick={undo} disabled={fullLen === 0 || solving.current} title="Take back your move" className="ml-1 rounded border border-amber-700/60 bg-amber-900/20 px-2 py-0.5 text-amber-200 hover:bg-amber-700/30 disabled:opacity-30">↶ Undo</button>
            </div>
            {!atLive && fullLen > 0 && <p className="mt-0.5 text-center text-[11px] text-amber-400">browsing — play a move here to continue from this point</p>}
            {(comment.you || comment.eng) && (
              <div className="mt-1.5 rounded-lg border border-ink-700 bg-ink-950/60 p-2 text-[11px] leading-relaxed">
                {comment.you && <p className={comment.you.startsWith("✗") ? "text-rose-300" : "text-emerald-300"}>{comment.you}</p>}
                {comment.eng && <p className="mt-0.5 text-sky-300">{comment.eng}</p>}
              </div>
            )}
          </div>

          {/* Difficulty rating */}
          <div className="mt-4 rounded-xl border border-brand-700/60 bg-brand-900/20 p-4 text-sm">
            <div className="flex items-baseline gap-3">
              <span className="text-ink-400">Difficulty rating</span>
              <span className="text-2xl font-bold text-white">{finalRating ?? "…"}</span>
              {finalRating != null && <span className="rounded-full bg-brand-700/60 px-2 py-0.5 text-xs text-brand-100">{finalBand}</span>}
            </div>
            {cur.emRate ? (
              <>
                {cur.emRate.themes.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-ink-400">Key ideas:</span>
                    {cur.emRate.themes.map((t) => <span key={t} className="rounded-full bg-brand-700/50 px-2 py-0.5 text-[11px] text-brand-100">{t}</span>)}
                  </div>
                )}
                <p className="mt-2 text-xs text-ink-400">
                  {cur.emRate.anchor
                    ? <>Human anchor: the lowest Maia level that converts this vs perfect defense is <b className="text-ink-200">{cur.emRate.anchor}</b>.</>
                    : <>Even <b className="text-ink-200">Maia-1900</b> can't hold the result against best defense — counter-intuitive for humans.</>}
                  {cur.emRate.signals.trap && <span className="text-amber-300"> Trap: the natural move throws it.</span>}
                  {cur.emRate.signals.sfSubtle && <> Shallow search misses the idea.</>}
                  {cur.emRate.signals.reciprocalZugzwang && <> Reciprocal zugzwang.</>}
                  {cur.emRate.signals.onlyMoves > 1 && <> {cur.emRate.signals.onlyMoves} only-moves.</>}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">Ensemble rater: Maia play-it-out (human) + Stockfish subtlety + DTM depth + zugzwang/trap/only-move + theme detection · confidence {cur.emRate.confidence}.</p>
              </>
            ) : tacticData ? (
              <>
                <p className="mb-1 mt-3 text-xs text-ink-400">Chance a player at each level plays the key move:</p>
                <div className="flex items-end gap-2">
                  {BANDS.map((b) => {
                    const pct = tacticData.profile[b] ?? 0;
                    return (
                      <div key={b} className="flex flex-1 flex-col items-center">
                        <span className="mb-0.5 text-[10px] text-ink-400">{Math.round(pct)}%</span>
                        <div className="flex h-14 w-full items-end rounded bg-ink-800/70">
                          <div className="w-full rounded bg-brand-500" style={{ height: `${Math.max(3, Math.min(100, pct))}%` }} />
                        </div>
                        <span className="mt-1 text-[10px] text-ink-300">{b}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-ink-400">
                  {tacticData.maiaSolved.length
                    ? <>Human levels that find the whole line: <b className="text-ink-200">{tacticData.maiaSolved.join(", ")}</b>.</>
                    : <>No human level (1100–1900) reliably finds the full line — counter‑intuitive.</>}
                  <span className="text-ink-500"> Model: GBM trained on 5.88M rated puzzles (±256 Elo).</span>
                </p>
              </>
            ) : null}
          </div>

          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-800/60 p-4 text-sm">
            <p className="mb-2 text-ink-200"><span className="text-ink-400">Idea — </span>{cur.idea}</p>
            <p className="mb-1 text-sky-300"><span className="text-ink-400">Best (Stockfish 18) — </span>{cur.sf}</p>
            {cur.maia !== "—" && <p className="text-amber-300"><span className="text-ink-400">Human (Maia) — </span>plays {cur.maia}. <span className="text-ink-400">{cur.note}</span></p>}
            {cur.maia === "—" && <p className="text-ink-400 text-xs">{cur.note}</p>}
            {showAn && (
              <p className="mt-2 border-t border-ink-700 pt-2 text-emerald-300"><span className="text-ink-400">Live engine — </span>
                Stockfish: <b>{an?.sf?.move ?? "…"}</b>{evalStr && ` (${evalStr})`} · Leela/Maia‑1500: <b>{an?.maia?.move ?? "…"}</b>
                <span className="text-ink-500"> — green arrow = best, yellow = likely human</span></p>
            )}
          </div>

          {(() => { const pp = cur.page ?? page; return (
            <>
              <p className="mb-2 mt-4 text-xs text-ink-500">Book page {pp} — scroll to read; click any other diagram to switch:</p>
              <div className="relative mx-auto w-full max-w-xl">
                <img src={`${BASE}${book.imgBase}p${pp}.png`} alt={`book page ${pp}`} className="w-full rounded-lg bg-white" />
                {(bookPuzzles[pp] || []).map((pz) => (
                  <button key={pz.n} onClick={() => start(pz)} title={`Play ${pz.num ?? "#" + pz.n}`}
                    style={{ left: `${pz.bb![0]}%`, top: `${pz.bb![1]}%`, width: `${pz.bb![2]}%`, height: `${pz.bb![3]}%` }}
                    className={`group absolute rounded-md border-2 transition ${cur.n === pz.n ? "border-brand-500 bg-brand-500/10" : "border-brand-500/40 bg-brand-500/5 hover:border-brand-500 hover:bg-brand-500/20"}`}>
                    <span className="absolute left-1 top-1 rounded bg-brand-600 px-1.5 text-[11px] font-bold text-white opacity-90">▶ {pz.num ?? "#" + pz.n}</span>
                  </button>
                ))}
              </div>
            </>
          ); })()}
        </div>
      )}
    </div>
  );
}
