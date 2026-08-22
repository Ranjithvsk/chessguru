// Modal chess game viewer used by PublicResultsDetail. Given a tournament id +
// round + board, fetches the PGN and lets the visitor step through the moves
// with a chessground board on the left + move list on the right.
//
// chess.js parses SAN into positions; chessground renders + provides arrow /
// square highlights. We build the whole move ply array upfront (SPA is tiny —
// no need to lazy-load moves).

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import { get } from "../lib/api";

interface Game {
  pgn: string;
  headers: Record<string, string>;
  white_rank: number;
  black_rank: number;
}

interface Props {
  tournamentId: string;
  round: number;
  board: number;
  whiteName: string;
  blackName: string;
  onClose: () => void;
}

export default function GameViewer({ tournamentId, round, board, whiteName, blackName, onClose }: Props) {
  const boardEl = useRef<HTMLDivElement>(null);
  const cgRef = useRef<any>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ply, setPly] = useState(0);

  useEffect(() => {
    let live = true;
    get<Game & { error?: string }>(`/api/results/tournaments/${tournamentId}/games/${round}/${board}`)
      .then((r) => { if (!live) return; if ((r as any).error) setErr((r as any).error); else setGame(r); })
      .catch(() => live && setErr("Failed to load game"));
    return () => { live = false; };
  }, [tournamentId, round, board]);

  // Parse PGN → array of FENs (one per ply, starting from initial position).
  const positions = useMemo(() => {
    if (!game) return [] as { fen: string; san?: string; from?: string; to?: string }[];
    const c = new Chess();
    try { c.loadPgn(game.pgn); } catch { return []; }
    const history = c.history({ verbose: true });
    // Replay to build FENs per ply
    const c2 = new Chess();
    const out: { fen: string; san?: string; from?: string; to?: string }[] = [{ fen: c2.fen() }];
    for (const mv of history) {
      c2.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      out.push({ fen: c2.fen(), san: mv.san, from: mv.from, to: mv.to });
    }
    return out;
  }, [game]);

  // Init chessground once, then update on ply change
  useEffect(() => {
    if (!boardEl.current || cgRef.current || positions.length === 0) return;
    cgRef.current = Chessground(boardEl.current, {
      fen: positions[0]!.fen,
      orientation: "white",
      viewOnly: true,
      coordinates: true,
    });
  }, [positions.length]);

  useEffect(() => {
    if (!cgRef.current || positions.length === 0) return;
    const pos = positions[Math.min(ply, positions.length - 1)]!;
    cgRef.current.set({ fen: pos.fen, lastMove: pos.from && pos.to ? [pos.from as any, pos.to as any] : undefined });
  }, [ply, positions]);

  // Cleanup
  useEffect(() => () => { cgRef.current?.destroy?.(); cgRef.current = null; }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPly((p) => Math.min(positions.length - 1, p + 1));
      else if (e.key === "Home") setPly(0);
      else if (e.key === "End") setPly(positions.length - 1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [positions.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="flex w-full max-w-5xl flex-col gap-4 rounded-3xl border border-ink-700 bg-ink-950 p-6 shadow-2xl md:flex-row">
        <div className="flex-shrink-0">
          <div className="mb-2 text-center text-sm font-semibold text-white">{blackName}</div>
          <div ref={boardEl} style={{ width: "min(80vh, 480px)", height: "min(80vh, 480px)" }} />
          <div className="mt-2 text-center text-sm font-semibold text-white">{whiteName}</div>
        </div>
        <div className="flex min-w-[280px] flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-ink-700 pb-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-brand-400">Round {round} · Board {board}</div>
              <div className="mt-0.5 text-sm text-ink-400">{game?.headers?.Result || (err ? "—" : "loading…")}</div>
            </div>
            <button onClick={onClose} className="text-2xl leading-none text-ink-400 hover:text-white">×</button>
          </div>
          {err ? (
            <div className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</div>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => setPly(0)} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs hover:bg-ink-800">⏮</button>
                <button onClick={() => setPly((p) => Math.max(0, p - 1))} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs hover:bg-ink-800">◀</button>
                <div className="flex-1 text-center text-xs text-ink-400">{ply} / {Math.max(0, positions.length - 1)}</div>
                <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs hover:bg-ink-800">▶</button>
                <button onClick={() => setPly(positions.length - 1)} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs hover:bg-ink-800">⏭</button>
              </div>
              <div className="mt-3 h-72 flex-1 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900/40 p-3 font-mono text-sm md:h-auto">
                {positions.slice(1).map((p, i) => {
                  const moveNo = Math.floor(i / 2) + 1;
                  const isWhite = i % 2 === 0;
                  const active = i + 1 === ply;
                  return (
                    <button key={i} onClick={() => setPly(i + 1)}
                            className={`mr-2 inline-block rounded px-1.5 py-0.5 hover:bg-ink-800 ${active ? "bg-brand-500 text-white" : "text-ink-300"}`}>
                      {isWhite ? <span className="mr-1 text-ink-500">{moveNo}.</span> : null}{p.san}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 text-[11px] text-ink-500">
                Keyboard: ← → step · Home/End jump · Esc close
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
