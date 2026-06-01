export type StudyKind = "mate" | "stopPawn";
export interface StudyDef {
  id: string;
  kind: StudyKind;
  pieces: string[];   // white attacking pieces (besides the king). stopPawn uses pieces[0].
  icon: string;
  title: string;
  blurb: string;
  detail: string;
  mateIn: string;
}

export const STUDIES: StudyDef[] = [
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
  { id: "stop-the-pawn", kind: "stopPawn", pieces: ["Q"], icon: "♛♟", title: "Queen vs Pawn", blurb: "King + Queen vs King + Pawn",
    detail: "Your opponent has a passed pawn racing to promote. Capture or blockade it with the queen, then checkmate. Let it promote and you start over.", mateIn: "Stop & mate" },
  { id: "rook-stop-pawn", kind: "stopPawn", pieces: ["R"], icon: "♜♟", title: "Rook vs Pawn", blurb: "King + Rook vs King + Pawn",
    detail: "Trickier than with a queen — your rook must catch the runner. Get behind or in front of the pawn, win it, then mate. Promotion = restart.", mateIn: "Stop & mate" },
];

export const studyById = (id: string | undefined) => STUDIES.find((s) => s.id === id);
