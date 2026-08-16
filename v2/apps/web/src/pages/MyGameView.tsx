// Analyzed game viewer. Route: /my-games/:id
//
// Board on the left, move list on the right with mistake markers.
// Click any move → board jumps. Sidebar shows the mistake explanation.

import { useMemo, useState } from "react";
import { Link, Navigate, useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board from "../components/Board";
import { api } from "../lib/api";
import { myGamesApi, type PlyAnalysis } from "../lib/my-games-api";

const TAG_LABEL: Record<string, string> = {
  missed_mate:        "Missed mate",
  hung_piece:         "Hung piece",
  missed_capture:     "Missed capture",
  missed_knight_fork: "Missed knight fork",
  missed_check:       "Missed check",
  missed_promotion:   "Missed promotion",
  opening_deviation:  "Opening deviation",
  positional:         "Positional",
};

const SEVERITY_STYLES: Record<string, string> = {
  blunder:     "bg-rose-500/20 text-rose-200 border-rose-500/40",
  mistake:     "bg-amber-500/20 text-amber-200 border-amber-500/40",
  inaccuracy:  "bg-ink-800 text-ink-300 border-ink-600",
};

const SEVERITY_MARK: Record<string, string> = {
  blunder:    "??",
  mistake:    "?",
  inaccuracy: "?!",
};

export default function MyGameViewPage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const q = useQuery({
    queryKey: ["my-game", id],
    queryFn: () => myGamesApi.get(id),
    enabled: !!auth?.loggedIn && !!id,
    refetchInterval: (data: any) => data?.game?.status === "analyzing" || data?.game?.status === "queued" ? 5000 : false,
  });

  const remove = useMutation({
    mutationFn: () => myGamesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-games"] }); nav("/my-games"); },
  });

  const [selectedPly, setSelectedPly] = useState<number>(0); // 0 = starting position

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/my-games/${encodeURIComponent(id)}`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-5xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-5xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || "not found")}</div>
    <Link to="/my-games" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← My Games</Link>
  </div>;

  const { game, analysis } = q.data;
  const plies: PlyAnalysis[] = analysis?.plies ?? [];

  const currentPly = plies.find((p) => p.ply === selectedPly);
  const fen = currentPly ? currentPly.fenAfter : (plies[0]?.fenBefore || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const lastMove: [Key, Key] | undefined = currentPly ? [currentPly.uci.slice(0, 2) as Key, currentPly.uci.slice(2, 4) as Key] : undefined;

  // Show best-move arrow when a mistake is selected
  const shapes: DrawShape[] = useMemo(() => {
    if (!currentPly || !currentPly.isMistake || !currentPly.bestUci) return [];
    return [{
      brush: "green" as any,
      orig: currentPly.bestUci.slice(0, 2) as Key,
      dest: currentPly.bestUci.slice(2, 4) as Key,
    }, {
      brush: "red" as any,
      orig: currentPly.uci.slice(0, 2) as Key,
      dest: currentPly.uci.slice(2, 4) as Key,
    }];
  }, [currentPly]);

  const orientation: "white" | "black" = game.ourColor === "black" ? "black" : "white";

  return (
    <div className="mx-auto max-w-6xl px-3 py-4">
      <Link to="/my-games" className="mb-2 inline-block text-xs text-ink-400 hover:text-ink-200">← My Games</Link>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-xl text-white">
          <b>{game.white}</b> vs <b>{game.black}</b> <span className="text-ink-500">— {game.result}</span>
        </h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${game.status === "done" ? "bg-emerald-500/20 text-emerald-200" : game.status === "analyzing" ? "bg-amber-500/20 text-amber-200 animate-pulse" : game.status === "failed" ? "bg-rose-500/20 text-rose-200" : "bg-ink-800 text-ink-400"}`}>
          {game.status}
        </span>
        {game.status === "failed" && game.error && <span className="text-xs text-rose-300">{game.error}</span>}
      </div>

      {game.status === "queued" && (
        <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Queued for analysis. Games are analyzed one at a time. This page will refresh automatically.
        </div>
      )}
      {game.status === "analyzing" && (
        <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Stockfish is analyzing your game (usually 1–2 minutes)…
        </div>
      )}

      {analysis && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <StatPill label="Blunders" value={analysis.mistakeCounts.blunder} color="rose" />
          <StatPill label="Mistakes" value={analysis.mistakeCounts.mistake} color="amber" />
          <StatPill label="Inaccuracies" value={analysis.mistakeCounts.inaccuracy} color="ink" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,540px)_1fr]">
        <div>
          <Board fen={fen} orientation={orientation} viewOnly lastMove={lastMove} shapes={shapes} />
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            <button onClick={() => setSelectedPly(0)}
              className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800">⏮</button>
            <button onClick={() => setSelectedPly(Math.max(0, selectedPly - 1))}
              className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800">◀</button>
            <button onClick={() => setSelectedPly(Math.min(plies.length, selectedPly + 1))}
              className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800">▶</button>
            <button onClick={() => setSelectedPly(plies.length)}
              className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800">⏭</button>
            <div className="ml-3 text-ink-400">move {selectedPly}/{plies.length}</div>
          </div>

          {/* Selected move details */}
          {currentPly && (
            <div className={`mt-3 rounded-xl border p-3 text-sm ${currentPly.isMistake && currentPly.severity ? SEVERITY_STYLES[currentPly.severity] : "border-ink-700 bg-ink-900 text-ink-200"}`}>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-white">{Math.ceil(currentPly.ply / 2)}{currentPly.ply % 2 === 1 ? "." : "..."} {currentPly.san}</span>
                {currentPly.severity && <span className="font-bold">{SEVERITY_MARK[currentPly.severity]}</span>}
                <span className="ml-auto font-mono">{formatCp(currentPly.cpAfter)}</span>
              </div>
              {currentPly.isMistake && (
                <div className="mt-2 space-y-1">
                  {currentPly.tag && (
                    <div className="text-xs">
                      <b>{TAG_LABEL[currentPly.tag] || currentPly.tag}</b>
                      {currentPly.explanation && <span className="ml-1 opacity-80">— {currentPly.explanation}</span>}
                    </div>
                  )}
                  {currentPly.bestSan && (
                    <div className="text-xs">
                      Best: <span className="font-mono">{currentPly.bestSan}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Move list */}
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</div>
          {plies.length === 0 ? (
            <div className="text-xs text-ink-500">
              {game.status === "done" ? "This game has no analyzed moves." : "Waiting for analysis…"}
            </div>
          ) : (
            <MoveList plies={plies} selected={selectedPly} onClick={setSelectedPly} />
          )}
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between">
        <div className="text-xs text-rose-200">Delete this game + its analysis.</div>
        <button onClick={() => { if (confirm("Delete this game and its analysis?")) remove.mutate(); }}
          className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20">
          Delete
        </button>
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: "rose" | "amber" | "ink" }) {
  const cls = color === "rose" ? "bg-rose-500/20 text-rose-200" : color === "amber" ? "bg-amber-500/20 text-amber-200" : "bg-ink-800 text-ink-300";
  return <div className={`rounded-full px-3 py-1 ${cls}`}>{label}: <b>{value}</b></div>;
}

function formatCp(cp: number): string {
  if (cp > 90000) return `#${100000 - cp}`;
  if (cp < -90000) return `#-${100000 + cp}`;
  return (cp / 100).toFixed(2);
}

function MoveList({ plies, selected, onClick }: { plies: PlyAnalysis[]; selected: number; onClick: (ply: number) => void }) {
  // Group as move-pairs: [white, black?]
  const rows: { moveNum: number; white?: PlyAnalysis; black?: PlyAnalysis }[] = [];
  for (const p of plies) {
    const moveNum = Math.ceil(p.ply / 2);
    let row = rows[rows.length - 1];
    if (!row || row.moveNum !== moveNum) {
      row = { moveNum };
      rows.push(row);
    }
    if (p.ply % 2 === 1) row.white = p; else row.black = p;
  }
  return (
    <div className="text-sm">
      {rows.map((r) => (
        <div key={r.moveNum} className="flex items-baseline gap-2 py-0.5">
          <span className="w-8 text-right text-xs text-ink-500">{r.moveNum}.</span>
          <MoveBtn p={r.white} selected={selected} onClick={onClick} />
          <MoveBtn p={r.black} selected={selected} onClick={onClick} />
        </div>
      ))}
    </div>
  );
}

function MoveBtn({ p, selected, onClick }: { p?: PlyAnalysis; selected: number; onClick: (ply: number) => void }) {
  if (!p) return <span className="w-16" />;
  const mark = p.severity ? SEVERITY_MARK[p.severity] : "";
  const cls = selected === p.ply
    ? "bg-brand-600 text-white"
    : p.isMistake
      ? (p.severity === "blunder" ? "text-rose-300 hover:bg-rose-500/10"
        : p.severity === "mistake" ? "text-amber-300 hover:bg-amber-500/10"
        : "text-ink-300 hover:bg-ink-800")
      : "text-ink-100 hover:bg-ink-800";
  return (
    <button onClick={() => onClick(p.ply)} className={`rounded px-1.5 py-0.5 font-mono ${cls}`}>
      {p.san}{mark && <sup className="ml-0.5">{mark}</sup>}
    </button>
  );
}
