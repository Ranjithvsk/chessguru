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
  // GM "Master Games" puzzles (source:"broadcast") only:
  source?: string;
  whiteName?: string;
  blackName?: string;
  whiteElo?: number;
  blackElo?: number;
  winnerName?: string;
  loserName?: string;
  winnerElo?: number;
  loserElo?: number;
  pov?: "white" | "black";
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
  /** Phase 7n: set when this solve crossed a round-number rating threshold. */
  milestone?: { milestone: number; firstTime: boolean } | null;
}

export interface AuthMe {
  loggedIn: boolean;
  userId?: string;
  username?: string;
  admin?: boolean;
  // Multi-tenant SaaS additions — set for members of any academy.
  academyId?: string | null;   // academy slug (e.g. "stephens-chess-academy")
  role?: "academy_owner" | "coach" | "student" | "parent" | null;
}
