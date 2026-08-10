// Client-side chess-board recognition from an uploaded image.
//
// MVP scope: the user supplies a cropped screenshot where the image bounds
// ARE the board. We slice the image into 8x8, sample the center of each
// square, and classify as one of:
//   - empty            (low colour variance vs neighbours)
//   - white-occupied   (dark shape on light average; sampled after subtracting square background)
//   - black-occupied   (light shape on dark, or dark shape on light with lower luminance)
//
// Piece TYPE detection isn't done in MVP (needs a trained CNN). We output a
// FEN with placeholder pieces (P/N/K/k) that chess.js will accept, and let
// the user edit types via the existing BoardEditor. Confidence-per-square is
// returned so the UI can highlight uncertain squares.
//
// Board orientation: assumed white-at-bottom (standard screenshot). A flip
// button in the UI re-runs the FEN build with rows reversed.

import { classifyPiece, type PieceType } from "./pieceClassifier";

export type SquareState = "empty" | "white" | "black";
export type DetectResult = {
  fen: string;
  grid: SquareState[][];    // 8x8, index 0 = top rank (rank 8), index 0 col = a
  confidence: number[][];   // 8x8, 0..1 — lower means "please verify this square"
  types: (PieceType | null)[][];    // per-square piece type when occupied
  imageDataUrl: string;     // for the UI to preview alongside the board
  meta: { whiteCount: number; blackCount: number };
};

/** Load an image file / blob / data-URL into an HTMLImageElement. */
async function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = url;
    });
    return img;
  } finally {
    // Revoke on next tick so decoded pixels remain valid for the caller.
    if (typeof src !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Downscale + crop to square. Screenshots often include a tiny margin; we
 *  trim symmetrically to the largest square that fits. Used as the fallback
 *  when auto-detect can't find a confident board. */
function cropToSquare(img: HTMLImageElement): HTMLCanvasElement {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const dx = Math.floor((img.naturalWidth - side) / 2);
  const dy = Math.floor((img.naturalHeight - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 480; canvas.height = 480;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, dx, dy, side, side, 0, 0, 480, 480);
  return canvas;
}

/** Auto-detect the chess board's bounding square inside a larger screenshot
 *  (browser chrome, side panels, captions, etc.). Approach: downscale to a
 *  work canvas capped at 400px, slide a square window at multiple sizes,
 *  score each by how strongly its 8×8 sub-grid alternates in luminance
 *  the way a chess board should. Best-scoring window is the board.
 *
 *  Returns null when confidence is too low -- caller falls back to
 *  cropToSquare (whole image assumed to be the board) with a UI nudge for
 *  the user to crop manually. Sub-second on a 400×400 work canvas. */
function autoDetectBoard(img: HTMLImageElement): { x: number; y: number; side: number; score: number } | null {
  const scale = 400 / Math.max(img.naturalWidth, img.naturalHeight, 1);
  const workW = Math.round(img.naturalWidth * scale);
  const workH = Math.round(img.naturalHeight * scale);
  const c = document.createElement("canvas");
  c.width = workW; c.height = workH;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, workW, workH);
  const full = ctx.getImageData(0, 0, workW, workH).data;
  const lumAt = (px: number, py: number): number => {
    if (px < 0 || py < 0 || px >= workW || py >= workH) return 0;
    const off = (py * workW + px) * 4;
    return 0.299 * full[off]! + 0.587 * full[off + 1]! + 0.114 * full[off + 2]!;
  };
  const maxSide = Math.min(workW, workH);
  const minSide = Math.max(80, Math.floor(maxSide * 0.3));
  let best: { x: number; y: number; side: number; score: number } | null = null;
  // Scale candidates at 12% steps; positional stride 6% of size. ~1000
  // windows total for a 400×300 image -- runs well under a second.
  for (let side = maxSide; side >= minSide; side = Math.floor(side * 0.88)) {
    const cell = side / 8;
    const step = Math.max(4, Math.floor(side * 0.06));
    for (let y = 0; y <= workH - side; y += step) {
      for (let x = 0; x <= workW - side; x += step) {
        // Sample the CENTRE of each of the 64 sub-cells. Learn dark/light
        // means from the alternating positions, then score how many samples
        // land on the correct side of the midpoint. 64 = perfect chessboard;
        // 32 = random noise.
        let darkSum = 0, darkN = 0, lightSum = 0, lightN = 0;
        const samples: number[] = new Array(64);
        for (let r = 0; r < 8; r++) {
          for (let cx = 0; cx < 8; cx++) {
            const sx = Math.round(x + cx * cell + cell / 2);
            const sy = Math.round(y + r * cell + cell / 2);
            const l = lumAt(sx, sy);
            samples[r * 8 + cx] = l;
            if ((r + cx) % 2 === 0) { lightSum += l; lightN++; }
            else { darkSum += l; darkN++; }
          }
        }
        const lightMean = lightSum / Math.max(1, lightN);
        const darkMean = darkSum / Math.max(1, darkN);
        // Reject candidates where the two square-classes aren't clearly
        // separated (not a board). 25 luminance units ≈ ~10% contrast.
        if (Math.abs(lightMean - darkMean) < 25) continue;
        const mid = (lightMean + darkMean) / 2;
        let correct = 0;
        for (let i = 0; i < 64; i++) {
          const r = Math.floor(i / 8), cx = i % 8;
          const expectLight = (r + cx) % 2 === 0;
          const isLight = samples[i]! >= mid;
          if (isLight === expectLight) correct++;
        }
        if (!best || correct > best.score) {
          best = { x, y, side, score: correct };
        }
      }
    }
  }
  // Demand at least 52/64 correct (81%). Below that the "board" is probably
  // a false positive; caller should nudge the user to crop manually.
  if (!best || best.score < 52) return null;
  return {
    x: Math.round(best.x / scale),
    y: Math.round(best.y / scale),
    side: Math.round(best.side / scale),
    score: best.score,
  };
}

/** Preferred crop: auto-detect the board first, fall back to cropToSquare
 *  when detection is unconfident. Returns the crop canvas + whether the
 *  auto-detector fired (so the UI can nudge the user for a manual crop). */
function detectAndCrop(img: HTMLImageElement): { canvas: HTMLCanvasElement; auto: boolean; score: number | null } {
  const found = autoDetectBoard(img);
  if (!found) return { canvas: cropToSquare(img), auto: false, score: null };
  const c = document.createElement("canvas");
  c.width = 480; c.height = 480;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, found.x, found.y, found.side, found.side, 0, 0, 480, 480);
  return { canvas: c, auto: true, score: found.score };
}

/** Mean + stddev of luminance over a rectangular sample. */
function stats(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): { mean: number; std: number } {
  const data = ctx.getImageData(x, y, w, h).data;
  let sum = 0, sumSq = 0;
  const n = w * h;
  for (let i = 0; i < data.length; i += 4) {
    // Perceived luminance (Rec. 601): cheap and enough for grayscale-ish
    // classification here.
    const l = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    sum += l; sumSq += l * l;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, std: Math.sqrt(variance) };
}

/** Detect the FEN placeholder from a canvas already cropped to the board. */
function classifyGrid(canvas: HTMLCanvasElement): { grid: SquareState[][]; confidence: number[][] } {
  const ctx = canvas.getContext("2d")!;
  const cell = canvas.width / 8;                // 60 for our 480px canvas
  const sample = Math.floor(cell * 0.5);        // sample the middle 50%
  const off = Math.floor((cell - sample) / 2);
  // First pass: read every square's stats to learn dark/light square averages.
  const cellStats: { mean: number; std: number; isDarkSquare: boolean }[][] = [];
  for (let r = 0; r < 8; r++) {
    const row: { mean: number; std: number; isDarkSquare: boolean }[] = [];
    for (let c = 0; c < 8; c++) {
      const s = stats(ctx, c * cell + off, r * cell + off, sample, sample);
      row.push({ ...s, isDarkSquare: (r + c) % 2 === 1 });
    }
    cellStats.push(row);
  }
  // Learn the two square-background luminances by averaging over LOW-variance
  // cells only (those are most likely empty).
  let darkSum = 0, darkN = 0, lightSum = 0, lightN = 0;
  for (const row of cellStats) for (const s of row) {
    if (s.std < 15) {   // "flat" = probably empty
      if (s.isDarkSquare) { darkSum += s.mean; darkN++; }
      else { lightSum += s.mean; lightN++; }
    }
  }
  const bgDark = darkN > 0 ? darkSum / darkN : 90;    // reasonable defaults
  const bgLight = lightN > 0 ? lightSum / lightN : 200;
  // Second pass: classify each square.
  const grid: SquareState[][] = [];
  const conf: number[][] = [];
  for (let r = 0; r < 8; r++) {
    const gRow: SquareState[] = [];
    const cRow: number[] = [];
    for (let c = 0; c < 8; c++) {
      const s = cellStats[r]![c]!;
      const bg = s.isDarkSquare ? bgDark : bgLight;
      const delta = Math.abs(s.mean - bg);
      // Empty: low variance AND close to background luminance.
      if (s.std < 12 && delta < 20) {
        gRow.push("empty");
        cRow.push(0.95);
        continue;
      }
      // Occupied. Decide colour by comparing sampled mean to background:
      // - Piece brighter than bg → white piece
      // - Piece darker than bg  → black piece
      const isWhite = s.mean > bg;
      gRow.push(isWhite ? "white" : "black");
      // Confidence: proportional to how far the piece pulled the mean from bg,
      // capped at 1.0. Very small deltas are ambiguous.
      const c01 = Math.min(1, Math.max(0.3, delta / 60));
      cRow.push(c01);
    }
    grid.push(gRow);
    conf.push(cRow);
  }
  return { grid, confidence: conf };
}

/** Grid → FEN with placeholder piece types. chess.js validates on load, so
 *  we place pieces conservatively:
 *   - White piece on rank 1 or 8 → N (knight; ranks 1/8 are illegal for pawns)
 *   - White piece elsewhere → P
 *   - Ensure exactly one K and one k so the position loads. If no white
 *     piece was detected, drop K on e1; if none was on rank 1 or 8, pick
 *     the highest-index W square. Symmetric for black. */
export function gridToFen(grid: SquareState[][], types?: (PieceType | null)[][]): string {
  // Start from classified types when provided, else fall back to a pawn/
  // knight placeholder. In either case ensureKing runs after to guarantee
  // a legal FEN.
  const pieces: (string | "")[][] = grid.map((row, r) =>
    row.map((sq, c) => {
      if (sq === "empty") return "";
      const white = sq === "white";
      const rank = 8 - r;
      const pawnAllowed = rank !== 1 && rank !== 8;
      const inferred = types?.[r]?.[c] ?? null;
      let p: string;
      if (inferred) {
        // Respect the classifier's guess, but demote a pawn on rank 1/8 to
        // knight since chess.js will reject it otherwise.
        if (inferred === "P" && !pawnAllowed) p = white ? "N" : "n";
        else p = white ? inferred : inferred.toLowerCase();
      } else {
        p = white ? (pawnAllowed ? "P" : "N") : (pawnAllowed ? "p" : "n");
      }
      return p;
    })
  );
  // Ensure kings.
  const ensureKing = (isWhite: boolean) => {
    const kingChar = isWhite ? "K" : "k";
    // Already present?
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (pieces[r]![c] === kingChar) return;
    // Find a candidate square of the right colour.
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = pieces[r]![c];
      if (p && p.toUpperCase() === "N") {   // prefer overwriting N (unlikely piece)
        if (isWhite && p === "N") { pieces[r]![c] = kingChar; return; }
        if (!isWhite && p === "n") { pieces[r]![c] = kingChar; return; }
      }
    }
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = pieces[r]![c];
      if (p && (isWhite ? p === p.toUpperCase() : p === p.toLowerCase())) {
        pieces[r]![c] = kingChar; return;
      }
    }
    // No occupied square of that colour at all -- place on the standard king square.
    pieces[isWhite ? 7 : 0]![4] = kingChar;
  };
  ensureKing(true);
  ensureKing(false);
  // Build FEN ranks.
  const ranks: string[] = [];
  for (let r = 0; r < 8; r++) {
    let s = ""; let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = pieces[r]![c];
      if (!p) { empty++; continue; }
      if (empty > 0) { s += empty; empty = 0; }
      s += p;
    }
    if (empty > 0) s += empty;
    ranks.push(s);
  }
  return `${ranks.join("/")} w - - 0 1`;
}

/** Full pipeline: image (blob or data URL) → detected FEN + per-square
 *  confidence + inferred piece TYPES via template-matching against the
 *  bundled Lichess-default (cburnett) SVGs. */
export async function detectPositionFromImage(src: string | Blob): Promise<DetectResult & { autoDetected: boolean; autoScore: number | null }> {
  const img = await loadImage(src);
  const { canvas, auto, score } = detectAndCrop(img);
  const { grid, confidence } = classifyGrid(canvas);
  // Classify piece TYPES for every occupied square. Multiply the two
  // confidences (occupancy × type) so downstream UI can flag squares
  // that are wobbly in either dimension.
  const ctx = canvas.getContext("2d")!;
  const cell = canvas.width / 8;
  const types: (PieceType | null)[][] = [];
  for (let r = 0; r < 8; r++) {
    const row: (PieceType | null)[] = [];
    for (let c = 0; c < 8; c++) {
      const sq = grid[r]![c]!;
      if (sq === "empty") { row.push(null); continue; }
      const color = sq === "white" ? "w" : "b";
      try {
        const res = await classifyPiece(ctx, c * cell, r * cell, cell, cell, color);
        row.push(res.type);
        // Combine occupancy conf with type conf: min-of-two so a bad
        // classification pulls the overall square below the 0.6 alert bar.
        confidence[r]![c] = Math.min(confidence[r]![c]!, res.confidence);
      } catch {
        row.push(null);   // classifier failed → placeholder from gridToFen
      }
    }
    types.push(row);
  }
  const fen = gridToFen(grid, types);
  let whiteCount = 0, blackCount = 0;
  for (const row of grid) for (const sq of row) {
    if (sq === "white") whiteCount++;
    else if (sq === "black") blackCount++;
  }
  return {
    fen, grid, confidence, types,
    imageDataUrl: canvas.toDataURL("image/png"),
    meta: { whiteCount, blackCount },
    autoDetected: auto,
    autoScore: score,
  };
}
