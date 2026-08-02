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
import { newCard, isDue, type FsrsState } from "./fsrs";
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

/** Remove opening from study queue and drop its cards. */
export function deactivateOpening(slug: string): void {
  const set = activatedSlugs();
  if (!set.has(slug)) return;
  set.delete(slug);
  writeActivated(set);
  const store = loadAllStates();
  for (const id of Object.keys(store)) {
    if (id.startsWith(`${slug}:`)) delete store[id];
  }
  writeAllStates(store);
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
 *  ply no longer exists (e.g. mainline was shortened between deploys). */
export function hydrateCard(cardId: string, state?: FsrsState): Card | null {
  const [slug, kind, plyStr] = cardId.split(":");
  if (!slug || !kind) return null;
  const o = openingBySlug.get(slug);
  if (!o) return null;
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
  return Object.keys(store)
    .filter((id) => id.startsWith(`${slug}:`))
    .map((id) => hydrateCard(id, store[id]))
    .filter((c): c is Card => c !== null);
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
    const [slug] = id.split(":");
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
    const [slug] = id.split(":");
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
 *  Replays the mainline up to (ply-1) so the position + prompt are consistent. */
export function renderNextMoveCard(card: Card): { fen: string; san: string; sideToMove: "w" | "b"; moveNo: number } | null {
  if (card.kind !== "next-move" || !card.ply) return null;
  const o = openingBySlug.get(card.slug);
  const sans = o?.mainlinePgn ?? o?.pgnStart;
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
