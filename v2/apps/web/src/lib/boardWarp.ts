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
  method: "opencv";
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

/** Find the largest 4-corner quadrilateral in the image (the chess board)
 *  and warp it to a canonical 480x480 square. Returns null when detection
 *  fails so callers can use a naive-crop fallback. */
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

    let bestCorners: Array<{ x: number; y: number }> | null = null;
    let bestArea = 0;
    const minArea = 0.08 * workW * workH;   // ignore tiny contours

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < minArea) { cnt.delete(); continue; }
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4 && area > bestArea) {
        const pts: Array<{ x: number; y: number }> = [];
        for (let j = 0; j < 4; j++) {
          pts.push({ x: approx.data32S[j * 2]!, y: approx.data32S[j * 2 + 1]! });
        }
        bestArea = area;
        bestCorners = pts;
      }
      approx.delete();
      cnt.delete();
    }

    if (!bestCorners) return null;

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
