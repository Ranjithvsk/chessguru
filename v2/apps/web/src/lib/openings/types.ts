// Memory Master 500 — S1 corpus schema.
//
// In-bundle TypeScript modules (not DB-backed) — matches the app's client-first
// pattern (see endgame/kpk oracle, memoryPalace). User state (mastery, card review
// history, streaks) lives in IndexedDB via a separate FSRS module (S4).
//
// Later slices that need server state (community mnemonics, real-game import,
// engine coach post-mortems) will add API endpoints — the corpus stays static.

/** Five orthogonal tag axes. Every opening picks 1–3 per axis. */
export type TagAxis = "CHARACTER" | "STRUCTURE" | "ATTACK" | "SCHOOL" | "PRACTICALITY";

export interface OpeningTag {
  slug: string;         // "aggressive", "closed", ...
  axis: TagAxis;
  label: string;        // "Aggressive"
  glyph?: string;       // 🔥 ⚖️ 🏰 …
}

/** Named canonical pawn structures — the CHUNKS masters recognise instantly. */
export interface PawnStructure {
  slug: string;           // "carlsbad" | "iqp" | "hedgehog" | ...
  name: string;           // "Carlsbad Structure"
  fen: string;            // representative FEN (pawn-only + kings sketched)
  glyph?: string;
  short: string;          // one-line description
  whitePlans: string[];   // ordered by frequency
  blackPlans: string[];
  reachedFrom: string[];  // opening slugs that reach this structure
}

/** One of ~20 top-level opening families. */
export interface OpeningFamily {
  id: string;                 // "sicilian" | "kings-indian" | ...
  name: string;               // "Sicilian Defence"
  displayOrder: number;       // sort key for UI + belt-progression suggestion
  colorHex: string;           // used in family-heat views + belt insignia
  approxOpenings: number;     // rough count of variations under this family (Tier 1-4)
  intro: string;              // 2-3 sentences: what defines the family, first moves
}

/** Which authors / sources back the Idea text. */
export interface Citation {
  author?: string;              // "Fine" | "Watson" | ...
  work: string;                 // book title or "Wikipedia" or "Stockfish 16"
  section?: string;             // chapter / page / URL fragment
  licence?: "PD" | "CC-BY-SA" | "CC0" | "CC-BY" | "paraphrase";
  url?: string;
}

/** One opening (Tier 1 pillar OR sub-variation OR branch). */
export interface Opening {
  slug: string;               // "sicilian-najdorf-english-attack"
  eco: string;                // "B90"
  ecoName: string;            // ECO's assigned name (may differ from ours)
  name: string;               // display name — what we call it
  aliases?: string[];         // ["Sicilian, Najdorf, English Attack, 6.Be3 e5"]
  familyId: string;           // → OpeningFamily.id
  parentSlug?: string;        // → parent Opening.slug (tree structure)
  tier: 1 | 2 | 3 | 4;        // 1 pillar / 2 named sub / 3 branch / 4 sideline
  frequencyBps?: number;      // 0-10000, share of master games at THIS position

  /** SAN moves that IDENTIFY this opening (short, e.g. "e4 c5 Nf3 d6 …"). */
  pgnStart: string[];
  /** 15-move-per-side canonical continuation (30 plies incl. pgnStart). Optional
   *  for Tier 3-4 branches where a shorter line is the norm. */
  mainlinePgn?: string[];

  tagSlugs: string[];         // pick 1-3 per axis from tags.ts

  structureSlug?: string;     // the structure this typically reaches (from structures.ts)

  /** Story anchor: the move number (in ONE side's count, 1-based) where the
   *  critical decision happens. Weighted heavier in FSRS + story climax. */
  criticalMoveNo?: number;

  idea?: OpeningIdea;         // may be null on generated stubs — S1 authors fill in
}

export interface OpeningIdea {
  short: string;              // one sentence — appears on cards + list rows
  long?: string;              // 3-5 paragraphs — appears on detail page
  whitePlans?: string[];      // 2-3 bullets
  blackPlans?: string[];
  storyHook?: string;         // one sentence — uses named squares + piece nicknames
  storyLong?: string;         // 30-sec narration script (S4/S6)
  citations?: Citation[];
  // 2026-08-02 — Wikibooks "Chess Opening Theory" is our primary auto-source
  // (per-move tree with plans + variations, CC-BY-SA 3.0). URL pattern:
  // en.wikibooks.org/wiki/Chess_Opening_Theory/1._e4/1...c5/2._Nf3/...
  wikibookUrl?: string;
  wikibookExcerpt?: string;
  wikipediaUrl?: string;      // article-level background (secondary)
  wikipediaExcerpt?: string;
  lichessWikiUrl?: string;    // lichess.org/opening/<slug>
}

/** Model games — canonical illustrations. */
export interface ModelGame {
  openingSlug: string;
  white: string;
  black: string;
  event: string;
  year: number;
  result: "1-0" | "1/2-1/2" | "0-1";
  keyMoveNo?: number;         // the move that made the opening famous
  keyMoveNote?: string;
  pgn: string;                // full game PGN
}
