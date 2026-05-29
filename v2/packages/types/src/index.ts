// Shared FE↔BE types for ChessGuru v2.

export interface Glicko {
  r: number; // rating
  d: number; // deviation
  v: number; // volatility
}

/** A puzzle as delivered to the client (first solution move already applied as `lastMove`). */
export interface Puzzle {
  id: string;
  fen: string;
  /** remaining solution moves in UCI (the opponent's setup move is `lastMove`) */
  solution: string[];
  rating: number;
  ratingDeviation?: number;
  plays?: number;
  themes?: string[];
  glicko?: Glicko;
  lastMove?: string; // opponent setup move (UCI), already reflected in `fen`
  preFen?: string;   // position before `lastMove`
}

export type Difficulty = "easiest" | "easier" | "normal" | "harder" | "hardest";

export interface MeRating {
  rating: number;
  loggedIn: boolean;
  userId?: string;
}

export interface CompleteResult {
  win: boolean;
  ratingDiff?: number;
  rating?: number;
  glicko?: Glicko;
}

export interface AuthMe {
  loggedIn: boolean;
  userId?: string;
  username?: string;
}
