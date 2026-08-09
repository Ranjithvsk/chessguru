// Viewer for one imported (Lichess/Chess.com) game. Parses the stored PGN
// with chess.js, walks the caller through positions with ◀/▶/⏮/⏭ + arrow keys.
// Mirrors the pattern used by BroadcastGame.tsx so we don't have two divergent
// PGN players in the codebase.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board from "../components/Board";

const BASE = import.meta.env.VITE_API_BASE ?? "";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface ExtGame {
  _id: string; source: "lichess"|"chesscom"; gameId: string; url?: string;
  played: string; white: string; black: string;
  whiteRating: number|null; blackRating: number|null;
  result: "1-0"|"0-1"|"1/2-1/2"; timeControl?: string|null; opening?: string|null;
  pgn?: string|null;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export default function ExternalGamePage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["ext-game", id],
    queryFn: () => get<ExtGame>(`/api/me/external-games/${encodeURIComponent(id)}`),
    enabled: !!id,
  });

  const { positions, fromTo, moves } = useMemo(() => {
    if (!data?.pgn) return { positions: [START_FEN], fromTo: [] as Array<[Key, Key]>, moves: [] as string[] };
    const chess = new Chess();
    try { chess.loadPgn(data.pgn); } catch { return { positions: [START_FEN], fromTo: [], moves: [] }; }
    const verbose = chess.history({ verbose: true });
    const c2 = new Chess();
    const p: string[] = [c2.fen()];
    const ft: Array<[Key, Key]> = [];
    const played: string[] = [];
    for (const m of verbose) {
      const mv = c2.move(m.san);
      if (!mv) break;
      p.push(c2.fen()); ft.push([mv.from as Key, mv.to as Key]); played.push(mv.san);
    }
    return { positions: p, fromTo: ft, moves: played };
  }, [data?.pgn]);

  const [ply, setPly] = useState(0);
  useEffect(() => setPly(0), [id]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); setPly((p) => Math.max(0, p - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setPly((p) => Math.min(positions.length - 1, p + 1)); }
      else if (e.key === "Home") { e.preventDefault(); setPly(0); }
      else if (e.key === "End")  { e.preventDefault(); setPly(positions.length - 1); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [positions.length]);

  if (isLoading) return <div className="py-16 text-center text-ink-400">Loading game…</div>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center">
        <p className="text-sm text-ink-400">Game not found (or not yours).</p>
        <Link to="/history" className="mt-3 inline-block text-sm text-brand-400 hover:underline">← My history</Link>
      </div>
    );
  }

  const cur = Math.max(0, Math.min(ply, positions.length - 1));
  const lastMove: [Key, Key] | undefined = cur > 0 ? fromTo[cur - 1] : undefined;
  const resultClass = data.result === "1-0" ? "text-emerald-300" : data.result === "0-1" ? "text-rose-300" : "text-ink-300";
  const platformBadge = data.source === "lichess" ? "♞ Lichess" : "♟ Chess.com";
  const platformCls = data.source === "lichess"
    ? "bg-brand-500/15 text-brand-100 border-brand-500/30"
    : "bg-emerald-500/10 text-emerald-200 border-emerald-500/30";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link to="/history?tab=external" className="text-xs text-ink-500 hover:text-ink-300">← My history · External games</Link>

      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-ink-500">
          <span className={`rounded border px-2 py-0.5 ${platformCls}`}>{platformBadge}</span>
          <span>{new Date(data.played).toLocaleString()}</span>
          {data.timeControl && <span>· {data.timeControl}</span>}
          {data.url && <a href={data.url} target="_blank" rel="noreferrer" className="ml-auto text-brand-300 underline">view original ↗</a>}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="text-lg font-bold text-white">{data.white}</span>
          <span className="text-xs tabular-nums text-ink-400">{data.whiteRating ?? "—"}</span>
          <span className={`font-mono ${resultClass}`}>{data.result === "1/2-1/2" ? "½–½" : data.result}</span>
          <span className="text-xs tabular-nums text-ink-400">{data.blackRating ?? "—"}</span>
          <span className="text-lg font-bold text-white">{data.black}</span>
        </div>
        {data.opening && <div className="mt-1 text-xs text-ink-400">Opening: {data.opening}</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="max-w-md">
            <Board fen={positions[cur]!} viewOnly coordinates lastMove={lastMove} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => setPly(0)} disabled={cur === 0}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40">⏮</button>
            <button onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={cur === 0}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40">◀</button>
            <span className="min-w-[110px] text-center text-xs font-medium text-ink-300">
              {cur === 0 ? "start" : `move ${Math.ceil(cur / 2)}${cur % 2 ? "…" : ""} · ply ${cur}/${moves.length}`}
            </span>
            <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} disabled={cur === positions.length - 1}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40">▶</button>
            <button onClick={() => setPly(positions.length - 1)} disabled={cur === positions.length - 1}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40">⏭</button>
            <span className="ml-auto text-[10px] text-ink-500">← → arrows</span>
          </div>
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Moves</div>
          <div className="flex max-h-[520px] flex-wrap gap-x-2 gap-y-1 overflow-y-auto text-sm">
            {moves.length === 0 && <p className="text-xs text-ink-500">No moves parsed from PGN.</p>}
            {moves.map((san, i) => {
              const isCurrent = cur === i + 1;
              const showNo = i % 2 === 0;
              return (
                <span key={i} className="flex items-baseline gap-1">
                  {showNo && <span className="text-[11px] tabular-nums text-ink-500">{Math.floor(i / 2) + 1}.</span>}
                  <button onClick={() => setPly(i + 1)}
                    className={`rounded px-1.5 py-0.5 font-mono ${isCurrent ? "bg-brand-500/30 text-white" : "text-ink-200 hover:bg-ink-800"}`}>
                    {san}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
