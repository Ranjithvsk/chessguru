// Bridge between the two move-tree formats ChessGuru stores.
//
//  * My Studies persists a FLAT list — every node carries its own id and a
//    parentId, plus san/uci/fenAfter, a NUMERIC PGN nag code, shapes, the ⭐
//    revise flag and an isMainLine boolean. See apps/api/src/studies.
//  * The Dream Meet board works on a NESTED tree — { move:{from,to,promotion},
//    nag as GLYPH TEXT, comment, shapes, children[] }, where children[0] is
//    the mainline. See apps/api/src/class/class-ws.ts and lib/localClassRoom.
//
// Converting between them is what lets the study editor run the real class
// board instead of an imitation of it. Both directions are lossless:
//   - all 14 glyphs the notation panel offers map onto standard PGN NAG codes
//   - node ids and the ⭐ flag ride along on the nested node as passthrough
//     fields, so a save never renumbers a chapter or drops a revise point
import { Chess } from "chess.js";
import type { LocalTreeNode, LocalShape } from "./localClassRoom";

export type StudyShape = { brush: string; orig: string; dest?: string };
export type StudyMoveNode = {
  id: string;
  parentId: string | null;
  ply: number;
  san: string;
  uci: string;
  fenAfter: string;
  comment?: string;
  nag?: number;
  shapes?: StudyShape[];
  isRevisePoint?: boolean;
  isMainLine: boolean;
};

/** Glyph ⇄ standard PGN NAG code. The first six are the move-quality codes
 *  ($1-$6); the rest are the evaluation symbols ($10-$19). This is the whole
 *  palette the Dream Meet notation panel can produce. */
const GLYPH_TO_NAG: Record<string, number> = {
  "!": 1, "?": 2, "!!": 3, "??": 4, "!?": 5, "?!": 6,
  "=": 10, "∞": 13,
  "+=": 14, "=+": 15,
  "±": 16, "∓": 17,
  "+-": 18, "-+": 19,
};
const NAG_TO_GLYPH: Record<number, string> = Object.fromEntries(
  Object.entries(GLYPH_TO_NAG).map(([g, n]) => [n, g]),
);

export function glyphToNag(glyph?: string): number | undefined {
  if (!glyph) return undefined;
  return GLYPH_TO_NAG[glyph];
}
export function nagToGlyph(nag?: number): string | undefined {
  if (typeof nag !== "number") return undefined;
  return NAG_TO_GLYPH[nag];
}

/** Replay a UCI line ("g1f3") from a FEN into a PGN. Puzzle solutions are
 *  stored as UCI, which a study cannot replay, so every "save this puzzle"
 *  path converts through here. Deliberately non-throwing: a bad move or
 *  promotion edge returns undefined so the caller saves the position alone
 *  rather than a broken game. Returns undefined for an empty line too —
 *  chess.js emits a full seven-tag header for zero moves, which would
 *  otherwise be saved as a chapter containing nothing. */
export function uciLineToPgn(fen: string, line: string[] = []): string | undefined {
  if (!fen || !Array.isArray(line) || line.length === 0) return undefined;
  try {
    const c = new Chess(fen);
    for (const u of line) {
      const applied = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: (u[4] as any) || "q" });
      if (!applied) return undefined;
    }
    return c.pgn() || undefined;
  } catch { return undefined; }
}

function newId(): string {
  const r = Math.random().toString(36).slice(2, 8);
  return (r + "000000").slice(0, 6);
}

/* ── flat (stored) → nested (board) ───────────────────────────────────── */

/** Children of `parentId`, mainline first. Studies marks the mainline with a
 *  per-node boolean rather than by position, so we reorder: the board treats
 *  children[0] AS the mainline. */
function childrenOf(moves: StudyMoveNode[], parentId: string | null): StudyMoveNode[] {
  const kids = moves.filter((m) => (m.parentId ?? null) === parentId);
  const mainIdx = kids.findIndex((k) => k.isMainLine);
  if (mainIdx > 0) {
    const [main] = kids.splice(mainIdx, 1);
    kids.unshift(main!);
  }
  return kids;
}

export function studyMovesToTree(moves: StudyMoveNode[]): LocalTreeNode[] {
  const list = Array.isArray(moves) ? moves : [];
  // Guard against a malformed parentId cycle looping forever.
  const seen = new Set<string>();
  const build = (parentId: string | null): LocalTreeNode[] => {
    const out: LocalTreeNode[] = [];
    for (const m of childrenOf(list, parentId)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const uci = String(m.uci || "");
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) continue;
      const node: LocalTreeNode = {
        move: {
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.slice(4) || undefined,
        },
        children: build(m.id),
      };
      const glyph = nagToGlyph(m.nag);
      if (glyph) node.nag = glyph;
      if (m.comment) node.comment = m.comment;
      if (Array.isArray(m.shapes) && m.shapes.length > 0) {
        node.shapes = m.shapes.map((s) => ({ orig: s.orig, dest: s.dest, brush: s.brush })) as LocalShape[];
      }
      if (m.id) node.id = m.id;
      if (m.isRevisePoint) node.revise = true;
      out.push(node);
    }
    return out;
  };
  return build(null);
}

/* ── nested (board) → flat (stored) ───────────────────────────────────── */

/** Replays the tree from `startFen` to recompute san / uci / fenAfter / ply,
 *  which the flat format stores denormalised. A node whose move is illegal
 *  from its parent position is dropped along with its subtree — the save
 *  endpoint would reject the whole chapter otherwise. */
export function treeToStudyMoves(startFen: string, tree: LocalTreeNode[]): StudyMoveNode[] {
  const out: StudyMoveNode[] = [];
  const walk = (nodes: LocalTreeNode[], parentId: string | null, fenBefore: string, ply: number) => {
    nodes.forEach((n, i) => {
      let board: Chess;
      try { board = new Chess(fenBefore); } catch { return; }
      let played: any = null;
      try {
        played = board.move({
          from: n.move.from, to: n.move.to,
          promotion: (n.move.promotion as any) || "q",
        });
      } catch { played = null; }
      if (!played) return;   // illegal here — drop this branch
      const id = n.id || newId();
      const row: StudyMoveNode = {
        id,
        parentId,
        ply,
        san: played.san,
        uci: played.from + played.to + (played.promotion || ""),
        fenAfter: board.fen(),
        // children[0] is the mainline by board convention.
        isMainLine: i === 0,
      };
      const nag = glyphToNag(n.nag);
      if (nag !== undefined) row.nag = nag;
      if (n.comment) row.comment = n.comment;
      if (Array.isArray(n.shapes) && n.shapes.length > 0) {
        row.shapes = n.shapes.map((s) => ({
          brush: s.brush || "green",
          orig: s.orig,
          dest: s.dest,
        }));
      }
      if (n.revise) row.isRevisePoint = true;
      out.push(row);
      walk(n.children || [], id, row.fenAfter, ply + 1);
    });
  };
  walk(Array.isArray(tree) ? tree : [], null, startFen, 1);
  return out;
}
