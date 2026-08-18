// Client-side Stockfish (single-file asm.js worker served at /stockfish.js).
// Used by the Study trainer to play the defending side at full strength AND
// by the S5 Engine Coach panel on the OpeningDetail page for verdicts.

export interface Analysis {
  /** Engine eval from the side-to-move perspective, in centipawns. Null when mate. */
  scoreCp: number | null;
  /** Positive N = side-to-move mates in N. Negative = side-to-move is mated in N. Null when eval. */
  mate: number | null;
  /** Engine's chosen best move in UCI ("e2e4"). */
  bestUci: string;
  /** Principal variation as UCI moves. */
  pvUci: string[];
  /** Search depth reached before we stopped. */
  depth: number;
}

export interface Engine {
  ready: Promise<void>;
  bestMove(fen: string, movetimeMs?: number): Promise<string>;
  analyse(fen: string, movetimeMs?: number): Promise<Analysis>;
  /** Multi-line analysis — returns up to `multiPv` best lines, sorted by
   *  strength (index 0 = best). Powers the "top 3 lines" panel on the
   *  puzzle trainer (owner ask 2026-08-18). */
  analyseMulti(fen: string, multiPv: number, movetimeMs?: number): Promise<Analysis[]>;
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

  /** Analyse a position: capture the last info line before `bestmove` so we
   *  keep the deepest score + PV. Timeout is (movetime + 8s) as a safety net. */
  const analyse = (fen: string, movetimeMs = 800) =>
    new Promise<Analysis>((resolve, reject) => {
      let lastScoreCp: number | null = null;
      let lastMate: number | null = null;
      let lastPv: string[] = [];
      let lastDepth = 0;
      const timer = setTimeout(() => { onLine = null; reject(new Error("engine timeout")); }, movetimeMs + 8000);
      onLine = (l) => {
        if (l.startsWith("info")) {
          // info depth 18 seldepth 22 ... score cp -34 ... pv e2e4 e7e5 ...
          const depthM = /\bdepth\s+(\d+)/.exec(l); if (depthM) lastDepth = Number(depthM[1]);
          const cpM = /\bscore\s+cp\s+(-?\d+)/.exec(l);
          const mM = /\bscore\s+mate\s+(-?\d+)/.exec(l);
          if (cpM) { lastScoreCp = Number(cpM[1]); lastMate = null; }
          else if (mM) { lastMate = Number(mM[1]); lastScoreCp = null; }
          const pvM = /\bpv\s+(.+)$/.exec(l);
          if (pvM) lastPv = pvM[1]!.trim().split(/\s+/);
        } else if (l.startsWith("bestmove")) {
          clearTimeout(timer); onLine = null;
          const bestUci = (l.split(/\s+/)[1] || "").trim();
          resolve({ scoreCp: lastScoreCp, mate: lastMate, bestUci, pvUci: lastPv, depth: lastDepth });
        }
      };
      send("position fen " + fen);
      send("go movetime " + movetimeMs);
    });

  /** MultiPV analysis. Sends `setoption name MultiPV value N` then parses
   *  each `info ... multipv K ...` line, keeping the deepest snapshot per K.
   *  Resolves with an array (length ≤ multiPv) sorted by K ascending so
   *  index 0 = strongest line. */
  const analyseMulti = (fen: string, multiPv: number, movetimeMs = 1200) =>
    new Promise<Analysis[]>((resolve, reject) => {
      const perLine = new Map<number, { scoreCp: number | null; mate: number | null; pv: string[]; depth: number }>();
      const timer = setTimeout(() => { onLine = null; reject(new Error("engine timeout")); }, movetimeMs + 8000);
      onLine = (l) => {
        if (l.startsWith("info")) {
          const multiM = /\bmultipv\s+(\d+)/.exec(l);
          const k = multiM ? Number(multiM[1]) : 1;
          if (k < 1 || k > multiPv) return;
          const depthM = /\bdepth\s+(\d+)/.exec(l);
          const cpM = /\bscore\s+cp\s+(-?\d+)/.exec(l);
          const mM = /\bscore\s+mate\s+(-?\d+)/.exec(l);
          const pvM = /\bpv\s+(.+)$/.exec(l);
          const prior = perLine.get(k) || { scoreCp: null, mate: null, pv: [], depth: 0 };
          if (depthM) prior.depth = Number(depthM[1]);
          if (cpM) { prior.scoreCp = Number(cpM[1]); prior.mate = null; }
          else if (mM) { prior.mate = Number(mM[1]); prior.scoreCp = null; }
          if (pvM) prior.pv = pvM[1]!.trim().split(/\s+/);
          perLine.set(k, prior);
        } else if (l.startsWith("bestmove")) {
          clearTimeout(timer); onLine = null;
          const sorted: Analysis[] = [...perLine.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => ({
              scoreCp: v.scoreCp,
              mate: v.mate,
              bestUci: v.pv[0] || "",
              pvUci: v.pv,
              depth: v.depth,
            }));
          // Restore MultiPV=1 so subsequent bestMove()/analyse() calls
          // aren't hobbled by lingering multipv state.
          send("setoption name MultiPV value 1");
          resolve(sorted);
        }
      };
      send("setoption name MultiPV value " + Math.max(1, Math.min(5, multiPv)));
      send("position fen " + fen);
      send("go movetime " + movetimeMs);
    });

  return { ready, bestMove, analyse, analyseMulti, quit: () => w.terminate() };
}

/** Convert side-to-move CP to white-perspective CP (for display consistency). */
export function toWhiteCp(a: Analysis, sideToMove: "w" | "b"): number | null {
  if (a.scoreCp == null) return null;
  return sideToMove === "w" ? a.scoreCp : -a.scoreCp;
}

/** Convert side-to-move mate to white-perspective mate. */
export function toWhiteMate(a: Analysis, sideToMove: "w" | "b"): number | null {
  if (a.mate == null) return null;
  return sideToMove === "w" ? a.mate : -a.mate;
}

/** Human eval label: "+0.34", "-1.20", "M3", "M-2". */
export function formatEval(cp: number | null, mate: number | null): string {
  if (mate != null) return mate > 0 ? `M${mate}` : `M${mate}`;
  if (cp == null) return "?";
  const s = (cp / 100).toFixed(2);
  return cp >= 0 ? `+${s}` : s;
}
