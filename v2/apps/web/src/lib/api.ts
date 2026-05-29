import type {
  Puzzle, Difficulty, MeRating, CompleteResult, AuthMe,
} from "@chessguru/types";

// Phase 0: same-origin via Vite proxy → existing Express API. Configurable for cutover.
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

export const api = {
  me: () => get<AuthMe>("/auth/me"),
  myRating: () => get<MeRating>("/api/me/rating"),
  themes: () => get<{ themes: string[] }>("/api/themes"),
  randomPuzzle: (theme: string, rating: number, difficulty: Difficulty) =>
    get<Puzzle>(`/api/puzzles/random?theme=${encodeURIComponent(theme)}&rating=${rating}&difficulty=${difficulty}`),
  complete: (id: string, body: { win: boolean; hint: boolean; difficulty: Difficulty; userId: string | null }) =>
    post<CompleteResult>(`/api/puzzles/${encodeURIComponent(id)}/complete`, body),
};
