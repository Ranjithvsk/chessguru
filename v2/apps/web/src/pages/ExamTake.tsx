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
  // Proctoring (Fair Play Phase 2): a proctored exam starts from a gate the
  // student clicks (that click is the user gesture full screen needs), and
  // while it runs every tab/window/full-screen change is recorded — per
  // position (sent with the answer) and for the attempt (sent with finish).
  const [gateOpen, setGateOpen] = useState(false);
  const [fsLost, setFsLost] = useState(false);
  const proctorRef = useRef({ startedAt: Date.now(), hiddenSince: null as number | null, hiddenMs: 0, hiddenCount: 0, fsExits: 0, fsSupported: false, fsUsed: false, events: [] as { t: number; k: string }[] });
  const posFocusRef = useRef({ hiddenMs: 0, hiddenCount: 0, fsExits: 0 });

  const start = useMutation({
    mutationFn: () => examsApi.startAttempt(id),
    onSuccess: (r) => { setAttemptId(r.attemptId); startedAtRef.current = Date.now(); },
  });
  const answer = useMutation({
    mutationFn: (body: any) => examsApi.answer(id, attemptId!, body),
  });
  const finish = useMutation({
    mutationFn: () => {
      const pr = proctorRef.current;
      if (pr.hiddenSince != null) { pr.hiddenMs += Date.now() - pr.hiddenSince; pr.hiddenSince = null; }
      const proctored = examQ.data?.exam?.proctored !== false;
      return examsApi.finish(id, attemptId!, proctored ? { proctor: { hiddenMs: pr.hiddenMs, hiddenCount: pr.hiddenCount, fsExits: pr.fsExits, fsSupported: pr.fsSupported, fsUsed: pr.fsUsed, events: pr.events.slice(0, 200) } } : undefined);
    },
    onSuccess: () => { try { if (document.fullscreenElement) void document.exitFullscreen(); } catch { /* */ } nav(`/exams/${encodeURIComponent(id)}/results`); },
  });

  const exam = examQ.data?.exam;
  const proctored = !!exam && exam.proctored !== false;

  // Auto-start attempt on page load (only once) — a proctored exam waits for
  // the gate click instead.
  const startedOnce = useRef(false);
  useEffect(() => {
    if (examQ.data && !attemptId && !startedOnce.current && !proctored) {
      startedOnce.current = true;
      start.mutate();
    }
  }, [examQ.data, proctored]);

  const beginProctored = () => {
    if (startedOnce.current) return;
    startedOnce.current = true;
    setGateOpen(true);
    const pr = proctorRef.current;
    pr.startedAt = Date.now();
    const el: any = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    pr.fsSupported = typeof req === "function";
    if (pr.fsSupported) {
      try { Promise.resolve(req.call(el)).then(() => { pr.fsUsed = true; }).catch(() => { /* denied: still recorded as not used */ }); } catch { /* */ }
    }
    start.mutate();
  };

  // Record focus and full-screen changes while a proctored attempt is open.
  useEffect(() => {
    if (!proctored || !attemptId) return;
    const pr = proctorRef.current;
    const ev = (k: string) => { if (pr.events.length < 200) pr.events.push({ t: Date.now() - pr.startedAt, k }); };
    const away = (k: string) => { if (pr.hiddenSince != null) return; pr.hiddenSince = Date.now(); pr.hiddenCount++; posFocusRef.current.hiddenCount++; ev(k); };
    const back = (k: string) => { if (pr.hiddenSince == null) return; const d = Date.now() - pr.hiddenSince; pr.hiddenMs += d; posFocusRef.current.hiddenMs += d; pr.hiddenSince = null; ev(k); };
    const onVis = () => { if (document.visibilityState === "hidden") away("hidden"); else back("visible"); };
    const onBlur = () => away("blur");
    const onFocus = () => back("focus");
    const onFs = () => {
      const inFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (inFs) { pr.fsUsed = true; setFsLost(false); ev("fs_enter"); }
      else { pr.fsExits++; posFocusRef.current.fsExits++; setFsLost(true); ev("fs_exit"); }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as any);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs as any);
    };
  }, [proctored, attemptId]);

  const returnToFullscreen = () => {
    const el: any = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (typeof req === "function") { try { Promise.resolve(req.call(el)).catch(() => { /* */ }); } catch { /* */ } }
  };

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
      posFocusRef.current = { hiddenMs: 0, hiddenCount: 0, fsExits: 0 };
    }
  }, [pos?.id]);

  const board = useMemo(() => pos ? new Chess(pos.fenBefore) : null, [pos?.fenBefore]);
  const dests = useMemo(() => board ? destsFor(board) : new Map<Key, Key[]>(), [board]);

  const submitAttempt = (uci: string | null, san: string | null) => {
    if (!attemptId || !pos) return;
    const timeSpentMs = Date.now() - startedAtRef.current;
    const pr = proctorRef.current;
    if (proctored && pr.hiddenSince != null) { const d = Date.now() - pr.hiddenSince; pr.hiddenMs += d; posFocusRef.current.hiddenMs += d; pr.hiddenSince = Date.now(); }
    answer.mutate(
      { positionId: pos.id, playedUci: uci, playedSan: san, timeSpentMs, ...(proctored ? { focus: { ...posFocusRef.current } } : {}) },
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
  if (exam && proctored && !attemptId && !gateOpen) {
    return (
      <div className="mx-auto max-w-lg px-3 py-10" data-testid="proctor-gate">
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">{exam.title}</div>
          <h1 className="mt-1 font-display text-2xl text-white">🛡 This exam is proctored</h1>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-300">
            <li>It opens in full screen and stays there until you finish.</li>
            <li>Leaving the tab, switching windows or leaving full screen is recorded and shown to your coach.</li>
            <li>{exam.timePerPosSec ? `You have ${exam.timePerPosSec} seconds per position.` : "There is no time limit per position."} {exam.positions.length} positions.</li>
          </ul>
          <button type="button" onClick={beginProctored} className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500" data-testid="proctor-start">Start exam</button>
          <Link to="/exams" className="mt-3 block text-center text-xs text-ink-400 hover:text-white">Not now</Link>
        </div>
      </div>
    );
  }
  if (!exam || !pos) return null;

  const turnColor = pos.turnColor;
  const timeoutPct = exam.timePerPosSec && remaining !== null ? (remaining / exam.timePerPosSec) * 100 : 100;

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-3 flex items-center justify-between text-xs text-ink-400">
        <div>Position {i + 1} of {positions.length} · {correctCount} correct so far</div>
        <div>{proctored && <span className="mr-2 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-semibold text-ink-200" title="Tab, window and full-screen changes are recorded">🛡 Proctored</span>}{exam.title}</div>
      </div>
      {proctored && fsLost && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" data-testid="fs-lost">
          <span>You left full screen — this has been recorded.</span>
          <button type="button" onClick={returnToFullscreen} className="rounded bg-amber-500/20 px-2 py-1 font-semibold hover:bg-amber-500/30">Return to full screen</button>
        </div>
      )}

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
