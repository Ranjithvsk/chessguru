import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";
import { createEngine, type Engine } from "../lib/engine";
import { studyById } from "../lib/studies";
import { studyPuzzle, studyMe, studyComplete } from "../lib/api";

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

// White K + one piece vs black K + N passed pawns (ranks 2-4, racing to promote).
function randomVsKP(piece: string, pawns = 1): string {
  const N = Math.max(1, Math.min(6, pawns));
  for (let i = 0; i < 5000; i++) {
    const wk = rsq(), wp = rsq(), bk = rsq();
    const used = new Set([wk, wp, bk]);
    if (used.size !== 3) continue;
    if (adjacent(wk, bk)) continue;
    const place = { [wk]: "K", [wp]: piece, [bk]: "k" } as Record<string, string>;
    // N black pawns, each on a distinct file (no doubled pawns), ranks 2-4.
    const files = [...FILES].sort(() => Math.random() - 0.5);
    let placed = 0;
    for (const f of files) {
      if (placed >= N) break;
      const sq = f + (2 + Math.floor(Math.random() * 3));
      if (used.has(sq)) continue;
      used.add(sq); place[sq] = "p"; placed++;
    }
    if (placed < N) continue;
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
  const STORE_KEY = `cg_study_${id ?? "x"}`;
  const PAWNS_KEY = `cg_study_${id ?? "x"}_pawns`;
  const game = useRef(new Chess());
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [fen, setFen] = useState("8/8/8/8/8/8/8/8 w - - 0 1");
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [status, setStatus] = useState<Status>({ kind: "play", msg: "Loading engine…" });
  const [thinking, setThinking] = useState(false);
  const [pawnCount, setPawnCount] = useState<number>(() => { try { return Number(localStorage.getItem(PAWNS_KEY)) || 1; } catch { return 1; } });
  const [, force] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [userRating, setUserRating] = useState<number>(1200);
  const [ratingDiff, setRatingDiff] = useState<number | null>(null);
  const userRatingRef = useRef(1200);
  const puzzleIdRef = useRef<string | null>(null);
  const reportedRef = useRef(false);
  const verdictRef = useRef<string | null>(null);

  const pieces = def?.pieces ?? ["Q"];
  const kind = def?.kind ?? "mate";
  const newPosition = useCallback(async () => {
    setThinking(false); setRatingDiff(null);
    // Prefer a RATED puzzle from the study DB at the player's level (matchmaking); else local generation.
    if (def && (kind === "mate" || kind === "stopPawn" || kind === "pawnEnd")) {
      try {
        const p = await studyPuzzle(def.id, userRatingRef.current, kind === "stopPawn" ? pawnCount : undefined);
        if (p && p.fen) {
          game.current = new Chess(p.fen);
          setFen(p.fen); setLastMove(undefined);
          setRating(p.rating); setVerdict(p.result); verdictRef.current = p.result;
          puzzleIdRef.current = p.id; reportedRef.current = false;
          setStatus({ kind: "play", msg: p.result === "draw" ? "Theoretical DRAW — can you hold it?" : kind === "pawnEnd" ? "Your move — promote a pawn, then checkmate." : "Your move — drive the king to the edge and checkmate." });
          try { localStorage.setItem(STORE_KEY, p.fen); localStorage.setItem(`${STORE_KEY}_meta`, JSON.stringify({ id: p.id, rating: p.rating, result: p.result })); } catch { /* */ }
          return;
        }
      } catch { /* fall through to local generation */ }
    }
    const PAWN_END_FALLBACK = ["4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "8/8/4k3/8/8/8/3KP3/8 w - - 0 1", "4k3/8/3K4/4P3/8/8/8/8 w - - 0 1"];
    const f = kind === "stopPawn" ? randomVsKP(pieces[0] ?? "Q", pawnCount)
      : kind === "pawnEnd" ? PAWN_END_FALLBACK[Math.floor(Math.random() * PAWN_END_FALLBACK.length)]!
      : randomMate(pieces);
    game.current = new Chess(f);
    setFen(f); setLastMove(undefined);
    setRating(null); setVerdict(null); verdictRef.current = null;
    puzzleIdRef.current = null; reportedRef.current = false;
    setStatus({ kind: "play", msg: kind === "pawnEnd" ? "Your move — promote a pawn, then checkmate." : "Your move — drive the king to the edge and checkmate." });
    try { localStorage.setItem(STORE_KEY, f); localStorage.removeItem(`${STORE_KEY}_meta`); } catch { /* */ }
  }, [kind, pieces, pawnCount, STORE_KEY, def]);

  // Resume the saved position on refresh (so it does NOT change), else make a new one.
  const resumeOrNew = useCallback(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch { /* */ }
    let meta: { id?: string; rating?: number; result?: string } | null = null;
    try { meta = JSON.parse(localStorage.getItem(`${STORE_KEY}_meta`) || "null"); } catch { /* */ }
    // A pre-rating saved position (no meta) on a DB-backed drill -> fetch a fresh RATED puzzle instead.
    if (saved && !meta && def && (def.kind === "mate" || def.kind === "stopPawn" || def.kind === "pawnEnd")) { void newPosition(); return; }
    if (saved) {
      try {
        game.current = new Chess(saved);
        setFen(saved); setLastMove(undefined); setThinking(false);
        if (meta) { setRating(meta.rating ?? null); setVerdict(meta.result ?? null); verdictRef.current = meta.result ?? null; puzzleIdRef.current = meta.id ?? null; reportedRef.current = false; }
        setStatus({ kind: "play", msg: "Your move \u2014 pick up where you left off." });
        return;
      } catch { /* fall through */ }
    }
    void newPosition();
  }, [newPosition, STORE_KEY, def]);

  useEffect(() => {
    if (!def) return;
    const e = createEngine(); engine.current = e;
    e.ready.then(() => setReady(true)).catch(() => setReady(true));
    if (def.kind === "mate" || def.kind === "stopPawn" || def.kind === "pawnEnd") {
      const RKEY = `cg_study_rating_${def.id}`;
      let lr = 1200; try { lr = Number(localStorage.getItem(RKEY)) || 1200; } catch { /* */ }
      setUserRating(lr); userRatingRef.current = lr;
      studyMe(def.id).then((m) => { if (m && typeof m.rating === "number") { setUserRating(m.rating); userRatingRef.current = m.rating; try { localStorage.setItem(RKEY, String(m.rating)); } catch { /* */ } } }).catch(() => { /* */ });
    }
    resumeOrNew();
    return () => e.quit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  useEffect(() => { try { localStorage.setItem(PAWNS_KEY, String(pawnCount)); } catch { /* */ } }, [pawnCount, PAWNS_KEY]);

  // Regenerate the position when the pawn count changes (engine stays up).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    newPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pawnCount]);

  const reportResult = useCallback((win: boolean) => {
    if (reportedRef.current || !puzzleIdRef.current) return;
    reportedRef.current = true;
    studyComplete(puzzleIdRef.current, win, userRatingRef.current)
      .then((res) => {
        if (res && typeof res.rating === "number") {
          setUserRating(res.rating); userRatingRef.current = res.rating;
          setRatingDiff(typeof res.ratingDiff === "number" ? res.ratingDiff : null);
          try { localStorage.setItem(`cg_study_rating_${def?.id ?? "x"}`, String(res.rating)); } catch { /* */ }
        }
      })
      .catch(() => { /* offline / non-critical */ });
  }, [def]);

  const moveNo = () => Math.ceil(game.current.history().length / 2);
  const finished = (): boolean => {
    if (game.current.isCheckmate()) {
      if (game.current.turn() === "w") { setStatus({ kind: "draw", msg: "You got checkmated \u{1F62C} Tap New position ↻" }); reportResult(false); }
      else { setStatus({ kind: "win", msg: `Checkmate! \u{1F389} Mated in ${moveNo()} moves.` }); reportResult(true); }
      return true;
    }
    if (game.current.isStalemate() || game.current.isDraw()) {
      const held = verdictRef.current === "draw";          // a theoretical-draw position: surviving to a draw = success
      setStatus(held
        ? { kind: "win", msg: "Draw secured! \u{1F389} You held the theoretical draw \u2014 that is the win here." }
        : { kind: "draw", msg: "Draw \u2014 but this one was winnable. Tap New position ↻" });
      reportResult(held);
      return true;
    }
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
        game.current.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: (best[4] as "q" | "r" | "b" | "n") || "q" });
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
          {rating != null && (
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-300">★ Rating {rating}</span>
              {verdict && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${verdict === "draw" ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                  {verdict === "draw" ? "DRAW — hold it" : "WIN — find the mate"}
                </span>
              )}
            </div>
          )}
        </div>
        {kind === "stopPawn" && (
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Number of pawns</div>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} onClick={() => setPawnCount(n)} disabled={!ready}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${pawnCount === n ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"} disabled:opacity-50`}>
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-500">Capture or blockade every pawn, then checkmate. If a pawn promotes you can still try to win the new queen — only a real draw or getting mated ends it.</p>
          </div>
        )}
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className={`text-base font-semibold ${tone}`}>{status.msg}</div>
          <div className="mt-1 text-xs text-ink-500">Move {moveNo()} · {ready ? "engine ready" : "loading engine…"}</div>
          {(kind === "mate" || kind === "stopPawn" || kind === "pawnEnd") && (
            <div className="mt-2 text-sm text-ink-300">Your rating: <span className="font-semibold text-white">{userRating}</span>{ratingDiff != null && <span className={ratingDiff >= 0 ? "text-emerald-400" : "text-rose-400"}> {ratingDiff >= 0 ? "+" : ""}{ratingDiff}</span>}</div>
          )}
          {(status.kind === "win" || status.kind === "draw") && (
            <button onClick={newPosition} className="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">New position →</button>
          )}
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <button onClick={newPosition} disabled={!ready}
            className="w-full rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-50">↻ New position</button>
          <p className="mt-3 text-xs text-ink-500">{kind === "pawnEnd" ? "King in front of the pawn, win the opposition, grab a key square — then push." : "Box the king in, march your own king up, and watch for stalemate."}</p>
        </div>
      </aside>
    </div>
  );
}
