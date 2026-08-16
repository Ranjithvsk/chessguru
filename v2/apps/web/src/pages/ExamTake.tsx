// Student: take an exam. Route: /exams/:id/take
//
// Card-by-card. Timer per position (if set). Move via click or SAN.
// On submit: answer sent to server (auto-graded), student sees ✓/✗ + expected,
// then a "Next →" button advances. Final card triggers /finish → results page.
//
// Server never returns expectedUci for the current card until AFTER we
// submit — students can't cheat by inspecting DevTools.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { api } from "../lib/api";
import { examsApi } from "../lib/exams-api";

function destsFor(g: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  const squares = ["a", "b", "c", "d", "e", "f", "g", "h"].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));
  for (const from of squares) {
    const moves = g.moves({ square: from as any, verbose: true }) as any[];
    if (moves.length) dests.set(from as Key, moves.map((m) => m.to as Key));
  }
  return dests;
}

export default function ExamTakePage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const examQ = useQuery({
    queryKey: ["exam", id],
    queryFn: () => examsApi.get(id),
    enabled: !!auth?.loggedIn && !!id,
  });

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"guess" | "revealed">("guess");
  const [feedback, setFeedback] = useState<{ correct: boolean; expectedSan?: string } | null>(null);
  const [sanInput, setSanInput] = useState("");
  const [sanError, setSanError] = useState("");
  const startedAtRef = useRef<number>(Date.now());
  const [remaining, setRemaining] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);

  const start = useMutation({
    mutationFn: () => examsApi.startAttempt(id),
    onSuccess: (r) => { setAttemptId(r.attemptId); startedAtRef.current = Date.now(); },
  });
  const answer = useMutation({
    mutationFn: (body: any) => examsApi.answer(id, attemptId!, body),
  });
  const finish = useMutation({
    mutationFn: () => examsApi.finish(id, attemptId!),
    onSuccess: () => nav(`/exams/${encodeURIComponent(id)}/results`),
  });

  // Auto-start attempt on page load (only once).
  const startedOnce = useRef(false);
  useEffect(() => {
    if (examQ.data && !attemptId && !startedOnce.current) {
      startedOnce.current = true;
      start.mutate();
    }
  }, [examQ.data]);

  const exam = examQ.data?.exam;
  const positions = exam?.positions ?? [];
  const pos = positions[i];

  // Timer per position. Resets when the card changes.
  useEffect(() => {
    if (!pos || phase !== "guess") return;
    startedAtRef.current = Date.now();
    if (!exam?.timePerPosSec) { setRemaining(null); return; }
    setRemaining(exam.timePerPosSec);
    const tick = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const rem = Math.max(0, (exam.timePerPosSec ?? 0) - elapsed);
      setRemaining(rem);
      if (rem <= 0) {
        clearInterval(tick);
        // Auto-submit "no answer"
        submitAttempt(null, null);
      }
    }, 250);
    return () => clearInterval(tick);
  }, [pos?.id, phase]);

  // Reset per-card state when i changes
  const prevPosId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (pos?.id !== prevPosId.current) {
      prevPosId.current = pos?.id;
      setPhase("guess");
      setFeedback(null);
      setSanInput("");
      setSanError("");
    }
  }, [pos?.id]);

  const board = useMemo(() => pos ? new Chess(pos.fenBefore) : null, [pos?.fenBefore]);
  const dests = useMemo(() => board ? destsFor(board) : new Map<Key, Key[]>(), [board]);

  const submitAttempt = (uci: string | null, san: string | null) => {
    if (!attemptId || !pos) return;
    const timeSpentMs = Date.now() - startedAtRef.current;
    answer.mutate(
      { positionId: pos.id, playedUci: uci, playedSan: san, timeSpentMs },
      {
        onSuccess: (r) => {
          setPhase("revealed");
          setFeedback({ correct: !!r.correct, expectedSan: r.expectedSan });
          if (r.correct) setCorrectCount((n) => n + 1);
        },
      },
    );
  };

  const onBoardMove = (from: Key, to: Key) => {
    if (phase !== "guess" || !board || !pos) return;
    const piece = board.get(from as any);
    let promotion: string | undefined;
    if (piece && piece.type === "p" && ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"))) promotion = "q";
    const sim = new Chess(pos.fenBefore);
    const m = sim.move({ from, to, promotion } as any);
    if (!m) return;
    submitAttempt(m.from + m.to + (m.promotion || ""), m.san);
  };

  const submitSan = () => {
    if (!pos) return;
    const s = sanInput.trim();
    if (!s) return;
    const sim = new Chess(pos.fenBefore);
    const m = sim.move(s, { strict: false } as any);
    if (!m) { setSanError(`"${s}" isn't legal here`); return; }
    submitAttempt(m.from + m.to + (m.promotion || ""), m.san);
  };

  const next = () => {
    if (i + 1 >= positions.length) {
      finish.mutate();
    } else {
      setI(i + 1);
    }
  };

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/exams/${encodeURIComponent(id)}/take`} replace />;
  if (examQ.isLoading || start.isPending) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Loading exam…</div>;
  if (examQ.error || start.error) return <div className="mx-auto max-w-4xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((examQ.error as any)?.message || (start.error as any)?.message)}</div>
    <Link to="/exams" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← Exams</Link>
  </div>;
  if (!exam || !pos) return null;

  const turnColor = pos.turnColor;
  const timeoutPct = exam.timePerPosSec && remaining !== null ? (remaining / exam.timePerPosSec) * 100 : 100;

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-3 flex items-center justify-between text-xs text-ink-400">
        <div>Position {i + 1} of {positions.length} · {correctCount} correct so far</div>
        <div>{exam.title}</div>
      </div>

      {/* Timer bar */}
      {exam.timePerPosSec && (
        <div className="mb-3 h-2 rounded-full bg-ink-800 overflow-hidden">
          <div className={`h-full transition-all duration-200 ${timeoutPct < 25 ? "bg-rose-500" : timeoutPct < 50 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${timeoutPct}%` }} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,540px)_1fr]">
        <div>
          <Board fen={pos.fenBefore}
            orientation={turnColor}
            turnColor={turnColor}
            movableColor={phase === "guess" ? turnColor : undefined}
            dests={phase === "guess" ? dests : undefined}
            onMove={onBoardMove}
          />
          <div className="mt-2 text-center text-sm text-ink-300">
            {phase === "guess" && <span>{turnColor === "white" ? "White" : "Black"} to move — find the best move</span>}
            {phase === "revealed" && feedback?.correct && <span className="text-emerald-400">✓ Correct — {feedback.expectedSan}</span>}
            {phase === "revealed" && feedback && !feedback.correct && <span className="text-rose-400">✗ Correct move was <b>{feedback.expectedSan}</b></span>}
          </div>

          {phase === "guess" && (
            <form onSubmit={(e) => { e.preventDefault(); submitSan(); }} className="mt-3 flex gap-2">
              <input value={sanInput} onChange={(e) => { setSanInput(e.target.value); setSanError(""); }}
                placeholder="Or type SAN: e4, Nf3, O-O…"
                className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500">Play</button>
            </form>
          )}
          {sanError && <div className="mt-1 text-xs text-rose-300">{sanError}</div>}
        </div>

        <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
          {phase === "guess" && (
            <>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Your move</div>
              <p className="text-sm text-ink-400">
                {exam.timePerPosSec
                  ? `You have ${exam.timePerPosSec} seconds. Click a piece on the board, or type SAN.`
                  : "Take your time. Click a piece on the board, or type SAN."}
              </p>
              {pos.comment && (
                <div className="mt-3 rounded bg-ink-800 p-3 text-xs text-ink-300">
                  💬 {pos.comment}
                </div>
              )}
            </>
          )}
          {phase === "revealed" && (
            <>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Answer</div>
              <div className={`rounded p-3 text-sm ${feedback?.correct ? "bg-emerald-500/10 text-emerald-100" : "bg-rose-500/10 text-rose-100"}`}>
                {feedback?.correct ? "✓ Correct." : `✗ You missed it. Correct: ${feedback?.expectedSan}`}
              </div>
              <button type="button" onClick={next} disabled={answer.isPending || finish.isPending}
                className="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {i + 1 >= positions.length ? (finish.isPending ? "Submitting…" : "Finish exam →") : "Next question →"}
              </button>
            </>
          )}
          {answer.error && <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{String((answer.error as any)?.message)}</div>}
        </div>
      </div>
    </div>
  );
}
