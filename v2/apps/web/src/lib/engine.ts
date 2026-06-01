// Client-side Stockfish (single-file asm.js worker served at /stockfish.js).
// Used by the Study trainer to play the defending side at full strength.
export interface Engine {
  ready: Promise<void>;
  bestMove(fen: string, movetimeMs?: number): Promise<string>;
  quit(): void;
}

export function createEngine(): Engine {
  const url = (import.meta.env.BASE_URL || "/") + "stockfish-nnue-16-single.js";
  const w = new Worker(url);
  let onLine: ((s: string) => void) | null = null;
  w.onmessage = (e: MessageEvent) => {
    const line = typeof e.data === "string" ? e.data : (e.data && (e.data as { data?: string }).data) || "";
    if (onLine) onLine(line);
  };
  const send = (c: string) => w.postMessage(c);

  const ready = new Promise<void>((resolve) => {
    onLine = (l) => {
      if (l === "uciok") send("isready");
      else if (l === "readyok") { onLine = null; resolve(); }
    };
    send("uci");
  });

  const bestMove = (fen: string, movetimeMs = 300) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { onLine = null; reject(new Error("engine timeout")); }, movetimeMs + 8000);
      onLine = (l) => {
        if (l.startsWith("bestmove")) {
          clearTimeout(timer); onLine = null;
          resolve((l.split(/\s+/)[1] || "").trim());
        }
      };
      send("position fen " + fen);
      send("go movetime " + movetimeMs);
    });

  return { ready, bestMove, quit: () => w.terminate() };
}
