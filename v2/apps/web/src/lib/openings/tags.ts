// Five orthogonal tag axes — each opening picks 1–3 per axis. Slugs are stable
// identifiers (URLs, filter chips); labels are what the UI shows.
import type { OpeningTag } from "./types";

export const TAGS: OpeningTag[] = [
  // CHARACTER — how it FEELS to play
  { slug: "strategic",   axis: "CHARACTER", label: "Strategic",   glyph: "⚖️" },
  { slug: "positional",  axis: "CHARACTER", label: "Positional",  glyph: "🧩" },
  { slug: "dynamic",     axis: "CHARACTER", label: "Dynamic",     glyph: "⚡" },
  { slug: "aggressive",  axis: "CHARACTER", label: "Aggressive",  glyph: "🔥" },
  { slug: "tactical",    axis: "CHARACTER", label: "Tactical",    glyph: "💥" },
  { slug: "solid",       axis: "CHARACTER", label: "Solid",       glyph: "🛡" },
  { slug: "risky",       axis: "CHARACTER", label: "Risky",       glyph: "🎲" },

  // STRUCTURE — pawn skeleton character
  { slug: "open",           axis: "STRUCTURE", label: "Open",          glyph: "🌐" },
  { slug: "semi-open",      axis: "STRUCTURE", label: "Semi-open",     glyph: "🌤" },
  { slug: "closed",         axis: "STRUCTURE", label: "Closed",        glyph: "🏰" },
  { slug: "fluid",          axis: "STRUCTURE", label: "Fluid",         glyph: "🌊" },
  { slug: "locked",         axis: "STRUCTURE", label: "Locked",        glyph: "🔒" },
  { slug: "hanging-pawns",  axis: "STRUCTURE", label: "Hanging pawns", glyph: "🪢" },
  { slug: "iqp",            axis: "STRUCTURE", label: "IQP",           glyph: "♟" },
  { slug: "fianchetto",     axis: "STRUCTURE", label: "Fianchetto",    glyph: "🏹" },

  // ATTACK — which flank / phase
  { slug: "kingside",           axis: "ATTACK", label: "Kingside attack",    glyph: "👉" },
  { slug: "queenside",          axis: "ATTACK", label: "Queenside attack",   glyph: "👈" },
  { slug: "central",            axis: "ATTACK", label: "Central pressure",   glyph: "⬆" },
  { slug: "both-flanks",        axis: "ATTACK", label: "Both flanks",        glyph: "↔️" },
  { slug: "endgame-oriented",   axis: "ATTACK", label: "Endgame-oriented",   glyph: "⏱" },

  // SCHOOL — historical/theoretical lineage
  { slug: "classical",   axis: "SCHOOL", label: "Classical",   glyph: "🎩" },
  { slug: "hypermodern", axis: "SCHOOL", label: "Hypermodern", glyph: "🎭" },
  { slug: "romantic",    axis: "SCHOOL", label: "Romantic",    glyph: "🌹" },
  { slug: "modern",      axis: "SCHOOL", label: "Modern",      glyph: "🚀" },
  { slug: "universal",   axis: "SCHOOL", label: "Universal",   glyph: "♾️" },

  // PRACTICALITY — how it behaves in real play
  { slug: "theory-heavy",     axis: "PRACTICALITY", label: "Theory-heavy",     glyph: "📚" },
  { slug: "idea-based",       axis: "PRACTICALITY", label: "Idea-based",       glyph: "💡" },
  { slug: "trap-heavy",       axis: "PRACTICALITY", label: "Trap-heavy",       glyph: "🕸" },
  { slug: "surprise-weapon",  axis: "PRACTICALITY", label: "Surprise weapon",  glyph: "🎁" },
  { slug: "sound-long-term",  axis: "PRACTICALITY", label: "Sound long-term",  glyph: "🌳" },
];

export const tagBySlug = new Map(TAGS.map((t) => [t.slug, t]));
export const tagsByAxis = (axis: OpeningTag["axis"]) => TAGS.filter((t) => t.axis === axis);
