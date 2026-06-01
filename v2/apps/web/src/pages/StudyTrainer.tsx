import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";
import { createEngine, type Engine } from "../lib/engine";
import { studyById } from "../lib/studies";

const FILES = "abcdefgh";
const rsq = () => FILES[Math.floor(Math.random() * 8)]! + (Math.floor(Math.random() * 8) + 1);
const adjacent = (a: string, b: string) =>
  Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) <= 1 && Math.abs(Number(a.slice(1)) - Number(b.slice(1))) <= 1;

function toFen(place: Record<string, string>, turn: "w" | "b") {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = place[FILES[f]! + r];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${turn} - - 0 1`;
}

const sqColor = (sqr: string) => ((sqr.charCodeAt(0) - 97) + Number(sqr.slice(1))) % 2;

function randomMate(pieces: string[]): string {
  for (let i = 0; i < 6000; i++) {
    const used = new Set<string>();
    const wk = rsq(); used.add(wk);
    const bk = rsq();
    if (used.has(bk) || adjacent(wk, bk)) continue;
    used.add(bk);
    const place: Record<string, string> = { [wk]: "K", [bk]: "k" };
    const twoBishops = pieces.filter((p) => p === "B").length >= 2;
    const bishopColors = new Set<number>();
    let ok = true;
    for (const p of pieces) {
      let sqr = "", tries = 0;
      do { sqr = rsq(); tries++; }
      while ((used.has(sqr) || (p === "B" && twoBishops && bishopColors.has(sqColor(sqr)))) && tries < 80);
      if (used.has(sqr)) { ok = false; break; }
      used.add(sqr); place[sqr] = p;
      if (p === "B") bishopColors.add(sqColor(sqr));
    }
    if (!ok) continue;
    try {
      const c = new Chess(toFen(place, "w"));
      if (c.isGameOver() || c.isCheck()) continue;
      if (new Chess(toFen(place, "b")).isCheck()) continue;
      return toFen(place, "w");
    } catch { continue; }
  }
  const fb: Record<string, string> = { e1: "K", e5: "k" };
  ["a1", "h1", "a2", "h2", "c1"].forEach((sp, i) => { if (pieces[i]) fb[sp] = pieces[i]!; });
  return toFen(fb, "w");
}

// White K + one piece vs black K + a passed pawn (rank 2-4, racing to promote).
function randomVsKP(piece: string): string {
  for (let i = 0; i < 3000; i++) {
    const wk = rsq(), wp = rsq(), bk = rsq();
    const bp = FILES[Math.floor(Math.random() * 8)]! + (2 + Math.floor(Math.random() * 3));
    if (new Set([wk, wp, bk, bp]).size !== 4) continue;
    if (adjacent(wk, bk)) continue;
    const place = { [wk]: "K", [wp]: piece, [bk]: "k", [bp]: "p" } as Record<string, string>;
    try {
      const c = new Chess(toFen(place, "w"));
      if (c.isGameOver() || c.isCheck()) continue;
      if (new Chess(toFen(place, "b")).isCheck()) continue;
      return toFen(place, "w");
    } catch { continue; }
  }
  return piece === "R" ? "8/8/8/8/4k3/8/3p4/3RK3 w - - 0 1" : "8/8/8/8/4k3/8/3p4/3QK3 w - - 0 1";
}

type Status = { kind: "play" | "think" | "win" | "draw"; msg: string };

export default function StudyTrainer() {
  const { id } = useParams();
  const def = studyById(id);
  const game = useRef(new Chess());
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [fen, setFen] = useState("8/8/8/8/8/8/8/8 w - - 0 1");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [status, setStatus] = useState<Status>({ kind: "play", msg: "Loading engine…" });
  const [thinking, setThinking] = useState(false);
  const [, force] = useState(0);

  const pieces = def?.pieces ?? ["Q"];
  const kind = def?.kind ?? "mate";
  const newPosition = useCallback(() => {
    const f = kind === "stopPawn" ? randomVsKP(pieces[0] ?? "Q") : randomMate(pieces);
    game.current = new Chess(f);
    setFen(f); setLastMove(undefined); setThinking(false);
    setStatus({ kind: "play", msg: "Your move — drive the king to the edge and checkmate." });
  }, [kind, pieces]);

  useEffect(() => {
    if (!def) return;
    const e = createEngine(); engine.current = e;
    e.ready.then(() => setReady(true)).catch(() => setReady(true));
    newPosition();
    return () => e.quit();
  }, [def, newPosition]);

  const moveNo = () => Math.ceil(game.current.history().length / 2);
  const finished = (): boolean => {
    if (kind === "stopPawn" && /[qrbn]/.test(game.current.fen().split(" ")[0] || "")) {
      setStatus({ kind: "draw", msg: "The pawn promoted! \u{1F62C} Tap New position ↻" }); return true;
    }
    if (game.current.isCheckmate()) { setStatus({ kind: "win", msg: `Checkmate! \u{1F389} Mated in ${moveNo()} moves.` }); return true; }
    if (game.current.isStalemate()) { setStatus({ kind: "draw", msg: "Stalemate — a draw. Tap New position ↻" }); return true; }
    if (game.current.isDraw()) { setStatus({ kind: "draw", msg: "Draw. Tap New position ↻" }); return true; }
    return false;
  };

  const onMove = useCallback(async (from: Key, to: Key) => {
    let mv: unknown = null;
    try { mv = game.current.move({ from, to, promotion: "q" }); } catch { mv = null; }
    if (!mv) { setFen(game.current.fen()); force((n) => n + 1); return; }
    setLastMove([from, to]); setFen(game.current.fen());
    if (finished()) return;
    setThinking(true); setStatus({ kind: "think", msg: "Stockfish is defending…" });
    let best = "";
    try { best = await engine.current!.bestMove(game.current.fen(), 400); } catch { /* */ }
    if (best && best !== "(none)" && best.length >= 4) {
      try {
        game.current.move({ from: best.slice(0, 2), to: best.slice(2, 4) });
        setLastMove([best.slice(0, 2) as Key, best.slice(2, 4) as Key]);
        setFen(game.current.fen());
      } catch { /* */ }
    }
    setThinking(false);
    if (!finished()) setStatus({ kind: "play", msg: "Your move." });
  }, []);

  if (!def) return <Navigate to="/study" replace />;

  const over = game.current.isGameOver();
  const myTurn = ready && !thinking && !over && game.current.turn() === "w";
  const dests = useMemo(() => (myTurn ? destsFromChess(game.current as never) : new Map()), [fen, myTurn]);
  const tone = { play: "text-ink-200", think: "text-gold-400", win: "text-accent-400", draw: "text-rose-400" }[status.kind];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section>
        <Board
          fen={fen} orientation="white" turnColor={game.current.turn() === "w" ? "white" : "black"}
          movableColor={myTurn ? "white" : undefined} dests={dests} lastMove={lastMove}
          check={game.current.isCheck()} onMove={onMove}
        />
      </section>
      <aside className="flex flex-col gap-4">
        <Link to="/study" className="text-sm text-ink-400 hover:text-white">← All studies</Link>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-gradient text-2xl text-white">{def.icon}</span>
            <div>
              <h1 className="font-display text-xl text-white">{def.title}</h1>
              <p className="text-sm text-ink-400">{def.blurb} · {def.mateIn}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-400">{def.detail}</p>
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className={`text-base font-semibold ${tone}`}>{status.msg}</div>
          <div className="mt-1 text-xs text-ink-500">Move {moveNo()} · {ready ? "engine ready" : "loading engine…"}</div>
          {(status.kind === "win" || status.kind === "draw") && (
            <button onClick={newPosition} className="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">New position →</button>
          )}
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <button onClick={newPosition} disabled={!ready}
            className="w-full rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-50">↻ New position</button>
          <p className="mt-3 text-xs text-ink-500">Box the king in, march your own king up, and watch for stalemate.</p>
        </div>
      </aside>
    </div>
  );
}
