// Daily revision drill — spaced-repetition through ⭐-flagged positions.
// Route: /revise
//
// Flow per card:
//   1. Show position (fenBefore), tell student whose turn.
//   2. Student plays a move (click on board or type SAN).
//   3. If it matches expectedUci → ✓ Correct → pick a grade (Hard/Good/Easy).
//   4. If it doesn't match → ✗ Wrong → show expected move + "Again" only.
//   5. Grade submits; card is scheduled; next card loads.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { api } from "../lib/api";
import { revisionsApi, type Grade, type RevisionItem } from "../lib/revisions-api";

function destsFor(g: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  const squares = ["a", "b", "c", "d", "e", "f", "g", "h"].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));
  for (const from of squares) {
    const moves = g.moves({ square: from as any, verbose: true }) as any[];
    if (moves.length) dests.set(from as Key, moves.map((m) => m.to as Key));
  }
  return dests;
}

export default function RevisePage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const qc = useQueryClient();
  const qq = useQuery({
    queryKey: ["rev-queue"],
    queryFn: () => revisionsApi.queue(30),
    enabled: !!auth?.loggedIn,
    refetchOnWindowFocus: false,
  });

  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"guess" | "correct" | "wrong">("guess");
  const [attempt, setAttempt] = useState<string>(""); // uci
  const [sanInput, setSanInput] = useState("");
  const [sanError, setSanError] = useState("");
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);

  // When queue is fresh, reset session state.
  const items = qq.data?.items ?? [];
  const item: RevisionItem | undefined = items[i];

  // Reset per-card state when moving between cards
  const prevItemId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (item?._id !== prevItemId.current) {
      prevItemId.current = item?._id;
      setPhase("guess");
      setAttempt("");
      setSanInput("");
      setSanError("");
    }
  }, [item?._id]);

  const board = useMemo(() => item ? new Chess(item.fenBefore) : null, [item?.fenBefore]);
  const dests = useMemo(() => board ? destsFor(board) : new Map<Key, Key[]>(), [board]);

  const review = useMutation({
    mutationFn: (grade: Grade) => revisionsApi.review({ chapterId: item!.chapterId, nodeId: item!.nodeId, grade }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rev-stats"] });
      // Move on
      setI((n) => n + 1);
    },
  });

  const submitAttempt = (uci: string) => {
    if (!item) return;
    setAttempt(uci);
    if (uci === item.expectedUci) {
      setPhase("correct");
      setCorrectCount((n) => n + 1);
    } else {
      setPhase("wrong");
      setWrongCount((n) => n + 1);
    }
  };

  const onBoardMove = (from: Key, to: Key) => {
    if (phase !== "guess" || !board || !item) return;
    // Handle promotion — default to queen (chess memory drills rarely rely on underpromotion; ok for now)
    const piece = board.get(from as any);
    let promotion: string | undefined;
    if (piece && piece.type === "p" && ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"))) {
      promotion = "q";
    }
    const simCheck = new Chess(item.fenBefore);
    const m = simCheck.move({ from, to, promotion } as any);
    if (!m) return;
    submitAttempt(m.from + m.to + (m.promotion || ""));
  };

  const submitSan = () => {
    if (!item) return;
    const s = sanInput.trim();
    if (!s) return;
    const sim = new Chess(item.fenBefore);
    const m = sim.move(s, { strict: false } as any);
    if (!m) { setSanError(`"${s}" isn't legal here`); return; }
    submitAttempt(m.from + m.to + (m.promotion || ""));
  };

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/revise" replace />;

  if (qq.isLoading) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Loading queue…</div>;
  if (qq.error) return <div className="mx-auto max-w-4xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((qq.error as any)?.message || qq.error)}</div>
  </div>;

  // All done!
  if (!item) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-10 text-center">
        <div className="mb-4 text-6xl">✨</div>
        {items.length === 0 ? (
          <>
            <h1 className="mb-2 font-display text-2xl text-white">Nothing to revise right now.</h1>
            <p className="mb-6 text-sm text-ink-400">Flag positions with ⭐ inside any study chapter to add them here.</p>
          </>
        ) : (
          <>
            <h1 className="mb-2 font-display text-2xl text-white">Session done!</h1>
            <p className="mb-6 text-sm text-ink-400">
              {items.length} card{items.length === 1 ? "" : "s"} reviewed · {correctCount} correct · {wrongCount} wrong
            </p>
          </>
        )}
        <div className="flex justify-center gap-3">
          <Link to="/studies" className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800">My studies</Link>
          <Link to="/" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Home</Link>
        </div>
      </div>
    );
  }

  const turnColor = item.turnColor;
  const bookBadge = item.bookId ? `📚 ${item.bookId}${item.bookChapterNumber ? ` · Ch ${item.bookChapterNumber}` : ""}` : null;

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      {/* Progress */}
      <div className="mb-3 flex items-center justify-between text-xs text-ink-400">
        <div>Card {i + 1} of {items.length}</div>
        <div className="flex items-center gap-3">
          {correctCount > 0 && <span className="text-emerald-400">✓ {correctCount}</span>}
          {wrongCount > 0 && <span className="text-rose-400">✗ {wrongCount}</span>}
          {item.streak > 0 && <span className="text-amber-300">🔥 streak {item.streak}</span>}
        </div>
      </div>

      {/* Card header — source study */}
      <div className="mb-2 rounded-xl border border-ink-700 bg-ink-900 p-3 text-xs text-ink-300">
        <div>📓 <Link to={`/studies/${encodeURIComponent(item.studyId)}`} className="hover:underline text-brand-200">{item.studyTitle}</Link> · <span className="text-ink-500">{item.chapterTitle}</span></div>
        {bookBadge && <div className="mt-1 text-brand-200/80">{bookBadge}</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,540px)_1fr]">
        {/* Board */}
        <div>
          <Board fen={item.fenBefore}
            orientation={turnColor}
            turnColor={turnColor}
            movableColor={phase === "guess" ? turnColor : undefined}
            dests={phase === "guess" ? dests : undefined}
            onMove={onBoardMove}
          />
          <div className="mt-2 text-center text-sm text-ink-300">
            {phase === "guess" && <span>{turnColor === "white" ? "White" : "Black"} to move — what's the best move?</span>}
            {phase === "correct" && <span className="text-emerald-400">✓ Correct — {item.expectedSan}</span>}
            {phase === "wrong" && <span className="text-rose-400">✗ You played {attempt} — correct was <b>{item.expectedSan}</b></span>}
          </div>

          {/* SAN input (only during guess phase) */}
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

        {/* Grade panel */}
        <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {phase === "guess" ? "Make your guess" : "How was that?"}
          </div>

          {phase === "guess" && (
            <div className="text-sm text-ink-400">
              Play the move you remember. Click a piece on the board, or type the move in the box.
              <div className="mt-4 rounded bg-ink-800 p-3 text-[11px]">
                💡 Try to recall <b>without</b> looking at hints. That's what makes it stick.
              </div>
            </div>
          )}

          {phase === "correct" && (
            <div className="space-y-2">
              <div className="text-sm text-ink-300">Nice. How comfortable were you?</div>
              <button onClick={() => review.mutate("hard")} disabled={review.isPending}
                className="flex w-full items-center justify-between rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/20 disabled:opacity-50">
                <span>😅 Hard <span className="text-[10px] text-ink-400">(barely)</span></span>
                <span className="text-[10px] text-ink-400">back sooner</span>
              </button>
              <button onClick={() => review.mutate("good")} disabled={review.isPending}
                className="flex w-full items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50">
                <span>👍 Good</span>
                <span className="text-[10px] text-ink-400">normal cadence</span>
              </button>
              <button onClick={() => review.mutate("easy")} disabled={review.isPending}
                className="flex w-full items-center justify-between rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-sm text-brand-100 hover:bg-brand-500/20 disabled:opacity-50">
                <span>💪 Easy</span>
                <span className="text-[10px] text-ink-400">longer gap</span>
              </button>
            </div>
          )}

          {phase === "wrong" && (
            <div className="space-y-2">
              <div className="text-sm text-ink-300">
                Correct move was <b className="text-white">{item.expectedSan}</b>. We'll bring this back tomorrow.
              </div>
              <button onClick={() => review.mutate("again")} disabled={review.isPending}
                className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-50">
                🔁 Again — review tomorrow
              </button>
              <Link to={`/studies/${encodeURIComponent(item.studyId)}/edit/${encodeURIComponent(item.chapterId)}`}
                className="block text-center text-xs text-brand-300 hover:underline">
                Open the study to re-read →
              </Link>
            </div>
          )}

          {review.error && (
            <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
              {String((review.error as any)?.message || review.error)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
