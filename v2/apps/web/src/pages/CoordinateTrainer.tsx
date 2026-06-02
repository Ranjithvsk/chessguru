import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board from "../components/Board";

const FILES = "abcdefgh";
const SECONDS = 45;

// role -> [white FEN char, black FEN char, white glyph, black glyph, label]
const ROLES = [
  ["P", "p", "♙", "♟", "Pawn"],
  ["N", "n", "♘", "♞", "Knight"],
  ["B", "b", "♗", "♝", "Bishop"],
  ["R", "r", "♖", "♜", "Rook"],
  ["Q", "q", "♕", "♛", "Queen"],
  ["K", "k", "♔", "♚", "King"],
] as const;

type Target = { sq: string; white: boolean; roleIdx: number };
const targetChar = (t: Target) => (t.white ? ROLES[t.roleIdx]![0] : ROLES[t.roleIdx]![1]);
const targetGlyph = (t: Target) => (t.white ? ROLES[t.roleIdx]![2] : ROLES[t.roleIdx]![3]);
const targetLabel = (t: Target) => `${t.white ? "White" : "Black"} ${ROLES[t.roleIdx]![4]}`;

function fenFromPlaced(placed: Record<string, string>): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = "", e = 0;
    for (let f = 0; f < 8; f++) {
      const c = placed[FILES[f]! + r];
      if (c) { if (e) { row += e; e = 0; } row += c; } else e++;
    }
    if (e) row += e;
    rows.push(row);
  }
  return `${rows.join("/")} w - - 0 1`;
}

function pickTarget(placed: Record<string, string>): Target | null {
  const empty: string[] = [];
  for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) { const s = FILES[f]! + r; if (!placed[s]) empty.push(s); }
  if (!empty.length) return null;
  return { sq: empty[Math.floor(Math.random() * empty.length)]!, white: Math.random() < 0.5, roleIdx: Math.floor(Math.random() * 6) };
}

export default function CoordinateTrainer() {
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [showCoords, setShowCoords] = useState(false);
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Target | null>(null);
  const [score, setScore] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SECONDS);
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem("cg_coord_best") || 0); } catch { return 0; } });
  const timer = useRef<number | null>(null);

  const start = useCallback(() => {
    setPlaced({}); setScore(0); setWrong(0); setTimeLeft(SECONDS); setShapes([]);
    setTarget(pickTarget({})); setPhase("run");
  }, []);

  useEffect(() => {
    if (phase !== "run") return;
    timer.current = window.setInterval(() => {
      setTimeLeft((t) => { if (t <= 1) { if (timer.current) window.clearInterval(timer.current); setPhase("done"); return 0; } return t - 1; });
    }, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [phase]);

  useEffect(() => {
    if (phase === "done") setBest((b) => { const nb = Math.max(b, score); try { localStorage.setItem("cg_coord_best", String(nb)); } catch { /* */ } return nb; });
  }, [phase, score]);

  const onSelect = useCallback((key: Key) => {
    if (phase !== "run" || !target) return;
    if (key === target.sq) {
      setPlaced((p) => {
        const np = { ...p, [key]: targetChar(target) };
        const nt = pickTarget(np);
        setTarget(nt);
        if (!nt) { if (timer.current) window.clearInterval(timer.current); setPhase("done"); }
        return np;
      });
      setScore((s) => s + 1);
      setShapes([]);
    } else {
      setWrong((w) => w + 1);
      setShapes([{ orig: key as Key, brush: "red" }]);
    }
  }, [phase, target]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section>
        <Board key={showCoords ? "coords-on" : "coords-off"} fen={fenFromPlaced(placed)} orientation={orientation} coordinates={showCoords}
          movableColor={undefined} dests={new Map()} shapes={shapes} onSelect={onSelect} />
      </section>
      <aside className="flex flex-col gap-4">
        <Link to="/study" className="text-sm text-ink-400 hover:text-white">&larr; All studies</Link>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-gradient text-lg font-bold text-white">a1</span>
            <div>
              <h1 className="font-display text-xl text-white">Coordinate Training</h1>
              <p className="text-sm text-ink-400">Place the piece on its square</p>
            </div>
          </div>
        </div>

        {phase === "run" && target ? (
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5 text-center">
            <div className="text-xs uppercase tracking-wide text-ink-500">Place this piece</div>
            <div className="my-2 flex items-center justify-center gap-3">
              <span className={`text-5xl leading-none ${target.white ? "text-white" : "text-ink-200"}`} style={{ textShadow: target.white ? "0 0 1px #000" : undefined }}>{targetGlyph(target)}</span>
              <div className="text-left">
                <div className="font-display text-2xl font-bold text-white">{target.sq}</div>
                <div className="text-xs text-ink-400">{targetLabel(target)}</div>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
              <div className="h-full bg-accent-500" style={{ width: `${(timeLeft / SECONDS) * 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="font-semibold text-accent-400">&#10003; {score}</span>
              <span className="text-ink-400">{timeLeft}s</span>
              <span className="font-semibold text-rose-400">&#10007; {wrong}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5 text-center">
            {phase === "done" ? (
              <>
                <div className="text-sm text-ink-400">Time! You placed</div>
                <div className="my-1 font-display text-6xl font-bold text-accent-400">{score}</div>
                <div className="text-xs text-ink-500">pieces correctly &middot; best {best}</div>
              </>
            ) : (
              <p className="mb-2 text-sm text-ink-400">A piece + square appears (e.g. <b className="text-white">Black Rook → e7</b>). Tap that square to place it. Best: {best}</p>
            )}
            <button onClick={start} className="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">
              {phase === "done" ? "Play again" : "Start"}
            </button>
          </div>
        )}

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-2 text-xs uppercase tracking-wide text-ink-500">Board side</div>
          <div className="flex gap-2">
            {(["white", "black"] as const).map((o) => (
              <button key={o} onClick={() => setOrientation(o)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize ${orientation === o ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
                {o}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCoords((v) => !v)}
            className="mt-3 w-full rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-300 hover:bg-ink-800">
            {showCoords ? "Hide coordinates" : "Show coordinates"}
          </button>
          <p className="mt-3 text-xs text-ink-500">{showCoords ? "Coordinates shown — training wheels on." : "Coordinates hidden — that’s the real test."} Pieces stay where you put them.</p>
        </div>
      </aside>
    </div>
  );
}
