// My Games API client — imported games + server-side Stockfish analysis.

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export type Severity = "blunder" | "mistake" | "inaccuracy";
export type MistakeTag =
  | "missed_mate" | "hung_piece" | "missed_capture"
  | "missed_knight_fork" | "missed_check" | "missed_promotion"
  | "opening_deviation" | "positional";

export interface GameSummary {
  _id: string;
  ownerId: string;
  source: "pgn" | "lichess" | "chesscom" | "chessguru";
  white: string;
  black: string;
  event?: string;
  date?: string;
  result: string;
  ourColor: "white" | "black" | "both";
  status: "queued" | "analyzing" | "done" | "failed";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlyAnalysis {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  cpBefore: number;
  cpAfter: number;
  bestUci: string | null;
  bestSan: string | null;
  isMistake: boolean;
  severity?: Severity;
  tag?: MistakeTag;
  explanation?: string;
  ourColor: "white" | "black";
}

export interface Analysis {
  gameId: string;
  plies: PlyAnalysis[];
  mistakeCounts: Record<Severity, number>;
  tagCounts: Record<string, number>;
}

export interface Weaknesses {
  gamesAnalyzed: number;
  totalBlunders: number;
  totalMistakes: number;
  totalInaccuracies: number;
  tagCounts: Record<string, number>;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${method} ${path} → ${r.status}`;
    try { const j = await r.json(); if (j?.message) msg = String(j.message); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const myGamesApi = {
  list: () => req<{ items: GameSummary[] }>("GET", "/api/my-games"),
  get: (id: string) => req<{ game: GameSummary & { pgn: string }; analysis: Analysis | null }>("GET", `/api/my-games/${encodeURIComponent(id)}`),
  importPgn: (body: { pgn: string; ourColor?: "white" | "black" | "both" }) =>
    req<{ imported: number; gameIds: string[] }>("POST", "/api/my-games/import/pgn", body),
  importLichess: (body: { username: string; max?: number }) =>
    req<{ imported: number; gameIds: string[] }>("POST", "/api/my-games/import/lichess", body),
  importChesscom: (body: { username: string; max?: number }) =>
    req<{ imported: number; gameIds: string[] }>("POST", "/api/my-games/import/chesscom", body),
  weaknesses: () => req<Weaknesses>("GET", "/api/my-games/me/weaknesses"),
  remove: (id: string) => req<{ ok: boolean }>("DELETE", `/api/my-games/${encodeURIComponent(id)}`),
};
