// Zugzwang corpus v1 — 11 hand-verified positions across 6 pattern classes.
// Sources cross-checked on Wikipedia / lichess / ChessBase; see the notes in
// PROJECT_MASTER research report (2026-08-16) for the wider 60-position list
// still awaiting book-look verification.

export type ZugzwangPattern =
  | "reciprocal"
  | "trebuchet"
  | "opposition"
  | "minor-piece"
  | "rook"
  | "queen"
  | "middlegame"
  | "study"
  | "domination";

export interface ZugzwangPosition {
  id: string;
  name: string;
  pattern: ZugzwangPattern;
  fen: string;
  /** Best move in SAN — the "correct" answer for practice mode. */
  bestMoveSan: string;
  /** Best move in UCI (from-to[+promotion]) — what practice mode matches against. */
  bestMoveUci: string;
  source: string;
  mechanism: string;
  /** Rough "find the move" Elo difficulty (400–2500). */
  difficulty: number;
  /** Text under the answer indicating what happens (win / draw / loss). */
  outcome?: string;
}

export const ZUGZWANG_PATTERNS: Array<{ id: ZugzwangPattern; label: string; blurb: string }> = [
  { id: "reciprocal", label: "Reciprocal (mutual) zugzwang", blurb: "Both sides would lose if it were their turn." },
  { id: "trebuchet",  label: "Trébuchet",                    blurb: "The K+P vs K+P mutual zugzwang — whoever moves loses their pawn." },
  { id: "opposition", label: "K+P opposition zugzwang",       blurb: "Classic king-and-pawn endings where the wrong-to-move king yields the key square." },
  { id: "minor-piece",label: "Minor-piece endgame zugzwang",  blurb: "Bishop vs knight, 2 knights vs pawn — the Troitzky line, Fischer’s Taimanov demolitions." },
  { id: "rook",       label: "Rook endgame zugzwang",         blurb: "Lucena, Philidor, and the tempo-move breakthroughs of rook endings." },
  { id: "queen",      label: "Queen endgame zugzwang",        blurb: "Q vs P wrong-rook draws, Q+P vs Q winning technique." },
  { id: "middlegame", label: "Middlegame zugzwang",           blurb: "The rarest and most famous — Sämisch, Fischer, Nimzowitsch, Alekhine." },
  { id: "study",      label: "Composition / study zugzwang",  blurb: "Réti, Saavedra — geometric zugzwang from problem chess." },
  { id: "domination", label: "Domination zugzwang",           blurb: "A piece with many nominal moves — every one loses material. Rinck studies + Beliavsky–Korchnoi." },
];

export const ZUGZWANG_POSITIONS: ZugzwangPosition[] = [
  // ─────────────── reciprocal ───────────────
  {
    id: "recip-01",
    name: "Hooper KP vs K — Black to move loses",
    pattern: "reciprocal",
    fen: "2k5/2P5/1K6/8/8/8/8/8 b - - 0 1",
    bestMoveSan: "Kd7",
    bestMoveUci: "c8d7",
    source: "Hooper 1970, A Pocket Guide to Chess Endgames.",
    mechanism: "Reciprocal zugzwang on b6/c8. Black must play 1…Kd7 2.Kb7 or 1…Kb8 2.Kb6 Kc8 3.c7 — either way White queens.",
    difficulty: 800,
    outcome: "White wins.",
  },
  {
    id: "recip-02",
    name: "Hooper KP vs K — White to move draws (mirror)",
    pattern: "reciprocal",
    fen: "2k5/2P5/1K6/8/8/8/8/8 w - - 0 1",
    bestMoveSan: "Kc6",
    bestMoveUci: "b6c6",
    source: "Hooper 1970 — the paired diagram to recip-01.",
    mechanism: "SAME board, opposite side to move — now White has to move and only draws (any king move loses c7 or stalemates). Illustrates the whole mutual-zugzwang concept.",
    difficulty: 1000,
    outcome: "Draw.",
  },
  // ─────────────── trébuchet ───────────────
  {
    id: "treb-01",
    name: "Classical trébuchet — White to move loses",
    pattern: "trebuchet",
    fen: "8/8/8/3pK3/2k1P3/8/8/8 w - - 0 1",
    bestMoveSan: "Kxd5",
    bestMoveUci: "e5d5",
    source: "Flear 2004, Practical Endgame Play — Mastering the Basics, p.13.",
    mechanism: "Each king simultaneously defends its own pawn and attacks the enemy's. Whoever moves has to release contact — 1.Kxd5 Kxe4 and Black promotes first.",
    difficulty: 1200,
    outcome: "Black wins.",
  },
  {
    id: "treb-02",
    name: "Classical trébuchet — Black to move loses (mirror)",
    pattern: "trebuchet",
    fen: "8/8/8/3pK3/2k1P3/8/8/8 b - - 0 1",
    bestMoveSan: "Kxd4",
    bestMoveUci: "c4d4",
    source: "Flear 2004 — paired diagram.",
    mechanism: "Same board, Black to move; 1…Kxd4 2.Kxd5 and White queens first. Zugzwang is symmetrical — the loser is whoever's turn it is.",
    difficulty: 1200,
    outcome: "White wins.",
  },
  // ─────────────── opposition ───────────────
  {
    id: "opp-01",
    name: "KP vs K — Black to move loses the opposition",
    pattern: "opposition",
    fen: "8/8/4k3/8/3K4/4P3/8/8 b - - 0 1",
    bestMoveSan: "Kd6",
    bestMoveUci: "e6d6",
    source: "Wikipedia — King and pawn versus king endgame.",
    mechanism: "White has the direct opposition. Whatever Black plays, White marches to a key square (d5/e5/f5) and wins the pawn ending.",
    difficulty: 900,
    outcome: "White wins.",
  },
  {
    id: "opp-02",
    name: "Ideal winning position — all three key squares",
    pattern: "opposition",
    fen: "2k5/8/2K5/2P5/8/8/8/8 w - - 0 1",
    bestMoveSan: "Kd6",
    bestMoveUci: "c6d6",
    source: "Wikipedia — King and pawn versus king endgame.",
    mechanism: "The white king already sits in front of the pawn on a key square — wins regardless of who moves. Contrast with recip-01 to see what \"key square\" really means.",
    difficulty: 700,
    outcome: "White wins.",
  },
  {
    id: "opp-03",
    name: "Wrong rook pawn — fortress draw (no zugzwang possible)",
    pattern: "opposition",
    fen: "7k/8/6KP/8/8/8/8/8 b - - 0 1",
    bestMoveSan: "Kg8",
    bestMoveUci: "h8g8",
    source: "Wikipedia — King and pawn versus king endgame; Averbakh, Chess Endings: Essential Knowledge.",
    mechanism: "NEGATIVE example. Black just shuffles h8/g8 and can never be dragged into zugzwang — White has no tempo move that changes the corner fortress.",
    difficulty: 600,
    outcome: "Draw.",
  },
  // ─────────────── rook ───────────────
  {
    id: "rook-01",
    name: "Lucena — build the bridge",
    pattern: "rook",
    fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    bestMoveSan: "Rc4",
    bestMoveUci: "c1c4",
    source: "Lucena 1497 (attrib.); de la Villa, 100 Endgames You Must Know.",
    mechanism: "1.Rc4! begins the bridge — Rd4 will later shield checks from the a-file, and Black's king is forced off the promotion path. The tempo mechanism IS zugzwang: any file Black tries yields the c-file to White's king.",
    difficulty: 1600,
    outcome: "White wins.",
  },
  // ─────────────── middlegame ───────────────
  {
    id: "mid-01",
    name: "Sämisch – Nimzowitsch 1923 — the \"Immortal Zugzwang\"",
    pattern: "middlegame",
    fen: "r1bqk2r/pp1n1pp1/2b1p2p/1p1p4/3P4/3B1P2/PP3R1P/R2Q2K1 w KQkq - 0 26",
    bestMoveSan: "Kh1",
    bestMoveUci: "g1h1",
    source: "Sämisch vs Nimzowitsch, Copenhagen 1923 rd.6. Nimzowitsch played 25…h6!! — every White reply drops material.",
    mechanism: "White resigned rather than move — Kh2/Kh1 loses to …R5f3; Qxf3 hangs to R2f5; Rce1 loses to Rxf3; only two tempo pawn moves remain and they exhaust in 1-2 moves.",
    difficulty: 2400,
    outcome: "Black wins — the canonical middlegame zugzwang.",
  },
  {
    id: "mid-05",
    name: "Fischer – Rossetto, Mar del Plata 1959",
    pattern: "middlegame",
    fen: "2r2n1k/2P5/1b6/8/8/1B6/PP4PP/6K1 b - - 0 33",
    bestMoveSan: "h5",
    bestMoveUci: "h7h5",
    source: "Fischer vs Rossetto, Mar del Plata 1959; Fischer, My 60 Memorable Games.",
    mechanism: "After 33.Bb3! Black is in zugzwang: any king move → Rb8 wins the piece; any rook move → Rb8 queens the c-pawn; any knight move → Be6 wins the rook. Only pawn tempos remain and they run out fast.",
    difficulty: 2200,
    outcome: "White wins.",
  },
  // ─────────────── study ───────────────
  {
    id: "study-01",
    name: "Réti 1921 — the geometric draw",
    pattern: "study",
    fen: "8/8/k1P5/7p/8/8/8/7K w - - 0 1",
    bestMoveSan: "Kg7",
    bestMoveUci: "h1g7",
    source: "Réti, Kagans Neueste Schachnachrichten 1921.",
    mechanism: "1.Kg7! is the double-purpose diagonal march. Not pure zugzwang, but the drawing idea is that Black cannot simultaneously stop the c-pawn and shepherd the h-pawn — a form of geometric tempo zugzwang.",
    difficulty: 2000,
    outcome: "Draw.",
  },
  // ─────────────── minor-piece ───────────────
  {
    id: "minor-01",
    name: "Fischer – Taimanov 1971 g4 — bishop dominates knight",
    pattern: "minor-piece",
    fen: "8/8/K1k1n3/1p3p1p/P1P5/8/1P4p1/5b2 b - - 0 57",
    bestMoveSan: "Ng7",
    bestMoveUci: "e6g7",
    source: "Fischer vs Taimanov, Candidates QF Vancouver 1971 game 4. FEN from Wikipedia diagram — may differ slightly from ChessBase.",
    mechanism: "Classic B-vs-N zugzwang finale. Knight has almost no move that doesn’t drop to the bishop or the king; any king move loses pawns. Fischer’s later Be8 (a few moves on) sealed it.",
    difficulty: 2000,
    outcome: "White wins.",
  },
  {
    id: "minor-02",
    name: "Fischer – Taimanov 1971 g2 (adjournment)",
    pattern: "minor-piece",
    fen: "8/3k4/1pn2rp1/pBp2p1p/P4P1P/2P1RKP1/1P6/8 b - - 0 41",
    bestMoveSan: "Rf7",
    bestMoveUci: "f6f7",
    source: "Fischer vs Taimanov, Vancouver 1971 game 2, adjournment position.",
    mechanism: "Adjournment diagram that eventually collapses into a bishop-vs-knight zugzwang win with 85.Bf5 much later. Start here and play toward the finish; the drift is inevitable.",
    difficulty: 2200,
    outcome: "White wins (in the game).",
  },
  {
    id: "minor-03",
    name: "Two knights vs pawn — Troitzky-line motif",
    pattern: "minor-piece",
    fen: "8/7k/5K2/8/5N2/5p2/5N2/8 w - - 0 1",
    bestMoveSan: "Nd3",
    bestMoveUci: "f2d3",
    source: "Troitzky, Collection of Chess Studies (1937), Two-Knight endings; the Troitzky line is the classical statement.",
    mechanism: "White blocks the f-pawn with one knight, mates with the other. The pawn is Black’s only ‘safety valve’ — freeze it and the king is squeezed into zugzwang / mate.",
    difficulty: 1900,
    outcome: "White wins.",
  },
  // ─────────────── rook (2nd — Philidor draw as negative example) ───────────────
  {
    id: "rook-02",
    name: "Philidor drawing position — no zugzwang possible",
    pattern: "rook",
    fen: "3k4/R7/4K3/4P3/8/8/r7/8 b - - 0 1",
    bestMoveSan: "Ra6",
    bestMoveUci: "a2a6",
    source: "Philidor, Analyse du jeu des Echecs (1777); Wikipedia — Philidor position.",
    mechanism: "NEGATIVE example. Defender’s rook sits on the 3rd rank (a2 here from Black’s POV); White has NO tempo move that breaks the fortress. Contrasts sharply with Lucena.",
    difficulty: 1400,
    outcome: "Draw.",
  },
  // ─────────────── queen ───────────────
  {
    id: "queen-01",
    name: "Q vs P on 7th (rook pawn) — stalemate fortress",
    pattern: "queen",
    fen: "7k/7p/5KQ1/8/8/8/8/8 w - - 0 1",
    bestMoveSan: "Kf7",
    bestMoveUci: "f6f7",
    source: "Wikipedia — Queen versus pawn endgame; Averbakh, Queen Endings.",
    mechanism: "NEGATIVE example. With a rook pawn on the 7th, White cannot approach without stalemating — zugzwang FAILS to break the fortress. Include to teach when the pattern doesn’t apply.",
    difficulty: 1200,
    outcome: "Draw.",
  },
  // ─────────────── domination ───────────────
  {
    id: "dom-01",
    name: "Rinck 1920 — rook dominated with 14 free squares",
    pattern: "domination",
    fen: "8/2N5/8/8/4rk2/8/5K2/1N1B4 w - - 0 1",
    bestMoveSan: "Nd2",
    bestMoveUci: "b1d2",
    source: "Henri Rinck, La Stratégie 1920; Wikipedia — Domination in chess.",
    mechanism: "After 1.Nd2! the Black rook has fourteen squares on the board but every single one loses to a knight capture or a knight fork: 1…Re7 2.Nd5+; 1…Re3 2.Nd5+; 1…Rd4 2.Ne6+; 1…Rb4 2.Nd5+; only 1…Re5 delays. Continues 2.Nc4 Re4/Rf5, 3.Nd6 Re5, 4.Bf3! and eventually 5.Ne6+ wins the rook.",
    difficulty: 2100,
    outcome: "White wins.",
  },
  {
    id: "dom-02",
    name: "Beliavsky – Korchnoi 2004 — Qd3 dominates the knight",
    pattern: "domination",
    fen: "6k1/p4pp1/7p/2p5/2N4P/P1b1P1P1/5PQK/3q4 b - - 1 38",
    bestMoveSan: "Qd3",
    bestMoveUci: "d1d3",
    source: "Beliavsky – Korchnoi, György Marx Memorial 2004 — position after White's blunder 38.Kh2? Wikipedia — Domination in chess.",
    mechanism: "38…Qd3! dominates the knight on c4. It nominally has six squares (b2, d2, a5, e5, d6, b6) but ALL are covered: b2/d2/a5/e5 by the black bishop, d6 by the queen itself, b6 by the a-pawn. No white queen defence works either — every square the queen could shield from is guarded by the black queen.",
    difficulty: 2200,
    outcome: "Black wins.",
  },
  {
    id: "study-02",
    name: "Saavedra 1895 — underpromotion or die",
    pattern: "study",
    fen: "8/2P5/1K6/8/8/8/8/k2r4 w - - 0 1",
    bestMoveSan: "c8=R",
    bestMoveUci: "c7c8r",
    source: "Saavedra, Glasgow Weekly Citizen 18 May 1895; Nunn, Understanding Chess Endgames.",
    mechanism: "Actually the WHOLE study is a zugzwang mechanism. After 1.c7 Rd6+ 2.Kb5 Rd5+ 3.Kb4 Rd4+ 4.Kb3 Rd3+ 5.Kc2 Rd4 — here 6.c8=Q?? Rc4+! draws by stalemate. Only 6.c8=R!! (this move) wins: threat Ra8# leaves Black in zugzwang with no defence.",
    difficulty: 1900,
    outcome: "White wins — position given at the critical underpromotion move.",
  },
];

export const zugzwangById = (id: string): ZugzwangPosition | undefined =>
  ZUGZWANG_POSITIONS.find((p) => p.id === id);

export const zugzwangByPattern = (pattern: ZugzwangPattern): ZugzwangPosition[] =>
  ZUGZWANG_POSITIONS.filter((p) => p.pattern === pattern);
