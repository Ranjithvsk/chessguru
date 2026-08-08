// Single-game viewer for a Lichess broadcast game. Route: /broadcasts/:id
//
// Renders board + step-through of the mainline SANs, plus the game header
// (event / date / players / result) and the full move list on the side.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Key } from "chessground/types";
import { Chess } from "chess.js";
import { useQuery } from "@tanstack/react-query";
import Board from "../components/Board";
import { broadcastOne } from "../lib/api";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function BroadcastGamePage() {
  const { id = "" } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["broadcast", id],
    queryFn: () => broadcastOne(id),
    enabled: !!id,
  });

  const g = data && "found" in data && data.found ? data : null;

  // Replay all moves once (chess.js) to build a per-ply FEN + from/to list.
  const { positions, fromTo, moves } = useMemo(() => {
    if (!g?.moves) return { positions: [START_FEN], fromTo: [] as Array<[Key, Key]>, moves: [] as string[] };
    const chess = new Chess();
    const p: string[] = [chess.fen()];
    const ft: Array<[Key, Key]> = [];
    const played: string[] = [];
    for (const san of g.moves) {
      try {
        const mv = chess.move(san);
        if (mv) { played.push(mv.san); p.push(chess.fen()); ft.push([mv.from as Key, mv.to as Key]); }
      } catch { break; }
    }
    return { positions: p, fromTo: ft, moves: played };
  }, [g?.moves]);

  const [ply, setPly] = useState(0);
  useEffect(() => setPly(0), [id]);

  // Keyboard nav (← → step, Home/End jump).
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
  if (!g) {
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center">
        <p className="text-sm text-ink-400">Game not found.</p>
        <Link to="/broadcasts" className="mt-3 inline-block text-sm text-brand-400 hover:underline">← All broadcasts</Link>
      </div>
    );
  }

  const cur = Math.max(0, Math.min(ply, positions.length - 1));
  const lastMove: [Key, Key] | undefined = cur > 0 ? fromTo[cur - 1] : undefined;
  const resultBadge = g.result === "1-0" ? "text-emerald-400" : g.result === "0-1" ? "text-rose-400" : "text-ink-400";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link to="/broadcasts" className="text-xs text-ink-500 hover:text-ink-300">← All broadcasts</Link>

      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
        <div className="text-[11px] uppercase tracking-wide text-ink-500">{g.event} · {g.round} · {g.date}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="text-lg font-bold text-white">{g.white}</span>
          <span className="text-xs tabular-nums text-ink-400">{g.whiteElo || "—"}</span>
          <span className={`font-mono ${resultBadge}`}>{g.result === "1/2-1/2" ? "½–½" : g.result}</span>
          <span className="text-xs tabular-nums text-ink-400">{g.blackElo || "—"}</span>
          <span className="text-lg font-bold text-white">{g.black}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Board + stepper */}
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
            <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} disabled={cur >= positions.length - 1}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40">▶</button>
            <button onClick={() => setPly(positions.length - 1)} disabled={cur >= positions.length - 1}
              className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-40">⏭</button>
          </div>
          <p className="mt-1 text-[10px] text-ink-500">keys: ← → step · Home/End jump</p>
        </div>

        {/* Move list */}
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-500">Mainline · {moves.length} plies</div>
          <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs">
            {moves.map((san, i) => {
              const moveNo = Math.floor(i / 2) + 1;
              const isWhite = i % 2 === 0;
              const active = cur === i + 1;
              return (
                <button key={i} onClick={() => setPly(i + 1)}
                  className={`rounded px-1 py-0.5 ${active ? "bg-yellow-400/25 font-bold text-white" : "text-ink-300 hover:bg-ink-800"}`}>
                  {isWhite ? `${moveNo}.` : ""}{san}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
