// Replay of one finished online game: the class-room board + notation table,
// server clocks per ply, keyboard and autoplay, PGN copy, jump into the
// board editor. Owner-only (the API refuses anyone else's game).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import MoveTable from "../components/MoveTable";
import { liveGames, type LiveGameFull } from "../lib/api";
import { OUTCOME_META, SPEED_META, avatarGradient, fmtDuration, tcLabel } from "./PlayHistory";

const fmtClock = (ms: number) => {
  const t = Math.max(0, ms);
  const s = Math.ceil(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const SPEEDS = [
  { label: "0.5×", ms: 2000 },
  { label: "1×", ms: 1000 },
  { label: "2×", ms: 500 },
  { label: "4×", ms: 250 },
];

export default function PlayGameReplayPage() {
  const { id = "" } = useParams();
  const [game, setGame] = useState<LiveGameFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const plyRef = useRef(0);
  plyRef.current = ply;

  useEffect(() => {
    let cancelled = false;
    liveGames.get(id)
      .then((g) => { if (cancelled) return; setGame(g); setPly(g.moves.length); })
      .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, [id]);

  const n = game?.moves.length ?? 0;
  const go = (p: number) => setPly(Math.max(0, Math.min(n, p)));

  // Keyboard: ← → step, Home/End jump, space play/pause, f flip.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(plyRef.current - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(plyRef.current + 1); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(n); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key.toLowerCase() === "f") setFlipped((f) => !f);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  // Autoplay.
  useEffect(() => {
    if (!playing) return;
    if (plyRef.current >= n) { setPlaying(false); return; }
    const t = setInterval(() => {
      if (plyRef.current >= n) { setPlaying(false); return; }
      setPly((p) => Math.min(n, p + 1));
    }, SPEEDS[speedIdx]!.ms);
    return () => clearInterval(t);
  }, [playing, speedIdx, n]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const fen = game?.fens[ply] ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    const uci = game?.moves[ply - 1];
    return uci ? [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] : undefined;
  }, [game, ply]);
  const orientation: "white" | "black" = game ? (flipped ? (game.myColor === "white" ? "black" : "white") : game.myColor) : "white";
  const top = orientation === "white" ? "black" : "white";
  const clock = game?.clocks[ply] ?? { white: 0, black: 0 };
  const turn = fen.split(" ")[1] === "b" ? "black" : "white";

  const thinkStats = useMemo(() => {
    if (!game) return null;
    const mine: number[] = [], theirs: number[] = [];
    game.moveTimes.forEach((t, i) => {
      const mover = i % 2 === 0 ? "white" : "black";
      (mover === game.myColor ? mine : theirs).push(t);
    });
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return { mine: avg(mine), theirs: avg(theirs), longestMine: Math.max(0, ...mine), longestTheirs: Math.max(0, ...theirs) };
  }, [game]);

  if (err) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl2 border border-rose-500/40 bg-rose-500/10 p-6 text-center">
        <div className="font-display text-xl text-white">Could not open this game</div>
        <div className="mt-1 text-sm text-rose-200">{err}</div>
        <Link to="/play/history" className="mt-4 inline-block rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800">← Back to my games</Link>
      </div>
    );
  }
  if (!game) return <div className="mx-auto h-[60vh] max-w-5xl animate-pulse rounded-xl2 bg-ink-900/60" />;

  const om = OUTCOME_META[game.outcome];
  const sm = SPEED_META[game.speed];
  const nameOf = (c: "white" | "black") => game.players[c].name;
  const isMe = (c: "white" | "black") => c === game.myColor;
  const PlayerBar = ({ color }: { color: "white" | "black" }) => (
    <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${turn === color && ply < n ? "bg-ink-800/80" : "bg-ink-900/40"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br ${isMe(color) ? "from-brand-400 to-brand-700" : avatarGradient(nameOf(color))} text-xs font-bold text-white`}>{nameOf(color).slice(0, 1).toUpperCase()}</span>
        <span className="truncate text-sm text-white">{color === "white" ? "♔" : "♚"} {nameOf(color)}{isMe(color) && <span className="ml-1 text-xs text-brand-200">(you)</span>}</span>
        {game.rating && <span className="text-xs text-ink-400">{Math.round(game.rating[color].before)}</span>}
      </div>
      <span className={`rounded bg-ink-950/80 px-2 py-0.5 font-mono text-sm ${turn === color && ply < n ? "text-white" : "text-ink-300"}`}>{fmtClock(clock[color])}</span>
    </div>
  );

  const copyPgn = async () => {
    try { await navigator.clipboard.writeText(game.pgn); setToast("PGN copied"); }
    catch { window.prompt("Copy the PGN:", game.pgn); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4" data-testid="game-replay">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/play/history" className="text-sm text-ink-300 hover:text-white">← My games</Link>
        <div className="text-xs text-ink-500">Keyboard: ← → step · Home/End jump · space play · f flip</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
        {/* Board column — same board as the class room, read-only */}
        <div className="space-y-2">
          <PlayerBar color={top} />
          <Board fen={fen} orientation={orientation} lastMove={lastMove} check={game.checks[ply] ?? false} viewOnly coordinates />
          <PlayerBar color={orientation} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900 px-2 py-1 shadow" data-testid="replay-controls">
              <button onClick={() => go(0)} disabled={ply === 0} title="Start (Home)" className="rounded-md px-2 py-0.5 text-sm text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30">⏮</button>
              <button onClick={() => go(ply - 1)} disabled={ply === 0} title="Previous (←)" className="rounded-md px-2 py-0.5 text-sm text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30">←</button>
              <button onClick={() => setPlaying((p) => !p)} disabled={ply >= n && !playing} title="Play / pause (space)" className={`rounded-md px-2.5 py-0.5 text-sm transition disabled:opacity-30 ${playing ? "bg-brand-600 text-white" : "text-white hover:bg-ink-800"}`}>{playing ? "⏸" : "▶"}</button>
              <span className="px-1 font-mono text-[11px] tabular-nums text-ink-400" data-testid="ply-label">{ply === 0 ? "start" : `${ply} / ${n}`}</span>
              <button onClick={() => go(ply + 1)} disabled={ply >= n} title="Next (→)" className="rounded-md px-2 py-0.5 text-sm text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30">→</button>
              <button onClick={() => go(n)} disabled={ply >= n} title="End (End)" className="rounded-md px-2 py-0.5 text-sm text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30">⏭</button>
            </div>
            <div className="flex items-center gap-1">
              <div className="inline-flex rounded-full border border-ink-700 bg-ink-900 p-0.5 text-[11px]">
                {SPEEDS.map((s, i) => (
                  <button key={s.label} onClick={() => setSpeedIdx(i)} className={`rounded-full px-2 py-0.5 ${speedIdx === i ? "bg-ink-700 text-white" : "text-ink-400 hover:text-white"}`}>{s.label}</button>
                ))}
              </div>
              <button onClick={() => setFlipped((f) => !f)} title="Flip board (f)" className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-1 text-sm text-ink-200 hover:bg-ink-800">🔄</button>
            </div>
          </div>
        </div>

        {/* Right column — result + notation + actions */}
        <div className="space-y-3">
          <div className={`relative overflow-hidden rounded-xl2 border p-4 ${game.outcome === "win" ? "border-emerald-400/40 bg-gradient-to-br from-emerald-500/20 via-ink-900 to-ink-900" : game.outcome === "loss" ? "border-rose-400/40 bg-gradient-to-br from-rose-500/20 via-ink-900 to-ink-900" : "border-ink-500/40 bg-gradient-to-br from-ink-700/40 via-ink-900 to-ink-900"}`} data-testid="result-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${om.badge}`}>{om.label}</span>
                <div className="mt-2 font-display text-2xl text-white">{game.reasonText}</div>
                <div className="mt-1 text-sm text-ink-300">
                  {sm.emoji} {sm.label} {tcLabel(game.timeControl)} · {game.rated ? "rated" : "casual"} · {Math.ceil(n / 2)} moves · {fmtDuration(game.durationMs)}
                </div>
                <div className="text-xs text-ink-500">{new Date(game.startedAt).toLocaleString()}</div>
              </div>
              {game.ratingDiff !== null && game.ratingBefore !== null && game.ratingAfter !== null && (
                <div className="rounded-xl bg-ink-950/60 px-4 py-2 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-ink-400">Your rating</div>
                  <div className="font-mono text-sm text-ink-300">{game.ratingBefore} → <span className="text-white">{game.ratingAfter}</span></div>
                  <div className={`font-display text-2xl ${game.ratingDiff >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{game.ratingDiff >= 0 ? "+" : ""}{game.ratingDiff}</div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl2 border border-ink-700 bg-ink-900">
            <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
              <span className="text-xs uppercase tracking-wide text-ink-400">Moves</span>
              <span className="text-[11px] text-ink-500">bars = thinking time</span>
            </div>
            <MoveTable sans={game.sans} ply={ply} onPick={go} moveTimes={game.moveTimes} className="max-h-[22rem] p-2" />
          </div>

          {thinkStats && n > 0 && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl border border-ink-700/70 bg-ink-900/70 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-400">Your thinking</div>
                <div className="font-display text-lg text-white">{(thinkStats.mine / 1000).toFixed(1)}s <span className="text-xs text-ink-400">avg</span></div>
                <div className="text-[11px] text-ink-400">longest {fmtDuration(thinkStats.longestMine)}</div>
              </div>
              <div className="rounded-xl border border-ink-700/70 bg-ink-900/70 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-400">{game.opponent.name}</div>
                <div className="font-display text-lg text-white">{(thinkStats.theirs / 1000).toFixed(1)}s <span className="text-xs text-ink-400">avg</span></div>
                <div className="text-[11px] text-ink-400">longest {fmtDuration(thinkStats.longestTheirs)}</div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={copyPgn} className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">📋 Copy PGN</button>
            <Link to={`/board-editor?fen=${encodeURIComponent(fen)}`} className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">🔍 Analyse this position</Link>
            <Link to="/play" className="ml-auto rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">♟️ Play again</Link>
          </div>
        </div>
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-ink-950 shadow-lg">{toast}</div>}
    </div>
  );
}
