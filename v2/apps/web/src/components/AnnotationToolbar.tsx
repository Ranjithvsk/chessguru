// Annotation toolbar — visible controls for arrows / circles / crosses on
// the board (owner ask 2026-09-02 "arrow and click to highlight square").
// Chessground already supports these via hidden right-click gestures; this
// exposes them for tablet users + coaches who don't know the gestures.
//
// Phase 2 (2026-09-02): 🎯 attack overlay — toggle on, click a piece,
// every square it attacks lights up as a subtle marker. Uses chess.js's
// `attackers()` per square so the result matches chess reality (includes
// defenders of own pieces + captures, not just legal moves).
//
// Used by both Dream Meet (SharedClassBoard) and /openings. Presentation
// is identical; interaction logic (parent handles onClick square routing
// via useAnnotationTool()) lets each host wire into its own shape state.

import { useCallback, useEffect, useState } from "react";
import { Chess } from "chess.js";

export type AnnotationTool = "cursor" | "arrow" | "circle" | "cross";
export type AnnotationBrush = "green" | "red" | "blue" | "yellow" | "purple";

// Colours match chessground's built-in brush names so shapes render
// with the library's stock renderer. "purple" isn't a chessground
// default — see `brushDefs` in AnnotationToolbar consumers.
const BRUSH_META: Record<AnnotationBrush, { label: string; hex: string }> = {
  green:  { label: "Good move / correct",   hex: "#15781B" },
  red:    { label: "Bad move / mistake",    hex: "#882020" },
  blue:   { label: "Interesting / plan",    hex: "#003088" },
  yellow: { label: "Attention / key square", hex: "#e68f00" },
  purple: { label: "Idea / long-term",       hex: "#6b21a8" },
};

const TOOL_META: Record<AnnotationTool, { label: string; icon: string; hint: string }> = {
  cursor: { label: "Cursor", icon: "🖱", hint: "Normal — move pieces + draw shapes via right-click" },
  arrow:  { label: "Arrow",  icon: "→", hint: "Click a square, then a target to draw an arrow" },
  circle: { label: "Circle", icon: "◯", hint: "Click a square to circle it (click again to remove)" },
  cross:  { label: "Cross",  icon: "✕", hint: "Click a square to mark ✕ (bad/avoid)" },
};

/** Persisted per user via localStorage — the tool + colour survive reloads
 *  so a coach's preferred setup ("cursor + red brush by default") sticks. */
export function useAnnotationTool() {
  const [tool, _setTool] = useState<AnnotationTool>(() => {
    try { return (localStorage.getItem("cg_annot_tool") as AnnotationTool) || "cursor"; } catch { return "cursor"; }
  });
  const [brush, _setBrush] = useState<AnnotationBrush>(() => {
    try { return (localStorage.getItem("cg_annot_brush") as AnnotationBrush) || "green"; } catch { return "green"; }
  });
  const setTool  = useCallback((t: AnnotationTool)  => { _setTool(t);  try { localStorage.setItem("cg_annot_tool", t); }  catch { /* */ } }, []);
  const setBrush = useCallback((b: AnnotationBrush) => { _setBrush(b); try { localStorage.setItem("cg_annot_brush", b); } catch { /* */ } }, []);
  // Pending source-square for the arrow tool: we're waiting for a second
  // click to complete the arrow. Reset on tool change / escape.
  const [pendingArrowFrom, setPendingArrowFrom] = useState<string | null>(null);
  useEffect(() => { setPendingArrowFrom(null); }, [tool]);
  // Attack-overlay mode (Phase 2). When ON, clicking a piece renders
  // every square that piece attacks. attackShownFrom is the currently-
  // shown source square (or null if nothing selected).
  const [attackMode, _setAttackMode] = useState<boolean>(() => {
    try { return localStorage.getItem("cg_annot_attack") === "1"; } catch { return false; }
  });
  const setAttackMode = useCallback((v: boolean) => { _setAttackMode(v); try { localStorage.setItem("cg_annot_attack", v ? "1" : "0"); } catch { /* */ } }, []);
  const [attackShownFrom, setAttackShownFrom] = useState<string | null>(null);
  // Switching tools OR turning off attack mode clears the pinned square.
  useEffect(() => { if (!attackMode) setAttackShownFrom(null); }, [attackMode]);
  useEffect(() => { if (tool !== "cursor") setAttackShownFrom(null); }, [tool]);
  // Escape returns to cursor tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
      if (e.key === "Escape") { _setTool("cursor"); setPendingArrowFrom(null); }
      else if (e.key.toLowerCase() === "a") setTool("arrow");
      else if (e.key.toLowerCase() === "c") setTool("circle");
      else if (e.key.toLowerCase() === "x") setTool("cross");
      else if (e.key === "1") setBrush("green");
      else if (e.key === "2") setBrush("red");
      else if (e.key === "3") setBrush("blue");
      else if (e.key === "4") setBrush("yellow");
      else if (e.key === "5") setBrush("purple");
      else if (e.key.toLowerCase() === "t") setAttackMode(!attackMode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool, setBrush, attackMode, setAttackMode]);

  return {
    tool, setTool,
    brush, setBrush,
    pendingArrowFrom, setPendingArrowFrom,
    attackMode, setAttackMode,
    attackShownFrom, setAttackShownFrom,
  };
}

/** Compute attack shapes for the given source-square on the given FEN.
 *  Returns chessground-shaped `{orig, brush?}` circles marking every
 *  square the source piece attacks (empty AND own-defended AND captures).
 *  Three brush flavours:
 *    * "attackAttack" — attacks an enemy piece (red-ish circle)
 *    * "attackDefend" — defends an own piece   (blue-ish circle)
 *    * "attackControl" — empty square controlled (yellow-ish dot)
 *  Consumers extend chessground's brush config with these colours.
 *
 *  Uses chess.js's attackers(sq, color) — walks all 64 squares, checks
 *  if `from` appears in the attackers of the target for the piece's
 *  own color. That covers piece-native movement WITHOUT depending on
 *  legality (a piece can "attack" a square even if it's pinned). */
export function computeAttackShapes(fen: string, from: string): Array<{ orig: string; brush?: string }> {
  try {
    const c = new Chess(fen);
    const piece = c.get(from as any);
    if (!piece) return [];
    const shapes: Array<{ orig: string; brush?: string }> = [{ orig: from, brush: "attackSource" }];
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
    for (const f of files) {
      for (let r = 1; r <= 8; r++) {
        const target = `${f}${r}`;
        if (target === from) continue;
        // attackers(target, ownColor) = pieces of `ownColor` that attack `target`.
        let attackers: string[] = [];
        try { attackers = c.attackers(target as any, piece.color) as unknown as string[]; }
        catch { continue; }
        if (!attackers.includes(from as any)) continue;
        const occupant = c.get(target as any);
        if (!occupant) {
          shapes.push({ orig: target, brush: "attackControl" });
        } else if (occupant.color === piece.color) {
          shapes.push({ orig: target, brush: "attackDefend" });
        } else {
          shapes.push({ orig: target, brush: "attackAttack" });
        }
      }
    }
    return shapes;
  } catch { return []; }
}

/** Apply a click to the current shape list per the active tool. Returns
 *  the NEXT shapes array (immutable). Caller pushes it into their state /
 *  broadcast pipeline.
 *
 *  Cross tool uses a special brush name "brushCross" that consumers
 *  render via chessground's `drawable.brushes` config extension — see
 *  the brushDefs export below.
 *
 *  If the arrow tool is mid-select (pendingArrowFrom set) and the user
 *  clicks the SAME square, cancel; otherwise draw arrow from → to. */
export function applyAnnotationClick(
  square: string,
  currentShapes: Array<{ orig: string; dest?: string; brush?: string }>,
  state: ReturnType<typeof useAnnotationTool>,
): Array<{ orig: string; dest?: string; brush?: string }> | null {
  const { tool, brush, pendingArrowFrom, setPendingArrowFrom } = state;
  if (tool === "cursor") return null;

  if (tool === "circle") {
    // Toggle circle with current brush at this square.
    const existing = currentShapes.findIndex((s) => s.orig === square && !s.dest && s.brush === brush);
    if (existing !== -1) return currentShapes.filter((_, i) => i !== existing);
    return [...currentShapes, { orig: square, brush }];
  }

  if (tool === "cross") {
    // Toggle cross (same as circle but brush "brushCross" so consumer
    // can render an X marker via customBrush).
    const existing = currentShapes.findIndex((s) => s.orig === square && !s.dest && s.brush === "brushCross");
    if (existing !== -1) return currentShapes.filter((_, i) => i !== existing);
    return [...currentShapes, { orig: square, brush: "brushCross" }];
  }

  if (tool === "arrow") {
    if (!pendingArrowFrom) {
      setPendingArrowFrom(square);
      return null;   // don't modify shapes yet — waiting for target
    }
    if (pendingArrowFrom === square) {
      // Same square = cancel selection.
      setPendingArrowFrom(null);
      return null;
    }
    const shape = { orig: pendingArrowFrom, dest: square, brush };
    setPendingArrowFrom(null);
    // Toggle: if this exact arrow already exists, remove it.
    const existing = currentShapes.findIndex((s) => s.orig === shape.orig && s.dest === shape.dest && s.brush === shape.brush);
    if (existing !== -1) return currentShapes.filter((_, i) => i !== existing);
    return [...currentShapes, shape];
  }
  return null;
}

/** The visible bar. Renders below the board — 44 px tall touch targets so
 *  it works on tablets. Cursor / Arrow / Circle / Cross buttons + colour
 *  palette + 🎯 Attack toggle + Clear. Keyboard shortcuts shown in tooltips. */
export function AnnotationToolbar({
  tool, brush, onToolChange, onBrushChange, onClear, hasShapes, attackMode, onAttackModeChange,
}: {
  tool: AnnotationTool;
  brush: AnnotationBrush;
  onToolChange: (t: AnnotationTool) => void;
  onBrushChange: (b: AnnotationBrush) => void;
  onClear: () => void;
  hasShapes: boolean;
  attackMode?: boolean;
  onAttackModeChange?: (v: boolean) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-1 rounded-full border border-ink-700 bg-ink-900/70 p-1 shadow-sm">
      {/* Tools */}
      {(["cursor", "arrow", "circle", "cross"] as AnnotationTool[]).map((t) => {
        const meta = TOOL_META[t];
        const active = tool === t;
        return (
          <button
            key={t}
            onClick={() => onToolChange(t)}
            title={`${meta.label} — ${meta.hint}${t !== "cursor" ? ` (${t[0].toUpperCase()})` : ""}`}
            className={`grid h-9 min-w-9 place-items-center rounded-full px-2 text-base transition ${active ? "bg-brand-500 text-white shadow-glow" : "text-ink-300 hover:bg-ink-800"}`}
          >
            <span aria-hidden>{meta.icon}</span>
          </button>
        );
      })}
      <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden />
      {/* Colours */}
      {(Object.keys(BRUSH_META) as AnnotationBrush[]).map((b, i) => {
        const meta = BRUSH_META[b];
        const active = brush === b;
        return (
          <button
            key={b}
            onClick={() => onBrushChange(b)}
            title={`${meta.label} (${i + 1})`}
            className={`grid h-8 w-8 place-items-center rounded-full transition ${active ? "ring-2 ring-white ring-offset-2 ring-offset-ink-900" : "hover:ring-1 hover:ring-white/40"}`}
            style={{ backgroundColor: meta.hex }}
          />
        );
      })}
      {/* Attack overlay toggle (Phase 2). Optional prop — consumers that
       *  don't want it just don't pass onAttackModeChange. */}
      {onAttackModeChange && (
        <>
          <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden />
          <button
            onClick={() => onAttackModeChange(!attackMode)}
            title="Attack view (T) — click a piece to see every square it attacks/defends"
            className={`grid h-9 min-w-9 place-items-center rounded-full px-2 text-base transition ${attackMode ? "bg-amber-500 text-white shadow-glow" : "text-ink-300 hover:bg-ink-800"}`}
          >
            🎯
          </button>
        </>
      )}
      <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden />
      <button
        onClick={onClear}
        disabled={!hasShapes}
        title="Remove every arrow / circle / cross on the current position"
        className="grid h-9 min-w-9 place-items-center rounded-full px-3 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-30"
      >
        🗑 Clear
      </button>
    </div>
  );
}

/** Chessground brush override for the ✕ cross marker. Consumer passes
 *  `drawable.brushes = { ...defaultBrushes, brushCross: {...} }` in its
 *  Chessground config. `brushCross` = a saturated red without an arrow-
 *  head so it renders as a filled square marker. The visual ✕ overlay
 *  itself is drawn by consumers via a small SVG on top of that square. */
export const BRUSH_HEXES = Object.fromEntries(
  Object.entries(BRUSH_META).map(([k, v]) => [k, v.hex]),
) as Record<AnnotationBrush, string>;
