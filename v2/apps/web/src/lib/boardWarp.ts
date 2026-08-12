// Robust chess-board detection + perspective warp via OpenCV.js.
//
// Handles phone photos, book pages, screenshots -- any image where a
// chess board is visually prominent. Finds the 4 corners of the largest
// quadrilateral in the image and warps it to a canonical 480x480 square.
// Result is then fed to the existing classifier pipeline.
//
// OpenCV.js is loaded lazily from CDN on first call (9MB one-time cost;
// browser caches it forever). We wrap the load in a Promise so multiple
// concurrent callers wait on a single load.
//
// If OpenCV fails to find a plausible board, returns null so the caller
// can fall back to the naive centre-crop / auto-detect path.

const OPENCV_URL = "https://docs.opencv.org/4.10.0/opencv.js";

declare global {
  interface Window {
    cv?: any;
  }
}

let cvLoadPromise: Promise<any> | null = null;

async function loadOpenCV(): Promise<any> {
  if (typeof window === "undefined") throw new Error("opencv only in browser");
  if (window.cv && window.cv.Mat) return window.cv;
  if (cvLoadPromise) return cvLoadPromise;
  cvLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = OPENCV_URL;
    script.async = true;
    script.onload = () => {
      // opencv.js exposes cv as a Promise-like or a global. Poll until Mat is available.
      let tries = 0;
      const check = () => {
        if (window.cv && window.cv.Mat) {
          resolve(window.cv);
        } else if (window.cv && typeof window.cv.then === "function") {
          window.cv.then(() => resolve(window.cv));
        } else if (tries++ < 50) {
          setTimeout(check, 100);
        } else {
          reject(new Error("opencv.js loaded but cv.Mat never appeared"));
        }
      };
      check();
    };
    script.onerror = () => reject(new Error("opencv.js CDN load failed"));
    document.head.appendChild(script);
  });
  return cvLoadPromise;
}

/** Preload OpenCV in the background (call once from the vision panel mount
 *  so first scan doesn't pay the 9MB download latency). */
export function preloadOpenCV(): void {
  loadOpenCV().catch(() => {/* silent -- fallback path still works */});
}

export interface BoardWarpResult {
  canvas: HTMLCanvasElement;        // 480x480 canonical warped board
  corners: Array<{ x: number; y: number }>;  // 4 corners in source-image coordinates
  method: "opencv" | "manual";
}

/** Warp with EXPLICIT corners (from the manual CornerAdjuster). Used when
 *  auto-detection got it wrong and the coach dragged handles to the true
 *  board corners. Corners can be in any order; we normalise via
 *  orderCorners internally. */
export async function warpWithCorners(
  source: HTMLImageElement | HTMLCanvasElement,
  corners: Array<{ x: number; y: number }>,
): Promise<BoardWarpResult | null> {
  if (corners.length !== 4) return null;
  let cv: any;
  try { cv = await loadOpenCV(); } catch { return null; }
  const sw = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height;
  const fullSrcCanvas = document.createElement("canvas");
  fullSrcCanvas.width = sw; fullSrcCanvas.height = sh;
  fullSrcCanvas.getContext("2d")!.drawImage(source, 0, 0);
  const fullSrc = cv.imread(fullSrcCanvas);
  const dst = new cv.Mat();
  const OUT = 480;
  const ordered = orderCorners(corners);
  const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2,
    [ordered[0]!.x, ordered[0]!.y, ordered[1]!.x, ordered[1]!.y,
     ordered[2]!.x, ordered[2]!.y, ordered[3]!.x, ordered[3]!.y]);
  const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2,
    [0, 0, OUT, 0, OUT, OUT, 0, OUT]);
  const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
  cv.warpPerspective(fullSrc, dst, M, new cv.Size(OUT, OUT), cv.INTER_CUBIC);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = OUT; outCanvas.height = OUT;
  cv.imshow(outCanvas, dst);
  srcPoints.delete(); dstPoints.delete(); M.delete(); dst.delete(); fullSrc.delete();
  return { canvas: outCanvas, corners: ordered, method: "manual" };
}

/** Order 4 corners as [top-left, top-right, bottom-right, bottom-left]
 *  regardless of their input order. Uses sum + diff of coordinates. */
function orderCorners(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  // Top-left has smallest x+y, bottom-right has largest x+y.
  // Top-right has smallest y-x, bottom-left has largest y-x.
  const sums = pts.map((p) => p.x + p.y);
  const diffs = pts.map((p) => p.y - p.x);
  const tl = pts[sums.indexOf(Math.min(...sums))]!;
  const br = pts[sums.indexOf(Math.max(...sums))]!;
  const tr = pts[diffs.indexOf(Math.min(...diffs))]!;
  const bl = pts[diffs.indexOf(Math.max(...diffs))]!;
  return [tl, tr, br, bl];
}

/** Score a candidate quadrilateral by how "chess-board-like" its interior
 *  is. Warp preview at 96×96, sample the 8×8 grid at cell centres, learn
 *  dark/light means from alternating positions, count how many samples
 *  land on the correct side of the midpoint. 64 = perfect chess board;
 *  ≤ 45 = probably a false positive (page block, text region, etc.).
 *  Uses this instead of raw contour area so page-sized false quadrilateral
 *  don't win over the real board when both are 4-sided contours. */
function checkerScore(cv: any, sourceMat: any, corners: Array<{ x: number; y: number }>): number {
  const OUT = 96;
  try {
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2,
      [corners[0]!.x, corners[0]!.y, corners[1]!.x, corners[1]!.y,
       corners[2]!.x, corners[2]!.y, corners[3]!.x, corners[3]!.y]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, OUT, 0, OUT, OUT, 0, OUT]);
    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const warped = new cv.Mat();
    cv.warpPerspective(sourceMat, warped, M, new cv.Size(OUT, OUT), cv.INTER_LINEAR);
    const gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    const cell = OUT / 8;
    const samples: number[] = new Array(64);
    let lightSum = 0, lightN = 0, darkSum = 0, darkN = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sx = Math.round(c * cell + cell / 2);
        const sy = Math.round(r * cell + cell / 2);
        const v = gray.ucharPtr(sy, sx)[0];
        samples[r * 8 + c] = v;
        if ((r + c) % 2 === 0) { lightSum += v; lightN++; }
        else { darkSum += v; darkN++; }
      }
    }
    const lightMean = lightSum / Math.max(1, lightN);
    const darkMean = darkSum / Math.max(1, darkN);
    srcPts.delete(); dstPts.delete(); M.delete(); warped.delete(); gray.delete();
    if (Math.abs(lightMean - darkMean) < 12) return 0;   // no chess-like contrast
    const mid = (lightMean + darkMean) / 2;
    let correct = 0;
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8), c = i % 8;
      const expectLight = (r + c) % 2 === 0;
      const isLight = samples[i]! >= mid;
      if (isLight === expectLight) correct++;
    }
    return correct;
  } catch {
    return 0;
  }
}

/** Find the chess board in the image and warp it to a canonical 480x480
 *  square. Selects among 4-corner candidates by CHECKER-PATTERN score
 *  (via checkerScore) so page-sized or text-block false positives don't
 *  win over the real board. Returns null when nothing scores well enough. */
export async function warpToCanonicalBoard(source: HTMLImageElement | HTMLCanvasElement): Promise<BoardWarpResult | null> {
  let cv: any;
  try {
    cv = await loadOpenCV();
  } catch {
    return null;
  }

  // Downscale to at most 800px on longest edge -- speeds up cv operations
  // dramatically and detection quality stays the same at chess-board scale.
  const sw = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height;
  const cap = 800;
  const scale = Math.min(1, cap / Math.max(sw, sh));
  const workW = Math.round(sw * scale);
  const workH = Math.round(sh * scale);

  const workCanvas = document.createElement("canvas");
  workCanvas.width = workW;
  workCanvas.height = workH;
  workCanvas.getContext("2d")!.drawImage(source, 0, 0, workW, workH);

  const src = cv.imread(workCanvas);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 30, 90);
    // Dilate to close small gaps in board frame edges.
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel);
    kernel.delete();

    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Collect ALL plausibly-sized 4-corner candidates then rank by
    // checker-pattern score (not by raw area). Text blocks / whole-page
    // rectangles score < 45; a real chess board scores 55+.
    const candidates: Array<{ corners: Array<{ x: number; y: number }>; area: number }> = [];
    const minArea = 0.03 * workW * workH;
    const maxArea = 0.95 * workW * workH;   // reject whole-image quads

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < minArea || area > maxArea) { cnt.delete(); continue; }
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4) {
        const pts: Array<{ x: number; y: number }> = [];
        for (let j = 0; j < 4; j++) {
          pts.push({ x: approx.data32S[j * 2]!, y: approx.data32S[j * 2 + 1]! });
        }
        // Reject strongly non-square candidates (aspect ratio outside 0.5-2.0
        // is not a chess board even under perspective distortion).
        const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
        const bw = Math.max(...xs) - Math.min(...xs);
        const bh = Math.max(...ys) - Math.min(...ys);
        const ar = bw / Math.max(1, bh);
        if (ar >= 0.5 && ar <= 2.0) {
          candidates.push({ corners: pts, area });
        }
      }
      approx.delete();
      cnt.delete();
    }

    // Also try approximating each contour more loosely (0.04 epsilon) so
    // slightly-noisy contours that don't reduce to exactly 4 sides get a
    // second chance -- important for phone photos with soft board edges.
    // (skipped for now -- kept simple; the 0.02 pass usually catches boards)

    if (candidates.length === 0) return null;

    let bestCorners: Array<{ x: number; y: number }> | null = null;
    let bestScore = 0;
    for (const cand of candidates) {
      const score = checkerScore(cv, src, orderCorners(cand.corners));
      if (score > bestScore) {
        bestScore = score;
        bestCorners = cand.corners;
      }
    }
    // Reject if even the best candidate doesn't look chess-board-like.
    if (!bestCorners || bestScore < 45) return null;

    // Bump corners back to source-image coordinates.
    const inv = 1 / scale;
    const cornersInSource = bestCorners.map((p) => ({ x: p.x * inv, y: p.y * inv }));
    const ordered = orderCorners(cornersInSource);

    // Warp using OpenCV on the FULL-res source (better quality classification).
    const fullSrcCanvas = document.createElement("canvas");
    fullSrcCanvas.width = sw;
    fullSrcCanvas.height = sh;
    fullSrcCanvas.getContext("2d")!.drawImage(source, 0, 0);
    const fullSrc = cv.imread(fullSrcCanvas);
    const dst = new cv.Mat();
    const OUT = 480;
    const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2,
      [ordered[0]!.x, ordered[0]!.y, ordered[1]!.x, ordered[1]!.y,
       ordered[2]!.x, ordered[2]!.y, ordered[3]!.x, ordered[3]!.y]);
    const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2,
      [0, 0, OUT, 0, OUT, OUT, 0, OUT]);
    const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
    cv.warpPerspective(fullSrc, dst, M, new cv.Size(OUT, OUT), cv.INTER_CUBIC);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = OUT;
    outCanvas.height = OUT;
    cv.imshow(outCanvas, dst);

    srcPoints.delete(); dstPoints.delete(); M.delete(); dst.delete(); fullSrc.delete();

    return { canvas: outCanvas, corners: ordered, method: "opencv" };
  } finally {
    src.delete(); gray.delete(); blur.delete(); edges.delete();
    contours.delete(); hierarchy.delete();
  }
}
