// Piece-type classifier for the vision pipeline.
//
// Approach: template matching against the 12 Lichess-default (cburnett)
// piece SVGs, which ship with chessground as embedded data URIs inside the
// CSS. At init time we lazily extract each SVG, render it to a 40×40
// grayscale canvas, and cache the raw pixel array.
//
// At classify() time we receive a square patch from the vision pipeline
// (dark-on-light or light-on-dark), normalize it to 40×40 grayscale +
// background-subtracted silhouette, and compare against the 6 templates of
// the detected colour via mean-squared-error. Lowest error wins.
//
// Confidence = 1 - (winnerErr / secondBestErr), floored at 0.5. So a
// piece that clearly matches queen and doesn't look like anything else
// scores near 1.0; a fuzzy shape that could be either bishop or queen
// scores closer to 0.5.
//
// This works well for Lichess/Chess.com defaults + any 2D chess set with
// similar silhouettes. Fails on 3D piece sets or wildly stylized fonts;
// piece TYPE lands as a best-guess and coach fixes via the position
// editor. Fine for MVP.

export type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";
export type PieceColor = "w" | "b";

// Order matches the classifier output for downstream FEN construction.
const TYPES: PieceType[] = ["K", "Q", "R", "B", "N", "P"];
const TYPE_TO_CSS: Record<PieceType, string> = {
  K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn",
};

const TMPL_SIZE = 40;

interface TemplateBank {
  // 12 entries: keys like "K:w", "P:b". Each Uint8ClampedArray is 40*40
  // grayscale (0..255) after silhouette extraction.
  templates: Map<string, Uint8ClampedArray>;
}

let bankPromise: Promise<TemplateBank> | null = null;

/** Fetch the cburnett CSS from the chessground package, extract each piece's
 *  base64 SVG data URI, and rasterize to a 40×40 grayscale silhouette. */
async function loadTemplates(): Promise<TemplateBank> {
  const templates = new Map<string, Uint8ClampedArray>();
  // vite: chessground ships the CSS as a package export. We fetch it via a
  // module ?url import so vite bundles + fingerprints correctly.
  const cssHref = (await import("chessground/assets/chessground.cburnett.css?url")).default;
  const cssText = await fetch(cssHref).then((r) => r.text());
  // Match each rule: piece.<type>.<color> { background-image: url('data:...') }
  const re = /piece\.(pawn|knight|bishop|rook|queen|king)\.(white|black)\s*\{[^}]*url\('([^']+)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) {
    const cssToType: Record<string, PieceType> = { pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" };
    const type = cssToType[m[1]!]!;
    const color: PieceColor = m[2] === "white" ? "w" : "b";
    const dataUri = m[3]!;
    const patch = await rasterize(dataUri);
    templates.set(`${type}:${color}`, patch);
  }
  return { templates };
}

function getBank(): Promise<TemplateBank> {
  if (!bankPromise) bankPromise = loadTemplates();
  return bankPromise;
}

/** Render a data-URI SVG to a 40×40 grayscale silhouette (0 = background,
 *  255 = piece). The chessground SVGs have transparent backgrounds so we
 *  key on the alpha channel to build the silhouette. */
async function rasterize(dataUri: string): Promise<Uint8ClampedArray> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("piece svg failed to load"));
    img.src = dataUri;
  });
  const c = document.createElement("canvas");
  c.width = TMPL_SIZE; c.height = TMPL_SIZE;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, TMPL_SIZE, TMPL_SIZE);
  ctx.drawImage(img, 0, 0, TMPL_SIZE, TMPL_SIZE);
  const data = ctx.getImageData(0, 0, TMPL_SIZE, TMPL_SIZE).data;
  const out = new Uint8ClampedArray(TMPL_SIZE * TMPL_SIZE);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // Piece = any non-transparent pixel. Value = 255 - luminance-ish so
    // dark strokes count as "solid piece" too. We don't need exact grayscale
    // here since the classifier compares silhouettes, not colours.
    const a = data[i + 3]!;
    out[j] = a > 40 ? 255 : 0;
  }
  return out;
}

/** Extract a 40×40 grayscale silhouette from a live board patch. The vision
 *  pipeline gives us the square's pixels (already background-normalized);
 *  we crop to the piece bounding box for scale invariance. */
function extractSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: PieceColor): Uint8ClampedArray {
  const src = ctx.getImageData(x, y, w, h).data;
  // Estimate background luminance from the corners (usually pure square colour).
  const corners = [
    lum(src, 0, 0, w),
    lum(src, w - 1, 0, w),
    lum(src, 0, h - 1, w),
    lum(src, w - 1, h - 1, w),
  ].sort((a, b) => a - b);
  const bg = (corners[1]! + corners[2]!) / 2;   // median of the 4 corners
  // Build a binary mask: pixel is "piece" if it deviates from bg by > 30
  // AND the deviation direction matches the piece colour (white piece =
  // brighter than dark square; black piece = darker than light square).
  const mask = new Uint8ClampedArray(w * h);
  for (let py = 0, i = 0; py < h; py++) {
    for (let px = 0; px < w; px++, i++) {
      const off = (py * w + px) * 4;
      const l = 0.299 * src[off]! + 0.587 * src[off + 1]! + 0.114 * src[off + 2]!;
      const delta = l - bg;
      const isPiece = color === "w" ? delta > 30 : delta < -30;
      mask[i] = isPiece ? 255 : 0;
    }
  }
  // Find bounding box of the piece pixels; fall back to whole square if
  // detection failed (rare when the vision pipeline said "occupied" but the
  // silhouette extractor sees nothing).
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (mask[py * w + px]) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  // Resample the bbox → 40×40. Nearest-neighbour keeps the silhouette crisp.
  const out = new Uint8ClampedArray(TMPL_SIZE * TMPL_SIZE);
  for (let oy = 0; oy < TMPL_SIZE; oy++) {
    for (let ox = 0; ox < TMPL_SIZE; ox++) {
      const sx = Math.min(bw - 1, Math.floor((ox / TMPL_SIZE) * bw));
      const sy = Math.min(bh - 1, Math.floor((oy / TMPL_SIZE) * bh));
      out[oy * TMPL_SIZE + ox] = mask[(minY + sy) * w + (minX + sx)]!;
    }
  }
  return out;
}

function lum(data: Uint8ClampedArray, x: number, y: number, w: number): number {
  const off = (y * w + x) * 4;
  return 0.299 * data[off]! + 0.587 * data[off + 1]! + 0.114 * data[off + 2]!;
}

function meanSquaredError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return sum / a.length;
}

/** Classify a single piece patch against the 6 templates for the detected
 *  colour. Returns the best-matching PieceType + a 0..1 confidence.
 *  The bank is loaded lazily on the first call; subsequent calls are hot. */
export async function classifyPiece(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  color: PieceColor,
): Promise<{ type: PieceType; confidence: number }> {
  const bank = await getBank();
  const sig = extractSilhouette(ctx, x, y, w, h, color);
  const scored = TYPES.map((t) => {
    const tmpl = bank.templates.get(`${t}:${color}`);
    if (!tmpl) return { type: t, err: Infinity };
    return { type: t, err: meanSquaredError(sig, tmpl) };
  }).sort((a, b) => a.err - b.err);
  const winner = scored[0]!;
  const second = scored[1]!;
  const gap = Math.max(0, second.err - winner.err);
  // Confidence: 0.5 when winner ties second; approaches 1 as the winner
  // pulls away. Capped so a tiny gap still returns a usable score.
  const confidence = Math.min(1, 0.5 + gap / (second.err + 1));
  return { type: winner.type, confidence };
}

/** Preload the template bank -- call once from the vision panel mount if
 *  you want to hide the first-classify latency. Optional. */
export function preloadPieceTemplates(): Promise<void> {
  return getBank().then(() => undefined);
}
