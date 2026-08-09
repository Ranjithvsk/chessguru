// Curated catalog of ChessGuru + Academy features. Powers the /signup-academy
// showcase and future in-app "what's included" pages. Static TS so we can add
// features by editing one file — no CMS, no DB round-trip on every page load.
//
// ⚠ RULE: when a user-facing feature ships, add an entry here AND publish an
// announcement via `POST /api/admin/announcements` so registered academy
// owners + coaches get an email. (See MEMORY: feature-launch-flow.)
//
// Screenshot naming convention: /feature-shots/<id>.png (2×, e.g. 1200×800).
// Missing shots fall back to the emoji tile so nothing looks broken.

export type FeatureCategory =
  | "puzzles" | "study" | "play" | "classes"
  | "academy" | "analytics" | "notifications" | "engagement";

export interface Feature {
  id: string;                    // stable slug — also the screenshot filename
  category: FeatureCategory;
  emoji: string;
  title: string;
  description: string;
  badge?: "NEW" | "BETA";
  shipped?: string;              // ISO date — most-recent items float to top of category
}

export const CATEGORY_META: Record<FeatureCategory, { label: string; blurb: string; gradient: string }> = {
  puzzles:       { label: "Puzzles",              blurb: "Rated tactics that adapt to every student", gradient: "from-brand-500/25 to-purple-500/10" },
  study:         { label: "Study",                blurb: "Openings, endgames, memory palace",         gradient: "from-emerald-500/25 to-teal-500/10" },
  play:          { label: "Play",                 blurb: "Games, engines, sandbox",                   gradient: "from-cyan-500/25 to-sky-500/10" },
  classes:       { label: "Live classes",         blurb: "Video coaching + shared board",             gradient: "from-rose-500/25 to-pink-500/10" },
  academy:       { label: "Academy management",   blurb: "Coaches, students, invites, fees",          gradient: "from-amber-500/25 to-orange-500/10" },
  analytics:     { label: "Analytics",            blurb: "Ratings, streaks, per-theme strengths",     gradient: "from-fuchsia-500/25 to-violet-500/10" },
  notifications: { label: "Notifications",        blurb: "Nudges that respect the user",              gradient: "from-indigo-500/25 to-blue-500/10" },
  engagement:    { label: "Engagement",           blurb: "Milestones, streaks, celebrations",         gradient: "from-orange-500/25 to-rose-500/10" },
};

export const FEATURES: Feature[] = [
  // ── Puzzles ────────────────────────────────────────────────────────────
  { id: "puzzle-trainer",      category: "puzzles",      emoji: "🧩", title: "Rated puzzle trainer",       description: "Glicko-rated tactics across every theme, difficulty ladder, spaced repetition." },
  { id: "puzzle-of-the-day",   category: "puzzles",      emoji: "🎯", title: "Puzzle of the Day",          description: "One shared puzzle every day — everyone gets the same one. Community leaderboard-lite baked in.", badge: "NEW", shipped: "2026-08-09" },
  { id: "daily-history-strip", category: "puzzles",      emoji: "📅", title: "7-day daily history",        description: "Every past daily at a glance — solved, missed, or skipped.", badge: "NEW", shipped: "2026-08-09" },
  { id: "blindfold",           category: "puzzles",      emoji: "🕶️", title: "Blindfold puzzles",          description: "Solve without seeing the pieces — separate rating, separate theme stats." },
  { id: "wrong-move-analysis", category: "puzzles",      emoji: "🔍", title: "Wrong-move review",          description: "Red arrow of what you played, green arrow of what to play. SAN callout in the sidebar." },

  // ── Study ─────────────────────────────────────────────────────────────
  { id: "opening-trainer",     category: "study",        emoji: "📕", title: "Opening trainer",            description: "Named openings with move-by-move drills and rated repetition." },
  { id: "endgame-manual",      category: "study",        emoji: "♚",  title: "Endgame manual",             description: "Rule-of-Square, KPK, Opposition — playable positions with a Maia play-it-out rater." },
  { id: "memory-palace",       category: "study",        emoji: "🧠", title: "Memory Palace",              description: "Position-recall trainer for pattern retention." },
  { id: "opening-tree",        category: "study",        emoji: "🌳", title: "Opening tree explorer",      description: "Browse master games branch-by-branch, per-move win rates." },
  { id: "coordinate-trainer",  category: "study",        emoji: "🅰️", title: "Coordinate trainer",         description: "Learn the board faster than your students expect." },

  // ── Play ──────────────────────────────────────────────────────────────
  { id: "pass-and-play",       category: "play",         emoji: "♟️", title: "Pass & play",                description: "Two players, one screen, one board — perfect for class demos." },
  { id: "engine-battle",       category: "play",         emoji: "⚔️", title: "Engine battle",              description: "Watch engines play each other. Useful for teaching plans and long-term strategy." },
  { id: "board-editor",        category: "play",         emoji: "✏️", title: "Board editor",               description: "Set up any position for teaching or analysis." },

  // ── Live classes ──────────────────────────────────────────────────────
  { id: "live-class",          category: "classes",      emoji: "🎥", title: "Live video classes",         description: "Multi-student video calls with a shared board — self-hosted Jitsi, no third-party accounts." },
  { id: "class-recording",     category: "classes",      emoji: "📼", title: "Class recording + replay",   description: "One-click record; students catch up on the same board sync you had live." },
  { id: "board-annotations",   category: "classes",      emoji: "✏️", title: "Board annotations",          description: "Arrows + circles broadcast to every student in real time." },
  { id: "snap-position",       category: "classes",      emoji: "📸", title: "📸 Snap-position",            description: "Coach freezes a moment mid-class — students revisit it later on /academy." },
  { id: "captions",            category: "classes",      emoji: "🗣️", title: "Live captions",              description: "Browser speech recognition streams captions to everyone." },
  { id: "chat-reactions",      category: "classes",      emoji: "💬", title: "Chat + raise-hand + emoji",  description: "Full classroom interaction, no side-app needed." },
  { id: "scheduling",          category: "classes",      emoji: "🗓️", title: "Class scheduling",           description: "Weekly recurring, single, calendar view, auto-reminders (24h / 1h / 15min)." },

  // ── Academy management ───────────────────────────────────────────────
  { id: "coaches",             category: "academy",      emoji: "👨‍🏫", title: "Coach management",         description: "Invite coaches by email — they land on a coach dashboard scoped to their students." },
  { id: "students",            category: "academy",      emoji: "👦", title: "Student roster",             description: "Owner sees all; each coach sees theirs. Rating, activity, streak, attendance in one row." },
  { id: "invites",             category: "academy",      emoji: "✉️", title: "Email invites",              description: "One-click invite links; auto-attach to the inviting coach." },
  { id: "fees",                category: "academy",      emoji: "💳", title: "Fees + UPI collection",      description: "Configurable monthly fee, one-tap UPI intent link, pending-fees rollup per student." },
  { id: "attendance",          category: "academy",      emoji: "✅", title: "Class attendance tracking",  description: "Auto-captured when a student joins the live class — CSV export + 30-day heatmap." },

  // ── Analytics ────────────────────────────────────────────────────────
  { id: "dashboard",           category: "analytics",    emoji: "📊", title: "My performance dashboard",   description: "Rating, per-theme Glicko, strengths, weaknesses, 30-day progress." },
  { id: "heatmap",             category: "analytics",    emoji: "🟩", title: "13-week activity heatmap",    description: "GitHub-style solve density — spot habit gaps at a glance." },
  { id: "personal-bests",      category: "analytics",    emoji: "🏆", title: "Personal bests",             description: "Best rating, best day, biggest gain, fastest solve — with the date each was set." },
  { id: "speed-by-theme",      category: "analytics",    emoji: "⚡", title: "Speed by theme",             description: "Median solve time per theme with faster/slower/steady trend arrows." },
  { id: "best-hour",           category: "analytics",    emoji: "🕒", title: "Best time of day",           description: "24-hour bar chart of when this student actually solves best." },
  { id: "csv-export",          category: "analytics",    emoji: "⬇️", title: "CSV history export",         description: "Full round history as flat CSV — coach archives, parent reports, external tools." },

  // ── Notifications ────────────────────────────────────────────────────
  { id: "weekly-digest",       category: "notifications", emoji: "📊", title: "Weekly progress digest",    description: "Sunday-morning email recap of the past week: solves, wins, rating delta, fastest solve.", badge: "NEW", shipped: "2026-08-09" },
  { id: "streak-reminder",     category: "notifications", emoji: "🔥", title: "Streak-save reminder",      description: "Evening email + in-app banner when a ≥3-day streak hasn't been fed today.", badge: "NEW", shipped: "2026-08-09" },
  { id: "push-notifications",  category: "notifications", emoji: "📱", title: "Browser push notifications", description: "PWA push — get streak nudges and milestone celebrations without opening email.", badge: "NEW", shipped: "2026-08-09" },
  { id: "class-reminders",     category: "notifications", emoji: "⏰", title: "Class reminders",           description: "24h / 1h / 15min before each class. Per-student opt-outs. Delivery-webhook wired." },

  // ── Engagement ───────────────────────────────────────────────────────
  { id: "rating-milestones",   category: "engagement",   emoji: "🎉", title: "Rating milestones",          description: "Confetti overlay + push when the student crosses 800 / 900 / … / 2200.", badge: "NEW", shipped: "2026-08-09" },
  { id: "count-milestones",    category: "engagement",   emoji: "🏅", title: "Solve-count milestones",     description: "Every 25 / 100 / 250 / 500 / 1000 solves — celebrating volume, not just gain.", badge: "NEW", shipped: "2026-08-09" },
  { id: "streaks",             category: "engagement",   emoji: "🔥", title: "Daily streaks",              description: "Solve streak + separate daily-puzzle attendance streak. Grace-day handling built in." },
  { id: "daily-strip",         category: "engagement",   emoji: "📅", title: "Past-7 daily strip",         description: "Consistency at a glance on the Daily page — ✓ / ✗ / – per day." },
];

export const FEATURES_BY_CATEGORY: Record<FeatureCategory, Feature[]> = (() => {
  const out = {} as Record<FeatureCategory, Feature[]>;
  for (const k of Object.keys(CATEGORY_META) as FeatureCategory[]) out[k] = [];
  for (const f of FEATURES) out[f.category].push(f);
  // NEW badges float to the top of their category.
  for (const k of Object.keys(out) as FeatureCategory[]) {
    out[k].sort((a, b) => (b.shipped ? 1 : 0) - (a.shipped ? 1 : 0));
  }
  return out;
})();
