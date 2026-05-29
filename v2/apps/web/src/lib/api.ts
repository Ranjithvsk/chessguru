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

export interface RandomPuzzleOpts { theme: string; rating: number; difficulty: Difficulty; maxPc?: number; }
export interface CompleteBody { win: boolean; hint: boolean; difficulty: Difficulty; userId: string | null; mode?: "puzzle" | "blindfold"; rating?: number; deviation?: number; }
export interface AuthResult { ok: boolean; error?: string; }

export interface Overview { total: number; engineGenerated: number; verified: number; engineGames: number; pools: { bfPools: number; piecePools: number; paths: number }; users: number; }
export interface Distribution { sampled: number; themeDist: { theme: string; count: number }[]; ratingDist: { band: number | string; count: number }[]; }
export interface GenPuzzle { id: string; fen: string; rating: number; themes: string[]; verified: boolean; }

export const api = {
  me: () => get<AuthMe>("/auth/me"),
  myRating: () => get<MeRating>("/api/me/rating"),
  themes: () => get<{ themes: string[] }>("/api/themes"),
  randomPuzzle: (opts: RandomPuzzleOpts) => {
    const p = new URLSearchParams({ theme: opts.theme, rating: String(opts.rating), difficulty: opts.difficulty });
    if (opts.maxPc) p.set("maxPc", String(opts.maxPc));
    return get<Puzzle>(`/api/puzzles/random?${p.toString()}`);
  },
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
