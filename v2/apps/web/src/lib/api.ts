import type {
  Puzzle, Difficulty, MeRating, CompleteResult, AuthMe,
} from "@chessguru/types";

// Phase 0: same-origin (Vite proxy in dev, nginx in prod) → existing Express API.
const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface RandomPuzzleOpts {
  theme: string;
  rating: number;
  difficulty: Difficulty;
  maxPc?: number;
}
export interface CompleteBody {
  win: boolean;
  hint: boolean;
  difficulty: Difficulty;
  userId: string | null;
  mode?: "puzzle" | "blindfold";
  rating?: number;
  deviation?: number;
}

export const api = {
  me: () => get<AuthMe>("/auth/me"),
  myRating: () => get<MeRating>("/api/me/rating"),
  themes: () => get<{ themes: string[] }>("/api/themes"),
  randomPuzzle: (opts: RandomPuzzleOpts) => {
    const p = new URLSearchParams({
      theme: opts.theme,
      rating: String(opts.rating),
      difficulty: opts.difficulty,
    });
    if (opts.maxPc) p.set("maxPc", String(opts.maxPc));
    return get<Puzzle>(`/api/puzzles/random?${p.toString()}`);
  },
  complete: (id: string, body: CompleteBody) =>
    post<CompleteResult>(`/api/puzzles/${encodeURIComponent(id)}/complete`, body),
};
