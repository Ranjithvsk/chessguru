// A clickable move tree: the mainline flowing, variations in parentheses,
// exactly the way a chess book prints them and the way Dream Meet's class
// board serialises them.
//
// Why not the flat two-column table: that can only ever show ONE line. Playing
// a different move from a rewound position creates a real branch in the board's
// tree, and a flat list either hides it or destroys it. Here every branch stays
// visible and one click switches to it.
//
// Presentational only — the caller owns the cursor and hands back the path.
import { useEffect, useRef } from "react";

export interface TreeNode {
  san: string;
  nag?: string;
  comment?: string;
  children: TreeNode[];
}

export interface MoveTreeProps {
  tree: TreeNode[];
  /** Cursor: child indices from the root. [] = the start position. */
  path: number[];
  onPick: (path: number[]) => void;
  className?: string;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export default function MoveTree({ tree, path, onPick, className = "" }: MoveTreeProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [path]);

  const move = (node: TreeNode, at: number[], ply: number, forceNumber: boolean) => {
    const white = ply % 2 === 0;                 // ply counts from 0 = white to move
    const num = Math.floor(ply / 2) + 1;
    const active = same(at, path);
    return (
      <span key={at.join("-")} className="whitespace-nowrap">
        {(white || forceNumber) && (
          <span className="mr-0.5 text-ink-500">{num}{white ? "." : "…"}</span>
        )}
        <button
          type="button"
          ref={active ? activeRef : undefined}
          onClick={() => onPick(at)}
          className={`rounded px-1 py-0.5 font-mono text-sm transition ${
            active ? "bg-brand-500/70 text-white" : "text-ink-100 hover:bg-ink-800"}`}
        >
          {node.san}{node.nag ?? ""}
        </button>{" "}
      </span>
    );
  };

  /** One line and everything hanging off it. Siblings beyond the first are
   *  rendered as parenthesised variations after the move they replace, which
   *  is where a reader expects to find them. */
  const line = (nodes: TreeNode[], base: number[], ply: number, insideVariation: boolean): JSX.Element[] => {
    const out: JSX.Element[] = [];
    let cur = nodes;
    let at = base;
    let p = ply;
    let first = true;
    while (cur.length) {
      const main = cur[0]!;
      const mainPath = [...at, 0];
      // A black move needs its number repeated when it opens a line or follows
      // a variation, or "…Nc6" floats with no move number to anchor it.
      out.push(move(main, mainPath, p, first && insideVariation));
      for (let i = 1; i < cur.length; i++) {
        const alt = cur[i]!;
        out.push(
          <span key={`v-${[...at, i].join("-")}`} className="text-ink-400">
            ({line([alt], at, p, true)})
          </span>,
        );
      }
      if (main.comment) {
        out.push(
          <span key={`c-${mainPath.join("-")}`} className="mr-1 text-xs italic text-ink-400">
            {main.comment}
          </span>,
        );
      }
      at = mainPath;
      cur = main.children;
      p += 1;
      first = false;
    }
    return out;
  };

  if (!tree.length) return null;

  return (
    <div className={`leading-7 ${className}`}>
      <button
        type="button"
        onClick={() => onPick([])}
        className={`mr-1 rounded px-1 py-0.5 text-[11px] uppercase tracking-wide transition ${
          path.length === 0 ? "bg-brand-500/70 text-white" : "text-ink-500 hover:bg-ink-800"}`}
      >
        start
      </button>
      {line(tree, [], 0, false)}
    </div>
  );
}
