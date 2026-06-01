export type StudyPiece = "Q" | "R";
export type StudyKind = "mate" | "stopPawn";
export interface StudyDef {
  id: string;
  kind: StudyKind;
  piece?: StudyPiece;   // for kind "mate"
  icon: string;
  title: string;
  blurb: string;
  detail: string;
  mateIn: string;
}

export const STUDIES: StudyDef[] = [
  {
    id: "queen-mate", kind: "mate", piece: "Q", icon: "♛", title: "Queen Mate", blurb: "King + Queen vs King",
    detail: "The first checkmate every player should master. Box the lone king toward an edge with your queen, bring your king up for support, and deliver mate — without falling for stalemate.",
    mateIn: "Mate in ≤ 10",
  },
  {
    id: "rook-mate", kind: "mate", piece: "R", icon: "♜", title: "Rook Mate", blurb: "King + Rook vs King",
    detail: "The classic 'box' / ladder mate. Use the rook to cut the king off a rank or file, oppose with your own king, and drive it back to the edge.",
    mateIn: "Mate in ≤ 16",
  },
  {
    id: "stop-the-pawn", kind: "stopPawn", icon: "♟", title: "Stop the Pawn", blurb: "King + Queen vs King + Pawn",
    detail: "Your opponent has a passed pawn racing to promote. Capture or blockade it with your queen, then checkmate the lone king. Let it promote and you'll have to start over!",
    mateIn: "Stop & mate",
  },
];

export const studyById = (id: string | undefined) => STUDIES.find((s) => s.id === id);
