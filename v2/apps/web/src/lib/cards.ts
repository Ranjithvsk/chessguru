// Memory Master 500 — card generation + storage.
//
// One Opening → many Cards. Cards live in localStorage keyed by cardId. State
// per card is FSRS (see ./fsrs). An opening is "activated" (in the user's
// study queue) when its slug is in the ACTIVATED_SLUGS set — activation
// eagerly generates all its cards (~15-20 per opening). Deactivation removes
// them.
//
// Card kinds shipped in S4-MVP:
//   next-move    one per ply in the mainline — "at this position, what next?"
//   plan-white   what's white's plan? (only if idea.whitePlans populated)
//   plan-black   what's black's plan?
//   structure    what pawn structure does this opening reach?
//
// Not yet: story-recall, model-game, engine-post-mortem (S5-6).
//
// Storage layout (localStorage keys):
//   cg_mm500_activated  JSON string[] of slugs
//   cg_mm500_cards      JSON Record<cardId, FsrsState>

import { Chess } from "chess.js";
import { openingBySlug } from "./openings";
import type { Opening } from "./openings/types";
import { newCard, isDue, grade as fsrsGrade, type FsrsState, type Grade } from "./fsrs";
import { loadRepertoire, repertoireRoleOf } from "./repertoire";

export type CardKind = "next-move" | "plan-white" | "plan-black" | "structure";

export interface Card {
  id: string;           // "<slug>:<kind>:<optional-ply>"
  slug: string;         // opening slug
  kind: CardKind;
  ply?: number;         // 1-based, only for next-move
  fsrs: FsrsState;
}

const K_ACTIVATED = "cg_mm500_activated";
const K_CARDS     = "cg_mm500_cards";
// Custom lines synthesised from repertoire entries with kind==="line" —
// stored separately from the 500-corpus so the trainer can hydrate cards
// whose slug isn't in openingBySlug. Owner ask 2026-08-20 ("also add own
// repertoire lines to Opening Trainer"). Key format for such slugs is
// `line:<repertoire-entry-_id>`.
const K_CUSTOM_LINES = "cg_mm500_custom_lines";

/** Slug prefix used for custom line entries in the trainer. */
const LINE_SLUG_PREFIX = "line:";
export function isCustomLineSlug(slug: string): boolean {
  return slug.startsWith(LINE_SLUG_PREFIX);
}

interface CustomLine { name: string; sans: string[] }
function loadCustomLines(): Record<string, CustomLine> {
  try {
    const raw = localStorage.getItem(K_CUSTOM_LINES);
    return raw ? (JSON.parse(raw) as Record<string, CustomLine>) : {};
  } catch { return {}; }
}
function writeCustomLines(map: Record<string, CustomLine>) {
  localStorage.setItem(K_CUSTOM_LINES, JSON.stringify(map));
}
/** Returns the trainer-facing slug for a repertoire entry (corpus slug for
 *  saved openings, `line:<id>` for custom lines). */
export function trainerSlugFor(entry: { _id: string; kind: "corpus" | "line"; slug?: string }): string | null {
  if (entry.kind === "corpus") return entry.slug ?? null;
  return LINE_SLUG_PREFIX + entry._id;
}
/** Lookup a display name + mainline SANs for any slug — corpus or custom. */
function lineDataFor(slug: string): { name: string; sans: string[] } | null {
  if (isCustomLineSlug(slug)) {
    const map = loadCustomLines();
    return map[slug] ?? null;
  }
  const o = openingBySlug.get(slug);
  if (!o) return null;
  return { name: o.name, sans: (o.mainlinePgn ?? o.pgnStart) ?? [] };
}
/** Display name for any activated slug (corpus opening or custom line). */
export function displayNameFor(slug: string): string {
  const d = lineDataFor(slug);
  return d?.name ?? slug;
}

/* ---------- activated openings ---------- */
export function activatedSlugs(): Set<string> {
  try {
    const raw = localStorage.getItem(K_ACTIVATED);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}
export function isActivated(slug: string): boolean {
  return activatedSlugs().has(slug);
}
function writeActivated(set: Set<string>) {
  localStorage.setItem(K_ACTIVATED, JSON.stringify([...set]));
}

/** Add an opening to the study queue and generate all its cards. Idempotent. */
export function activateOpening(slug: string): number {
  const set = activatedSlugs();
  if (set.has(slug)) return cardsForOpening(slug).length;
  const o = openingBySlug.get(slug);
  if (!o) return 0;
  set.add(slug);
  writeActivated(set);
  const generated = generateCardsFor(o);
  const store = loadAllStates();
  for (const c of generated) {
    // Don't overwrite a card that somehow already exists (defensive).
    if (!store[c.id]) store[c.id] = c.fsrs;
  }
  writeAllStates(store);
  return generated.length;
}

/** Add a custom line (kind==="line" repertoire entry) to the study queue.
 *  Generates one next-move card per ply in `sans`. Idempotent. */
export function activateLineEntry(entry: { _id: string; name: string; sans: string[] }): number {
  const slug = LINE_SLUG_PREFIX + entry._id;
  const set = activatedSlugs();
  if (set.has(slug)) return cardsForOpening(slug).length;
  const sans = entry.sans || [];
  if (sans.length === 0) return 0;
  // Persist the synthetic opening so future renders can look it up by slug.
  const map = loadCustomLines();
  map[slug] = { name: entry.name, sans };
  writeCustomLines(map);
  set.add(slug);
  writeActivated(set);
  const store = loadAllStates();
  for (let i = 0; i < sans.length; i++) {
    const id = `${slug}:nm:${i + 1}`;
    if (!store[id]) store[id] = newCard();
  }
  writeAllStates(store);
  return sans.length;
}

/** Dispatch helper: activate a repertoire entry regardless of kind. */
export function activateRepertoireEntry(entry: { _id: string; kind: "corpus" | "line"; slug?: string; name: string; sans?: string[] }): number {
  if (entry.kind === "corpus" && entry.slug) return activateOpening(entry.slug);
  if (entry.kind === "line" && entry.sans?.length) {
    return activateLineEntry({ _id: entry._id, name: entry.name, sans: entry.sans });
  }
  return 0;
}
/** Predicate that mirrors `activateRepertoireEntry`. */
export function isRepertoireEntryActivated(entry: { _id: string; kind: "corpus" | "line"; slug?: string }): boolean {
  const s = trainerSlugFor(entry);
  return !!s && isActivated(s);
}

/** Remove opening from study queue and drop its cards. Also cleans up the
 *  custom-lines map if the slug is a synthetic `line:*` entry, so removing
 *  a repertoire-derived line doesn't leave a phantom localStorage record. */
export function deactivateOpening(slug: string): void {
  const set = activatedSlugs();
  if (!set.has(slug)) return;
  set.delete(slug);
  writeActivated(set);
  const store = loadAllStates();
  const prefix = `${slug}:`;
  for (const id of Object.keys(store)) {
    if (id.startsWith(prefix)) delete store[id];
  }
  writeAllStates(store);
  if (isCustomLineSlug(slug)) {
    const map = loadCustomLines();
    if (map[slug]) {
      delete map[slug];
      writeCustomLines(map);
    }
  }
}

/* ---------- card generation ---------- */
export function generateCardsFor(o: Opening): Card[] {
  const cards: Card[] = [];
  const sans = o.mainlinePgn ?? o.pgnStart;
  if (sans?.length) {
    for (let i = 0; i < sans.length; i++) {
      cards.push({
        id: `${o.slug}:nm:${i + 1}`,
        slug: o.slug,
        kind: "next-move",
        ply: i + 1,
        fsrs: newCard(),
      });
    }
  }
  if (o.idea?.whitePlans?.length) {
    cards.push({ id: `${o.slug}:plan-w`, slug: o.slug, kind: "plan-white", fsrs: newCard() });
  }
  if (o.idea?.blackPlans?.length) {
    cards.push({ id: `${o.slug}:plan-b`, slug: o.slug, kind: "plan-black", fsrs: newCard() });
  }
  if (o.structureSlug) {
    cards.push({ id: `${o.slug}:struct`, slug: o.slug, kind: "structure", fsrs: newCard() });
  }
  return cards;
}

/* ---------- card state persistence ---------- */
type StateStore = Record<string, FsrsState>;

export function loadAllStates(): StateStore {
  try {
    const raw = localStorage.getItem(K_CARDS);
    return raw ? (JSON.parse(raw) as StateStore) : {};
  } catch { return {}; }
}
export function writeAllStates(store: StateStore) {
  localStorage.setItem(K_CARDS, JSON.stringify(store));
}
export function saveCardState(cardId: string, state: FsrsState) {
  const s = loadAllStates();
  s[cardId] = state;
  writeAllStates(s);
}

/* ---------- reconstruction: cardId → Card (with FEN-before, SAN, prompt) ---------- */

/** Hydrate a bare cardId into a full Card object. Returns null if opening or
 *  ply no longer exists (e.g. mainline was shortened between deploys).
 *
 *  Note: cardIds for custom-line entries carry an extra "line:" prefix in
 *  the slug, so a cardId looks like `line:<id>:nm:<ply>` — split(":") gives
 *  ["line", "<id>", "nm", "<ply>"]. We reassemble the slug accordingly. */
export function hydrateCard(cardId: string, state?: FsrsState): Card | null {
  const parts = cardId.split(":");
  if (parts.length < 2) return null;
  let slug: string, kind: string, plyStr: string | undefined;
  if (parts[0] === "line") {
    // ["line", <id>, <kind>, <ply?>]
    if (parts.length < 3) return null;
    slug = `${parts[0]}:${parts[1]}`;
    kind = parts[2]!;
    plyStr = parts[3];
  } else {
    slug = parts[0]!;
    kind = parts[1]!;
    plyStr = parts[2];
  }
  const lineData = lineDataFor(slug);
  if (!lineData) return null;
  const fsrs = state ?? loadAllStates()[cardId] ?? newCard();
  if (kind === "nm") {
    const ply = plyStr ? Number(plyStr) : undefined;
    if (!ply) return null;
    return { id: cardId, slug, kind: "next-move", ply, fsrs };
  }
  if (kind === "plan-w") return { id: cardId, slug, kind: "plan-white", fsrs };
  if (kind === "plan-b") return { id: cardId, slug, kind: "plan-black", fsrs };
  if (kind === "struct") return { id: cardId, slug, kind: "structure", fsrs };
  return null;
}

/* ---------- queries ---------- */

/** All cards belonging to one activated opening — cheap: filter store keys. */
export function cardsForOpening(slug: string): Card[] {
  const store = loadAllStates();
  const prefix = `${slug}:`;
  return Object.keys(store)
    .filter((id) => id.startsWith(prefix))
    .map((id) => hydrateCard(id, store[id]))
    .filter((c): c is Card => c !== null);
}

/** Slug extraction from cardId — mirrors hydrateCard's parsing (handles the
 *  `line:<id>:...` prefix). Used by queue-level filters. */
function slugFromCardId(id: string): string | null {
  const parts = id.split(":");
  if (parts.length < 2) return null;
  return parts[0] === "line" ? `${parts[0]}:${parts[1]}` : parts[0]!;
}

/** Daily due queue. Ordered:
 *   1. Repertoire openings' cards first (if a repertoire exists)
 *   2. Then by due-ness (most-overdue first) — new cards count as due=now.
 *  New-card intake is capped so first-day feels sane. */
export function dueCards(now: Date = new Date(), newLimit = 10): Card[] {
  const store = loadAllStates();
  const rep = loadRepertoire();
  const active = activatedSlugs();
  const all: Card[] = [];
  for (const id of Object.keys(store)) {
    const slug = slugFromCardId(id);
    if (!slug || !active.has(slug)) continue;
    const s = store[id];
    if (!s || !isDue(s, now)) continue;
    const c = hydrateCard(id, s);
    if (c) all.push(c);
  }
  // Split new vs review: cap new to newLimit so a freshly-added opening
  // doesn't dump 20 cards on day 1.
  const news = all.filter((c) => c.fsrs.state === "new");
  const revs = all.filter((c) => c.fsrs.state !== "new");
  const prioritise = (a: Card, b: Card) => {
    const ra = repertoireRoleOf(a.slug, rep) ? 0 : 1;
    const rb = repertoireRoleOf(b.slug, rep) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime();
  };
  news.sort(prioritise);
  revs.sort(prioritise);
  return [...revs, ...news.slice(0, newLimit)];
}

/** Resolve a slug into a drillable {slug,name,sans} bundle. Returns null
 *  when the slug is unknown (activated opening was removed from the corpus
 *  or its custom-line record was wiped). Used by the trainer's picker. */
export function resolveDrill(slug: string): { slug: string; name: string; sans: string[] } | null {
  const data = lineDataFor(slug);
  if (!data || data.sans.length === 0) return null;
  return { slug, name: data.name, sans: data.sans };
}

/** Pick the opening the student should drill next: whichever activated
 *  opening has the earliest due (or new) next-move card. Returns null when
 *  the whole queue is empty. Used by the interactive drill mode
 *  (owner ask 2026-08-20 — "allow them to freely play the opening in
 *  opening trainer, give them a score, resuggest like Ankidroid"). */
export function nextOpeningToStudy(now: Date = new Date()): { slug: string; name: string; sans: string[] } | null {
  const store = loadAllStates();
  const active = activatedSlugs();
  let best: { slug: string; dueAt: number } | null = null;
  for (const id of Object.keys(store)) {
    const slug = slugFromCardId(id);
    if (!slug || !active.has(slug)) continue;
    // Only next-move cards drive the drill — plans/structure cards are
    // still reviewed one-off elsewhere (not surfaced in the drill).
    if (!id.includes(":nm:")) continue;
    const s = store[id];
    if (!s) continue;
    if (!isDue(s, now) && s.state !== "new") continue;
    const dueMs = new Date(s.due).getTime();
    if (!best || dueMs < best.dueAt) best = { slug, dueAt: dueMs };
  }
  if (!best) return null;
  const data = lineDataFor(best.slug);
  if (!data || data.sans.length === 0) return null;
  return { slug: best.slug, name: data.name, sans: data.sans };
}

/** After a drill session, persist FSRS state for every ply the student
 *  played. `results[i]` is the grade for ply (i+1). Missing/undefined grades
 *  leave the card alone (student may have quit early). */
export function applyDrillResults(slug: string, results: Array<Grade | undefined>) {
  const store = loadAllStates();
  for (let i = 0; i < results.length; i++) {
    const g = results[i];
    if (!g) continue;
    const cardId = `${slug}:nm:${i + 1}`;
    const prior = store[cardId] ?? newCard();
    store[cardId] = fsrsGrade(prior, g);
  }
  writeAllStates(store);
}

/** Opening-level review summary — used for the "next review" hint on the
 *  scorecard and the "Upcoming" panel on the trainer page. Aggregates every
 *  next-move card of the opening: earliest due, average due, count. */
export interface OpeningReviewSummary {
  slug: string;
  name: string;
  totalCards: number;
  earliestDue: Date;                                     // when the FIRST card comes back
  latestDue: Date;                                       // when the LAST card comes back
  averageStabilityDays: number;                          // ~how long the opening is "stable"
}
export function openingReviewSummary(slug: string): OpeningReviewSummary | null {
  const data = lineDataFor(slug);
  if (!data) return null;
  const store = loadAllStates();
  const prefix = `${slug}:nm:`;
  const cards = Object.keys(store).filter((id) => id.startsWith(prefix)).map((id) => store[id]!);
  if (cards.length === 0) return null;
  let earliest = Infinity;
  let latest = -Infinity;
  let stabilitySum = 0;
  for (const c of cards) {
    const t = new Date(c.due).getTime();
    if (t < earliest) earliest = t;
    if (t > latest) latest = t;
    stabilitySum += c.stability || 0;
  }
  return {
    slug,
    name: data.name,
    totalCards: cards.length,
    earliestDue: new Date(earliest),
    latestDue: new Date(latest),
    averageStabilityDays: stabilitySum / cards.length,
  };
}

/** Top-N openings by earliest due-date — used to render an "Upcoming" list
 *  so the student can see the spaced-repetition schedule at a glance. */
export function upcomingOpenings(limit = 5): OpeningReviewSummary[] {
  const active = [...activatedSlugs()];
  const summaries = active
    .map((s) => openingReviewSummary(s))
    .filter((x): x is OpeningReviewSummary => x !== null)
    .sort((a, b) => a.earliestDue.getTime() - b.earliestDue.getTime());
  return summaries.slice(0, limit);
}

/** Summary counts for the dashboard: how many due now, how many new, total. */
export function queueSummary(now: Date = new Date()): {
  dueNow: number;
  newAvailable: number;
  totalCards: number;
  activeOpenings: number;
} {
  const store = loadAllStates();
  const active = activatedSlugs();
  let dueNow = 0;
  let newAvailable = 0;
  let totalCards = 0;
  for (const id of Object.keys(store)) {
    const slug = slugFromCardId(id);
    if (!slug || !active.has(slug)) continue;
    totalCards++;
    const s = store[id]!;
    if (s.state === "new") newAvailable++;
    else if (isDue(s, now)) dueNow++;
  }
  return { dueNow, newAvailable, totalCards, activeOpenings: active.size };
}

/* ---------- render helpers — used by the review UI ---------- */

/** For a next-move card, compute the FEN before the move AND the expected SAN.
 *  Replays the mainline up to (ply-1) so the position + prompt are consistent.
 *  Works for both 500-corpus openings and custom-line entries — `lineDataFor`
 *  resolves both. */
export function renderNextMoveCard(card: Card): { fen: string; san: string; sideToMove: "w" | "b"; moveNo: number } | null {
  if (card.kind !== "next-move" || !card.ply) return null;
  const data = lineDataFor(card.slug);
  const sans = data?.sans;
  if (!sans || card.ply > sans.length) return null;
  const g = new Chess();
  for (let i = 0; i < card.ply - 1; i++) {
    try { g.move(sans[i]!); } catch { return null; }
  }
  const fen = g.fen();
  const sideToMove = g.turn();
  const expected = sans[card.ply - 1]!;
  return { fen, san: expected, sideToMove, moveNo: Math.ceil(card.ply / 2) };
}
