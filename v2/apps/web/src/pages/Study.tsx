import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";
import { createEngine, type Engine } from "../lib/engine";

type Piece = "Q" | "R";
const STUDIES: { piece: Piece; label: string; icon: string; sub: string }[] = [
  { piece: "Q", label: "Queen Mate", icon: "♛", sub: "King + Queen vs King" },
  { piece: "R", label: "Rook Mate", icon: "♜", sub: "King + Rook vs King" },
];

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

/** Random legal King+piece-vs-King position; White (K + Q/R) to move, not terminal. */
function randomMate(piece: Piece): string {
  for (let i = 0; i < 1000; i++) {
    const wk = rsq(), bk = rsq(), wp = rsq();
    if (new Set([wk, bk, wp]).size !== 3) continue;
    if (adjacent(wk, bk)) continue;
    const place = { [wk]: "K", [wp]: piece, [bk]: "k" } as Record<string, string>;
    try {
      const c = new Chess(toFen(place, "w"));
      if (c.isGameOver() || c.isCheck()) continue;
      if (new Chess(toFen(place, "b")).isCheck()) continue;
      return toFen(place, "w");
    } catch { continue; }
  }
  return piece === "Q" ? "4k3/8/8/8/8/8/3Q4/4K3 w - - 0 1" : "4k3/8/8/8/8/8/3R4/4K3 w - - 0 1";
}

type Status = { kind: "play" | "think" | "win" | "draw"; msg: string };

export default function StudyPage() {
  const game = useRef(new Chess());
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [study, setStudy] = useState<Piece>("Q");
  const [fen, setFen] = useState("8/8/8/8/8/8/8/8 w - - 0 1");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [status, setStatus] = useState<Status>({ kind: "play", msg: "Loading engine…" });
  const [thinking, setThinking] = useState(false);
  const [, force] = useState(0);

  const newPosition = useCallback((piece: Piece) => {
    const f = randomMate(piece);
    game.current = new Chess(f);
    setFen(f); setLastMove(undefined); setThinking(false);
    setStatus({ kind: "play", msg: "Your move — drive the king to the edge and checkmate." });
  }, []);

  useEffect(() => {
    const e = createEngine(); engine.current = e;
    e.ready.then(() => setReady(true)).catch(() => setReady(true));
    newPosition("Q");
    return () => e.quit();
  }, [newPosition]);

  const selectStudy = (p: Piece) => { setStudy(p); newPosition(p); };

  const moveNo = () => Math.ceil(game.current.history().length / 2);
  const finished = (): boolean => {
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
    try { best = await engine.current!.bestMove(game.current.fen(), 400); } catch { /* engine stalled */ }
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

  const over = game.current.isGameOver();
  const myTurn = ready && !thinking && !over && game.current.turn() === "w";
  const dests = useMemo(() => (myTurn ? destsFromChess(game.current as never) : new Map()), [fen, myTurn]);
  const tone = { play: "text-ink-200", think: "text-gold-400", win: "text-accent-400", draw: "text-rose-400" }[status.kind];
  const cur = STUDIES.find((s) => s.piece === study)!;

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
        <div className="flex gap-2">
          {STUDIES.map((st) => (
            <button key={st.piece} onClick={() => selectStudy(st.piece)} disabled={!ready}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${study === st.piece ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
              {st.icon} {st.label}
            </button>
          ))}
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-gradient text-2xl text-white">{cur.icon}</span>
            <div>
              <h1 className="font-display text-xl text-white">{cur.label}</h1>
              <p className="text-sm text-ink-400">{cur.sub}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-400">
            You play <b className="text-white">White</b>. Checkmate the lone king — Stockfish defends
            at full strength. Don&apos;t stalemate!
          </p>
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className={`text-base font-semibold ${tone}`}>{status.msg}</div>
          <div className="mt-1 text-xs text-ink-500">Move {moveNo()} · {ready ? "engine ready" : "loading engine…"}</div>
          {(status.kind === "win" || status.kind === "draw") && (
            <button onClick={() => newPosition(study)} className="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">
              New position &rarr;
            </button>
          )}
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <button onClick={() => newPosition(study)} disabled={!ready}
            className="w-full rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-50">
            ↻ New position
          </button>
          <p className="mt-3 text-xs text-ink-500">Box the king in with your piece, march your own king up, and watch for stalemate.</p>
        </div>
      </aside>
    </div>
  );
}
