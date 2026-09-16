// Generated — do not hand-edit. Rebuilt by scripts/grade_data.py.
//
// What each side should play in every position of the triangulation chapter,
// worked out with Stockfish. A position is analysed twice, once for each side to
// move, because the lesson asks the student for both.
//
//   bestUci / bestSan  the engine's move
//   result             what that move achieves: win, draw or loss
//   okUci              every other move that reaches the SAME result — the
//                      student has not thrown the position away, they just have
//                      not found the point, so these earn partial credit
//
// Anything outside those two sets changes the result and scores nothing.

export interface SideAnswer {
  bestUci: string;
  bestSan: string;
  result: "win" | "draw" | "loss";
  okUci: string[];
  legalCount: number;
}

export interface PositionAnswers {
  white: SideAnswer | null;
  black: SideAnswer | null;
}

export const TRIANGULATION_ANSWERS: Record<string, PositionAnswers> = {
  "dv-01": {
    white: { bestUci: "d5c4", bestSan: "Kc4", result: "win", okUci: ["d5e5", "d5e4", "d5d4"], legalCount: 5 },
    black: { bestUci: "d7e8", bestSan: "Ke8", result: "loss", okUci: ["d7d8", "d7c8", "d7e7"], legalCount: 4 },
  },
  "dv-02": {
    white: { bestUci: "e5d4", bestSan: "Kd4", result: "win", okUci: [], legalCount: 6 },
    black: { bestUci: "c6c5", bestSan: "Kxc5", result: "win", okUci: [], legalCount: 3 },
  },
  "dv-03": {
    white: { bestUci: "d4d5", bestSan: "Kd5", result: "win", okUci: ["d4e5", "d4e4", "d4c4", "d4e3", "d4d3", "d4c3"], legalCount: 8 },
    black: { bestUci: "d7e6", bestSan: "Ke6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c6"], legalCount: 6 },
  },
  "dv-04": {
    white: { bestUci: "d5d6", bestSan: "Kd6", result: "draw", okUci: ["d5e6", "d5e5", "d5c5", "d5e4", "d5d4", "d5c4", "c6b7", "c6c7"], legalCount: 9 },
    black: { bestUci: "c8b8", bestSan: "Kb8", result: "draw", okUci: [], legalCount: 3 },
  },
  "dv-05": {
    white: { bestUci: "d5d6", bestSan: "Kd6", result: "win", okUci: ["d5e6", "d5e5", "d5e4", "d5d4", "d5c4"], legalCount: 7 },
    black: { bestUci: "c8d7", bestSan: "Kd7", result: "loss", okUci: ["c8d8", "c8b8"], legalCount: 3 },
  },
  "fa-01": {
    white: { bestUci: "d5d4", bestSan: "Kd4", result: "win", okUci: ["d5e6", "d5d6", "d5e5", "d5c5", "d5e4", "d5c4"], legalCount: 8 },
    black: { bestUci: "c8c7", bestSan: "Kc7", result: "loss", okUci: ["c8d8", "c8b8"], legalCount: 3 },
  },
  "sei-01": {
    white: { bestUci: "c5d5", bestSan: "Kd5", result: "win", okUci: [], legalCount: 4 },
    black: { bestUci: "c7c8", bestSan: "Kc8", result: "loss", okUci: ["c7d8", "c7b8"], legalCount: 3 },
  },
  "pz-01": {
    white: { bestUci: "e3e4", bestSan: "Ke4", result: "loss", okUci: ["e3d4", "e3f3", "e3f2", "e3e2", "e3d2", "d5d6"], legalCount: 7 },
    black: { bestUci: "g5f5", bestSan: "Kf5", result: "win", okUci: [], legalCount: 6 },
  },
  "neu-01": {
    white: { bestUci: "e4f4", bestSan: "Kf4", result: "win", okUci: ["e4d4", "e4f3", "e4d3"], legalCount: 7 },
    black: { bestUci: "d6c7", bestSan: "Kc7", result: "loss", okUci: ["d6e7", "d6d7", "d6c6", "d6c5", "h6h5"], legalCount: 6 },
  },
  "neu-02": {
    white: { bestUci: "f4e3", bestSan: "Ke3", result: "win", okUci: ["f4e4", "f4g3", "f4f3"], legalCount: 6 },
    black: { bestUci: "h6h5", bestSan: "h5", result: "loss", okUci: ["e7f8", "e7e8", "e7d8", "e7f7", "e7d7", "e7d6"], legalCount: 7 },
  },
  "neu-03": {
    white: { bestUci: "f3e3", bestSan: "Ke3", result: "win", okUci: ["f3f4", "f3e4", "f3g3", "f3g2", "f3f2", "f3e2"], legalCount: 9 },
    black: { bestUci: "d7d6", bestSan: "Kd6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7c6", "h6h5"], legalCount: 8 },
  },
  "neu-04": {
    white: { bestUci: "e3e4", bestSan: "Ke4", result: "win", okUci: ["e3f4", "e3d4", "e3f3", "e3d3", "e3f2", "e3e2", "e3d2"], legalCount: 10 },
    black: { bestUci: "d6e5", bestSan: "Ke5", result: "draw", okUci: [], legalCount: 8 },
  },
  "neu-05": {
    white: { bestUci: "e4f4", bestSan: "Kf4", result: "win", okUci: ["e4d4", "e4f3", "e4d3"], legalCount: 7 },
    black: { bestUci: "d6c6", bestSan: "Kc6", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c5", "h6h5"], legalCount: 6 },
  },
  "neu-06": {
    white: { bestUci: "g4g5", bestSan: "g5", result: "win", okUci: ["f4e4", "f4f3"], legalCount: 6 },
    black: { bestUci: "d6e7", bestSan: "Ke7", result: "loss", okUci: ["d6d7", "d6c7", "d6c6", "d6d5", "d6c5", "h6h5"], legalCount: 7 },
  },
};

/** Full marks for the engine move, partial for one that keeps the result. */
export function gradeMove(ans: SideAnswer | null, uci: string | null): "best" | "sound" | "wrong" | "none" {
  if (!ans) return "none";
  if (!uci) return "none";
  if (uci === ans.bestUci) return "best";
  if (ans.okUci.includes(uci)) return "sound";
  return "wrong";
}

export const MARKS: Record<string, number> = { best: 5, sound: 3, wrong: 0, none: 0 };
