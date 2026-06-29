import type {
  Puzzle, Difficulty, MeRating, CompleteResult, AuthMe,
} from "@chessguru/types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface RandomPuzzleOpts { theme: string; rating: number; difficulty: Difficulty; maxPc?: number; userId?: string | null; section?: string; player?: string; }
export interface MasterPlayer { name: string; count: number; }
export interface CompleteBody { win: boolean; hint: boolean; difficulty: Difficulty; userId: string | null; mode?: "puzzle" | "blindfold"; rating?: number; deviation?: number; theme?: string; }
export interface AuthResult { ok: boolean; error?: string; }

export interface Overview { total: number; engineGenerated: number; verified: number; engineGames: number; pools: { bfPools: number; piecePools: number; paths: number }; users: number; }
export interface Distribution { sampled: number; themeDist: { theme: string; count: number }[]; ratingDist: { band: number | string; count: number }[]; }
export interface GenPuzzle { id: string; fen: string; rating: number; themes: string[]; verified: boolean; }

export interface HistoryItem {
  id: string; date: string; win: boolean;
  ratingDiff: number | null; ratingAfter: number | null;
  puzzleRating: number | null; themes: string[]; mode: string; sel?: string | null;
  fen: string | null; lastMove: string | null; orientation: "white" | "black";
}
export interface HistoryReport {
  loggedIn: boolean;
  totals?: { attempted: number; solved: number; failed: number; winRate: number };
  byTheme?: { theme: string; total: number; wins: number }[];
  byBand?: { band: string; lo: number; total: number; wins: number }[];
  items?: HistoryItem[];
  hasMore?: boolean;
  nextOffset?: number;
}

export const api = {
  me: () => get<AuthMe>("/auth/me"),
  myRating: () => get<MeRating>("/api/me/rating"),
  history: (offset = 0) => get<HistoryReport>(`/api/me/history?offset=${offset}`),
  themes: () => get<{ themes: string[] }>("/api/themes"),
  randomPuzzle: (opts: RandomPuzzleOpts) => {
    const p = new URLSearchParams({ theme: opts.theme, rating: String(opts.rating), difficulty: opts.difficulty });
    if (opts.maxPc) p.set("maxPc", String(opts.maxPc));
    if (opts.userId) p.set("userId", opts.userId);
    if (opts.section) p.set("section", opts.section);
    if (opts.player) p.set("player", opts.player);
    return get<Puzzle>(`/api/puzzles/random?${p.toString()}`);
  },
  puzzleById: (id: string) => get<Puzzle>(`/api/puzzles/${encodeURIComponent(id)}`),
  masterPlayers: () => get<MasterPlayer[]>("/api/puzzles/master-players"),
  complete: (id: string, body: CompleteBody) => post<CompleteResult>(`/api/puzzles/${encodeURIComponent(id)}/complete`, body),

  signin: (username: string, password: string, keep: boolean) => post<AuthResult>("/auth/signin", { username, password, keep }),
  register: (username: string, password: string, email: string) => post<AuthResult>("/auth/register", { username, password, email }),
  logout: () => post<{ ok: boolean }>("/auth/logout", {}),

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

export interface StudyPuzzle { id: string; fen: string; rating: number; result: "win" | "draw" | "loss"; dtm: number; solution: string[]; }
export const studyPuzzle = (type: string, level: number, pawns?: number) =>
  get<StudyPuzzle | null>(`/api/study/puzzle?type=${encodeURIComponent(type)}&level=${level}${pawns ? `&pawns=${pawns}` : ""}`);

export const studyMe = (type: string) =>
  get<{ rating: number; nb: number; guest: boolean }>(`/api/study/me?type=${encodeURIComponent(type)}`);
export const studyComplete = (id: string, win: boolean, rating: number) =>
  post<{ win: boolean; rating: number; ratingDiff: number; puzzleRating: number }>(`/api/study/${id}/complete`, { win, rating, deviation: 500 });

// --- Admin: registered users + their activity (gated to admins server-side) ---
export interface AdminUserRow { username: string; email: string | null; createdAt: string | null; puzzleRating: number | null; solves: number; wins: number; lastActive: string | null; study: Record<string, number>; }
export const adminUsers = () => get<AdminUserRow[]>("/api/admin/users");
export interface AdminUserDetail { username: string; email: string | null; createdAt: string | null; ratings: Record<string, { r: number; nb: number }>; recent: { puzzleId: string; win: boolean; at: string; rating: number | null; ratingDiff: number | null; themes: string[] }[]; }
export const adminUserDetail = (u: string) => get<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(u)}`);
