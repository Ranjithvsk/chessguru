// Memory Master 500 — corpus entry point. Everything the app consumes goes
// through this file so slice-2+ don't have to update import paths as the corpus
// grows (S1 → 5 pillars, then 20, then 500).
//
// The plain array + Map exports are deliberate: they're tree-shakable, and
// consumers can filter without pulling a DB layer.

export type * from "./types";
export { TAGS, tagBySlug, tagsByAxis } from "./tags";
export { FAMILIES, familyById } from "./families";
export { STRUCTURES, structureBySlug } from "./structures";
export { PILLARS } from "./pillars";

import { PILLARS } from "./pillars";
import { GENERATED_OPENINGS } from "./generated";
import type { Opening } from "./types";

/** The full corpus. PILLARS = 20 hand-authored Tier-1 openings. GENERATED =
 *  ~500 openings ranked by Lichess masters DB frequency with Wikibook excerpts
 *  (CC-BY-SA). Pillars take precedence — any generated entry with the same ECO
 *  as a pillar is dropped in favour of the hand-authored version. */
const pillarEcos = new Set(PILLARS.map((p) => p.eco));
const pillarSlugs = new Set(PILLARS.map((p) => p.slug));
const dedupedGenerated = GENERATED_OPENINGS.filter(
  (g) => !pillarEcos.has(g.eco) && !pillarSlugs.has(g.slug),
);
export const OPENINGS: Opening[] = [...PILLARS, ...dedupedGenerated];

/** Lookup by slug — the canonical way to jump from a URL or a card to its data. */
export const openingBySlug = new Map(OPENINGS.map((o) => [o.slug, o]));

/** Group by family for the "browse by family" navigator (S3+). */
export function openingsByFamily(familyId: string): Opening[] {
  return OPENINGS.filter((o) => o.familyId === familyId);
}

/** Filter helper — used by the tag chip filters on the browse page. */
export function openingsByTags(tagSlugs: string[]): Opening[] {
  if (!tagSlugs.length) return OPENINGS;
  return OPENINGS.filter((o) => tagSlugs.every((t) => o.tagSlugs.includes(t)));
}

/** Resolve the corpus Opening for a played line. Returns the entry whose
 *  `pgnStart` is the LONGEST exact-prefix match of `sans` — so playing
 *  `1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6` picks Najdorf if we have
 *  it, else falls back to `1.e4 c5 2.Nf3 d6` (Open Sicilian), else `1.e4 c5`,
 *  and so on down to the first-move entry. Powers the Explorer's inline
 *  wikibook panel so every ply (from move 1) surfaces its idea + wikibook
 *  excerpt without the user leaving the analysis view. */
export function findOpeningForLine(sans: string[]): Opening | null {
  let best: Opening | null = null;
  let bestLen = -1;
  for (const o of OPENINGS) {
    const start = o.pgnStart;
    if (start.length <= bestLen) continue;         // can't beat current best
    if (start.length > sans.length) continue;      // longer than played line
    let match = true;
    for (let i = 0; i < start.length; i++) {
      if (start[i] !== sans[i]) { match = false; break; }
    }
    if (match) { best = o; bestLen = start.length; }
  }
  return best;
}
