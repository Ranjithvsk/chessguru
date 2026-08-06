// Turn an opening's moves into MEMORY ANCHORS: every move = a piece-character doing
// something to the destination square's vivid scene. This is the doc's
// "[Character] + [Action] + [Square scene]" move-reading, applied to a whole opening.
import { Chess } from "chess.js";
import { WHITE_ARMY, BLACK_ARMY, isLightSquare, type Scene } from "./memoryPalace";

export interface OpeningStep {
  ply: number;        // 1-based
  san: string;        // e.g. "Nf3"
  from: string;
  to: string;         // the anchor square
  role: string;       // "Pawn" | "Knight" | ... (matches PieceChar.role)
  color: "w" | "b";
  capture: boolean;
  check: boolean;
  castle: boolean;
  fen: string;        // position AFTER the move
  /** Which specific piece moved — used by anchorFor to pick the named character:
   *   - Knight: "b" (queen-side) | "g" (king-side)
   *   - Rook:   "a" | "h"
   *   - Pawn:   "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" (starting file)
   *   - Others: undefined (bishops derive from step.to colour). */
  variant?: string;
}

const ROLE: Record<string, string> = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };

/** Replay a SAN line into per-move steps (stops at the first illegal SAN).
 *  Maintains per-side lineage maps for KNIGHTS, ROOKS, and PAWNS so each
 *  move's `variant` sticks to a specific piece across the whole game
 *  (Bheem/Chutki, Dholu/Bholu, Kevin/Stuart/…, and their black counterparts).
 *  Handles captures, castling (rook moves too), en passant, and promotion. */
export function buildSteps(sans: string[]): OpeningStep[] {
  const g = new Chess();
  const out: OpeningStep[] = [];
  const wKnight: Record<string, string> = { b1: "b", g1: "g" };
  const bKnight: Record<string, string> = { b8: "b", g8: "g" };
  const wRook:   Record<string, string> = { a1: "a", h1: "h" };
  const bRook:   Record<string, string> = { a8: "a", h8: "h" };
  const wPawn:   Record<string, string> = {};
  const bPawn:   Record<string, string> = {};
  for (const f of "abcdefgh") { wPawn[f + "2"] = f; bPawn[f + "7"] = f; }

  const mapFor = (piece: string, color: string): Record<string, string> | null => {
    if (piece === "n") return color === "w" ? wKnight : bKnight;
    if (piece === "r") return color === "w" ? wRook : bRook;
    if (piece === "p") return color === "w" ? wPawn : bPawn;
    return null;
  };

  for (const san of sans) {
    let mv;
    try { mv = g.move(san); } catch { break; }
    if (!mv) break;

    // Resolve variant BEFORE we mutate lineage — read from the FROM square.
    let variant: string | undefined;
    const movingMap = mapFor(mv.piece, mv.color);
    if (movingMap) variant = movingMap[mv.from];

    // Captures — remove opponent's tracked piece.
    if (mv.captured) {
      const oppColor = mv.color === "w" ? "b" : "w";
      // En passant: captured pawn sits behind the destination square.
      const capSq = mv.flags.includes("e") ? mv.to[0]! + mv.from[1]! : mv.to;
      const oppMap = mapFor(mv.captured, oppColor);
      if (oppMap) delete oppMap[capSq];
    }

    // Move the piece in its own map (unless promoted — then it stops being a pawn).
    if (movingMap) {
      const v = movingMap[mv.from];
      delete movingMap[mv.from];
      if (v && !mv.promotion) movingMap[mv.to] = v;
    }

    // Castling — the rook also moves. chess.js reports only the king in mv.
    if (mv.flags.includes("k") || mv.flags.includes("q")) {
      const rank = mv.color === "w" ? "1" : "8";
      const rookMap = mv.color === "w" ? wRook : bRook;
      if (mv.flags.includes("k")) {
        const v = rookMap["h" + rank]; delete rookMap["h" + rank]; if (v) rookMap["f" + rank] = v;
      } else {
        const v = rookMap["a" + rank]; delete rookMap["a" + rank]; if (v) rookMap["d" + rank] = v;
      }
    }

    out.push({
      ply: out.length + 1,
      san: mv.san,
      from: mv.from,
      to: mv.to,
      role: ROLE[mv.piece]!,
      color: mv.color as "w" | "b",
      capture: mv.flags.includes("c") || mv.flags.includes("e"),
      check: mv.san.includes("+") || mv.san.includes("#"),
      castle: mv.flags.includes("k") || mv.flags.includes("q"),
      fen: g.fen(),
      variant,
    });
  }
  return out;
}

const VERB: Record<string, string> = {
  Pawn: "marches to", Knight: "jumps to", Bishop: "aims at",
  Rook: "rolls to", Queen: "flies to", King: "steps to",
};

export interface Anchor { character: string; glyph: string; sentence: string; scene: Scene; }

/** The anchor for one step, using the active picture set's scene for the destination square.
 *  Splits pieces into named individuals:
 *   - Knights by starting file (Bheem b / Chutki g; Tom b / Jerry g)
 *   - Bishops by square colour (Warrior/Young Arjuna; Warrior/Young Karna)
 *   - Rooks by starting file (Dholu a / Bholu h; Motu a / Patlu h)
 *   - Pawns by starting file (Kevin/Stuart/… ; Lil-a/…). */
export function anchorFor(step: OpeningStep, scenes: Record<string, Scene>): Anchor {
  const army = step.color === "w" ? WHITE_ARMY : BLACK_ARMY;
  const generic = army.find((p) => p.role === step.role && !p.variant);
  let ch;
  if (step.role === "Bishop") {
    // Bishops never change square colour, so `to` = same colour as its lifetime square.
    const wanted: "light" | "dark" = isLightSquare(step.to) ? "light" : "dark";
    ch = army.find((p) => p.role === "Bishop" && p.variant === wanted) ?? generic;
  } else if ((step.role === "Knight" || step.role === "Rook" || step.role === "Pawn") && step.variant) {
    ch = army.find((p) => p.role === step.role && p.variant === step.variant) ?? generic;
  } else {
    ch = generic;
  }
  ch = ch ?? army.find((p) => p.role === step.role)!;
  const sc = scenes[step.to]!;
  const verb = step.castle ? "castles to" : (VERB[step.role] ?? "moves to");
  let sentence = `${ch.name} ${verb} the ${sc.pair}`;
  if (step.capture) sentence += " and grabs it";
  if (step.check) sentence += " — CHECK!";
  return { character: ch.name, glyph: ch.glyph, sentence, scene: sc };
}

/** Compose the whole opening into ONE running story — every move's anchor
 *  strung together with varied connectors so it reads aloud as one memorable
 *  narrative chunk instead of 8-15 separate rows. Used by the "The whole line"
 *  card so the reader can memorise the WHOLE line as one story. */
export function composeLineStory(steps: OpeningStep[], scenes: Record<string, Scene>): string {
  if (!steps.length) return "";
  const CONNECTORS = ["Then", "Next", "So", "Now", "After that", "Suddenly", "Meanwhile"];
  const parts: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const a = anchorFor(steps[i]!, scenes);
    if (i === 0) {
      parts.push(`First, ${a.sentence.charAt(0).toLowerCase()}${a.sentence.slice(1)}`);
    } else if (i === steps.length - 1) {
      parts.push(`and finally ${a.sentence.charAt(0).toLowerCase()}${a.sentence.slice(1)}`);
    } else {
      const c = CONNECTORS[(i - 1) % CONNECTORS.length]!;
      parts.push(`${c.toLowerCase()} ${a.sentence.charAt(0).toLowerCase()}${a.sentence.slice(1)}`);
    }
  }
  return parts.join(". ") + ".";
}

export interface OpeningPreset { id: string; name: string; eco: string; sans: string[] }

// 2026-08-02 \u2014 Memory Master 500 (S1 seed). The Tier 1 pillars carry full
// 15-move mainlines + metadata (tags, plans, story, citations); we surface them
// here so the existing trainer picks them up with zero UI changes. As the corpus
// grows via pillars.ts + generated branches, only that file updates \u2014 this stays
// a thin adapter.
import { PILLARS } from "./openings/pillars";
const PILLAR_PRESETS: OpeningPreset[] = PILLARS.map((p) => ({
  id: p.slug,
  name: p.name,
  eco: p.eco,
  sans: p.mainlinePgn ?? p.pgnStart,
}));

// Short "starter" lines that shipped in the first Opening-Memory release. Kept for
// coverage until every one has a pillar equivalent authored (Scotch, Scheveningen,
// French Advance, Queen's Gambit \u2014 Tier 1 items pending Day-2 authoring).
const STARTER_PRESETS: OpeningPreset[] = [
  { id: "scotch", name: "Scotch Game", eco: "C44", sans: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4"] },
  { id: "sicilian-scheveningen", name: "Sicilian \u2014 Scheveningen", eco: "B80", sans: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e6"] },
  { id: "french-advance", name: "French Defence \u2014 Advance", eco: "C02", sans: ["e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6"] },
  { id: "queens-gambit", name: "Queen's Gambit", eco: "D06", sans: ["d4", "d5", "c4", "e6", "Nc3", "Nf6"] },
];

export const OPENING_PRESETS: OpeningPreset[] = [...PILLAR_PRESETS, ...STARTER_PRESETS];

// Handoff from the Opening tab: the explored line is dropped here, read once by the trainer.
export const OPENING_HANDOFF_KEY = "cg_opening_to_memorize";
export interface OpeningHandoff { name: string; sans: string[] }
