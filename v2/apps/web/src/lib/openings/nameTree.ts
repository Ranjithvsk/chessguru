// Parse the corpus into a 3-column NAME-based drilldown:
//   Family (root) → Opening (mid) → Variation (leaf, may nest deeper)
//
// The Lichess opening naming convention is:
//   "Sicilian Defense"                              → root of the Sicilian family
//   "Sicilian Defense: Najdorf Variation"           → mid layer under Sicilian
//   "Sicilian Defense: Najdorf, English Attack"     → deeper variation
//   "Sicilian Defense: Najdorf, English Attack, 6.Be3 e5"   → sub-sub-variation
//
// We split first on ": " (family/rest), then on ", " (variation path). Every
// unique prefix becomes a folder; each opening in the corpus is placed under
// its full path.
//
// Owner ask 2026-08-19: "option to select openings from openings names like
// tree". Keeps the existing SAN move-tree at /study/tree intact — this is the
// complementary NAME-tree.

import { OPENINGS } from "./index";
import type { Opening } from "./types";

export interface NameNode {
  key: string;                        // full path joined by " / "
  label: string;                      // this segment's display
  children: Map<string, NameNode>;
  openings: Opening[];                // openings that terminate at THIS path
}

function newNode(key: string, label: string): NameNode {
  return { key, label, children: new Map(), openings: [] };
}

let cached: NameNode | null = null;

/** Build (and cache) the full name-tree from the corpus. Root has one child
 *  per family. Deterministic order: openings sorted by tier asc → frequency
 *  desc → name asc, so pillars surface first inside each folder. */
export function buildNameTree(): NameNode {
  if (cached) return cached;
  const root = newNode("", "root");

  for (const o of OPENINGS) {
    // Prefer ecoName (Lichess exact) — falls back to our display name.
    const raw = (o.ecoName || o.name || "").trim();
    if (!raw) continue;
    const [familyPart, ...rest] = raw.split(":");
    const family = (familyPart || "").trim();
    const variationString = rest.join(":").trim();       // preserve any embedded colons
    const variations = variationString ? variationString.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const path = [family, ...variations];

    let cur = root;
    let acc = "";
    for (const seg of path) {
      acc = acc ? `${acc} / ${seg}` : seg;
      let child = cur.children.get(seg);
      if (!child) {
        child = newNode(acc, seg);
        cur.children.set(seg, child);
      }
      cur = child;
    }
    cur.openings.push(o);
  }

  // Sort openings within each folder for stable UI.
  const sortNode = (n: NameNode) => {
    n.openings.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const fd = (b.frequencyBps ?? 0) - (a.frequencyBps ?? 0);
      if (fd) return fd;
      return a.name.localeCompare(b.name);
    });
    for (const c of n.children.values()) sortNode(c);
  };
  sortNode(root);

  // Two-part post-process:
  //
  // (1) At ROOT, MERGE families that differ only by a "type suffix"
  //     (Defense/Defence/Opening/Attack/Game/System/Variation). Our
  //     hand-written pillars use short names ("Sicilian", "French") while
  //     the generated ECO corpus uses long canonical names ("Sicilian
  //     Defense", "French Defense") — without this merge they'd appear as
  //     two separate families at the top level. Long name wins.
  //
  // (2) Then at EVERY level, re-parent siblings whose label starts with
  //     another sibling's label + a space, SKIPPING the type-suffix cases
  //     (which are name variants, not sub-variations). Lichess writes many
  //     variations as own-line names ("Smith-Morra Gambit Accepted")
  //     rather than comma-nested ("Smith-Morra Gambit, Accepted"), so this
  //     pulls them under their real parent.
  //
  // Fix owner report 2026-08-19: "sicilian defence into sicilian, defence
  // which is wrong, but smith-morra gambit tree is correct".
  const TYPE_SUFFIXES = new Set(["Defense", "Defence", "Opening", "Attack", "Game", "System", "Variation"]);

  const mergeAtRoot = (r: NameNode) => {
    const kids = [...r.children.values()].sort((a, b) => a.label.length - b.label.length);
    for (const shortNode of kids) {
      // Find a longer sibling that starts with this + " " + one type suffix.
      const longMatch = kids.find((k) =>
        k !== shortNode
        && k.label.length > shortNode.label.length
        && k.label.startsWith(shortNode.label + " ")
        && TYPE_SUFFIXES.has(k.label.slice(shortNode.label.length + 1)),
      );
      if (!longMatch) continue;
      // Merge shortNode INTO longMatch (canonical wins).
      for (const o of shortNode.openings) longMatch.openings.push(o);
      for (const [k, v] of shortNode.children) {
        if (!longMatch.children.has(k)) {
          v.key = `${longMatch.key} / ${k}`;
          longMatch.children.set(k, v);
        }
        // Duplicate child key at both parents — skip; keep the canonical
        // parent's version so we don't accidentally lose curated data.
      }
      r.children.delete(shortNode.label);
    }
  };
  mergeAtRoot(root);

  const reparentByPrefix = (n: NameNode) => {
    const kids = [...n.children.values()].sort((a, b) => a.label.length - b.label.length);
    const seen: NameNode[] = [];
    for (const c of kids) {
      const parent = seen.find((p) => c.label.startsWith(p.label + " "));
      if (parent) {
        const newLabel = c.label.slice(parent.label.length + 1).trim();
        // Skip type-suffix "reparents" — these are just name variants and
        // would collapse two peers instead of creating a real hierarchy.
        if (TYPE_SUFFIXES.has(newLabel)) { seen.push(c); continue; }
        n.children.delete(c.label);
        c.label = newLabel;
        c.key = `${parent.key} / ${newLabel}`;
        parent.children.set(newLabel, c);
      } else {
        seen.push(c);
      }
    }
    for (const c of n.children.values()) reparentByPrefix(c);
  };
  reparentByPrefix(root);

  cached = root;
  return root;
}

/** Recursive count of openings under a subtree (including this node). */
export function subtreeOpeningCount(node: NameNode): number {
  let n = node.openings.length;
  for (const c of node.children.values()) n += subtreeOpeningCount(c);
  return n;
}

/** Sort children of a node by subtree size desc (busiest family/variation first). */
export function sortedNameChildren(node: NameNode): NameNode[] {
  return [...node.children.values()].sort((a, b) => {
    const nd = subtreeOpeningCount(b) - subtreeOpeningCount(a);
    if (nd) return nd;
    return a.label.localeCompare(b.label);
  });
}
