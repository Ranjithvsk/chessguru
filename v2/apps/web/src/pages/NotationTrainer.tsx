// Chess Notation trainer — the "gateway" lesson every beginner needs before
// openings, book study, or reading a game score make sense.
//
// Owner ask 2026-08-19: "learn openings, need Chess Notation" — the openings
// program shows moves like "1.e4 c5 2.Nf3" and a first-timer can't parse them
// without knowing what N/B/R/Q/K stand for, how captures work, castling, etc.
//
// Two panes:
//   * Reference (left): every SAN symbol on one card with a played example.
//   * Quiz (right): random legal position + a random legal move shown in SAN;
//     the user plays that move on the board. Score + best in localStorage;
//     10-question round.
//
// No engine, no backend — chess.js drives legality, everything else is local.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board, { destsFromChess } from "../components/Board";

type Question = { fen: string; san: string; from: string; to: string; turn: "w" | "b" };

const OPENING_LINES: string[][] = [
  ["e4","e5","Nf3","Nc6","Bb5","a6","Ba4","Nf6","O-O","Be7"],       // Ruy Lopez
  ["e4","c5","Nf3","d6","d4","cxd4","Nxd4","Nf6","Nc3","a6"],       // Najdorf
  ["d4","d5","c4","e6","Nc3","Nf6","Bg5","Be7","e3","O-O"],         // QGD Orthodox
  ["d4","Nf6","c4","g6","Nc3","Bg7","e4","d6","Nf3","O-O"],         // King's Indian
  ["e4","e6","d4","d5","Nc3","Bb4","e5","c5","a3","Bxc3+"],         // French Winawer
  ["e4","c6","d4","d5","Nc3","dxe4","Nxe4","Bf5","Ng3","Bg6"],      // Caro-Kann
  ["d4","d5","c4","c6","Nf3","Nf6","Nc3","dxc4","a4","Bf5"],        // Slav
  ["e4","e5","Nf3","Nc6","Bc4","Bc5","c3","Nf6","d4","exd4"],       // Italian
  ["c4","e5","Nc3","Nf6","g3","Bb4","Bg2","O-O","e4","Bxc3"],       // English
  ["e4","e5","Nf3","Nc6","d4","exd4","Nxd4","Nf6","Nc3","Bb4"],     // Scotch 4-Knights
];

// Pick a random legal move from a chess position and return it as a Question.
// Prefers "interesting" moves (captures, checks, castling, promotions) so the
// user meets the tricky notation early — falls back to a random legal move if
// none are found (rare in mid-opening positions).
function pickMove(g: Chess): Question | null {
  const moves = g.moves({ verbose: true }) as Array<{ san: string; from: string; to: string }>;
  if (!moves.length) return null;
  const spicy = moves.filter((m) => /[x+#=O]/.test(m.san));
  const pool = spicy.length ? spicy : moves;
  const m = pool[Math.floor(Math.random() * pool.length)]!;
  return { fen: g.fen(), san: m.san, from: m.from, to: m.to, turn: g.turn() };
}

function nextQuestion(): Question {
  const line = OPENING_LINES[Math.floor(Math.random() * OPENING_LINES.length)]!;
  const cut = 2 + Math.floor(Math.random() * (line.length - 1));   // 2..line.length ply
  const g = new Chess();
  for (let i = 0; i < cut; i++) g.move(line[i]!);
  const q = pickMove(g);
  if (q) return q;
  const g2 = new Chess();
  return pickMove(g2)!;
}

const ROUND_SIZE = 10;
const BEST_KEY = "cg_notation_best_v1";

export default function NotationTrainer() {
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const [q, setQ] = useState<Question | null>(null);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<"" | "right" | "wrong">("");
  const [showHint, setShowHint] = useState(false);
  const [best, setBest] = useState<number>(() => {
    try { return Number(localStorage.getItem(BEST_KEY) || 0); } catch { return 0; }
  });
  const lockRef = useRef(false);

  const chess = useMemo(() => (q ? new Chess(q.fen) : new Chess()), [q]);
  const dests = useMemo(() => (q ? destsFromChess(chess) : new Map()), [chess, q]);

  const start = useCallback(() => {
    setPhase("run"); setIdx(0); setScore(0); setFeedback(""); setShowHint(false);
    setQ(nextQuestion()); lockRef.current = false;
  }, []);

  const advance = useCallback((correct: boolean) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setFeedback(correct ? "right" : "wrong");
    if (correct) setScore((s) => s + 1);
    setTimeout(() => {
      const nextIdx = idx + 1;
      if (nextIdx >= ROUND_SIZE) {
        setPhase("done");
        const finalScore = score + (correct ? 1 : 0);
        if (finalScore > best) {
          setBest(finalScore);
          try { localStorage.setItem(BEST_KEY, String(finalScore)); } catch { /* */ }
        }
      } else {
        setIdx(nextIdx);
        setQ(nextQuestion());
        setFeedback("");
        setShowHint(false);
      }
      lockRef.current = false;
    }, 700);
  }, [idx, score, best]);

  const onMove = (from: Key, to: Key) => {
    if (!q || phase !== "run" || lockRef.current) return;
    // Try the move; SAN comparison handles disambiguation + check/mate suffix.
    const g = new Chess(q.fen);
    let played: string | null = null;
    try {
      // Auto-queen promotions — matches chess.js default; if the target SAN
      // demands a different piece the string compare will reject it.
      const mv = g.move({ from: String(from), to: String(to), promotion: "q" });
      played = mv ? mv.san : null;
    } catch { played = null; }
    if (!played) { advance(false); return; }
    advance(played === q.san);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Study · Opening foundations</div>
          <h1 className="font-display text-2xl text-white">Chess Notation</h1>
          <p className="text-sm text-ink-400">
            Every opening line, every game score, every book: written in this notation.
            Read the reference on the left, then play the moves shown in the drill.
          </p>
        </div>
        <div className="shrink-0 text-right text-xs text-ink-400">
          <div>Best: <span className="font-bold text-brand-300">{best}/{ROUND_SIZE}</span></div>
          <Link to="/study" className="text-brand-400 hover:underline">← Study</Link>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Reference card ─────────────────────────────────────────────── */}
        <aside className="space-y-3 rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="font-display text-lg text-white">The alphabet</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-ink-800">
              <RefRow letter="K" glyph="♚" name="King" example="Kg1 = King to g1" />
              <RefRow letter="Q" glyph="♛" name="Queen" example="Qd8 = Queen to d8" />
              <RefRow letter="R" glyph="♜" name="Rook" example="Rae1 = a-file Rook to e1" />
              <RefRow letter="B" glyph="♝" name="Bishop" example="Bxc4 = Bishop takes c4" />
              <RefRow letter="N" glyph="♞" name="kNight (N — K is taken)" example="Nf3 = Knight to f3" />
              <RefRow letter="—" glyph="♟" name="Pawn (no letter)" example="e4 = Pawn to e4" />
            </tbody>
          </table>

          <h2 className="mt-4 font-display text-lg text-white">The symbols</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-ink-800">
              <RefRow letter="x" glyph="⚔" name="Captures" example="exd5, Nxe4, Bxc6+" />
              <RefRow letter="+" glyph="＋" name="Check" example="Qh5+ threatens the king" />
              <RefRow letter="#" glyph="＃" name="Checkmate" example="Qh7# — game over" />
              <RefRow letter="O-O" glyph="🏰" name="Castle king-side" example="Both sides — 3 squares" />
              <RefRow letter="O-O-O" glyph="🏰" name="Castle queen-side" example="Longer castle — 4 squares" />
              <RefRow letter="=" glyph="👑" name="Promotion" example="e8=Q, a1=N — pick a piece" />
              <RefRow letter="Ngf3" glyph="?" name="Disambiguation" example="Two Knights can go to f3 — say which" />
            </tbody>
          </table>

          <div className="mt-4 rounded-lg bg-ink-950 p-3 text-xs text-ink-400">
            <div className="font-semibold text-ink-200">Order matters</div>
            <div className="mt-1">Piece → (disambig) → (x) → square → (=piece) → (+/#).</div>
            <div className="mt-1 font-mono text-ink-300">Nb1xd2+</div>
          </div>
        </aside>

        {/* ── Quiz pane ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          {phase === "idle" && (
            <div className="space-y-3 rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center">
              <p className="text-sm text-ink-300">
                Ready? We'll show you a real opening position and a move written in notation.
                Your job: play that exact move on the board.
              </p>
              <p className="text-xs text-ink-500">{ROUND_SIZE} questions per round · your best score is saved.</p>
              <button onClick={start}
                className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-400">
                Start round →
              </button>
            </div>
          )}
          {phase === "done" && (
            <div className="space-y-3 rounded-xl2 border border-ink-700 bg-ink-900 p-6 text-center">
              <div className="text-4xl">{score === ROUND_SIZE ? "🏆" : score >= 7 ? "🎉" : score >= 4 ? "👍" : "📚"}</div>
              <div className="font-display text-2xl text-white">You got {score} / {ROUND_SIZE}</div>
              <div className="text-xs text-ink-400">
                {score === best && best > 0 ? "New personal best!" : `Best: ${best}/${ROUND_SIZE}`}
              </div>
              <button onClick={start}
                className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-400">
                Play again
              </button>
            </div>
          )}
          {phase === "run" && q && (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl2 border border-ink-700 bg-ink-900 p-4">
                <div>
                  <div className="text-[11px] uppercase text-ink-500">Play this move</div>
                  <div className="font-mono text-2xl font-bold text-white">{q.san}</div>
                  <div className="mt-1 text-xs text-ink-400">
                    {q.turn === "w" ? "White" : "Black"} to move · {idx + 1}/{ROUND_SIZE}
                  </div>
                </div>
                <div className="text-right text-xs text-ink-400">
                  <div>Score: <span className="font-bold text-brand-300">{score}</span></div>
                  <button onClick={() => setShowHint((v) => !v)}
                    className="mt-1 text-brand-400 hover:underline">
                    {showHint ? "hide hint" : "hint?"}
                  </button>
                </div>
              </div>

              <div className={`rounded-xl2 border-4 transition-colors ${
                feedback === "right" ? "border-emerald-500"
                : feedback === "wrong" ? "border-rose-500"
                : "border-transparent"}`}>
                <Board
                  fen={q.fen}
                  orientation={q.turn === "w" ? "white" : "black"}
                  turnColor={q.turn === "w" ? "white" : "black"}
                  movableColor={q.turn === "w" ? "white" : "black"}
                  dests={dests}
                  onMove={onMove}
                  showDests={showHint}
                />
              </div>

              {showHint && (
                <p className="text-xs text-ink-500">
                  💡 Hint dots are on. Piece <b className="text-ink-200">{q.san.match(/^[KQRBN]/)?.[0] ?? "Pawn"}</b>
                  {q.san.includes("x") && " · this move captures"}
                  {q.san.includes("+") && " · gives check"}
                  {q.san.includes("#") && " · delivers mate"}
                  {q.san.startsWith("O-O-O") ? " · queen-side castle"
                    : q.san.startsWith("O-O") ? " · king-side castle" : ""}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function RefRow({ letter, glyph, name, example }: { letter: string; glyph: string; name: string; example: string }) {
  return (
    <tr>
      <td className="w-14 py-1.5 font-mono text-base font-bold text-brand-300">{letter}</td>
      <td className="w-8 py-1.5 text-lg text-ink-200">{glyph}</td>
      <td className="py-1.5 text-ink-300">{name}</td>
      <td className="py-1.5 text-right font-mono text-xs text-ink-500">{example}</td>
    </tr>
  );
}
