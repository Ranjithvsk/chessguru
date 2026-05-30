// Our own opening explorer — served by the v2 NestJS API (/api/explorer).
// (We do NOT call explorer.lichess.ovh: it 401s our datacenter IP. See
//  PROJECT_MASTER/plans/own-opening-explorer.md.)
const BASE = import.meta.env.VITE_API_BASE ?? "";

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number | null;
}
export interface ExplorerData {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening?: { eco: string; name: string } | null;
  topGames?: unknown[];
}

export type ExplorerDb = "masters";

export async function fetchExplorer(fen: string, db: ExplorerDb = "masters", moves = 14): Promise<ExplorerData> {
  const p = new URLSearchParams({ fen, db, moves: String(moves) });
  const res = await fetch(`${BASE}/api/explorer?${p.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  return res.json() as Promise<ExplorerData>;
}
