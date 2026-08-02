// Memory Master 500 — S2 Repertoire Wizard.
//
// A user's REPERTOIRE = a personalised subset (typically 30-40) of the 500
// openings they want to memorise. Populated by the 10-question wizard; can be
// hand-tweaked from the browse page later. Stored in localStorage (tiny data
// — a few dozen slugs + wizard answers). Once S4 (FSRS card engine) lands,
// cards for repertoire openings will be prioritised in the daily queue.

import { OPENINGS } from "./openings";
import type { Opening } from "./openings/types";

/** The 10 wizard questions — order matches the UI. */
export interface WizardAnswers {
  rating: "u1200" | "1200-1600" | "1600-2000" | "2000+";
  timePerWeek: "under-30m" | "30m-2h" | "2-5h" | "5h+";
  whiteFirst: "e4" | "d4" | "c4-nf3" | "both";
  vsE4: "sicilian" | "e5-classical" | "french" | "caro-kann" | "modern-pirc" | "any";
  vsD4: "kings-indian" | "nimzo-indian" | "qgd-orthodox" | "slav" | "grunfeld" | "any";
  style: "attacker" | "positional" | "universal";
  aggression: 1 | 2 | 3 | 4 | 5;            // 1 = solid · 5 = wild gambits
  theoryLoad: "love-it" | "avoid-it" | "whatever-works";
  roleModel: "kasparov" | "karpov" | "carlsen" | "tal" | "fischer" | "none";
  surpriseWeapons: boolean;                   // include some off-beat openings?
}

/** What the wizard produces. */
export interface Repertoire {
  answers: WizardAnswers;
  whiteSlugs: string[];   // openings played AS White (ordered by fit-score desc)
  blackVsE4: string[];    // Black replies to 1.e4
  blackVsD4: string[];    // Black replies to 1.d4
  createdAt: string;      // ISO
  updatedAt: string;
}

const STORAGE_KEY = "cg_repertoire_v1";

// ── storage ───────────────────────────────────────────────────────────────
export function loadRepertoire(): Repertoire | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Repertoire : null; }
  catch { return null; }
}
export function saveRepertoire(r: Repertoire): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...r, updatedAt: new Date().toISOString() })); }
  catch { /* quota / private mode — silent */ }
}
export function clearRepertoire(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
}

/** Cheap membership check for badges / filters on the browse page. */
export function inRepertoire(slug: string, r?: Repertoire | null): boolean {
  const rep = r ?? loadRepertoire();
  if (!rep) return false;
  return rep.whiteSlugs.includes(slug) || rep.blackVsE4.includes(slug) || rep.blackVsD4.includes(slug);
}

// ── scoring ───────────────────────────────────────────────────────────────
// Each opening gets a fit-score against the user's answers. Higher = better fit.
// White + Black scored separately (the same opening can score high as White and
// zero as Black because it's a 1.e4 opening).

/** Family → whether the family is a 1.e4 opening (White plays 1.e4). */
const E4_FAMILIES = new Set(["italian", "ruy-lopez", "open-e5-misc", "sicilian", "french", "caro-kann", "scandi-alekhine", "modern-pirc"]);
/** 1.d4 family. */
const D4_FAMILIES = new Set(["qgd", "slav", "kings-indian", "nimzo", "grunfeld", "qi-bogo", "catalan", "d4-side", "dutch", "benoni-benko"]);
/** Flank openings (c4 / Nf3 / g3 / etc.). */
const FLANK_FAMILIES = new Set(["english", "reti-kia"]);

/** How each style role model maps to tag preferences. */
const ROLE_MODEL_TAGS: Record<WizardAnswers["roleModel"], string[]> = {
  kasparov: ["dynamic", "aggressive", "theory-heavy"],
  karpov: ["strategic", "positional", "solid", "idea-based"],
  carlsen: ["universal", "endgame-oriented", "sound-long-term"],
  tal: ["tactical", "aggressive", "risky", "romantic"],
  fischer: ["classical", "aggressive", "theory-heavy"],
  none: [],
};

function scoreAsWhite(o: Opening, a: WizardAnswers): number {
  let s = 0;
  // First-move preference
  if (a.whiteFirst === "e4" && E4_FAMILIES.has(o.familyId)) s += 40;
  else if (a.whiteFirst === "d4" && D4_FAMILIES.has(o.familyId)) s += 40;
  else if (a.whiteFirst === "c4-nf3" && FLANK_FAMILIES.has(o.familyId)) s += 40;
  else if (a.whiteFirst === "both") {
    if (E4_FAMILIES.has(o.familyId) || D4_FAMILIES.has(o.familyId) || FLANK_FAMILIES.has(o.familyId)) s += 20;
  } else return -Infinity;   // wrong first move — skip
  s += scoreByStyle(o, a);
  s += (o.frequencyBps ?? 0) / 200;  // popularity boost (0-50 pts)
  if (o.tier === 1) s += 15;         // pillars ranked above generated branches
  return s;
}

function scoreAsBlackVsE4(o: Opening, a: WizardAnswers): number {
  // Only e4-family openings played from Black's side count.
  if (!E4_FAMILIES.has(o.familyId)) return -Infinity;
  let s = 0;
  const wantFamily = a.vsE4 === "any" ? null : mapVsE4ToFamily(a.vsE4);
  if (wantFamily) {
    if (o.familyId === wantFamily) s += 40;
    else return -Infinity;   // user picked a specific family
  } else {
    s += 20;   // any e4 defence eligible
  }
  s += scoreByStyle(o, a);
  s += (o.frequencyBps ?? 0) / 200;
  if (o.tier === 1) s += 15;
  return s;
}

function scoreAsBlackVsD4(o: Opening, a: WizardAnswers): number {
  if (!D4_FAMILIES.has(o.familyId)) return -Infinity;
  let s = 0;
  const wantFamily = a.vsD4 === "any" ? null : mapVsD4ToFamily(a.vsD4);
  if (wantFamily) {
    if (o.familyId === wantFamily) s += 40;
    else return -Infinity;
  } else {
    s += 20;
  }
  s += scoreByStyle(o, a);
  s += (o.frequencyBps ?? 0) / 200;
  if (o.tier === 1) s += 15;
  return s;
}

function mapVsE4ToFamily(v: WizardAnswers["vsE4"]): string | null {
  switch (v) {
    case "sicilian": return "sicilian";
    case "french": return "french";
    case "caro-kann": return "caro-kann";
    case "modern-pirc": return "modern-pirc";
    case "e5-classical": return "italian";  // will also match ruy / open-e5 via score fallback below
    case "any": return null;
  }
}
function mapVsD4ToFamily(v: WizardAnswers["vsD4"]): string | null {
  switch (v) {
    case "kings-indian": return "kings-indian";
    case "nimzo-indian": return "nimzo";
    case "qgd-orthodox": return "qgd";
    case "slav": return "slav";
    case "grunfeld": return "grunfeld";
    case "any": return null;
  }
}

function scoreByStyle(o: Opening, a: WizardAnswers): number {
  let s = 0;
  const tags = new Set(o.tagSlugs);
  // Style preference
  if (a.style === "attacker") {
    if (tags.has("aggressive")) s += 15;
    if (tags.has("tactical")) s += 10;
    if (tags.has("dynamic")) s += 8;
    if (tags.has("solid")) s -= 10;
    if (tags.has("positional")) s -= 5;
  } else if (a.style === "positional") {
    if (tags.has("positional")) s += 15;
    if (tags.has("strategic")) s += 10;
    if (tags.has("solid")) s += 8;
    if (tags.has("aggressive")) s -= 8;
    if (tags.has("tactical")) s -= 5;
  }  // universal = no style bonus
  // Aggression slider (1-5)
  if (a.aggression >= 4) {
    if (tags.has("aggressive") || tags.has("risky")) s += 5 * a.aggression;
    if (tags.has("solid")) s -= 15;
  } else if (a.aggression <= 2) {
    if (tags.has("solid") || tags.has("sound-long-term")) s += 5 * (6 - a.aggression);
    if (tags.has("risky") || tags.has("aggressive")) s -= 10;
  }
  // Theory load
  if (a.theoryLoad === "love-it" && tags.has("theory-heavy")) s += 10;
  if (a.theoryLoad === "avoid-it") {
    if (tags.has("theory-heavy")) s -= 15;
    if (tags.has("idea-based") || tags.has("sound-long-term") || tags.has("universal")) s += 10;
  }
  // Surprise weapons
  if (a.surpriseWeapons && tags.has("surprise-weapon")) s += 5;
  else if (!a.surpriseWeapons && tags.has("surprise-weapon")) s -= 8;
  // Role model
  const rmTags = ROLE_MODEL_TAGS[a.roleModel] ?? [];
  for (const t of rmTags) if (tags.has(t)) s += 3;
  return s;
}

/** Build a repertoire from wizard answers. Roughly 12-15 per side (adjust for
 *  time-per-week — more time = more openings to memorise). */
export function generateRepertoire(a: WizardAnswers): Repertoire {
  const sizeByTime = { "under-30m": 6, "30m-2h": 10, "2-5h": 15, "5h+": 20 };
  const perSide = sizeByTime[a.timePerWeek];

  const rank = (score: (o: Opening) => number) =>
    OPENINGS.map((o) => ({ o, s: score(o) }))
      .filter((r) => Number.isFinite(r.s))
      .sort((x, y) => y.s - x.s)
      .slice(0, perSide)
      .map((r) => r.o.slug);

  const now = new Date().toISOString();
  return {
    answers: a,
    whiteSlugs: rank((o) => scoreAsWhite(o, a)),
    blackVsE4:  rank((o) => scoreAsBlackVsE4(o, a)),
    blackVsD4:  rank((o) => scoreAsBlackVsD4(o, a)),
    createdAt: now,
    updatedAt: now,
  };
}

// ── UI helper: what's this opening's role in the repertoire? ─────────────
export function repertoireRoleOf(slug: string, r?: Repertoire | null): "white" | "vs-e4" | "vs-d4" | null {
  const rep = r ?? loadRepertoire();
  if (!rep) return null;
  if (rep.whiteSlugs.includes(slug)) return "white";
  if (rep.blackVsE4.includes(slug)) return "vs-e4";
  if (rep.blackVsD4.includes(slug)) return "vs-d4";
  return null;
}
