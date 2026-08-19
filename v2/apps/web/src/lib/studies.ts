export type StudyKind = "mate" | "stopPawn" | "pawnEnd" | "coordinate" | "memory" | "notation";
export interface StudyDef {
  id: string;
  kind: StudyKind;
  pieces?: string[];  // white attacking pieces (besides the king). stopPawn uses pieces[0]. (none for coordinate)
  icon: string;
  title: string;
  blurb: string;
  detail: string;
  mateIn: string;
  // Curated difficulty range for the CONCEPT (not the individual puzzles).
  // Renders as a "★ 400–1200 · Beginner–Intermediate" chip on the /study page
  // so students can pick trainers matched to their level. Empirical rating
  // (from /api/study/levels) is shown ALONGSIDE this when data exists.
  // Omit for pure utility/dashboard entries where "difficulty" doesn't apply.
  range?: [number, number];
  // Game phase this trainer teaches. Drives the section grouping on /study
  // (Opening / Middle game / End game). "memory" is a standalone bucket for
  // general board-memory tools (Memory Palace) that don't belong to a specific
  // phase — owner ask 2026-08-18. Owner-requested taxonomy overall.
  phase?: "opening" | "middle" | "end" | "memory";
}

export const STUDIES: StudyDef[] = [
  { id: "openings-by-name", kind: "memory", icon: "🗂️", title: "Browse by opening name", blurb: "Family → Opening → Variation",
    detail: "3-column drilldown of every opening in the corpus, grouped by name. Pick the family (Sicilian, King's Indian…), then a variation, then a sub-line — and see the live position on the right. Complements the SAN move-tree at /study/tree.", mateIn: "drilldown · live board", phase: "opening" },
  { id: "notation", kind: "notation", icon: "♞", title: "Chess Notation", blurb: "Read the language of chess",
    detail: "Every opening line, every game score, every book: written in this notation. Learn the alphabet (K/Q/R/B/N/pawn), captures (x), check/mate (+/#), castling (O-O), promotion (=Q) and disambiguation — then drill on 10 real opening positions per round.", mateIn: "10-question round", range: [200, 900], phase: "opening" },
  { id: "coordinates", kind: "coordinate", icon: "a1", title: "Coordinate Training", blurb: "Place pieces by coordinate",
    detail: "A square + piece appears (e.g. \u201cBlack Rook \u2192 e7\u201d) and you tap that square to place it. Coordinates are hidden — the classic way to learn the board. 45-second sprint.", mateIn: "45s sprint", range: [400, 1200], phase: "opening" },
  { id: "memory-palace", kind: "memory", icon: "\ud83c\udff0", title: "Memory Palace", blurb: "A funny picture on every square",
    detail: "The memory-champion trick: each of the 64 squares gets a silly, unforgettable scene (a1 = Ant on the Sun, h8 = Hedgehog that Ate too much). Pick from 11 picture sets \u2014 Easy, Animals, Mythology, Space, Ocean, Jungle, Fairy Tales, Superheroes, Cartoons, Vehicles, Food. Explore the board, then quiz yourself both ways.", mateIn: "11 sets \u00b7 no timer", range: [800, 1600], phase: "memory" },
  { id: "opening-memory", kind: "memory", icon: "\u265f\ufe0f", title: "Opening Memory", blurb: "Memorize an opening as a story",
    detail: "Learn an opening the memory-champion way: every move becomes a hero visiting a square\u2019s funny picture (its anchor). Step through the Italian, Ruy Lopez, Scotch or Queen\u2019s Gambit \u2014 or send a line over from the Opening explorer \u2014 in any of the 11 picture sets.", mateIn: "anchors \u00b7 step-through", range: [900, 1700], phase: "opening" },
  { id: "daily", kind: "memory", icon: "\ud83d\udd01", title: "Daily Study", blurb: "Your spaced-repetition review queue",
    detail: "The FSRS-scheduled review queue. Every opening you activate for study generates cards \u2014 one per move in the mainline, plus plan + structure cards. Grade Again/Hard/Good/Easy after each; the scheduler picks when to bring the card back so it lands right before you'd forget. Repertoire openings jump the queue.", mateIn: "FSRS \u00b7 daily cadence", phase: "opening" },
  { id: "tree", kind: "memory", icon: "\ud83c\udf33", title: "Opening tree", blurb: "Explore the 500 as one big variation forest",
    detail: "The whole 500-corpus arranged as a move-tree: 1.e4 branches into every response Black plays, each of those branches into White's replies, and so on. Coloured dots mark dominant family per branch. Click any node to preview the position; click an opening leaf to read theory. Your repertoire openings are highlighted; activated ones get a \u2713.", mateIn: "one big move-tree", phase: "opening" },
  { id: "prep-test", kind: "memory", icon: "\u23f1\ufe0f", title: "Prep-test", blurb: "5-minute rapid drill before a game",
    detail: "You're about to play \u2014 pick White, Black-vs-1.e4, or Black-vs-1.d4, and we serve the 15 most-critical mainline positions from your activated openings on that side. Rapid-fire: reveal, grade, next. Grades still feed FSRS so a pre-match blunder gets rescheduled for tomorrow.", mateIn: "15 cards \u00b7 pick your side", range: [1000, 1800], phase: "opening" },
  { id: "import-game", kind: "memory", icon: "\ud83d\udce5", title: "Import a game", blurb: "Score a real game against the 500-corpus",
    detail: "Paste a PGN from Lichess or Chess.com. We identify the opening from the 500-corpus (the deepest match), count your book plies, and pin the first deviation move \u2014 theory says X, you played Y. One click adds the opening's cards to your daily queue so the correction is drilled into muscle memory.", mateIn: "PGN \u2192 book % + deviation", phase: "opening" },
  { id: "progress", kind: "memory", icon: "\ud83d\udcca", title: "Progress", blurb: "Streak, retention, mastery by family",
    detail: "Your Memory Master 500 report card: cards mastered vs learning, retention rate, streak days, reviews-per-day for the past 30 days, upcoming due-load for the next 30 days, and a mastery bar per opening family. All computed locally from your FSRS state \u2014 no accounts, no sync.", mateIn: "streak \u00b7 retention \u00b7 load", phase: "opening" },
  { id: "openings", kind: "memory", icon: "\ud83d\udcda", title: "Memory Master 500", blurb: "Browse the 500 most-played openings",
    detail: "The whole corpus in one place: 500 openings sourced from Lichess ECO (CC0) + Wikibooks Chess Opening Theory (CC-BY-SA), ranked by master-game frequency. Filter by tag (aggressive / positional / theory-heavy \u2026) or family (Sicilian, Ruy Lopez, King\u2019s Indian \u2026). Tap any opening to read its idea, plans, story, and 15-move mainline \u2014 then hand off to the Opening Memory trainer to memorise it.", mateIn: "500 openings \u00b7 filter \u00b7 learn", phase: "opening" },
  { id: "repertoire", kind: "memory", icon: "\ud83c\udfaf", title: "Build my repertoire", blurb: "10 questions \u2192 your 30-40 openings",
    detail: "Answer 10 questions about your rating, time, style, and defence preferences \u2014 and the wizard picks your personalised opening repertoire from the 500. Kept in your browser only; redo whenever your style changes. When the FSRS card engine ships, your repertoire's openings get prioritised in the daily study queue.", mateIn: "10 questions \u00b7 personalised", range: [900, 1600], phase: "opening" },
  { id: "queen-mate", kind: "mate", pieces: ["Q"], icon: "♛", title: "Queen Mate", blurb: "King + Queen vs King",
    detail: "The first checkmate to master. Box the lone king to an edge with the queen, bring your king up, and mate — without stalemating.", mateIn: "Mate in ≤ 10", range: [400, 900], phase: "end" },
  { id: "rook-mate", kind: "mate", pieces: ["R"], icon: "♜", title: "Rook Mate", blurb: "King + Rook vs King",
    detail: "The classic box / ladder mate. Cut the king off with the rook, oppose with your king, and drive it to the edge.", mateIn: "Mate in ≤ 16", range: [500, 1000], phase: "end" },
  { id: "two-rook-mate", kind: "mate", pieces: ["R", "R"], icon: "♜♜", title: "Double Rook Mate", blurb: "King + 2 Rooks vs King",
    detail: "The easiest mate of all — the two-rook 'lawnmower'. Roll the rooks rank by rank to push the king off the board. Your king isn't even needed.", mateIn: "Mate in ≤ 7", range: [400, 800], phase: "end" },
  { id: "two-bishop-mate", kind: "mate", pieces: ["B", "B"], icon: "♝♝", title: "Two-Bishop Mate", blurb: "King + 2 Bishops vs King",
    detail: "Two bishops on opposite colours mate the lone king in a corner. Coordinate the bishops to build a wall and use your king to herd it.", mateIn: "Mate in ≤ 19", range: [1400, 1800], phase: "end" },
  { id: "bishop-knight-mate", kind: "mate", pieces: ["B", "N"], icon: "♝♞", title: "Bishop + Knight Mate", blurb: "King + Bishop + Knight vs King",
    detail: "The hardest basic mate. You must drive the king to a corner of the BISHOP's colour. Needs precise king+piece coordination (the 'W' manoeuvre).", mateIn: "Mate in ≤ 33 · hardest", range: [1700, 2100], phase: "end" },
  { id: "pawn-endgames", kind: "pawnEnd", icon: "♟", title: "Pawn Endgames · Rated", blurb: "Real pawn endings at your level",
    detail: "The rated follow-up to the Promote One Pawn course: real pawn endgames from Dvoretsky's Endgame Manual and the Lichess puzzle base, matched to your rating. You play White against full-strength Stockfish — promote a pawn and checkmate, or hold the theoretical draw. Ratings run 600 to 2800+, so even experienced players will find trouble.", mateIn: "Rated · win or hold", range: [600, 2800], phase: "end" },
  { id: "stop-the-pawn", kind: "stopPawn", pieces: ["Q"], icon: "♛♟", title: "Queen vs Pawns", blurb: "King + Queen vs King + Pawns (pick 1–4)",
    detail: "Your opponent has passed pawns racing to promote. Pick how many pawns (1, 2, 3 or 4), capture or blockade them with the queen, then checkmate. If a pawn promotes you can still try to win the new queen — only a real draw or getting mated ends it.", mateIn: "1–4 pawns", range: [700, 1200], phase: "end" },
  { id: "rook-stop-pawn", kind: "stopPawn", pieces: ["R"], icon: "♜♟", title: "Rook vs Pawns", blurb: "King + Rook vs King + Pawns (pick 1–4)",
    detail: "Trickier than with a queen — your rook must catch the runners. Pick 1–4 pawns, get behind or in front of each, win them, then mate. If a pawn promotes you can still try to win it.", mateIn: "1–4 pawns", range: [900, 1400], phase: "end" },
  { id: "zugzwang", kind: "pawnEnd", icon: "⚔️", title: "Zugzwang", blurb: "The move you don’t want to make",
    detail: "11 canonical zugzwang positions across 6 pattern classes — Hooper KP-vs-K, the classical trébuchet, K+P opposition with wrong-rook-pawn draw, Lucena, Sämisch–Nimzowitsch 1923 (Immortal Zugzwang), Fischer–Rossetto 1959, Réti 1921, Saavedra 1895. Study mode reveals mechanism + source; Practice mode hides the answer and asks you to play the correct move on the board.", mateIn: "6 classes · study + practice", range: [1200, 2000], phase: "end" },
];

export const studyById = (id: string | undefined) => STUDIES.find((s) => s.id === id);
