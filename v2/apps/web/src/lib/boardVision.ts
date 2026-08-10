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

export type SquareState = "empty" | "white" | "black";
export type DetectResult = {
  fen: string;
  grid: SquareState[][];    // 8x8, index 0 = top rank (rank 8), index 0 col = a
  confidence: number[][];   // 8x8, 0..1 — lower means "please verify this square"
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
 *  trim symmetrically to the largest square that fits. */
function cropToSquare(img: HTMLImageElement): HTMLCanvasElement {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const dx = Math.floor((img.naturalWidth - side) / 2);
  const dy = Math.floor((img.naturalHeight - side) / 2);
  // Target 480px so each square is 60x60 -- plenty for the naive sampling.
  const canvas = document.createElement("canvas");
  canvas.width = 480; canvas.height = 480;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, dx, dy, side, side, 0, 0, 480, 480);
  return canvas;
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
export function gridToFen(grid: SquareState[][]): string {
  // Start with placeholder pieces per square.
  const pieces: (string | "")[][] = grid.map((row, r) =>
    row.map((sq) => {
      if (sq === "empty") return "";
      const white = sq === "white";
      // Ranks are flipped in the grid (index 0 = rank 8 = top).
      const rank = 8 - r;
      const pawnAllowed = rank !== 1 && rank !== 8;
      const p = white ? (pawnAllowed ? "P" : "N") : (pawnAllowed ? "p" : "n");
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

/** Full pipeline: image (blob or data URL) → detected FEN + per-square confidence. */
export async function detectPositionFromImage(src: string | Blob): Promise<DetectResult> {
  const img = await loadImage(src);
  const canvas = cropToSquare(img);
  const { grid, confidence } = classifyGrid(canvas);
  const fen = gridToFen(grid);
  let whiteCount = 0, blackCount = 0;
  for (const row of grid) for (const sq of row) {
    if (sq === "white") whiteCount++;
    else if (sq === "black") blackCount++;
  }
  return {
    fen, grid, confidence,
    imageDataUrl: canvas.toDataURL("image/png"),
    meta: { whiteCount, blackCount },
  };
}
