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
