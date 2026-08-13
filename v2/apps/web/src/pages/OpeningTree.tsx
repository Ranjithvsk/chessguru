// Memory Master 500 — visual family tree of the corpus.
// Route: /study/tree
//
// Left: nested collapsible tree. Every node is a SAN move; children are the
// moves played AT this position by any of the 500 corpus openings. Node size
// = subtree count; connector colour = dominant family. Leaves link to the
// opening detail page.
//
// Right: board rendering the position of the currently-focused node, so you
// can see the tree branch WHILE seeing the resulting position.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Chess } from "chess.js";
import Board from "../components/Board";
import { buildTree, sortedChildren, dominantFamily, type TreeNode } from "../lib/openingTree";
import { FAMILIES, familyById, openingBySlug } from "../lib/openings";
import { isActivated } from "../lib/cards";
import { loadRepertoire, repertoireRoleOf } from "../lib/repertoire";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function OpeningTree() {
  const root = useMemo(() => buildTree(), []);
  const [focusPath, setFocusPath] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const rep = useMemo(() => loadRepertoire(), []);

  // Convert focusPath to a FEN so the board mirrors the tree cursor.
  const focusFen = useMemo(() => {
    if (focusPath.length === 0) return START_FEN;
    const g = new Chess();
    for (const san of focusPath) {
      try { g.move(san); } catch { return g.fen(); }
    }
    return g.fen();
  }, [focusPath]);

  const focusPathKey = focusPath.join("|");

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-3">
        <h1 className="text-2xl font-bold">Opening tree</h1>
        <p className="mt-1 text-sm text-ink-500">
          The 500-corpus arranged as one big move-tree. Click ▶ to expand a branch, or click any move to
          preview the position. Leaves are openings — tap to read.
        </p>
      </header>

      {/* Family colour legend */}
      <div className="mb-3 flex flex-wrap gap-2 text-[10px]">
        {FAMILIES.slice(0, 12).map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.colorHex }} />
            {f.name}
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-ink-900 bg-ink-900 p-3">
          <TreeRow
            node={root}
            depth={0}
            expanded={expanded}
            focusPathKey={focusPathKey}
            rep={rep}
            onToggle={toggle}
            onFocus={setFocusPath}
          />
        </div>

        <aside className="space-y-3">
          <div className="sticky top-4">
            <Board fen={focusFen} viewOnly coordinates />
            <div className="mt-2 rounded-lg bg-ink-950 p-2 text-center font-mono text-xs">
              {focusPath.length === 0 ? "start" : focusPath.map((san, i) => (
                <span key={i}>
                  {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : " "}
                  {san}{" "}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-ink-500">
              Board mirrors the highlighted node. Depth {focusPath.length}.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TreeRow({
  node, depth, expanded, focusPathKey, rep, onToggle, onFocus,
}: {
  node: TreeNode; depth: number; expanded: Set<string>; focusPathKey: string;
  rep: ReturnType<typeof loadRepertoire>;
  onToggle: (key: string) => void; onFocus: (path: string[]) => void;
}) {
  const key = node.fullPath.join("|");
  const isExpanded = expanded.has(key);
  const isFocus = focusPathKey === key;
  const children = sortedChildren(node);
  const hasChildren = children.length > 0;
  const domFam = dominantFamily(node);
  const domColor = domFam ? familyById.get(domFam)?.colorHex : "#94a3b8";
  const sideToMove = node.fullPath.length % 2 === 0 ? "w" : "b";
  const moveNo = Math.floor((node.fullPath.length - 1) / 2) + 1;

  return (
    <div>
      {/* This node's own row (root = special, no move label) */}
      {node.fullPath.length > 0 && (
        <div
          className={`flex items-center gap-1.5 rounded py-0.5 pr-2 text-xs ${isFocus ? "bg-yellow-100" : "hover:bg-ink-950"}`}
          style={{ paddingLeft: `${depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              onClick={() => onToggle(key)}
              className="h-4 w-4 shrink-0 text-ink-600 hover:text-ink-300"
              aria-label={isExpanded ? "collapse" : "expand"}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}

          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: domColor }} />

          <button
            onClick={() => onFocus(node.fullPath)}
            className="flex items-center gap-1.5 truncate text-left font-mono"
          >
            <span className={`font-semibold ${sideToMove === "b" ? "text-ink-300" : "text-ink-100"}`}>
              {sideToMove === "b" ? `${moveNo}.` : `${moveNo}…`}
            </span>
            <span className={`${sideToMove === "b" ? "text-ink-100" : "text-ink-400"}`}>{node.san}</span>
          </button>

          {/* Openings that end exactly at this ply */}
          {node.openings.map((o) => {
            const role = repertoireRoleOf(o.slug, rep);
            const active = isActivated(o.slug);
            return (
              <Link
                key={o.slug}
                to={`/study/openings/${o.slug}`}
                className={`ml-1 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  role ? "bg-indigo-100 text-indigo-800" : "bg-ink-900 text-ink-300"
                } hover:opacity-80`}
                title={`${o.eco} · ${o.name}`}
              >
                {o.tier === 1 && "⭐ "}
                {o.name}
                {active && " ✓"}
              </Link>
            );
          })}

          {/* Subtree count (if it has more than just self) */}
          {hasChildren && (
            <span className="ml-auto shrink-0 text-[10px] text-ink-600">
              {node.count} inside
            </span>
          )}
        </div>
      )}

      {/* Children */}
      {(node.fullPath.length === 0 || isExpanded) && children.map((c) => (
        <TreeRow
          key={c.fullPath.join("|")}
          node={c}
          depth={node.fullPath.length === 0 ? 0 : depth + 1}
          expanded={expanded}
          focusPathKey={focusPathKey}
          rep={rep}
          onToggle={onToggle}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

/* Small helper if other pages want a "jump to this position in tree" link. */
export function treeUrlForOpeningSlug(slug: string): string {
  const o = openingBySlug.get(slug);
  if (!o) return "/study/tree";
  const q = encodeURIComponent(o.pgnStart.join(","));
  return `/study/tree?path=${q}`;
}
