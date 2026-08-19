// Achievement catalog — one-time unlocks tied to REAL chess skill milestones.
//
// Design principle: every badge marks a milestone that transfers to
// over-the-board play. A "Fork Specialist" badge means the student has
// actually seen 50 fork puzzles at ≥70% accuracy, so they can spot forks
// in their own games. This is not vanity gamification — the training that
// unlocks each badge IS the improvement.
//
// Progress is computed lazily from raw data (users.dailyPuzzleStreak,
// userperfs, rounds). Unlocks are persisted in `academyBadges` so the
// award moment is atomic and can be surfaced to the coach.

export type AchievementKind =
  | "count-rounds"       // solve N rounds total
  | "count-blindfold"    // solve N blindfold rounds
  | "peak-rating"        // reach rating >= N (from users.puzzleRating history or userperfs)
  | "current-rating"     // current rating >= N
  | "theme-mastery"      // >=N solves in a theme with >=accuracy%
  | "current-streak"     // dailyPuzzleStreak.current >= N (or longest)
  | "longest-streak"     // dailyPuzzleStreak.longest >= N
  | "speed-week"         // >=N solves under M ms each in the last 7d
  | "accuracy-week"      // >=N solves at >=A% accuracy in the last 7d
  | "theme-variety"      // solved in >=N distinct themes lifetime
  ;

export interface Achievement {
  id: string;
  category: "puzzles" | "rating" | "theme" | "streak" | "blindfold" | "special";
  tier: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  emoji: string;
  name: string;
  /** Coach/student-facing prose that explains the CHESS-SKILL benefit — why
   *  earning this badge actually makes them better. */
  chessBenefit: string;
  kind: AchievementKind;
  /** kind-specific parameters — normalised in the evaluator. */
  n?: number;
  ms?: number;
  accuracy?: number;
  theme?: string;
}

/** All the achievements. Keep this list authoritative — new entries are
 *  auto-picked up by the evaluator + gallery. Order = display order. */
export const ACHIEVEMENTS: Achievement[] = [
  // ── Puzzle milestones ────────────────────────────────────────────────
  { id: "p-1",    category: "puzzles", tier: "bronze",   emoji: "🎯",  name: "First blood",         chessBenefit: "You solved your first tactic. The pattern-recognition muscle is turned on.", kind: "count-rounds", n: 1 },
  { id: "p-100",  category: "puzzles", tier: "silver",   emoji: "🧩",  name: "Century Solver",      chessBenefit: "100 tactics down. Simple pins, forks, and back-rank mates are now instinct.", kind: "count-rounds", n: 100 },
  { id: "p-500",  category: "puzzles", tier: "gold",     emoji: "💯",  name: "Puzzle Journeyman",   chessBenefit: "500 puzzles builds a tactical vocabulary — you spot double attacks and skewers without thinking.", kind: "count-rounds", n: 500 },
  { id: "p-1000", category: "puzzles", tier: "platinum", emoji: "🏆",  name: "Puzzle Master",       chessBenefit: "1000 puzzles = tournament-strength calculation. You see combinations 2–3 moves ahead automatically.", kind: "count-rounds", n: 1000 },
  { id: "p-5000", category: "puzzles", tier: "diamond",  emoji: "👑",  name: "Puzzle Grandmaster",  chessBenefit: "5000 puzzles rewires how you look at a position — every move you play is filtered through tactics-first pattern matching.", kind: "count-rounds", n: 5000 },

  // ── Rating milestones (current puzzle rating) ────────────────────────
  { id: "r-1200", category: "rating", tier: "bronze",   emoji: "⭐",  name: "Rising Star",     chessBenefit: "1200 rating = you consistently spot 1-move tactics. Basic checkmates and safe piece captures are automatic.", kind: "current-rating", n: 1200 },
  { id: "r-1500", category: "rating", tier: "silver",   emoji: "🌟",  name: "Solid Player",    chessBenefit: "1500 rating = you calculate 2-move combos reliably. Enough to win most club-level tactical skirmishes.", kind: "current-rating", n: 1500 },
  { id: "r-1800", category: "rating", tier: "gold",     emoji: "✨",  name: "Strong Tactician",chessBenefit: "1800 rating = you see multi-move combinations, sacrifices, and quiet moves. Tournament-strong tactical vision.", kind: "current-rating", n: 1800 },
  { id: "r-2000", category: "rating", tier: "platinum", emoji: "💎",  name: "Expert Solver",   chessBenefit: "2000 rating = expert-level pattern bank. You calculate deep forcing lines and evaluate quiet positions.", kind: "current-rating", n: 2000 },
  { id: "r-2200", category: "rating", tier: "diamond",  emoji: "🔱",  name: "Master Solver",   chessBenefit: "2200 rating = candidate-master calculation depth. You match master-level tactical accuracy on the puzzle rack.", kind: "current-rating", n: 2200 },

  // ── Theme mastery — the CHESS-SKILL badges ───────────────────────────
  // 50 solves at ≥70% accuracy is the "internalised" threshold — that
  // pattern will fire during a real game without conscious calculation.
  { id: "t-fork",       category: "theme", tier: "gold", emoji: "🍴",  name: "Fork Specialist",     chessBenefit: "50 fork puzzles at 70%+ — you spot double attacks on kings, queens and rooks in your own games. Fork tactics win games.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "fork" },
  { id: "t-pin",        category: "theme", tier: "gold", emoji: "📌",  name: "Pin Master",          chessBenefit: "50 pin puzzles at 70%+ — you'll pile up on absolute pins and win pieces you'd otherwise miss.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "pin" },
  { id: "t-skewer",     category: "theme", tier: "gold", emoji: "🍢",  name: "Skewer Sniper",       chessBenefit: "50 skewer puzzles at 70%+ — long-range piece motifs become instinct; you'll pick up exchanges opponents don't see coming.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "skewer" },
  { id: "t-sac",        category: "theme", tier: "gold", emoji: "💥",  name: "Sacrifice Wizard",    chessBenefit: "50 sacrifice puzzles at 70%+ — you'll offer material for a winning attack without hesitation. Every player's favourite skill.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "sacrifice" },
  { id: "t-attraction", category: "theme", tier: "gold", emoji: "🧲",  name: "Attraction Artist",   chessBenefit: "50 attraction motifs at 70%+ — luring the king or queen onto a bad square becomes second nature.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "attraction" },
  { id: "t-mate",       category: "theme", tier: "gold", emoji: "☠️",  name: "Mate Hunter",         chessBenefit: "50 mating puzzles at 70%+ — you'll finish attacks with clinical mating nets instead of letting the king escape.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "mate" },
  { id: "t-endgame",    category: "theme", tier: "gold", emoji: "♚",   name: "Endgame Guardian",    chessBenefit: "50 endgame puzzles at 70%+ — you'll convert winning endings (K+P, R+P, opposite bishops) that decide most junior games.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "endgame" },
  { id: "t-defence",    category: "theme", tier: "silver", emoji: "🛡️", name: "Defender's Shield", chessBenefit: "50 defensive puzzles at 65%+ — you'll find only-moves under attack and hold lost-looking games.", kind: "theme-mastery", n: 50, accuracy: 0.65, theme: "defensiveMove" },
  { id: "t-back-rank",  category: "theme", tier: "silver", emoji: "🚪", name: "Back-Rank Hunter",   chessBenefit: "30 back-rank mate puzzles at 70%+ — you'll spot back-rank motifs during your own middlegame planning.", kind: "theme-mastery", n: 30, accuracy: 0.7, theme: "backRankMate" },
  { id: "t-discovered", category: "theme", tier: "gold", emoji: "🎭",  name: "Discovery Expert",    chessBenefit: "50 discovered-attack puzzles at 70%+ — one of the deadliest patterns in the game becomes yours.", kind: "theme-mastery", n: 50, accuracy: 0.7, theme: "discoveredAttack" },

  // ── Consistency — training habit is 80% of improvement ───────────────
  { id: "s-7",   category: "streak", tier: "bronze",   emoji: "🔥",     name: "Week Warrior",   chessBenefit: "7 days in a row of puzzles = the habit is forming. Regular puzzle practice is the strongest single predictor of rating growth.", kind: "longest-streak", n: 7 },
  { id: "s-30",  category: "streak", tier: "silver",   emoji: "🔥🔥",   name: "Month Monster",  chessBenefit: "30-day streak = you've built a real training routine. Rating typically climbs 100+ points at this cadence.", kind: "longest-streak", n: 30 },
  { id: "s-100", category: "streak", tier: "gold",     emoji: "🔥🔥🔥", name: "Century Streak", chessBenefit: "100-day streak = elite discipline. This is the level of consistency behind titled-player training regimens.", kind: "longest-streak", n: 100 },
  { id: "s-365", category: "streak", tier: "diamond",  emoji: "🌋",     name: "Year of Fire",   chessBenefit: "365-day streak = one of the rarest badges. A full year of daily puzzles is a life-changing chess habit.", kind: "longest-streak", n: 365 },

  // ── Blindfold ────────────────────────────────────────────────────────
  { id: "b-1",   category: "blindfold", tier: "bronze",  emoji: "🙈", name: "First Vision",         chessBenefit: "First blindfold puzzle solved. You've started training your board-visualisation muscle — the single most important calculation skill.", kind: "count-blindfold", n: 1 },
  { id: "b-100", category: "blindfold", tier: "silver",  emoji: "👁️", name: "Blindfold Solver",     chessBenefit: "100 blindfold puzzles = you can hold complex positions in your head. Long calculation in real games becomes far easier.", kind: "count-blindfold", n: 100 },
  { id: "b-500", category: "blindfold", tier: "diamond", emoji: "🧠", name: "Blindfold Master",     chessBenefit: "500 blindfold solves = you can visualise 5+ ply ahead reliably. Master-strength calculation.", kind: "count-blindfold", n: 500 },

  // ── Special — hard-to-earn quality signals ───────────────────────────
  { id: "x-speed",    category: "special", tier: "gold",   emoji: "⚡", name: "Speed Demon",   chessBenefit: "20 puzzles under 10s each in a single week — you spot patterns as fast as tournament blitz requires.", kind: "speed-week", n: 20, ms: 10_000 },
  { id: "x-accuracy", category: "special", tier: "gold",   emoji: "🎯", name: "Sharpshooter",  chessBenefit: "90%+ accuracy over 100 puzzles in one week — you're calculating carefully, the exact habit that translates to over-the-board decisions.", kind: "accuracy-week", n: 100, accuracy: 0.9 },
  { id: "x-variety",  category: "special", tier: "silver", emoji: "🎨", name: "Full-Range Trainer", chessBenefit: "Solved puzzles in 15+ distinct themes — broad tactical vocabulary. You won't be surprised by any pattern in real play.", kind: "theme-variety", n: 15 },
];

/** Group achievements by category for the gallery. Order is preserved. */
export function groupByCategory(ach: Achievement[]) {
  const out = new Map<string, Achievement[]>();
  for (const a of ach) {
    if (!out.has(a.category)) out.set(a.category, []);
    out.get(a.category)!.push(a);
  }
  return out;
}

export const TIER_COLOR: Record<Achievement["tier"], string> = {
  bronze:   "from-orange-500 to-orange-700",
  silver:   "from-slate-300 to-slate-500",
  gold:     "from-amber-300 to-amber-600",
  platinum: "from-cyan-300 to-cyan-500",
  diamond:  "from-fuchsia-300 via-purple-400 to-indigo-500",
};
