// Memory Master 500 — user-written mnemonic stories, kept in localStorage.
//
// Every opening gets 3 possible story sources, in priority order:
//   1. User-written story  — from this file (localStorage)
//   2. Pillar story        — Opening.idea.storyHook/storyLong (hand-authored)
//   3. Auto-generated      — deterministic template from family + moves + tags
//
// Community sync (S6 full) needs a backend for shared mnemonics; MVP ships
// personal + auto so the "Story" panel is populated for all 500 openings.

import type { Opening } from "./openings/types";
import { familyById, structureBySlug, tagBySlug } from "./openings";

const K = "cg_mm500_user_stories";

export interface UserStory {
  hook: string;         // one sentence, appears on the panel
  long?: string;        // optional full narration
  updatedAt: string;    // ISO
}

type Store = Record<string, UserStory>;

function loadStore(): Store {
  try { return JSON.parse(localStorage.getItem(K) ?? "{}") as Store; }
  catch { return {}; }
}
function writeStore(s: Store) { localStorage.setItem(K, JSON.stringify(s)); }

export function loadUserStory(slug: string): UserStory | null {
  return loadStore()[slug] ?? null;
}

export function saveUserStory(slug: string, hook: string, long?: string): void {
  const s = loadStore();
  if (!hook.trim()) { delete s[slug]; }
  else s[slug] = { hook: hook.trim(), long: long?.trim() || undefined, updatedAt: new Date().toISOString() };
  writeStore(s);
}

export function clearUserStory(slug: string): void {
  const s = loadStore();
  delete s[slug];
  writeStore(s);
}

/** Pick the best available story + note its provenance. Always returns
 *  something — the auto-generated fallback covers every opening. */
export function resolveStory(o: Opening): {
  hook: string;
  long?: string;
  source: "user" | "pillar" | "auto";
} {
  const u = loadUserStory(o.slug);
  if (u) return { hook: u.hook, long: u.long, source: "user" };
  if (o.idea?.storyHook) return { hook: o.idea.storyHook, long: o.idea.storyLong, source: "pillar" };
  return { ...autoStory(o), source: "auto" };
}

/* ---------- auto-story generator ---------- */

/** Deterministic per-opening story built from corpus metadata. Not literary
 *  gold, but consistent + memorable enough to seed an elaboration. */
export function autoStory(o: Opening): { hook: string; long: string } {
  const family = familyById.get(o.familyId);
  const familyName = family?.name ?? "opening";
  const struct = o.structureSlug ? structureBySlug.get(o.structureSlug) : null;
  const tags = o.tagSlugs.map((s) => tagBySlug.get(s)).filter(Boolean).slice(0, 3);
  const characterTag = tags.find((t) => t?.axis === "CHARACTER");
  const attackTag = tags.find((t) => t?.axis === "ATTACK");
  const schoolTag = tags.find((t) => t?.axis === "SCHOOL");

  const first3 = (o.pgnStart ?? []).slice(0, 6).map((san, i) => {
    const isWhite = i % 2 === 0;
    const moveNo = Math.floor(i / 2) + 1;
    return isWhite ? `${moveNo}.${san}` : `${san}`;
  }).join(" ");

  // One-sentence hook.
  const hookVerb = characterTag?.slug === "aggressive" ? "storms"
    : characterTag?.slug === "positional" ? "manoeuvres"
    : characterTag?.slug === "solid" ? "digs in"
    : "advances";
  const attackImage = attackTag?.slug === "kingside-attack" ? "with pawns raining on the king"
    : attackTag?.slug === "queenside-attack" ? "with rooks charging down the flank"
    : attackTag?.slug === "central-attack" ? "seizing the centre before the storm"
    : "trading punches in the middle";

  const hook = `${familyName} ${hookVerb} ${attackImage}${struct ? ` — the board will settle into a ${struct.name.toLowerCase()}` : ""}.`;

  // Longer narration (3-4 sentences). Includes the actual move sequence as a
  // memory anchor: "You'll see 1.e4 e5 2.Nf3 Nc6 …" — the reader visualises
  // the moves, then the plans + structure paint the story around them.
  const schoolLine = schoolTag ? `This is a ${schoolTag.label.toLowerCase()} opening. ` : "";
  const plansLine = o.idea?.short ? `${o.idea.short} ` : "";
  const structLine = struct ? `The pawns lock into the ${struct.name} — remember that shape and every plan follows from it. ` : "";
  const moveLine = first3 ? `The opening moves are ${first3}. Fix that sequence in your head; each move earns its square. ` : "";

  const long = `${moveLine}${schoolLine}${plansLine}${structLine}`.trim();

  return { hook, long };
}

/* ---------- speech synthesis ---------- */

/** Speak a string via the browser SpeechSynthesis API. Returns a stop fn. */
export function speak(text: string, opts?: { rate?: number; voice?: string }): () => void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return () => {};
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts?.rate ?? 1.0;
  const voices = window.speechSynthesis.getVoices();
  if (opts?.voice) {
    const v = voices.find((v) => v.name === opts.voice);
    if (v) u.voice = v;
  } else {
    // Prefer an en-GB or en-US voice if available.
    const preferred = voices.find((v) => /en-GB/i.test(v.lang)) ?? voices.find((v) => /en-US/i.test(v.lang));
    if (preferred) u.voice = preferred;
  }
  window.speechSynthesis.speak(u);
  return () => window.speechSynthesis.cancel();
}
