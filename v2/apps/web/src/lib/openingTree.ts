// Memory Master 500 — build a move-trie of the entire corpus.
//
// Every opening's pgnStart contributes a path from root. Nodes share the
// prefix. Each node knows: the SAN played to reach it, the openings that end
// EXACTLY here (i.e. the leaf for that opening's identification depth), and
// the recursive size of the subtree below it.
//
// Consumed by pages/OpeningTree.tsx as a lazy-expanded nested tree.

import { OPENINGS } from "./openings";
import type { Opening } from "./openings/types";

export interface TreeNode {
  san: string;                // move to reach this node ("" for root)
  fullPath: string[];         // full san sequence from root, root = []
  children: Map<string, TreeNode>;
  /** Openings whose pgnStart ENDS exactly at this node. Sorted by frequency. */
  openings: Opening[];
  /** Total openings reachable at or below this node (incl. self). */
  count: number;
  /** Rough family-frequency map for family-color rendering of the aggregate node. */
  familyMix: Map<string, number>;
}

export function buildTree(): TreeNode {
  const root: TreeNode = {
    san: "",
    fullPath: [],
    children: new Map(),
    openings: [],
    count: 0,
    familyMix: new Map(),
  };

  for (const o of OPENINGS) {
    const path = o.pgnStart;
    if (!path?.length) continue;
    let cur = root;
    for (let i = 0; i < path.length; i++) {
      const san = path[i]!;
      let child = cur.children.get(san);
      if (!child) {
        child = {
          san,
          fullPath: path.slice(0, i + 1),
          children: new Map(),
          openings: [],
          count: 0,
          familyMix: new Map(),
        };
        cur.children.set(san, child);
      }
      cur = child;
    }
    cur.openings.push(o);
  }

  // 2nd pass: sort openings per node by frequency, and compute subtree counts + family mix.
  const finalize = (n: TreeNode) => {
    n.openings.sort((a, b) => (b.frequencyBps ?? 0) - (a.frequencyBps ?? 0));
    let cnt = n.openings.length;
    for (const o of n.openings) {
      n.familyMix.set(o.familyId, (n.familyMix.get(o.familyId) ?? 0) + 1);
    }
    for (const child of n.children.values()) {
      finalize(child);
      cnt += child.count;
      for (const [fam, k] of child.familyMix) {
        n.familyMix.set(fam, (n.familyMix.get(fam) ?? 0) + k);
      }
    }
    n.count = cnt;
  };
  finalize(root);
  return root;
}

/** Sort a node's children for display: by subtree count (biggest branches first). */
export function sortedChildren(n: TreeNode): TreeNode[] {
  return [...n.children.values()].sort((a, b) => b.count - a.count);
}

/** Get the dominant family for a node — used to colour the connector line. */
export function dominantFamily(n: TreeNode): string | null {
  let best: string | null = null;
  let bestK = 0;
  for (const [fam, k] of n.familyMix) {
    if (k > bestK) { best = fam; bestK = k; }
  }
  return best;
}
