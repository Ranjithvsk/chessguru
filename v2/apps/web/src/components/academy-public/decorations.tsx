// Chess-themed decoration primitives used by the public academy page.
//
// All hand-drawn SVG so we don't pull a new dep and every piece can be tinted
// via `currentColor`. Sizes are Tailwind classes on the outer <span>/<div>.
//
// Nothing in this file talks to the network or React state — pure presentation
// so the whole set can be tree-shaken if unused.

import type { JSX } from "react";

// A quick lookup so callers pass a semantic piece name instead of an SVG path.
// The path data is taken from the classic FIDE outlines, simplified to a
// single-fill silhouette so it renders sharp at any size and against any
// background.
const PIECE_PATHS: Record<string, string> = {
  king:
    "M22.5 11.63V6M20 8h5M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5zM12.5 37c5.5 3.5 14.5 3.5 20 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z",
  queen:
    "M8 12a2 2 0 11-4 0 2 2 0 014 0zM24.5 7.5a2 2 0 11-4 0 2 2 0 014 0zM41 12a2 2 0 11-4 0 2 2 0 014 0zM16 8.5a2 2 0 11-4 0 2 2 0 014 0zM33 9a2 2 0 11-4 0 2 2 0 014 0zM9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14l2 12zM9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z",
  rook:
    "M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5M34 14l-3 3H14l-3-3M31 17v12.5H14V17M31 29.5l1.5 2.5h-20l1.5-2.5M11 14h23",
  bishop:
    "M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2zM15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2zM25 8a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z",
  knight:
    "M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3M9.5 25.5a.5.5 0 11-1 0 .5.5 0 011 0zM15 15.5a.5 1.5 30 11-.866-.5.5 1.5 30 01.866.5z",
  pawn:
    "M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z",
};

interface PieceProps {
  piece: keyof typeof PIECE_PATHS | string;
  className?: string;
  title?: string;
}

/** Big chess piece silhouette used as a corner/section watermark. Passes
 *  `className` straight through so callers can size/tint/position with
 *  Tailwind utilities (opacity, blur, etc.). */
export function PieceSilhouette({ piece, className, title }: PieceProps): JSX.Element {
  const d = PIECE_PATHS[piece] || PIECE_PATHS.knight;
  return (
    <svg
      viewBox="0 0 45 45"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <path d={d} fill="currentColor" stroke="currentColor" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Tileable 8×8 chessboard-square SVG data URI used as a low-opacity
 *  background texture. Colour comes from the two hex args so it can
 *  match the surrounding section. Default: warm cream + soft indigo. */
export function chessboardBgDataUri(light = "#fef7e0", dark = "#c7d2fe"): string {
  // Two 40×40 squares in a 80×80 tile so background-size: 80px 80px gives
  // a proper checker. Using SVG (not repeating-conic) keeps sharp edges
  // on retina displays.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><rect width='40' height='40' fill='${light}'/><rect x='40' y='40' width='40' height='40' fill='${light}'/><rect x='40' width='40' height='40' fill='${dark}'/><rect y='40' width='40' height='40' fill='${dark}'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** Rating tier pill — colour-tiered by Elo band. Used on coach cards and
 *  student "champions" grid. */
export function RatingPill({ rating }: { rating: number }): JSX.Element {
  let cls = "bg-slate-100 text-slate-700 ring-slate-200";
  let icon = "♟";
  if (rating >= 2200) {
    cls = "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white ring-violet-300";
    icon = "★";
  } else if (rating >= 2000) {
    cls = "bg-gradient-to-r from-amber-400 to-orange-500 text-white ring-amber-300";
    icon = "♛";
  } else if (rating >= 1500) {
    cls = "bg-amber-100 text-amber-800 ring-amber-200";
    icon = "♞";
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ${cls}`}>
      <span aria-hidden>{icon}</span>
      <span>{rating} Elo</span>
    </span>
  );
}

/** Chess-title badge (GM / IM / FM / CM / WGM …). Colour matches FIDE-ish
 *  norms: GM is gold, IM silver, FM bronze, others slate. Empty title →
 *  renders nothing (returns null). */
export function TitleBadge({ title }: { title?: string }): JSX.Element | null {
  if (!title) return null;
  const t = title.toUpperCase();
  let cls = "bg-slate-800 text-white";
  if (t === "GM" || t === "WGM") cls = "bg-gradient-to-br from-amber-400 to-yellow-600 text-white shadow-md shadow-amber-400/30";
  else if (t === "IM" || t === "WIM") cls = "bg-gradient-to-br from-slate-400 to-slate-600 text-white";
  else if (t === "FM" || t === "WFM") cls = "bg-gradient-to-br from-orange-500 to-amber-700 text-white";
  else if (t === "CM" || t === "WCM" || t === "NM") cls = "bg-slate-700 text-white";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider ${cls}`}>
      {t}
    </span>
  );
}

/** Emoji country flag from a two-letter ISO code. Non-2-letter falls back
 *  to a globe. */
export function CountryFlag({ country }: { country: string }): JSX.Element | null {
  if (!country) return null;
  if (!/^[A-Z]{2}$/i.test(country)) return <span aria-hidden>🌐</span>;
  const cc = country.toUpperCase();
  const emoji = String.fromCodePoint(...cc.split("").map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
  return <span className="text-lg leading-none" title={cc}>{emoji}</span>;
}

/** Five-star rating strip. Half-stars supported (0.5 increments). */
export function StarRating({ rating, size = "md" }: { rating: number; size?: "sm" | "md" | "lg" }): JSX.Element {
  const clamped = Math.max(0, Math.min(5, rating));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.5;
  const cls = size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <div className={`inline-flex items-center gap-0.5 ${cls}`} aria-label={`${clamped} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => {
        if (i < full) return <span key={i} className="text-amber-400">★</span>;
        if (i === full && half) return <span key={i} className="text-amber-400">⯨</span>;
        return <span key={i} className="text-slate-300">★</span>;
      })}
    </div>
  );
}

/** Absolute-positioned decorative pattern layer that wraps a chessboard
 *  texture at low opacity. Drop into any section as first child. */
export function ChessboardPattern({
  className = "",
  light = "#fef3c7",
  dark = "#c7d2fe",
  opacity = 0.08,
}: {
  className?: string;
  light?: string;
  dark?: string;
  opacity?: number;
}): JSX.Element {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ backgroundImage: chessboardBgDataUri(light, dark), backgroundSize: "80px 80px", opacity }}
    />
  );
}

/** SVG hero illustration used when the academy has no cover image. A stylised
 *  chess scene: a partial board, a queen and knight silhouette, and a soft
 *  gradient sky — colourful enough to feel intentional. */
export function HeroChessScene(): JSX.Element {
  return (
    <svg viewBox="0 0 600 480" className="w-full h-auto" role="img" aria-label="Chess pieces on a board">
      <defs>
        <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="60%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#fca5a5" />
        </linearGradient>
        <linearGradient id="boardG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* backdrop */}
      <rect width="600" height="480" fill="url(#skyG)" rx="24" />
      <circle cx="440" cy="140" r="120" fill="url(#glow)" />

      {/* board — perspective foreshortened to hint depth */}
      <g transform="translate(60 260) skewX(-8)">
        <rect width="480" height="200" rx="6" fill="url(#boardG)" />
        {/* 8×8 grid — only 4 rows visible (front of board) */}
        {Array.from({ length: 4 }).map((_, r) =>
          Array.from({ length: 8 }).map((__, c) => {
            const isDark = (r + c) % 2 === 1;
            return (
              <rect
                key={`${r}-${c}`}
                x={c * 60}
                y={r * 50}
                width="60"
                height="50"
                fill={isDark ? "#1e3a8a" : "#f8fafc"}
                opacity={isDark ? 0.85 : 0.95}
              />
            );
          }),
        )}
      </g>

      {/* queen silhouette — violet */}
      <g transform="translate(230 60) scale(4.2)" fill="#7c3aed" opacity="0.92">
        <path d="M8 12a2 2 0 11-4 0 2 2 0 014 0zM24.5 7.5a2 2 0 11-4 0 2 2 0 014 0zM41 12a2 2 0 11-4 0 2 2 0 014 0zM16 8.5a2 2 0 11-4 0 2 2 0 014 0zM33 9a2 2 0 11-4 0 2 2 0 014 0zM9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14l2 12z" />
      </g>

      {/* knight silhouette — chess-blue */}
      <g transform="translate(80 90) scale(3.6)" fill="#1e3a8a" opacity="0.9">
        <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" />
      </g>

      {/* tiny amber pawn */}
      <g transform="translate(430 240) scale(2.4)" fill="#f59e0b">
        <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" />
      </g>

      {/* decorative sparkles */}
      <circle cx="500" cy="80" r="4" fill="#f59e0b" />
      <circle cx="60" cy="180" r="3" fill="#7c3aed" />
      <circle cx="550" cy="200" r="2.5" fill="#e11d48" />
    </svg>
  );
}

/** Small mini-board diagram used in the About section. Renders a real
 *  Sicilian-like position statically (no interactivity, no chessground dep). */
export function MiniBoardDiagram(): JSX.Element {
  // Position: after 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 (Najdorf).
  // Board rendered from White's POV.
  const board: Array<Array<string>> = [
    ["r", "", "b", "q", "k", "b", "", "r"],
    ["", "p", "", "", "p", "p", "p", "p"],
    ["p", "", "", "p", "", "n", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["", "", "", "N", "P", "", "", ""],
    ["", "", "N", "", "", "", "", ""],
    ["P", "P", "P", "", "", "P", "P", "P"],
    ["R", "", "B", "Q", "K", "B", "", "R"],
  ];
  const glyphs: Record<string, string> = {
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
  };
  return (
    <div className="relative aspect-square w-full max-w-sm mx-auto rounded-2xl overflow-hidden shadow-2xl ring-4 ring-white">
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {board.flatMap((row, r) =>
          row.map((sq, c) => {
            const isLight = (r + c) % 2 === 0;
            return (
              <div
                key={`${r}-${c}`}
                className={`flex items-center justify-center text-3xl md:text-4xl select-none ${isLight ? "bg-amber-50" : "bg-indigo-700"} ${sq === sq.toUpperCase() ? "text-slate-900" : "text-slate-900"}`}
              >
                {sq ? <span className={sq === sq.toUpperCase() ? "text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]" : "text-slate-900"} style={sq === sq.toUpperCase() ? { WebkitTextStroke: "0.5px #0f172a" } : undefined}>{glyphs[sq]}</span> : null}
              </div>
            );
          }),
        )}
      </div>
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-white/90 text-slate-800 text-[10px] font-bold uppercase tracking-widest">Najdorf Sicilian</div>
    </div>
  );
}
