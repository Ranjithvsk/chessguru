import { get, post, deleteJson } from "./api";

export type ChessdbGame = {
  _id: string;
  source: string;
  event?: string; site?: string; round?: string;
  date?: string; year?: number;
  white?: string; whiteElo?: number | null;
  black?: string; blackElo?: number | null;
  result?: string; eco?: string; plycount?: number;
  moves?: string;
  movesUci?: string;
  seenIn?: string[];
  dupCount?: number;
};

export type ChessdbSearchResult = {
  count: number;
  skip: number;
  limit: number;
  items: Array<Omit<ChessdbGame, "moves" | "movesUci"> & { movesPreview?: string }>;
  error?: string;
};

export type GameplayReviseAssignment = {
  _id: string;
  coachId: string;
  studentIds: string[];
  title: string;
  sourceGameId: string | null;
  pgn: string;
  coachNotes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const chessdbApi = {
  search(params: {
    white?: string; black?: string; event?: string; eco?: string;
    year?: number | string; yearFrom?: number | string; yearTo?: number | string;
    source?: string; limit?: number; skip?: number;
  }): Promise<ChessdbSearchResult> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    return get(`/api/chessdb/search?${qs.toString()}`);
  },
  game(id: string): Promise<ChessdbGame> {
    return get(`/api/chessdb/game/${encodeURIComponent(id)}`);
  },
  byPosition(params: {
    moves?: string;
    white?: string; black?: string; event?: string;
    eco?: string; yearFrom?: number | string; yearTo?: number | string;
    limit?: number;
  }): Promise<{ count: number; limit: number; moves: string; items: any[]; error?: string }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    if (!qs.has("limit")) qs.set("limit", "50");
    return get(`/api/chessdb/by-position?${qs.toString()}`);
  },
};

export const gameplayReviseApi = {
  // coach
  create(body: { title: string; studentIds: string[]; sourceGameId?: string | null; pgn?: string; coachNotes?: string }) {
    return post<GameplayReviseAssignment>("/api/gameplay-revise", body);
  },
  mine(): Promise<GameplayReviseAssignment[]> {
    return get("/api/gameplay-revise/mine");
  },
  update(id: string, patchBody: Partial<{ title: string; studentIds: string[]; pgn: string; coachNotes: string }>) {
    return patch<GameplayReviseAssignment>(`/api/gameplay-revise/${id}`, patchBody);
  },
  del(id: string) {
    return deleteJson<{ deleted: number }>(`/api/gameplay-revise/${id}`);
  },
  // student
  forMe(): Promise<GameplayReviseAssignment[]> {
    return get("/api/gameplay-revise/for-me");
  },
  forMeOne(id: string) {
    return get<{ assignment: GameplayReviseAssignment; progress: any; updated: boolean }>(`/api/gameplay-revise/for-me/${id}`);
  },
  progress(id: string, body: { ply: number; correct: boolean; tries: number; version: number; completed?: boolean }) {
    return post<{ ok: boolean }>(`/api/gameplay-revise/for-me/${id}/progress`, body);
  },
};
