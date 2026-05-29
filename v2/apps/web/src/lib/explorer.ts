// Lichess opening explorer (public API, called client-side from the visitor's browser).
export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}
export interface ExplorerData {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening?: { eco: string; name: string } | null;
}

export async function fetchExplorer(fen: string, source: "lichess" | "masters" = "lichess"): Promise<ExplorerData> {
  const p = new URLSearchParams({ variant: "standard", fen, moves: "12", topGames: "0", recentGames: "0" });
  if (source === "lichess") {
    p.set("speeds", "blitz,rapid,classical");
    p.set("ratings", "1600,1800,2000,2200,2500");
  }
  const res = await fetch(`https://explorer.lichess.ovh/${source}?${p.toString()}`);
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  return res.json() as Promise<ExplorerData>;
}
