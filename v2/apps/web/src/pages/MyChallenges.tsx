// /challenges — student's log of past "find the good moves" class challenges.
// Each row: position (mini board), prompt, class title, their attempt in SAN,
// time taken. Click a row → local playthrough of their attempt on a full
// board (same walkthrough UX as the post-challenge review pill in class).
//
// Backed by GET /api/me/challenges (see class-challenges.controller.ts).

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";
import Board from "../components/Board";

interface StudentChallengeRow {
  classId: string;
  classTitle?: string;
  positionFen: string;
  startFen: string;
  prompt: string;
  startedAt: string;
  endedAt: string;
  myMovesSan: string[];
  myFinalFen?: string;
  myTimeMs?: number;
  correct?: boolean | null;
  totalAnswers: number;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`/v2api${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export default function MyChallengesPage() {
  const q = useQuery({
    queryKey: ["me.challenges"],
    queryFn: () => get<{ challenges: StudentChallengeRow[] }>("/api/me/challenges"),
  });
  const rows = q.data?.challenges ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Link to="/history" className="text-ink-300 hover:text-white">← History</Link>
        <span className="text-ink-500">/</span>
        <span className="text-ink-300">Challenges</span>
      </div>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">🧠 My Challenges</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">
          Every "find the good moves" challenge you've answered in class. Click a row to walk through your attempt.
        </p>
      </header>

      {q.isLoading && <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-8 text-center text-sm text-ink-400">Loading…</div>}
      {q.isError && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-sm text-red-200">Couldn't load. {q.error instanceof Error ? q.error.message : ""}</div>}
      {!q.isLoading && !q.isError && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-10 text-center">
          <div className="mb-2 text-4xl" aria-hidden>🧠</div>
          <h3 className="font-display text-xl text-ink-100">No challenges yet</h3>
          <p className="mt-2 max-w-md text-sm text-ink-400 mx-auto">
            When your coach runs a "find the good moves" challenge in Dream Meet, your answer will show up here.
          </p>
        </div>
      )}
      {!q.isLoading && !q.isError && rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((r, i) => <ChallengeCard key={i} r={r} />)}
        </div>
      )}
    </div>
  );
}

function ChallengeCard({ r }: { r: StudentChallengeRow }) {
  const [open, setOpen] = useState(false);
  const timeLabel = r.myTimeMs
    ? r.myTimeMs >= 60_000 ? `${Math.floor(r.myTimeMs/60_000)}m ${Math.round((r.myTimeMs%60_000)/1000)}s` : `${Math.round(r.myTimeMs/1000)}s`
    : "—";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60 p-4 text-left transition hover:-translate-y-0.5 hover:border-purple-500/60"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-ink-400">
              {new Date(r.endedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <h3 className="mt-0.5 truncate text-sm font-semibold text-ink-100">{r.classTitle || r.classId}</h3>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-200 ring-1 ring-purple-400/30">
              🧠 {r.myMovesSan.length} {r.myMovesSan.length === 1 ? "move" : "moves"}
            </span>
            {r.correct === true && (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 ring-1 ring-emerald-400/40">✓ correct</span>
            )}
            {r.correct === false && (
              <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-200 ring-1 ring-rose-400/40">✗ wrong</span>
            )}
          </div>
        </div>
        {r.prompt && <p className="mb-3 text-xs italic text-ink-300 line-clamp-2">"{r.prompt}"</p>}
        <div className="mb-3 aspect-square w-full overflow-hidden rounded-lg border border-ink-700">
          <Board fen={r.positionFen} orientation="white" movableColor="none" dests={new Map() as any} coordinates />
        </div>
        <div className="flex items-center justify-between text-[11px] text-ink-400">
          <span className="font-mono text-purple-200 truncate">{r.myMovesSan.join(" ") || "—"}</span>
          <span className="ml-2 whitespace-nowrap">⏱ {timeLabel}</span>
        </div>
      </button>
      {open && <ChallengeReviewModal r={r} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChallengeReviewModal({ r, onClose }: { r: StudentChallengeRow; onClose: () => void }) {
  const [idx, setIdx] = useState<number>(r.myMovesSan.length - 1);
  const fen = useMemo(() => {
    try {
      const c = new Chess(r.positionFen);
      const upTo = Math.min(idx + 1, r.myMovesSan.length);
      for (let i = 0; i < upTo; i++) {
        try { c.move(r.myMovesSan[i] as any); } catch { break; }
      }
      return c.fen();
    } catch { return r.positionFen; }
  }, [idx, r.positionFen, r.myMovesSan]);
  const atStart = idx <= -1;
  const atEnd = idx >= r.myMovesSan.length - 1;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-purple-500/40 bg-ink-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg text-purple-100">🧠 Your answer</h3>
            {r.prompt && <p className="mt-1 text-xs italic text-ink-400">"{r.prompt}"</p>}
            {r.classTitle && <p className="mt-1 text-[11px] text-ink-500">{r.classTitle} · {new Date(r.endedAt).toLocaleDateString()}</p>}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800 text-ink-300 hover:bg-ink-700">✕</button>
        </div>
        <div className="mb-3 aspect-square w-full overflow-hidden rounded-lg border border-ink-700">
          <Board fen={fen} orientation="white" movableColor="none" dests={new Map() as any} coordinates />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setIdx((i) => Math.max(-1, i - 1))} disabled={atStart}
              className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-lg text-ink-200 hover:bg-ink-700 disabled:opacity-30">◀</button>
            <button onClick={() => setIdx((i) => Math.min(r.myMovesSan.length - 1, i + 1))} disabled={atEnd}
              className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-lg text-ink-200 hover:bg-ink-700 disabled:opacity-30">▶</button>
          </div>
          <div className="text-xs font-mono text-purple-200">
            {atStart ? "start" : `${idx + 1}/${r.myMovesSan.length} · ${r.myMovesSan[idx]}`}
          </div>
          <div className="text-[11px] text-ink-500">
            {r.totalAnswers > 1 ? `${r.totalAnswers} students answered` : "you were the only one"}
          </div>
        </div>
      </div>
    </div>
  );
}
