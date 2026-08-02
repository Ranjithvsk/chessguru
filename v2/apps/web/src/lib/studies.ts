export type StudyKind = "mate" | "stopPawn" | "pawnEnd" | "coordinate" | "memory";
export interface StudyDef {
  id: string;
  kind: StudyKind;
  pieces?: string[];  // white attacking pieces (besides the king). stopPawn uses pieces[0]. (none for coordinate)
  icon: string;
  title: string;
  blurb: string;
  detail: string;
  mateIn: string;
}

export const STUDIES: StudyDef[] = [
  { id: "coordinates", kind: "coordinate", icon: "a1", title: "Coordinate Training", blurb: "Place pieces by coordinate",
    detail: "A square + piece appears (e.g. \u201cBlack Rook \u2192 e7\u201d) and you tap that square to place it. Coordinates are hidden — the classic way to learn the board. 45-second sprint.", mateIn: "45s sprint" },
  { id: "memory-palace", kind: "memory", icon: "\ud83c\udff0", title: "Memory Palace", blurb: "A funny picture on every square",
    detail: "The memory-champion trick: each of the 64 squares gets a silly, unforgettable scene (a1 = Ant on the Sun, h8 = Hedgehog that Ate too much). Pick from 11 picture sets \u2014 Easy, Animals, Mythology, Space, Ocean, Jungle, Fairy Tales, Superheroes, Cartoons, Vehicles, Food. Explore the board, then quiz yourself both ways.", mateIn: "11 sets \u00b7 no timer" },
  { id: "opening-memory", kind: "memory", icon: "\u265f\ufe0f", title: "Opening Memory", blurb: "Memorize an opening as a story",
    detail: "Learn an opening the memory-champion way: every move becomes a hero visiting a square\u2019s funny picture (its anchor). Step through the Italian, Ruy Lopez, Scotch or Queen\u2019s Gambit \u2014 or send a line over from the Opening explorer \u2014 in any of the 11 picture sets.", mateIn: "anchors \u00b7 step-through" },
  { id: "openings", kind: "memory", icon: "\ud83d\udcda", title: "Memory Master 500", blurb: "Browse the 500 most-played openings",
    detail: "The whole corpus in one place: 500 openings sourced from Lichess ECO (CC0) + Wikibooks Chess Opening Theory (CC-BY-SA), ranked by master-game frequency. Filter by tag (aggressive / positional / theory-heavy \u2026) or family (Sicilian, Ruy Lopez, King\u2019s Indian \u2026). Tap any opening to read its idea, plans, story, and 15-move mainline \u2014 then hand off to the Opening Memory trainer to memorise it.", mateIn: "500 openings \u00b7 filter \u00b7 learn" },
  { id: "repertoire", kind: "memory", icon: "\ud83c\udfaf", title: "Build my repertoire", blurb: "10 questions \u2192 your 30-40 openings",
    detail: "Answer 10 questions about your rating, time, style, and defence preferences \u2014 and the wizard picks your personalised opening repertoire from the 500. Kept in your browser only; redo whenever your style changes. When the FSRS card engine ships, your repertoire's openings get prioritised in the daily study queue.", mateIn: "10 questions \u00b7 personalised" },
  { id: "queen-mate", kind: "mate", pieces: ["Q"], icon: "♛", title: "Queen Mate", blurb: "King + Queen vs King",
    detail: "The first checkmate to master. Box the lone king to an edge with the queen, bring your king up, and mate — without stalemating.", mateIn: "Mate in ≤ 10" },
  { id: "rook-mate", kind: "mate", pieces: ["R"], icon: "♜", title: "Rook Mate", blurb: "King + Rook vs King",
    detail: "The classic box / ladder mate. Cut the king off with the rook, oppose with your king, and drive it to the edge.", mateIn: "Mate in ≤ 16" },
  { id: "two-rook-mate", kind: "mate", pieces: ["R", "R"], icon: "♜♜", title: "Double Rook Mate", blurb: "King + 2 Rooks vs King",
    detail: "The easiest mate of all — the two-rook 'lawnmower'. Roll the rooks rank by rank to push the king off the board. Your king isn't even needed.", mateIn: "Mate in ≤ 7" },
  { id: "two-bishop-mate", kind: "mate", pieces: ["B", "B"], icon: "♝♝", title: "Two-Bishop Mate", blurb: "King + 2 Bishops vs King",
    detail: "Two bishops on opposite colours mate the lone king in a corner. Coordinate the bishops to build a wall and use your king to herd it.", mateIn: "Mate in ≤ 19" },
  { id: "bishop-knight-mate", kind: "mate", pieces: ["B", "N"], icon: "♝♞", title: "Bishop + Knight Mate", blurb: "King + Bishop + Knight vs King",
    detail: "The hardest basic mate. You must drive the king to a corner of the BISHOP's colour. Needs precise king+piece coordination (the 'W' manoeuvre).", mateIn: "Mate in ≤ 33 · hardest" },
  { id: "pawn-endgames", kind: "pawnEnd", icon: "♟", title: "Pawn Endgames · Rated", blurb: "Real pawn endings at your level",
    detail: "The rated follow-up to the Promote One Pawn course: real pawn endgames from Dvoretsky's Endgame Manual and the Lichess puzzle base, matched to your rating. You play White against full-strength Stockfish — promote a pawn and checkmate, or hold the theoretical draw. Ratings run 600 to 2800+, so even experienced players will find trouble.", mateIn: "Rated · win or hold" },
  { id: "stop-the-pawn", kind: "stopPawn", pieces: ["Q"], icon: "♛♟", title: "Queen vs Pawns", blurb: "King + Queen vs King + Pawns (pick 1–4)",
    detail: "Your opponent has passed pawns racing to promote. Pick how many pawns (1, 2, 3 or 4), capture or blockade them with the queen, then checkmate. If a pawn promotes you can still try to win the new queen — only a real draw or getting mated ends it.", mateIn: "1–4 pawns" },
  { id: "rook-stop-pawn", kind: "stopPawn", pieces: ["R"], icon: "♜♟", title: "Rook vs Pawns", blurb: "King + Rook vs King + Pawns (pick 1–4)",
    detail: "Trickier than with a queen — your rook must catch the runners. Pick 1–4 pawns, get behind or in front of each, win them, then mate. If a pawn promotes you can still try to win it.", mateIn: "1–4 pawns" },
];

export const studyById = (id: string | undefined) => STUDIES.find((s) => s.id === id);
