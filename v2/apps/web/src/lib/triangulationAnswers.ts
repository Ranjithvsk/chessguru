// Generated — do not hand-edit. Rebuilt by v2/scripts/grade_data.py.
//
// The answer key for the triangulation chapter. Students answer on the board,
// so the key covers a LINE rather than a single move:
//
//   mover    what the side to move should play — the engine's move, plus every
//            other move reaching the same result (those earn partial credit)
//   replies  keyed by the mover's move: what the opponent's best answer is to
//            THAT move, and which answers hold the same result
//
// Mapping a reply for every legal first move is what lets the second ply be
// marked fairly. A student who plays a second-best first move is judged on the
// defence to their move, not on the defence to the engine's.

export interface MoveKey {
  bestUci: string;
  bestSan: string;
  result: "win" | "draw" | "loss";
  okUci: string[];
}

export interface PositionAnswers {
  turn: "white" | "black";
  mover: MoveKey;
  replies: Record<string, MoveKey>;
}

export const TRIANGULATION_ANSWERS: Record<string, PositionAnswers> = {
  "dv-01": {
    turn: "white",
    mover: { bestUci: "d5e5", bestSan: "Ke5", result: "win", okUci: ["d5e4", "d5d4", "d5c4"] },
    replies: {
      "d5e5": { bestUci: "d7c6", bestSan: "Kc6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7"] },
      "d5e4": { bestUci: "d7c6", bestSan: "Kc6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7e6"] },
      "d5d4": { bestUci: "d7e6", bestSan: "Ke6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c6"] },
      "d5c4": { bestUci: "d7e6", bestSan: "Ke6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c6"] },
      "c5c6": { bestUci: "d7c8", bestSan: "Kc8", result: "draw", okUci: [] },
    },
  },
  "dv-02": {
    turn: "white",
    mover: { bestUci: "e5d4", bestSan: "Kd4", result: "win", okUci: [] },
    replies: {
      "e5f6": { bestUci: "c6c5", bestSan: "Kxc5", result: "win", okUci: ["c6d5", "c6b5"] },
      "e5e6": { bestUci: "c6c5", bestSan: "Kxc5", result: "win", okUci: [] },
      "e5f5": { bestUci: "c6c5", bestSan: "Kxc5", result: "win", okUci: ["c6d5", "c6b5"] },
      "e5f4": { bestUci: "c6c5", bestSan: "Kxc5", result: "win", okUci: ["c6d5", "c6b5"] },
      "e5e4": { bestUci: "c6c5", bestSan: "Kxc5", result: "win", okUci: [] },
      "e5d4": { bestUci: "c6b5", bestSan: "Kb5", result: "loss", okUci: ["c6d7"] },
    },
  },
  "dv-03": {
    turn: "white",
    mover: { bestUci: "d4d5", bestSan: "Kd5", result: "win", okUci: ["d4e5", "d4e4", "d4c4", "d4e3", "d4d3", "d4c3"] },
    replies: {
      "d4e5": { bestUci: "d7c6", bestSan: "Kc6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7"] },
      "d4d5": { bestUci: "d7e8", bestSan: "Ke8", result: "loss", okUci: ["d7d8", "d7c8", "d7e7"] },
      "d4e4": { bestUci: "d7e6", bestSan: "Ke6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c6"] },
      "d4c4": { bestUci: "d7d8", bestSan: "Kd8", result: "loss", okUci: ["d7e8", "d7c8", "d7e7", "d7e6", "d7c6"] },
      "d4e3": { bestUci: "d7e7", bestSan: "Ke7", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e6", "d7c6"] },
      "d4d3": { bestUci: "d7d8", bestSan: "Kd8", result: "loss", okUci: ["d7e8", "d7c8", "d7e7", "d7e6", "d7c6"] },
      "d4c3": { bestUci: "d7e7", bestSan: "Ke7", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e6", "d7c6"] },
      "c5c6": { bestUci: "d7c6", bestSan: "Kxc6", result: "draw", okUci: ["d7c8"] },
    },
  },
  "dv-04": {
    turn: "white",
    mover: { bestUci: "d5d6", bestSan: "Kd6", result: "draw", okUci: ["d5e6", "d5e5", "d5c5", "d5e4", "d5d4", "d5c4", "c6b7", "c6c7"] },
    replies: {
      "d5e6": { bestUci: "b7c6", bestSan: "bxc6", result: "draw", okUci: ["c8b8"] },
      "d5d6": { bestUci: "c8b8", bestSan: "Kb8", result: "draw", okUci: [] },
      "d5e5": { bestUci: "b7c6", bestSan: "bxc6", result: "draw", okUci: ["c8b8"] },
      "d5c5": { bestUci: "c8b8", bestSan: "Kb8", result: "draw", okUci: [] },
      "d5e4": { bestUci: "b7c6", bestSan: "bxc6", result: "draw", okUci: ["c8b8"] },
      "d5d4": { bestUci: "b7c6", bestSan: "bxc6", result: "draw", okUci: ["c8b8"] },
      "d5c4": { bestUci: "b7c6", bestSan: "bxc6", result: "draw", okUci: ["c8b8"] },
      "c6b7": { bestUci: "c8b7", bestSan: "Kxb7", result: "draw", okUci: ["c8b8"] },
      "c6c7": { bestUci: "c8d7", bestSan: "Kd7", result: "draw", okUci: [] },
    },
  },
  "dv-05": {
    turn: "white",
    mover: { bestUci: "d5d6", bestSan: "Kd6", result: "win", okUci: ["d5e6", "d5e5", "d5e4", "d5d4", "d5c4"] },
    replies: {
      "d5e6": { bestUci: "c8d8", bestSan: "Kd8", result: "loss", okUci: ["c8b8"] },
      "d5d6": { bestUci: "c8d8", bestSan: "Kd8", result: "loss", okUci: ["c8b8"] },
      "d5e5": { bestUci: "c8d7", bestSan: "Kd7", result: "loss", okUci: ["c8d8", "c8b8"] },
      "d5e4": { bestUci: "c8d8", bestSan: "Kd8", result: "loss", okUci: ["c8b8", "c8d7"] },
      "d5d4": { bestUci: "c8d7", bestSan: "Kd7", result: "loss", okUci: ["c8d8", "c8b8"] },
      "d5c4": { bestUci: "c8d8", bestSan: "Kd8", result: "loss", okUci: ["c8b8", "c8d7"] },
      "c5c6": { bestUci: "c8b8", bestSan: "Kb8", result: "draw", okUci: [] },
    },
  },
  "fa-01": {
    turn: "white",
    mover: { bestUci: "d5c4", bestSan: "Kc4", result: "win", okUci: ["d5e6", "d5d6", "d5e5", "d5c5", "d5e4", "d5d4"] },
    replies: {
      "d5e6": { bestUci: "c8c7", bestSan: "Kc7", result: "loss", okUci: ["c8d8", "c8b8"] },
      "d5d6": { bestUci: "c8d8", bestSan: "Kd8", result: "loss", okUci: ["c8b8"] },
      "d5e5": { bestUci: "c8c7", bestSan: "Kc7", result: "loss", okUci: ["c8d8", "c8b8"] },
      "d5c5": { bestUci: "c8c7", bestSan: "Kc7", result: "loss", okUci: ["c8d8", "c8b8"] },
      "d5e4": { bestUci: "c8c7", bestSan: "Kc7", result: "loss", okUci: ["c8d8", "c8b8"] },
      "d5d4": { bestUci: "c8d8", bestSan: "Kd8", result: "loss", okUci: ["c8b8", "c8c7"] },
      "d5c4": { bestUci: "c8d8", bestSan: "Kd8", result: "loss", okUci: ["c8b8", "c8c7"] },
      "c6c7": { bestUci: "c8c7", bestSan: "Kxc7", result: "draw", okUci: ["c8d7", "c8b7"] },
    },
  },
  "sei-01": {
    turn: "white",
    mover: { bestUci: "c5d5", bestSan: "Kd5", result: "win", okUci: [] },
    replies: {
      "c5d5": { bestUci: "c7c8", bestSan: "Kc8", result: "loss", okUci: ["c7d8", "c7b8"] },
      "c5d4": { bestUci: "c7c6", bestSan: "Kxc6", result: "draw", okUci: ["c7d6"] },
      "c5c4": { bestUci: "c7c6", bestSan: "Kxc6", result: "draw", okUci: ["c7d6"] },
      "c5b4": { bestUci: "c7c6", bestSan: "Kxc6", result: "draw", okUci: ["c7d6"] },
    },
  },
  "pz-01": {
    turn: "black",
    mover: { bestUci: "g5f5", bestSan: "Kf5", result: "win", okUci: [] },
    replies: {
      "g5h6": { bestUci: "d5d6", bestSan: "d6", result: "win", okUci: [] },
      "g5g6": { bestUci: "e3f4", bestSan: "Kf4", result: "draw", okUci: [] },
      "g5f6": { bestUci: "e3e4", bestSan: "Ke4", result: "draw", okUci: [] },
      "g5h5": { bestUci: "d5d6", bestSan: "d6", result: "win", okUci: [] },
      "g5f5": { bestUci: "e3d4", bestSan: "Kd4", result: "loss", okUci: ["e3f3", "e3f2", "e3e2", "e3d2", "d5d6"] },
      "c4c3": { bestUci: "e3d3", bestSan: "Kd3", result: "win", okUci: ["d5d6"] },
    },
  },
  "neu-01": {
    turn: "white",
    mover: { bestUci: "e4d4", bestSan: "Kd4", result: "win", okUci: ["e4f4", "e4f3", "e4d3"] },
    replies: {
      "e4f4": { bestUci: "d6e7", bestSan: "Ke7", result: "loss", okUci: ["d6d7", "d6c7", "d6c6", "d6d5", "d6c5", "h6h5"] },
      "e4d4": { bestUci: "d6c6", bestSan: "Kc6", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "h6h5"] },
      "e4f3": { bestUci: "d6e5", bestSan: "Ke5", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6d5", "d6c5", "h6h5"] },
      "e4e3": { bestUci: "d6e5", bestSan: "Ke5", result: "draw", okUci: [] },
      "e4d3": { bestUci: "d6d5", bestSan: "Kd5", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6e5", "d6c5", "h6h5"] },
      "h4h5": { bestUci: "d6c6", bestSan: "Kc6", result: "draw", okUci: ["d6e7", "d6c7"] },
      "g4g5": { bestUci: "h6g5", bestSan: "hxg5", result: "draw", okUci: ["f6g5"] },
    },
  },
  "neu-02": {
    turn: "white",
    mover: { bestUci: "f4e4", bestSan: "Ke4", result: "win", okUci: ["f4g3", "f4f3", "f4e3"] },
    replies: {
      "f4e4": { bestUci: "e7d6", bestSan: "Kd6", result: "loss", okUci: ["e7f8", "e7e8", "e7d8", "e7f7", "e7d7", "h6h5"] },
      "f4g3": { bestUci: "e7f7", bestSan: "Kf7", result: "loss", okUci: ["e7f8", "e7e8", "e7d8", "e7d7", "e7d6", "h6h5"] },
      "f4f3": { bestUci: "h6h5", bestSan: "h5", result: "loss", okUci: ["e7f8", "e7e8", "e7d8", "e7f7", "e7d7", "e7d6"] },
      "f4e3": { bestUci: "e7d7", bestSan: "Kd7", result: "loss", okUci: ["e7f8", "e7e8", "e7d8", "e7f7", "e7d6", "h6h5"] },
      "h4h5": { bestUci: "e7d6", bestSan: "Kd6", result: "draw", okUci: ["e7f8", "e7e8", "e7d8", "e7f7", "e7d7"] },
      "g4g5": { bestUci: "f6g5", bestSan: "fxg5+", result: "draw", okUci: ["h6g5"] },
    },
  },
  "neu-03": {
    turn: "white",
    mover: { bestUci: "f3e3", bestSan: "Ke3", result: "win", okUci: ["f3f4", "f3e4", "f3g3", "f3g2", "f3f2", "f3e2"] },
    replies: {
      "f3f4": { bestUci: "d7d6", bestSan: "Kd6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7c6", "h6h5"] },
      "f3e4": { bestUci: "d7d6", bestSan: "Kd6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7c6", "h6h5"] },
      "f3g3": { bestUci: "d7d6", bestSan: "Kd6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7c6", "h6h5"] },
      "f3e3": { bestUci: "d7d6", bestSan: "Kd6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7c6", "h6h5"] },
      "f3g2": { bestUci: "d7c6", bestSan: "Kc6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7d6", "h6h5"] },
      "f3f2": { bestUci: "h6h5", bestSan: "h5", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7d6", "d7c6"] },
      "f3e2": { bestUci: "d7d6", bestSan: "Kd6", result: "loss", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7c6", "h6h5"] },
      "h4h5": { bestUci: "d7d6", bestSan: "Kd6", result: "draw", okUci: ["d7e8", "d7d8", "d7c8", "d7e7", "d7c7", "d7c6"] },
      "g4g5": { bestUci: "h6g5", bestSan: "hxg5", result: "draw", okUci: ["f6g5"] },
    },
  },
  "neu-04": {
    turn: "white",
    mover: { bestUci: "e3e4", bestSan: "Ke4", result: "win", okUci: ["e3f4", "e3d4", "e3f3", "e3d3", "e3f2", "e3e2", "e3d2"] },
    replies: {
      "e3f4": { bestUci: "d6e7", bestSan: "Ke7", result: "loss", okUci: ["d6d7", "d6c7", "d6c6", "d6d5", "d6c5", "h6h5"] },
      "e3e4": { bestUci: "d6c6", bestSan: "Kc6", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c5", "h6h5"] },
      "e3d4": { bestUci: "d6c6", bestSan: "Kc6", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "h6h5"] },
      "e3f3": { bestUci: "d6c7", bestSan: "Kc7", result: "loss", okUci: ["d6e7", "d6d7", "d6c6", "d6e5", "d6d5", "d6c5", "h6h5"] },
      "e3d3": { bestUci: "d6d5", bestSan: "Kd5", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6e5", "d6c5", "h6h5"] },
      "e3f2": { bestUci: "h6h5", bestSan: "h5", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6e5", "d6d5", "d6c5"] },
      "e3e2": { bestUci: "d6d5", bestSan: "Kd5", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6e5", "d6c5", "h6h5"] },
      "e3d2": { bestUci: "d6d5", bestSan: "Kd5", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6e5", "d6c5", "h6h5"] },
      "h4h5": { bestUci: "d6e5", bestSan: "Ke5", result: "draw", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6d5", "d6c5"] },
      "g4g5": { bestUci: "f6g5", bestSan: "fxg5", result: "draw", okUci: ["h6g5"] },
    },
  },
  "neu-05": {
    turn: "black",
    mover: { bestUci: "d6c6", bestSan: "Kc6", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c5", "h6h5"] },
    replies: {
      "d6e7": { bestUci: "e4d5", bestSan: "Kd5", result: "win", okUci: ["e4f4", "e4d4", "e4f3", "e4e3", "e4d3"] },
      "d6d7": { bestUci: "e4d5", bestSan: "Kd5", result: "win", okUci: ["e4f4", "e4d4", "e4f3", "e4e3", "e4d3"] },
      "d6c7": { bestUci: "e4f4", bestSan: "Kf4", result: "win", okUci: ["e4d5", "e4d4", "e4f3", "e4e3", "e4d3"] },
      "d6c6": { bestUci: "e4f4", bestSan: "Kf4", result: "win", okUci: ["e4d4", "e4f3", "e4e3", "e4d3"] },
      "d6c5": { bestUci: "e4e3", bestSan: "Ke3", result: "win", okUci: ["e4f4", "e4f3", "e4d3", "g4g5"] },
      "h6h5": { bestUci: "g4h5", bestSan: "gxh5", result: "win", okUci: ["e4f4", "e4e3", "g4g5"] },
    },
  },
  "neu-06": {
    turn: "white",
    mover: { bestUci: "f4e4", bestSan: "Ke4", result: "win", okUci: ["f4f3", "g4g5"] },
    replies: {
      "f4e4": { bestUci: "d6c6", bestSan: "Kc6", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c5", "h6h5"] },
      "f4g3": { bestUci: "d6e5", bestSan: "Ke5", result: "draw", okUci: [] },
      "f4f3": { bestUci: "d6e5", bestSan: "Ke5", result: "loss", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6d5", "d6c5", "h6h5"] },
      "f4e3": { bestUci: "d6e5", bestSan: "Ke5", result: "draw", okUci: [] },
      "h4h5": { bestUci: "d6d5", bestSan: "Kd5", result: "draw", okUci: ["d6e7", "d6d7", "d6c7", "d6c6", "d6c5"] },
      "g4g5": { bestUci: "d6e7", bestSan: "Ke7", result: "loss", okUci: ["d6d7", "d6c7", "d6c6", "d6d5", "d6c5", "h6g5", "f6g5", "h6h5"] },
    },
  },
};

/** Full marks for the key move, partial for one that reaches the same result. */
export function markMove(key: MoveKey | undefined, uci: string | null): "best" | "sound" | "wrong" | "none" {
  if (!key || !uci) return "none";
  if (uci === key.bestUci) return "best";
  if (key.okUci.includes(uci)) return "sound";
  return "wrong";
}

export const MARKS: Record<string, number> = { best: 5, sound: 3, wrong: 0, none: 0 };
