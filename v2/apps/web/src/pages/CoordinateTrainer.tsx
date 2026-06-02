import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Board from "../components/Board";

const FILES = "abcdefgh";
const SECONDS = 45;
const ROLES = [
  { wc: "P", bc: "p", glyph: "♟", label: "Pawn" },
  { wc: "N", bc: "n", glyph: "♞", label: "Knight" },
  { wc: "B", bc: "b", glyph: "♝", label: "Bishop" },
  { wc: "R", bc: "r", glyph: "♜", label: "Rook" },
  { wc: "Q", bc: "q", glyph: "♛", label: "Queen" },
  { wc: "K", bc: "k", glyph: "♚", label: "King" },
] as const;

type Target = { sq: string; white: boolean; roleIdx: number };
type Sel = { white: boolean; roleIdx: number };
type Drag = Sel & { x: number; y: number; sx: number; sy: number; moved: boolean };

const tChar = (t: Target) => (t.white ? ROLES[t.roleIdx]!.wc : ROLES[t.roleIdx]!.bc);
const tLabel = (t: Target) => `${t.white ? "White" : "Black"} ${ROLES[t.roleIdx]!.label}`;

function fenFromPlaced(placed: Record<string, string>): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = "", e = 0;
    for (let f = 0; f < 8; f++) { const c = placed[FILES[f]! + r]; if (c) { if (e) { row += e; e = 0; } row += c; } else e++; }
    if (e) row += e; rows.push(row);
  }
  return `${rows.join("/")} w - - 0 1`;
}
function pickTarget(placed: Record<string, string>): Target | null {
  const empty: string[] = [];
  for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) { const s = FILES[f]! + r; if (!placed[s]) empty.push(s); }
  if (!empty.length) return null;
  return { sq: empty[Math.floor(Math.random() * empty.length)]!, white: Math.random() < 0.5, roleIdx: Math.floor(Math.random() * 6) };
}
function squareFromPoint(x: number, y: number, orientation: "white" | "black"): string | null {
  const el = document.querySelector("cg-board"); if (!el) return null;
  const r = el.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return null;
  const s = r.width / 8;
  const col = Math.max(0, Math.min(7, Math.floor((x - r.left) / s)));
  const row = Math.max(0, Math.min(7, Math.floor((y - r.top) / s)));
  const file = orientation === "white" ? col : 7 - col;
  const rank = orientation === "white" ? 8 - row : row + 1;
  return FILES[file]! + rank;
}
const glyphStyle = (white: boolean): React.CSSProperties =>
  white ? { color: "#f1f5f9", textShadow: "0 1px 2px #000, 0 0 2px #000" }
        : { color: "#0b0f17", textShadow: "0 0 1px #94a3b8, 0 0 2px #cbd5e1" };

export default function CoordinateTrainer() {
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [showCoords, setShowCoords] = useState(false);
  const [timed, setTimed] = useState(true);
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Target | null>(null);
  const [selected, setSelected] = useState<Sel | null>(null);
  const [score, setScore] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SECONDS);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem("cg_coord_best") || 0); } catch { return 0; } });
  const timer = useRef<number | null>(null);

  const start = useCallback(() => {
    setPlaced({}); setScore(0); setWrong(0); setSelected(null); setTimeLeft(SECONDS); setTarget(pickTarget({})); setPhase("run");
  }, []);

  useEffect(() => {
    if (phase !== "run" || !timed) return;
    timer.current = window.setInterval(() => {
      setTimeLeft((t) => { if (t <= 1) { if (timer.current) window.clearInterval(timer.current); setPhase("done"); return 0; } return t - 1; });
    }, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [phase, timed]);

  useEffect(() => {
    if (phase === "done" && timed) setBest((b) => { const nb = Math.max(b, score); try { localStorage.setItem("cg_coord_best", String(nb)); } catch { /* */ } return nb; });
  }, [phase, score, timed]);

  // shared placement check (used by both drag-drop and click-to-place)
  const tryPlace = useCallback((piece: Sel, sq: string) => {
    if (!target) return;
    if (piece.white === target.white && piece.roleIdx === target.roleIdx && sq === target.sq) {
      setPlaced((p) => { const np = { ...p, [sq]: tChar(target) }; const nt = pickTarget(np); setTarget(nt); if (!nt) { if (timer.current) window.clearInterval(timer.current); setPhase("done"); } return np; });
      setScore((s) => s + 1); setSelected(null);
    } else { setWrong((w) => w + 1); setWrongFlash(true); window.setTimeout(() => setWrongFlash(false), 450); }
  }, [target]);

  // drag (mouse/touch) — tap = select, move = drag-drop
  useEffect(() => {
    if (!drag) return;
    const ori = orientation; const piece: Sel = { white: drag.white, roleIdx: drag.roleIdx };
    const mv = (e: PointerEvent) => { e.preventDefault(); setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8 } : d)); };
    const up = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8;
      setDrag(null);
      if (moved) { const sq = squareFromPoint(e.clientX, e.clientY, ori); if (sq) tryPlace(piece, sq); }
      else { setSelected((s) => (s && s.white === piece.white && s.roleIdx === piece.roleIdx ? null : piece)); } // tap toggles selection
    };
    window.addEventListener("pointermove", mv, { passive: false });
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.white, drag?.roleIdx]);

  const startDrag = (white: boolean, roleIdx: number) => (e: React.PointerEvent) => {
    if (phase !== "run") return;
    e.preventDefault();
    setDrag({ white, roleIdx, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
  };

  // click-to-place: a selected piece + a tapped square (own square math, viewOnly board)
  const onBoardClick = useCallback((e: React.MouseEvent) => {
    if (phase !== "run" || !selected) return;
    const sq = squareFromPoint(e.clientX, e.clientY, orientation);
    if (sq) tryPlace(selected, sq);
  }, [phase, selected, tryPlace, orientation]);

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      <div className="flex items-center justify-between">
        <Link to="/study" className="text-sm text-ink-400 hover:text-white">&larr; All studies</Link>
        <span className="text-xs font-medium text-ink-500">Coordinate Training</span>
      </div>

      {phase === "run" && target && (
        <div className={`rounded-xl2 border bg-ink-900 p-3 transition-colors ${wrongFlash ? "border-rose-500" : "border-ink-700"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-4xl leading-none" style={glyphStyle(target.white)}>{ROLES[target.roleIdx]!.glyph}</span>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-ink-500">Place on</div>
                <div className="font-display text-2xl font-bold leading-tight text-white">{target.sq}</div>
                <div className="text-[11px] text-ink-400">{tLabel(target)}{selected ? " · piece selected, tap the square" : " · drag it, or tap it then the square"}</div>
              </div>
            </div>
            <div className="text-right text-sm leading-tight">
              <div className="font-semibold text-accent-400">&#10003; {score}</div>
              <div className="text-ink-400">{timed ? `${timeLeft}s` : "\u221E"}</div>
              <div className="font-semibold text-rose-400">&#10007; {wrong}</div>
            </div>
          </div>
          {timed
            ? <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800"><div className="h-full bg-accent-500" style={{ width: `${(timeLeft / SECONDS) * 100}%` }} /></div>
            : <button onClick={() => { if (timer.current) window.clearInterval(timer.current); setPhase("done"); }} className="mt-2 w-full rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">Finish &amp; see score</button>}
        </div>
      )}

      {/* PIECE TRAY — tap to select or drag */}
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-2">
        {([true, false] as const).map((white) => (
          <div key={String(white)} className="flex justify-around gap-1">
            {ROLES.map((role, ri) => {
              const isSel = !!selected && selected.white === white && selected.roleIdx === ri;
              return (
                <div key={ri} onPointerDown={startDrag(white, ri)}
                  style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: phase === "run" ? "grab" : "default", opacity: phase === "run" ? 1 : 0.5 }}
                  className={`grid h-10 w-10 place-items-center rounded-lg text-3xl leading-none ${isSel ? "bg-brand-600 ring-2 ring-brand-400" : "hover:bg-ink-800"}`}>
                  <span style={glyphStyle(white)}>{role.glyph}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div onClick={onBoardClick}>
        <Board key={showCoords ? "coords-on" : "coords-off"} fen={fenFromPlaced(placed)} orientation={orientation}
          coordinates={showCoords} viewOnly movableColor={undefined} dests={new Map()} />
      </div>

      <div className="flex items-center gap-2">
        {(["white", "black"] as const).map((o) => (
          <button key={o} onClick={() => setOrientation(o)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize ${orientation === o ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>{o}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setShowCoords((v) => !v)} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-300 hover:bg-ink-800">{showCoords ? "Hide coords" : "Show coords"}</button>
        <button onClick={() => setTimed((v) => !v)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${timed ? "border border-ink-600 text-ink-300 hover:bg-ink-800" : "bg-brand-600 text-white"}`}>{timed ? "Timer: On" : "Timer: Off (practice)"}</button>
      </div>

      {phase !== "run" && (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4 text-center">
          {phase === "done" ? (
            <div className="mb-2"><span className="text-sm text-ink-400">{timed ? "Time! You placed " : "You placed "}</span><span className="font-display text-2xl font-bold text-accent-400">{score}</span><span className="text-sm text-ink-400">{timed ? ` · best ${best}` : ""}</span></div>
          ) : (
            <p className="mb-2 text-sm text-ink-400">A piece + square appears. <b className="text-white">Drag</b> the matching piece onto the square — or <b className="text-white">tap the piece then the square</b>. Best: {best}</p>
          )}
          <button onClick={start} className="w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">{phase === "done" ? "Play again" : "Start"}</button>
        </div>
      )}

      {drag && drag.moved && (
        <div style={{ position: "fixed", left: drag.x, top: drag.y, transform: "translate(-50%,-55%)", pointerEvents: "none", zIndex: 60, fontSize: 46, lineHeight: 1 }}>
          <span style={glyphStyle(drag.white)}>{ROLES[drag.roleIdx]!.glyph}</span>
        </div>
      )}
    </div>
  );
}
