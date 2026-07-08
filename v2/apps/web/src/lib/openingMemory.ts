// Turn an opening's moves into MEMORY ANCHORS: every move = a piece-character doing
// something to the destination square's vivid scene. This is the doc's
// "[Character] + [Action] + [Square scene]" move-reading, applied to a whole opening.
import { Chess } from "chess.js";
import { WHITE_ARMY, BLACK_ARMY, type Scene } from "./memoryPalace";

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
}

const ROLE: Record<string, string> = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };

/** Replay a SAN line into per-move steps (stops at the first illegal SAN). */
export function buildSteps(sans: string[]): OpeningStep[] {
  const g = new Chess();
  const out: OpeningStep[] = [];
  for (const san of sans) {
    let mv;
    try { mv = g.move(san); } catch { break; }
    if (!mv) break;
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
    });
  }
  return out;
}

const VERB: Record<string, string> = {
  Pawn: "marches to", Knight: "jumps to", Bishop: "aims at",
  Rook: "rolls to", Queen: "flies to", King: "steps to",
};

export interface Anchor { character: string; glyph: string; sentence: string; scene: Scene; }

/** The anchor for one step, using the active picture set's scene for the destination square. */
export function anchorFor(step: OpeningStep, scenes: Record<string, Scene>): Anchor {
  const army = step.color === "w" ? WHITE_ARMY : BLACK_ARMY;
  const ch = army.find((p) => p.role === step.role)!;
  const sc = scenes[step.to]!;
  const verb = step.castle ? "castles to" : (VERB[step.role] ?? "moves to");
  let sentence = `${ch.name} ${verb} the ${sc.pair}`;
  if (step.capture) sentence += " and grabs it";
  if (step.check) sentence += " — CHECK!";
  return { character: ch.name, glyph: ch.glyph, sentence, scene: sc };
}

export interface OpeningPreset { id: string; name: string; eco: string; sans: string[] }

// Built-in openings so the trainer works on its own (the "one opening works" default).
export const OPENING_PRESETS: OpeningPreset[] = [
  { id: "giuoco-piano", name: "Giuoco Piano", eco: "C53", sans: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6"] },
  { id: "ruy-lopez", name: "Ruy Lopez", eco: "C60", sans: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"] },
  { id: "scotch", name: "Scotch Game", eco: "C44", sans: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4"] },
  { id: "sicilian-scheveningen", name: "Sicilian \u2014 Scheveningen", eco: "B80", sans: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e6"] },
  { id: "french-advance", name: "French Defence \u2014 Advance", eco: "C02", sans: ["e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6"] },
  { id: "french-winawer", name: "French Defence \u2014 Winawer", eco: "C15", sans: ["e4", "e6", "d4", "d5", "Nc3", "Bb4"] },
  { id: "queens-gambit", name: "Queen's Gambit", eco: "D06", sans: ["d4", "d5", "c4", "e6", "Nc3", "Nf6"] },
];

// Handoff from the Opening tab: the explored line is dropped here, read once by the trainer.
export const OPENING_HANDOFF_KEY = "cg_opening_to_memorize";
export interface OpeningHandoff { name: string; sans: string[] }
