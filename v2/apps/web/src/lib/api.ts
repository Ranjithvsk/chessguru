import type {
  Puzzle, Difficulty, MeRating, CompleteResult, AuthMe,
} from "@chessguru/types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function deleteJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// Best-effort: tell the API the coach just entered a class room, so it can push
// the academy's OFFLINE students a "class is live" notification deep-linking to
// this exact room. Server is session-authenticated + coach-gated + idempotent,
// so calling it from any room mount is safe (students are a silent no-op).
// When `deferNotify` is true (audience-picker flow), the announcement row is
// still written but push fires later from PATCH /audience — prevents an
// initial "everyone I coach" push before the coach has narrowed the audience.
export async function announceGoingLive(room: string, joinPath: string, opts: { deferNotify?: boolean } = {}): Promise<void> {
  try {
    await post<{ ok: boolean }>(`/api/class/${encodeURIComponent(room)}/going-live`, {
      joinPath, deferNotify: !!opts.deferNotify,
    });
  } catch { /* never block the room from loading */ }
}

// Router path for a class room. Historically switched between two retired
// in-app implementations (/class/ and a from-scratch WebRTC mesh at /call/);
// both were removed 2026-08-12. Every live class now runs on Dream Meet.
// `kind` and `role` are kept in the signature so existing callers compile;
// the `kind` value is ignored.
export function classRoomPath(_kind: string | null | undefined, id: string, role: "coach" | "student"): string {
  return `/class-v2/${encodeURIComponent(id)}?role=${role}`;
}

export interface RandomPuzzleOpts { theme: string; rating: number; difficulty: Difficulty; maxPc?: number; userId?: string | null; section?: string; player?: string;   mode?: string;
  /** Curriculum override — exact target rating, bypasses live-rating +
   *  difficulty offset. Used by the weakness-curriculum ratchet. */
  exactRating?: number;
}
export interface MasterPlayer { name: string; count: number; }
export interface CompleteBody { win: boolean; hint: boolean; difficulty: Difficulty; userId: string | null; mode?: "puzzle" | "blindfold"; rating?: number; deviation?: number; theme?: string; ms?: number; moves_ms?: number[]; wrong?: string; daily?: boolean;  focus?: { hiddenMs: number; hiddenCount: number; firstMoveAfterReturnMs: number | null };}
export interface AuthResult { ok: boolean; error?: string; }

export interface Overview { total: number; engineGenerated: number; verified: number; engineGames: number; pools: { bfPools: number; piecePools: number; paths: number }; users: number; }
export interface Distribution { sampled: number; themeDist: { theme: string; count: number }[]; ratingDist: { band: number | string; count: number }[]; }
export interface GenPuzzle { id: string; fen: string; rating: number; themes: string[]; verified: boolean; }

export interface HistoryItem {
  id: string; date: string; win: boolean;
  ratingDiff: number | null; ratingAfter: number | null;
  puzzleRating: number | null; themes: string[]; mode: string; sel?: string | null;
  ms?: number | null;
  movesMs?: number[] | null;  // per-move deltas: [firstMoveMs, gap1→2, gap2→3, ...]
  wrong?: string | null;    // UCI of the wrong move played (only set on misses)
  best?: string | null;     // UCI of the expected first move — for the "best was X" callout
  dubious?: true;           // flagged suspicious solve (fast win on much-harder puzzle)
  difficulty?: string | null;  // "easiest" | "easier" | "normal" | "harder" | "hardest" — null on pre-2026-08-27 rows
  fen: string | null; lastMove: string | null; orientation: "white" | "black";
}
export interface HistoryReport {
  loggedIn: boolean;
  viewedAs?: string | null;      // set when an admin views another user's history via ?as=<u>
  viewedRating?: number | null;  // ditto — the viewed user's own puzzle rating
  totals?: { attempted: number; solved: number; failed: number; winRate: number };
  byTheme?: { theme: string; total: number; wins: number }[];
  byBand?: { band: string; lo: number; total: number; wins: number }[];
  items?: HistoryItem[];
  hasMore?: boolean;
  nextOffset?: number;
}

export interface MyRound { win: boolean; date: string; ratingDiff: number | null; ms: number | null; wrong: string | null; best: string | null; }

// ── Online play history (/api/live-games) ───────────────────────────────────
export type LiveSpeed = "bullet" | "blitz" | "rapid" | "classical";
export type LiveOutcome = "win" | "loss" | "draw";
export interface LiveGameSummary {
  id: string; startedAt: string; finishedAt: string; durationMs: number;
  speed: LiveSpeed; timeControl: { initial: number; increment: number }; rated: boolean;
  myColor: "white" | "black"; opponent: { id: string; name: string };
  result: string | null; status: string; outcome: LiveOutcome; reasonText: string; plies: number;
  ratingBefore: number | null; ratingAfter: number | null; ratingDiff: number | null; opponentRating: number | null;
}
export interface LiveGameFull extends LiveGameSummary {
  players: { white: { id: string | null; name: string }; black: { id: string | null; name: string } };
  initialFen: string; moves: string[]; moveTimes: number[]; sans: string[]; fens: string[]; checks: boolean[];
  clocks: { white: number; black: number }[];
  rating: { white: { before: number; after: number }; black: { before: number; after: number } } | null;
  pgn: string;
}
export interface LiveSpeedStats { games: number; wins: number; losses: number; draws: number; rating: number | null; provisional: boolean; history: { t: string; r: number }[] }
export interface LiveGamesStats {
  games: number; wins: number; losses: number; draws: number; winRate: number;
  currentStreak: number; longestStreak: number; totalMs: number; avgPlies: number;
  colors: { white: { games: number; wins: number }; black: { games: number; wins: number } };
  bestWin: { opponent: string; rating: number; id: string } | null;
  bySpeed: Record<LiveSpeed, LiveSpeedStats>;
  form: LiveOutcome[]; lastPlayedAt: string | null;
}
export const liveGames = {
  list: (q: { speed?: string; outcome?: string; rated?: string; offset?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && v !== "all") params.set(k, String(v));
    const qs = params.toString();
    return get<{ total: number; offset: number; items: LiveGameSummary[] }>(`/api/live-games${qs ? `?${qs}` : ""}`);
  },
  stats: () => get<LiveGamesStats>("/api/live-games/stats"),
  get: (id: string) => get<LiveGameFull>(`/api/live-games/${encodeURIComponent(id)}`),
};

export const api = {
  me: () => get<AuthMe>("/auth/me"),
  myRating: () => get<MeRating>("/api/me/rating"),
  history: (offset = 0, as?: string | null) =>
    get<HistoryReport>(`/api/me/history?offset=${offset}${as ? `&as=${encodeURIComponent(as)}` : ""}`),
  myRound: (pid: string) => get<{ round: MyRound | null }>(`/api/me/round/${encodeURIComponent(pid)}`),
  themes: () => get<{ themes: string[] }>("/api/themes"),
  suggestedThemes: () => get<{
    global: number;
    items: Array<{ theme: string; yourRating: number | null; delta: number | null; solves: number; reason: "weakness" | "strength" | "new" | "starter" }>;
  }>("/api/puzzles/suggested-themes"),
  randomPuzzle: (opts: RandomPuzzleOpts) => {
    const p = new URLSearchParams({ theme: opts.theme, rating: String(opts.rating), difficulty: opts.difficulty });
    if (opts.maxPc) p.set("maxPc", String(opts.maxPc));
    if (opts.userId) p.set("userId", opts.userId);
    if (opts.section) p.set("section", opts.section);
    if (opts.player) p.set("player", opts.player);
    if (opts.mode) p.set("mode", opts.mode); // blindfold serves from its own rating
    if (opts.exactRating) p.set("exactRating", String(opts.exactRating));
    return get<Puzzle>(`/api/puzzles/random?${p.toString()}`);
  },
  puzzleById: (id: string) => get<Puzzle>(`/api/puzzles/${encodeURIComponent(id)}`),
  masterPlayers: () => get<MasterPlayer[]>("/api/puzzles/master-players"),
  complete: (id: string, body: CompleteBody) => post<CompleteResult>(`/api/puzzles/${encodeURIComponent(id)}/complete`, body),

  signin: (username: string, password: string, keep: boolean, tenantSlug?: string) => post<AuthResult>("/auth/signin", { username, password, keep, tenantSlug }),
  register: (username: string, password: string, email: string) => post<AuthResult>("/auth/register", { username, password, email }),
  signupAcademy: (body: { academyName: string; ownerName: string; ownerEmail: string; password: string }) =>
    post<AuthResult & { academyId?: string; academyName?: string }>("/auth/signup-academy", body),
  logout: () => post<{ ok: boolean }>("/auth/logout", {}),
  changePassword: (currentPassword: string, newPassword: string) => post<{ ok: boolean; error?: string }>("/auth/change-password", { currentPassword, newPassword }),
  requestReset:  (email: string) => post<{ ok: boolean; error?: string }>("/auth/request-reset", { email }),
  resetPassword: (token: string, newPassword: string) => post<AuthResult & { username?: string }>("/auth/reset-password", { token, newPassword }),
  requestOtp:    (email: string) => post<{ ok: boolean; error?: string }>("/auth/request-otp", { email }),
  otpSignin:     (email: string, code: string, tenantSlug?: string) => post<AuthResult>("/auth/otp-signin", { email, code, tenantSlug }),

  adminOverview: () => get<Overview>("/api/status/overview"),
  adminDistribution: () => get<Distribution>("/api/status/distribution"),
  generatedStats: () => get<{ total: number; approved: number; rejected: number; pending: number }>("/api/generated/stats"),
  generatedPuzzles: (limit: number) => get<{ puzzles: GenPuzzle[] }>(`/api/generated/puzzles?limit=${limit}`),
  approve: (id: string) => post<{ ok: boolean }>(`/api/generated/puzzles/${encodeURIComponent(id)}/approve`, {}),
  reject: (id: string) => post<{ ok: boolean }>(`/api/generated/puzzles/${encodeURIComponent(id)}/reject`, {}),

  queueStats: () => get<{ counts: Record<string, number>; recent: { id: string; gameId: string; state: string; ts: number }[] }>("/api/admin/queue"),
  enqueueExtraction: (limit: number) => post<{ enqueued: number; availableGames: number }>("/api/admin/extract", { limit }),
};

// Study-puzzle rating summary per study type (study-factory). Used by the Study list to show level.
export interface StudyLevel { n: number; min: number; avg: number; max: number; }
export const studyLevels = () => get<Record<string, StudyLevel>>("/api/study/levels");

export interface StudyPuzzle { id: string; fen: string; rating: number; result: "win" | "draw" | "loss"; dtm: number; solution: string[]; book?: string | null; author?: string | null; quote?: string | null; topic?: string | null; }
export const studyPuzzle = (type: string, level: number, pawns?: number, book?: string) =>
  get<StudyPuzzle | null>(`/api/study/puzzle?type=${encodeURIComponent(type)}&level=${level}${pawns ? `&pawns=${pawns}` : ""}${book ? `&book=${encodeURIComponent(book)}` : ""}`);

// Books that have famous seeded positions for a study type (the book selector).
export interface StudyBook { book: string; author: string; n: number; }
export const studyBooks = (type: string) =>
  get<StudyBook[]>(`/api/study/books?type=${encodeURIComponent(type)}`);

export const studyMe = (type: string) =>
  get<{ rating: number; nb: number; guest: boolean }>(`/api/study/me?type=${encodeURIComponent(type)}`);
export const studyComplete = (id: string, win: boolean, rating: number) =>
  post<{ win: boolean; rating: number; ratingDiff: number; puzzleRating: number }>(`/api/study/${id}/complete`, { win, rating, deviation: 500 });

// --- Admin: registered users + their activity (gated to admins server-side) ---
export interface AdminUserRow { username: string; email: string | null; academyId?: string | null; role?: string | null; createdAt: string | null; lastLogin: string | null; puzzleRating: number | null; solves: number; wins: number; lastActive: string | null; studySolves: number; studyWins: number; study: Record<string, number>; solves7d?: number; wins7d?: number; net7d?: number | null; }
export const adminUsers = () => get<AdminUserRow[]>("/api/admin/users");
export interface AdminOverview {
  users: { total: number; newToday: number; newWeek: number; active7d: number; active30d: number };
  solves: { puzzleTotal: number; studyTotal: number; today: number; week: number };
  signups14: { date: string; n: number }[];
  activity14: { date: string; puzzle: number; study: number }[];
  content: { puzzlePool: number; studyTotal: number; studyByType: { type: string; n: number }[]; studyPending: number };
  inactive: { username: string; lastActive: string; days: number }[];
}
export const adminOverview = () => get<AdminOverview>("/api/admin/overview");
export interface AdminUserDetail { username: string; email: string | null; createdAt: string | null; lastLogin: string | null; ratings: Record<string, { r: number; nb: number }>; recent: { puzzleId: string; win: boolean; at: string; rating: number | null; ratingDiff: number | null; themes: string[] }[]; recentStudy: { type: string; win: boolean; at: string; rating: number | null; ratingDiff: number | null }[]; solvesToday: number; solvesWeek: number; studySolves: number; studyWins: number; topThemes: { theme: string; n: number }[]; ratingHistory: number[]; }
export const adminUserDetail = (u: string) => get<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(u)}`);

// --- Admin: per-academy adoption & retention (/admin/academies) -------------
// Mirrors AdminAcademiesService (apps/api/src/admin/admin-academies.service.ts)
// by hand — admin payloads are not generated and are not shared through
// @chessguru/types, so these interfaces have to be kept in step with the service
// manually.
//
// ONE endpoint serves two callers and must not be turned into an envelope:
// this page, and the super-admin academy picker on Leaderboard.tsx:391 which
// reads the same URL as a bare Array<{id, name, studentCount}> and needs the
// "__all__" / "__platform__" sentinel rows. Everything below is additive.
export type AcademyHealthBand = "thriving" | "growing" | "starting" | "quiet" | "dormant" | "aggregate";

export interface AdminAcademyFeature {
  key: string;
  label: string;
  /** false = an academy-only feature on a bucket that is not a tenant. Renders
   *  as "n/a", never as "never used". */
  applicable: boolean;
  used: boolean;
  count: number;
  lastUsedAt: string | null;
  detail?: Record<string, number>;
}

export interface AdminAcademySparkPoint {
  date: string;
  puzzles: number;
  studySolves: number;
  /** Before this academy signed up — those solves are the students' personal
   *  history and are not credited to the academy anywhere. */
  preSignup: boolean;
}

export interface AdminAcademyPeople {
  students: number; coaches: number; parents: number; owners: number; other: number; total: number;
  everLoggedIn: number; neverLoggedIn: number;
  /** Current members who transferred in from another academy. */
  joinedFromElsewhere: number;
  /** Accounts that have LEFT. Their activity from while they were here is still
   *  counted here. */
  departed: number;
  /** academyId points at an academy row that no longer exists. */
  orphaned: number;
}

export interface AdminAcademyActivity {
  /** Every window on this page is the last 7 / 30 IST CALENDAR days, today
   *  included. There is no second, rolling-hours definition anywhere. */
  activeUsers7d: number; activeUsersPrev7d: number; activeUsers30d: number;
  puzzles7d: number; puzzlesPrev7d: number; puzzles30d: number;
  studySolves7d: number; studySolvesPrev7d: number; studySolves30d: number;
  solves7d: number; solvesPrev7d: number; solves30d: number;
  puzzlesLifetime: number; studySolvesLifetime: number;
  /** Solves by current members from before they were members here. */
  puzzlesBeforeJoining: number;
  actions7d: number; actions30d: number; activeDays30: number;
  lastActivityAt: string | null; daysSinceLastActivity: number | null;
  lastStaffActionAt: string | null; daysSinceStaffAction: number | null;
  staffActionDays: number; staffActionWindowDays: number;
  activeStaff: number; staffTotal: number;
  /** Artefacts a platform admin authored inside this tenant. Excluded from every
   *  staff-habit number so our own poking cannot make a dead academy look alive. */
  vendorActions: number;
}

export interface AdminAcademyRow {
  id: string;
  name: string;
  /** The picker's field. role:"student" only (for the two sentinels it keeps its
   *  legacy meaning — see the service). */
  studentCount: number;
  kind: "academy" | "standalone" | "all";
  synthetic: boolean;
  ownerId: string | null; ownerName: string | null;
  plan: string | null; createdAt: string | null; ageDays: number | null;
  isTest: boolean; testReason: string | null;
  /** Owned by a platform admin — our own sandbox, never a customer. */
  isInternal: boolean;
  /** Set when this one row could not be computed; the card degrades, the page
   *  does not fall over. */
  dataError: string | null;
  people: AdminAcademyPeople;
  activity: AdminAcademyActivity;
  features: AdminAcademyFeature[];
  featuresUsed: number; featuresApplicable: number; featuresTotal: number;
  operational: { used: number; applicable: number; total: number; features: AdminAcademyFeature[] };
  individual: { used: number; applicable: number; total: number; features: AdminAcademyFeature[] };
  spark: AdminAcademySparkPoint[];
  /** `severity` ascending = needs attention first; `tier` keeps the vendor
   *  sandbox, test shells and the standalone bucket out of the customers' way.
   *  The array arrives in the PICKER's legacy order, so the page sorts on these. */
  health: { band: AcademyHealthBand; label: string; reason: string; severity: number; tier: number };
}
export const adminAcademies = () => get<AdminAcademyRow[]>("/api/admin/academies");

export interface AdminAcademyPerson {
  userId: string; username: string; name: string; role: string;
  isStaff: boolean; joinedAt: string | null;
  joinedFromElsewhere: boolean; detachedFrom: string | null;
  departed: boolean; departedAt: string | null;
  orphanedAcademyId: string | null;
  puzzles7d: number; puzzles30d: number; puzzlesLifetime: number;
  studySolves7d: number; studySolves30d: number; studySolvesLifetime: number;
  solves7d: number; studiesCreated: number;
  puzzleRating: number | null;
  lastActivityAt: string | null; daysSinceLastActivity: number | null;
  lastSeen: string | null; lastLogin: string | null;
  /** express-session, rolling. 30-day horizon — null means "nothing in 30 days". */
  lastRequestAt: string | null;
  everLoggedIn: boolean;
}

export interface AdminAcademySeriesPoint {
  date: string; puzzles: number; studySolves: number;
  activeUsers: number; staffActions: number; created: number; preSignup: boolean;
}

export interface AdminAcademyCreated {
  kind: string; title: string; by: string | null; at: string | null; note: string | null;
  /** Identical artefacts made by the same person in the same minute (one
   *  "assign to the whole batch" click) collapse to one line carrying a count. */
  count: number;
}

export interface AdminAcademyDetail {
  academy: AdminAcademyRow;
  people: { rows: AdminAcademyPerson[]; total: number; current: number; departed: number; limit: number; offset: number };
  series: AdminAcademySeriesPoint[];
  /** Newest first, every kind merged, sorted on real date fields (never on the
   *  random string _id). `createdTotal` is the REAL total, not the sum of
   *  truncated fetches. */
  created: AdminAcademyCreated[];
  /** The real total of artefacts. `createdLines` is how many lines that is
   *  after identical bulk rows are collapsed. */
  createdTotal: number;
  createdLines: number;
  createdLimit: number;
  generatedAt: string;
  timezone: string;
  weekDays: number;
}
export const adminAcademyDetail = (id: string, opts: { peopleLimit?: number } = {}) =>
  get<AdminAcademyDetail>(
    `/api/admin/academies/${encodeURIComponent(id)}`
    + (opts.peopleLimit ? `?peopleLimit=${opts.peopleLimit}` : ""),
  );

// ── Broadcast games (Lichess PGN dumps) ───────────────────────────────
export interface BroadcastListItem {
  id: string; event: string; site: string; round: string; date: string;
  white: string; whiteElo: number; black: string; blackElo: number;
  result: string; ply: number;
}
export interface BroadcastListResp {
  items: BroadcastListItem[]; total: number; offset: number;
  pageSize: number; hasMore: boolean;
}
export interface BroadcastGame extends BroadcastListItem {
  found: true; moves: string[];
}
export const broadcastList = (params: { minElo?: number; result?: string; q?: string; from?: string; to?: string; offset?: number } = {}) => {
  const p = new URLSearchParams();
  if (params.minElo != null) p.set("minElo", String(params.minElo));
  if (params.result)          p.set("result", params.result);
  if (params.q)               p.set("q", params.q);
  if (params.from)            p.set("from", params.from);
  if (params.to)              p.set("to", params.to);
  if (params.offset)          p.set("offset", String(params.offset));
  return get<BroadcastListResp>(`/api/broadcasts?${p.toString()}`);
};
export const broadcastFacets = () =>
  get<{ events: { event: string; n: number }[]; players: { name: string; n: number }[] }>("/api/broadcasts/facets");
export const broadcastOne = (id: string) =>
  get<BroadcastGame | { found: false }>(`/api/broadcasts/${encodeURIComponent(id)}`);

// --- Admin: sales leads (/admin/leads) — mirrors AdminLeadsService (apps/api/src/admin/admin-leads.service.ts) ---
export type LeadStatus = "new" | "contacted" | "interested" | "demo" | "trial" | "converted" | "lost";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "interested", "demo", "trial", "converted", "lost"];
export type LeadActivity = { at: string; by: string; kind: "note" | "call" | "status" | "email" | "whatsapp" | "visit"; text: string };
export type Lead = {
  id: string; name: string; city: string; locality: string; address: string; phones: string; email: string; website: string; coaches: string;
  estStudents: string; estCoaches: string; estimateBasis: string; notes: string; sources: string;
  status: LeadStatus; assignee: string; nextFollowUpAt: string | null; lastContactAt: string | null; academyId: string | null;
  optIn: boolean; optInAt: string | null; optInSource: string;
  activity: LeadActivity[]; createdAt: string | null; updatedAt: string | null;
};
export type LeadSummary = { total: number; byStatus: Record<LeadStatus, number>; followUpsDue: number; converted: number; conversionPct: number };
export const adminLeads = (q: { status?: string; q?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][]).toString();
  return get<Lead[]>(`/api/admin/leads${qs ? `?${qs}` : ""}`);
};
export const adminLeadsSummary = () => get<LeadSummary>("/api/admin/leads/summary");
export const adminLeadUpdate = (id: string, body: Partial<Lead>) => patch<Lead>(`/api/admin/leads/${encodeURIComponent(id)}`, body);
export const adminLeadActivity = (id: string, body: { kind: LeadActivity["kind"]; text: string }) => post<Lead>(`/api/admin/leads/${encodeURIComponent(id)}/activity`, body);
export const adminLeadCreate = (body: Partial<Lead>) => post<Lead>("/api/admin/leads", body);

