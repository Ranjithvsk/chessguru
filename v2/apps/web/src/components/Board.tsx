import { useEffect, useRef, useState } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key, Color, Dests, Role } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import { CBURNETT_PIECES } from "./cburnett-pieces";

export type Promotion = "q" | "r" | "b" | "n";

/**
 * The single shared chess board for ChessGuru v2.
 * Every page (Puzzles, Blindfold, Theme, Opening, Engine Battle, Board Editor)
 * renders THIS component and only varies the props.
 */
export interface BoardProps {
  fen: string;
  orientation?: Color;                 // default "white"
  turnColor?: Color;                   // whose move it is
  movableColor?: Color | "both";       // who may move (undefined = nobody)
  dests?: Dests;                       // legal destinations per square
  lastMove?: [Key, Key];
  check?: boolean;                     // highlight the side-to-move's king
  viewOnly?: boolean;                  // spectator (Engine Battle)
  coordinates?: boolean;               // default true
  blindfold?: boolean;                 // hide pieces (Blindfold mode)
  shapes?: DrawShape[];                // arrows/circles (hints, engine PV, coach annotations)
  onShapesChange?: (shapes: DrawShape[]) => void; // fires on user draw/clear (right-click)
  onMove?: (from: Key, to: Key, promotion?: Promotion) => void;
  onPremove?: (from: Key, to: Key) => void;
  premovable?: boolean;
  /** Show chessground's legal-move dots when a piece is selected. Default false. */
  showDests?: boolean;
  /** When true, clicking a piece does NOT select it — no selected-square
   *  highlight, no destination hints. Piece can still be moved by dragging.
   *  Used by the Dream Meet coach board (owner ask 2026-09-03: "when coach
   *  click piece, it highlight the possible move for that piece, remove
   *  that"). Default false — most surfaces want the normal click-to-select
   *  UX (touch devices, students, puzzles). */
  hideMoveHints?: boolean;
  onSelect?: (key: Key) => void;
  className?: string;
  /** Force chessground to re-apply the current fen when this value changes,
   *  even if fen itself is unchanged. Used by drills to snap a wrong-move
   *  piece back to its origin square (owner report 2026-08-20 — "I can't
   *  undo wrong move"). */
  syncNonce?: number;
}

export default function Board({
  fen,
  orientation = "white",
  turnColor,
  movableColor,
  dests,
  lastMove,
  check = false,
  viewOnly = false,
  coordinates = true,
  blindfold = false,
  shapes,
  onShapesChange,
  onMove,
  onPremove,
  premovable = false,
  onSelect,
  showDests = false,
  hideMoveHints = false,
  className = "",
  syncNonce,
}: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  // Pending under-promotion picker. TKT-90 (2026-08-27): without this,
  // chessground's `after` event fires with just (from,to) and callers
  // silently defaulted to queen — every knight/rook/bishop-promotion
  // puzzle was unsolvable. When we detect a pawn landing on rank 1/8,
  // suspend the onMove callback until the user picks Q/R/B/N.
  const [pending, setPending] = useState<{ from: Key; to: Key; color: Color } | null>(null);

  // chessground is created once, so its event handlers would capture the
  // first-render callbacks — when the puzzle is still loading, submit() closes
  // over an undefined puzzle and bails. Route events through refs kept current
  // each render so the live onMove/submit always runs.
  const onMoveRef = useRef(onMove);
  const onPremoveRef = useRef(onPremove);
  const onSelectRef = useRef(onSelect);
  const onShapesChangeRef = useRef(onShapesChange);
  useEffect(() => { onMoveRef.current = onMove; onPremoveRef.current = onPremove; onSelectRef.current = onSelect; onShapesChangeRef.current = onShapesChange; });

  // A pawn move to rank 8 (white) or rank 1 (black) is a promotion.
  // We inspect the destination square's piece after chessground's animation
  // settled — chessground stores the moving piece there without auto-promoting.
  function isPromotion(from: Key, to: Key): { color: Color } | null {
    const piece = api.current?.state.pieces.get(to);
    if (!piece || piece.role !== "pawn") return null;
    const lastRank = piece.color === "white" ? "8" : "1";
    if (to[1] !== lastRank) return null;
    // Sanity: pawn actually came from the adjacent rank.
    void from;
    return { color: piece.color };
  }

  function handleAfter(from: Key, to: Key) {
    const p = isPromotion(from, to);
    if (p) { setPending({ from, to, color: p.color }); return; }
    onMoveRef.current?.(from, to);
  }

  function pick(role: Promotion) {
    if (!pending) return;
    const { from, to, color } = pending;
    setPending(null);
    // Reflect the choice on the board immediately so the render doesn't
    // flash a pawn on rank 8 while the caller catches up via fen prop.
    const roleFull: Role = role === "q" ? "queen" : role === "r" ? "rook" : role === "b" ? "bishop" : "knight";
    api.current?.setPieces(new Map([[to, { role: roleFull, color, promoted: true }]]));
    onMoveRef.current?.(from, to, role);
  }

  // create once
  useEffect(() => {
    if (!el.current) return;
    const config: Config = {
      fen,
      orientation,
      turnColor,
      coordinates,
      viewOnly,
      lastMove,
      check: check ? turnColor : undefined,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: movableColor,
        dests,
        // hideMoveHints wins: coach board wants zero visual feedback on
        // click. Otherwise honour the caller's opt-in (practice pages set
        // true so students see destination dots).
        showDests: hideMoveHints ? false : showDests,
        events: { after: (from, to) => handleAfter(from, to) },
      },
      premovable: {
        enabled: premovable,
        showDests: true,
        events: { set: (orig, dest) => onPremoveRef.current?.(orig, dest) },
      },
      // selectable stays ON regardless — disabling it kills tap-to-move
      // on touch (owner report 2026-09-03: "now coach also cant move"
      // after I tried selectable:false to hide the click hints). Dest
      // hints alone are enough to hide via movable.showDests above.
      selectable: { enabled: true },
      events: { select: (key) => onSelectRef.current?.(key) },
      // drawable.onChange fires when the USER draws/erases shapes via right-click.
      // Programmatic setShapes() from the sync effect below does NOT trigger it, so
      // there's no echo loop with remote annotations.
      drawable: {
        enabled: true, visible: true,
        // Chessground default is eraseOnClick:true — a left-click on the
        // board (moving a piece, selecting a square) wipes every shape.
        // That was silently killing the Dream Meet coach's arrows: draw
        // arrow → click board → arrow gone, before the 1-s debounced
        // persistence save could fire. Owner report Sep 2 2026. Shapes
        // now stick until removed (right-click a shape to erase it) or
        // until a position change (see class-ws clearShapesAndBroadcast).
        eraseOnClick: false,
        onChange: (s) => onShapesChangeRef.current?.(s),
        // Custom brushes for the annotation toolbar's cross tool +
        // Phase 2 attack overlay (2026-09-02). Chessground merges
        // these with its defaults (green/red/blue/yellow). Names
        // must match the shape.brush strings used by AnnotationToolbar
        // + computeAttackShapes.
        brushes: {
          purple:        { key: "annot-purple",   color: "#6b21a8", opacity: 1,    lineWidth: 10 },
          brushCross:    { key: "annot-cross",    color: "#dc2626", opacity: 0.9,  lineWidth: 10 },
          attackSource:  { key: "attack-source",  color: "#f59e0b", opacity: 0.7,  lineWidth: 10 },
          attackAttack:  { key: "attack-attack",  color: "#dc2626", opacity: 0.55, lineWidth: 8 },
          attackDefend:  { key: "attack-defend",  color: "#3b82f6", opacity: 0.5,  lineWidth: 8 },
          attackControl: { key: "attack-control", color: "#f59e0b", opacity: 0.35, lineWidth: 6 },
        } as any,
      },
    };
    api.current = Chessground(el.current, config);
    if (shapes) api.current.setShapes(shapes);
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sync on prop changes
  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      turnColor,
      coordinates,
      viewOnly,
      lastMove,
      check: check ? turnColor : undefined,
      // showDests MUST be re-set here — chessground's default is TRUE, so
      // any api.set() that touches `movable` without passing showDests can
      // silently revert to showing the dest hints (owner report 2026-09-03:
      // "when I click knight, it should not highlight possible move
      // locations, still in shows"). Include it explicitly so the coach's
      // click-highlight stays off after every re-render.
      movable: { color: movableColor, dests, showDests: hideMoveHints ? false : showDests },
    });
    api.current?.cancelPremove();
  }, [fen, orientation, turnColor, coordinates, viewOnly, lastMove, check, movableColor, dests, syncNonce, hideMoveHints, showDests]);

  // shapes (hints / engine arrows)
  useEffect(() => {
    api.current?.setShapes(shapes ?? []);
  }, [shapes]);

  // Position the picker column above/below the promotion square in a way
  // that always stays inside the board. The board is 8×8; each square is
  // 12.5% of width/height. Orientation matters — chessground flips coords
  // for black-at-bottom.
  const pickerPos = pending ? (() => {
    const file = pending.to.charCodeAt(0) - 97;              // a=0..h=7
    const rank = Number(pending.to[1]) - 1;                  // 1=0..8=7
    const col = orientation === "white" ? file : 7 - file;
    const row = orientation === "white" ? 7 - rank : rank;   // top row = 0
    // If the promotion square is on the top half, stack the picker downward;
    // otherwise upward. The picker is 4 squares tall.
    const downward = row <= 3;
    const topStart = downward ? row : row - 3;
    return { leftPct: col * 12.5, topPct: topStart * 12.5, downward };
  })() : null;

  const pickerOrder: Promotion[] = pickerPos?.downward
    ? (pending?.color === "white" ? ["q", "n", "r", "b"] : ["q", "n", "r", "b"])
    : (pending?.color === "white" ? ["b", "r", "n", "q"] : ["b", "r", "n", "q"]);

  return (
    <div className={`cg-board-wrap ${blindfold ? "blindfold" : ""} ${className}`} style={{ position: "relative" }}>
      <div ref={el} style={{ width: "100%", height: "100%" }} />
      {pending && pickerPos && (
        <div
          role="dialog"
          aria-label="Choose promotion piece"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: `${pickerPos.leftPct}%`,
            top: `${pickerPos.topPct}%`,
            width: "12.5%",
            height: "50%",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {pickerOrder.map((r) => {
            const roleFull: Role = r === "q" ? "queen" : r === "r" ? "rook" : r === "b" ? "bishop" : "knight";
            return (
              <button
                key={r}
                type="button"
                onClick={() => pick(r)}
                aria-label={roleFull}
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                  position: "relative",
                }}
              >
                <span
                  className={`cg-promo-piece ${pending.color} ${roleFull}`}
                  style={{
                    position: "absolute",
                    inset: 4,
                    backgroundImage: `url(${pieceUrl(pending.color, roleFull)})`,
                    backgroundSize: "contain",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center",
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Reuse the same cburnett SVGs the rest of the board uses (already bundled).
function pieceUrl(color: Color, role: Role): string {
  const letter = role === "knight" ? "N" : role.charAt(0).toUpperCase();
  const key = color === "white" ? letter : letter.toLowerCase();
  return CBURNETT_PIECES[key] || "";
}

/** Build chessground dests from a chess.js instance (shared helper). */
export function destsFromChess(game: { moves: (o: { verbose: true }) => Array<{ from: string; to: string }> }): Dests {
  const m: Dests = new Map();
  for (const mv of game.moves({ verbose: true })) {
    const arr = m.get(mv.from as Key) ?? [];
    arr.push(mv.to as Key);
    m.set(mv.from as Key, arr);
  }
  return m;
}
