// Student "Gameplay Revise" — list assignments sent by coach + per-assignment
// walk-through page where student guesses each move.
// Routes:
//   /revise/games                     — list all assignments for me
//   /revise/games/:id                 — play one

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import type { Key } from "chessground/types";
import { api } from "../lib/api";
import { gameplayReviseApi, type GameplayReviseAssignment } from "../lib/chessdb-api";

// -------------------- LIST PAGE --------------------
export function StudentGameplayReviseListPage() {
  const authQ = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const listQ = useQuery({ queryKey: ["gameplay-revise-for-me"], queryFn: gameplayReviseApi.forMe });

  if (authQ.data && !authQ.data.loggedIn) return <Navigate to="/login?back=/revise/games" replace />;

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-white flex items-center gap-2">
          <span className="text-3xl">🎯</span> Game Memory Revise
        </h1>
        <p className="text-sm text-ink-400 mt-1">Master games your coach has sent — try to guess each move</p>
      </div>

      {listQ.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {listQ.data && listQ.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-ink-700 p-8 text-center text-sm text-ink-400">
          No games sent yet. Your coach hasn't shared any master games for you to study.
        </div>
      )}
      {listQ.data && listQ.data.length > 0 && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {listQ.data.map((a) => <AssignmentCard key={a._id} a={a} />)}
        </div>
      )}
    </div>
  );
}

function AssignmentCard({ a }: { a: GameplayReviseAssignment }) {
  return (
    <Link to={`/revise/games/${a._id}`}
      className="block rounded-xl border border-ink-800 bg-gradient-to-br from-ink-900 to-ink-950 p-4 hover:border-fuchsia-500/50 transition-colors group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-white flex-1 group-hover:text-fuchsia-300 transition-colors">{a.title}</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">v{a.version}</span>
      </div>
      {a.coachNotes && <div className="text-xs text-ink-300 italic mb-2 line-clamp-2">"{a.coachNotes}"</div>}
      <div className="text-[10px] text-ink-500 font-mono truncate">{a.pgn.slice(0, 80)}…</div>
      <div className="mt-2 text-xs text-fuchsia-400 group-hover:text-fuchsia-300">Start revise →</div>
    </Link>
  );
}

// -------------------- DETAIL / PLAY PAGE --------------------
export function StudentGameplayRevisePlayPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const authQ = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["gameplay-revise-play", id],
    queryFn: () => gameplayReviseApi.forMeOne(id!),
    enabled: !!id,
  });

  const boardEl = useRef<HTMLDivElement>(null);
  const cgRef = useRef<any>(null);

  // Parse pgn (which is UCI-space-separated or SAN — our chessdb stores UCI for lumbras/caissa/ajcor, SAN otherwise)
  const positions = useMemo(() => {
    const raw = q.data?.assignment?.pgn?.trim();
    if (!raw) return [] as Array<{ fen: string; san: string; uci: string; from: string; to: string; promotion?: string }>;
    const c = new Chess();
    const out: Array<{ fen: string; san: string; uci: string; from: string; to: string; promotion?: string }> = [];
    const tokens = raw.split(/\s+/).filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    for (const tok of tokens) {
      const clean = tok.replace(/[!?]+$/g, "");
      // Detect UCI (e2e4 / e7e8q)
      const ucim = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/i.exec(clean);
      let mv;
      try {
        if (ucim) {
          mv = c.move({ from: ucim[1] as any, to: ucim[2] as any, promotion: ucim[3]?.toLowerCase() as any });
        } else {
          mv = c.move(clean);
        }
      } catch { break; }
      if (!mv) break;
      out.push({
        fen: c.fen(), san: mv.san, uci: mv.from + mv.to + (mv.promotion || ""),
        from: mv.from, to: mv.to, promotion: mv.promotion,
      });
    }
    return out;
  }, [q.data?.assignment?.pgn]);

  const totalPlies = positions.length;
  const [ply, setPly] = useState(0); // next ply to guess (0..totalPlies)
  const [tries, setTries] = useState(0);
  const [feedback, setFeedback] = useState<null | "correct" | "wrong" | "hint">(null);
  const [revealed, setRevealed] = useState(false);

  // Whenever assignment loads, seed ply from server progress
  useEffect(() => {
    if (!q.data) return;
    setPly(Math.max(0, Number(q.data.progress?.lastPly ?? 0)));
  }, [q.data?.assignment?._id]);

  // Position BEFORE the current ply (initial if ply=0, else positions[ply-1].fen)
  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const currentFen = ply === 0 ? startFen : positions[ply - 1]?.fen ?? startFen;
  const expected = positions[ply]; // the move student should guess

  const progressMut = useMutation({
    mutationFn: (body: { ply: number; correct: boolean; tries: number; completed?: boolean }) =>
      gameplayReviseApi.progress(id!, { ...body, version: q.data?.assignment?.version ?? 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gameplay-revise-play", id] }),
  });

  function handleMove(from: string, to: string, promotion?: string) {
    if (!expected) return;
    const student = from + to + (promotion || "");
    const nextTries = tries + 1;
    if (student === expected.uci) {
      setFeedback("correct");
      progressMut.mutate({ ply, correct: true, tries: nextTries, completed: ply + 1 === totalPlies });
      // Auto-advance after brief pause
      setTimeout(() => {
        setPly((p) => p + 1);
        setTries(0);
        setFeedback(null);
        setRevealed(false);
      }, 700);
    } else {
      setTries(nextTries);
      setFeedback("wrong");
      // Snap back to current position (chessground illegal-shape prevents this, but our permissive setup allows)
      cgRef.current?.set({ fen: currentFen });
    }
  }

  function reveal() {
    if (!expected) return;
    setRevealed(true);
    setFeedback("hint");
    progressMut.mutate({ ply, correct: false, tries: tries + 1, completed: ply + 1 === totalPlies });
    setTimeout(() => {
      setPly((p) => p + 1);
      setTries(0);
      setFeedback(null);
      setRevealed(false);
    }, 1500);
  }

  // Init chessground on mount
  useEffect(() => {
    if (!boardEl.current || cgRef.current) return;
    cgRef.current = Chessground(boardEl.current, {
      fen: currentFen,
      orientation: expected?.from?.[1] === "2" || expected?.from?.[1] === "1" ? "white" : (ply % 2 === 0 ? "white" : "black"),
      coordinates: true,
      movable: {
        free: false,
        events: {
          after: (from: Key, to: Key) => handleMove(String(from), String(to)),
        },
      },
    });
  }, [q.data?.assignment?._id]);

  // Update board on ply change
  useEffect(() => {
    if (!cgRef.current) return;
    const orient = ply % 2 === 0 ? "white" : "black";
    // Compute legal moves via chess.js for the current fen
    const c = new Chess(currentFen);
    const dests = new Map<Key, Key[]>();
    for (const m of c.moves({ verbose: true })) {
      const arr = dests.get(m.from as Key) || [];
      arr.push(m.to as Key);
      dests.set(m.from as Key, arr);
    }
    cgRef.current.set({
      fen: currentFen,
      orientation: orient,
      turnColor: c.turn() === "w" ? "white" : "black",
      lastMove: revealed && expected ? [expected.from as Key, expected.to as Key] : undefined,
      movable: {
        color: c.turn() === "w" ? "white" : "black",
        dests,
        free: false,
        events: {
          after: (from: Key, to: Key) => handleMove(String(from), String(to)),
        },
      },
    });
  }, [ply, currentFen, revealed]);

  if (authQ.data && !authQ.data.loggedIn) return <Navigate to={`/login?back=/revise/games/${id}`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (!q.data) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Not found.</div>;

  const a = q.data.assignment;
  const done = ply >= totalPlies;
  const scores = q.data.progress?.scoresByPly || {};
  const correctCount = Object.values(scores).filter((s: any) => s?.correct).length;

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Link to="/revise/games" className="text-xs text-ink-400 hover:text-ink-200">← Back to list</Link>
          <h1 className="font-display text-xl text-white mt-1">{a.title}</h1>
          <div className="text-xs text-ink-400">Ply {ply} of {totalPlies} · {correctCount} correct</div>
          {q.data.updated && <div className="mt-1 text-xs text-fuchsia-400">✱ Coach updated this game since your last visit</div>}
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-500">Progress</div>
          <div className="text-lg font-bold text-white">{totalPlies ? Math.round((ply / totalPlies) * 100) : 0}%</div>
        </div>
      </div>

      {a.coachNotes && (
        <div className="mb-4 rounded-lg border border-fuchsia-500/30 bg-fuchsia-900/20 p-3 text-sm text-fuchsia-100">
          <div className="text-[10px] uppercase tracking-wider text-fuchsia-400 mb-1">Coach notes</div>
          "{a.coachNotes}"
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        {/* Board */}
        <div>
          <div ref={boardEl} className="aspect-square w-full max-w-[600px] mx-auto rounded-lg overflow-hidden shadow-xl" />

          {/* Feedback strip */}
          <div className="mt-3 min-h-[48px]">
            {feedback === "correct" && (
              <div className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-4 py-2 text-emerald-200 font-semibold text-center">
                ✓ Correct! {expected?.san}
              </div>
            )}
            {feedback === "wrong" && (
              <div className="rounded-lg bg-rose-500/20 border border-rose-500/40 px-4 py-2 text-rose-200 text-center">
                ✗ Not quite — try again ({tries} {tries === 1 ? "try" : "tries"})
              </div>
            )}
            {feedback === "hint" && (
              <div className="rounded-lg bg-amber-500/20 border border-amber-500/40 px-4 py-2 text-amber-200 text-center">
                💡 The move was <span className="font-bold">{expected?.san}</span>
              </div>
            )}
            {done && (
              <div className="rounded-lg bg-gradient-to-r from-emerald-500/30 to-teal-500/30 border border-emerald-500/50 px-4 py-3 text-emerald-100 text-center">
                🎉 Game complete! {correctCount} of {totalPlies} correct ({Math.round(100 * correctCount / totalPlies)}%)
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="rounded-xl border border-ink-800 bg-ink-900/50 p-4">
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">Your turn</div>
          {!done ? (
            <>
              <div className="mb-3 text-sm text-white">Guess the next move ({ply % 2 === 0 ? "White" : "Black"} to play)</div>
              <button onClick={reveal}
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-200 hover:bg-ink-700 mb-2">
                💡 Show me the move
              </button>
              {ply > 0 && (
                <button onClick={() => { setPly(p => Math.max(0, p - 1)); setTries(0); setFeedback(null); setRevealed(false); }}
                  className="w-full rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-400 hover:bg-ink-800">
                  ← Undo
                </button>
              )}
            </>
          ) : (
            <button onClick={() => { setPly(0); setTries(0); setFeedback(null); setRevealed(false); }}
              className="w-full rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 px-3 py-2 text-sm font-semibold text-white shadow">
              🔄 Play again from start
            </button>
          )}

          <div className="mt-4 pt-4 border-t border-ink-800">
            <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">Move history</div>
            <div className="max-h-64 overflow-y-auto text-xs font-mono space-y-0.5">
              {positions.slice(0, ply).map((p, i) => {
                const s: any = scores[i];
                const marker = s?.correct ? "✓" : s ? "✗" : "•";
                const color = s?.correct ? "text-emerald-400" : s ? "text-rose-400" : "text-ink-500";
                return (
                  <div key={i} className={`${color} flex justify-between`}>
                    <span>{i % 2 === 0 ? `${Math.floor(i/2) + 1}.` : "..."} {p.san}</span>
                    <span>{marker}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
