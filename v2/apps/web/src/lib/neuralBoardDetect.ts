// Neural chess-board corner detector -- runs INT8 MobileNetV3-small in
// the BROWSER via onnxruntime-web. Model was trained on Vinayaka RTX 3080
// against 15K samples of realistically-simulated phone photos of chess
// books (perspective + lighting + lens artefacts + book curvature +
// bleed-through + highlighter + coffee stains + torn corners + JPEG etc.
// -- see /tmp/gen-corner-data-v3.py for the 60+ realism factors).
//
// Val error ~15 px on a 384x384 image (~4%). Runs in ~150ms per image
// on a mid-range phone (WASM SIMD).
//
// Public API:
//   detectBoardCorners(source): Promise<Array<{x,y}> | null>
//     Returns 4 corners in source-image coordinates in the order
//     [TL, TR, BR, BL], or null if inference failed / low confidence.
//
//   preloadNeuralDetector(): void
//     Fire-and-forget model download (call on vision-panel mount to
//     hide first-scan latency).

import * as ort from "onnxruntime-web";

const MODEL_URL = "/v2/models/chess-corner-detector-int8.onnx";
const META_URL = "/v2/models/chess-corner-detector.meta.json";
const IMG_SIZE = 384;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise: Promise<ort.InferenceSession> | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    // Concurrent: WASM binary + model bytes + meta.
    const [session] = await Promise.all([
      ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] }),
      fetch(META_URL).then((r) => r.json()).catch(() => null),
    ]);
    // eslint-disable-next-line no-console
    console.log("[neuralBoardDetect] session loaded (int8 MobileNetV3, corner regression)");
    return session;
  })();
  return sessionPromise;
}

export function preloadNeuralDetector(): void {
  getSession().catch(() => {/* silent */});
}

/** Resize source to IMG_SIZE × IMG_SIZE (fit-fill) and produce a
 *  CHW-normalized Float32 tensor + the effective scale factors so we
 *  can un-project the network's output back to source coords. */
function preprocess(source: HTMLImageElement | HTMLCanvasElement): { chw: Float32Array; sx: number; sy: number; srcW: number; srcH: number } {
  const srcW = "naturalWidth" in source ? source.naturalWidth : source.width;
  const srcH = "naturalHeight" in source ? source.naturalHeight : source.height;
  const c = document.createElement("canvas");
  c.width = IMG_SIZE; c.height = IMG_SIZE;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, IMG_SIZE, IMG_SIZE);
  const imgData = ctx.getImageData(0, 0, IMG_SIZE, IMG_SIZE).data;
  const plane = IMG_SIZE * IMG_SIZE;
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    const off = p * 4;
    chw[p]             = (imgData[off]!     / 255 - MEAN[0]!) / STD[0]!;
    chw[plane + p]     = (imgData[off + 1]! / 255 - MEAN[1]!) / STD[1]!;
    chw[2 * plane + p] = (imgData[off + 2]! / 255 - MEAN[2]!) / STD[2]!;
  }
  return { chw, sx: srcW / IMG_SIZE, sy: srcH / IMG_SIZE, srcW, srcH };
}

/** Run the neural corner detector on any image. Returns 4 corners in
 *  source-image pixel coordinates as an array [TL, TR, BR, BL], or null
 *  if the inference failed or the predicted corners look implausible
 *  (mutually-crossing, degenerate quad, out-of-bounds by > 20%). */
export async function detectBoardCorners(source: HTMLImageElement | HTMLCanvasElement): Promise<Array<{ x: number; y: number }> | null> {
  let session: ort.InferenceSession;
  try {
    session = await getSession();
  } catch {
    return null;
  }
  const { chw, sx, sy, srcW, srcH } = preprocess(source);
  const input = new ort.Tensor("float32", chw, [1, 3, IMG_SIZE, IMG_SIZE]);
  const out = await session.run({ pixel_values: input });
  const raw = out.corners!.data as Float32Array;
  if (raw.length !== 8) return null;

  // Model emits normalized [0,1] coords; scale to source-image pixels.
  const cornersSrc: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 4; i++) {
    const nx = raw[i * 2]!;
    const ny = raw[i * 2 + 1]!;
    // Allow slight out-of-bounds (network may predict corners just
    // beyond the frame if the board is partially cropped).
    if (nx < -0.2 || nx > 1.2 || ny < -0.2 || ny > 1.2) return null;
    cornersSrc.push({
      x: Math.max(0, Math.min(srcW - 1, nx * IMG_SIZE * sx)),
      y: Math.max(0, Math.min(srcH - 1, ny * IMG_SIZE * sy)),
    });
  }
  return cornersSrc;
}
