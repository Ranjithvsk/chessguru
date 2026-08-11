// Trained chess-piece classifier (v3.5) -- direct 13-class softmax over
// each square, replacing the v3 nearest-neighbour-against-reference-bank
// approach. Model was fine-tuned on Vinayaka RTX 3080 (DINOv2-base frozen
// backbone + trained 256->13 MLP head) then exported to ONNX opset 17 with
// a dynamic batch dim; runs CPU-inference here on France via onnxruntime-node.
//
// Classes (order matches classes.json emitted by export-onnx.py):
//   Bb, Bw, Kb, Kw, Nb, Nw, Pb, Pw, Qb, Qw, Rb, Rw, empty
//
// Input: 224x224 RGB tensor NHWC, ImageNet-normalised. We do the resize
// (256 shortest edge) + centre-crop 224 in sharp before passing to ORT.

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const CHESS_CLASSIFIER_VERSION = 'v3.6-dinov2-linear-with-book-pixels';
const RESIZE = 256;
const CROP = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function resolvePaths(): { model: string; classes: string } {
  const modelCandidates = [
    process.env.CHESS_CLASSIFIER_PATH,
    path.resolve(__dirname, '../../models/chess-classifier.onnx'),
    path.resolve(__dirname, '../models/chess-classifier.onnx'),
    path.resolve(process.cwd(), 'models/chess-classifier.onnx'),
  ].filter(Boolean) as string[];
  const model = modelCandidates.find((p) => existsSync(p)) || modelCandidates[1]!;
  const classes = model.replace(/\.onnx$/, '.classes.json');
  return { model, classes };
}
const PATHS = resolvePaths();

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let inputName = 'pixel_values';
let outputName = 'logits';
let classNames: string[] = [];

async function getSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    if (!existsSync(PATHS.model)) {
      throw new Error(`Chess classifier model not found at ${PATHS.model}. Run scripts to export from Vinayaka.`);
    }
    const session = await ort.InferenceSession.create(PATHS.model);
    inputName = session.inputNames[0] || 'pixel_values';
    outputName = session.outputNames[0] || 'logits';
    classNames = JSON.parse(readFileSync(PATHS.classes, 'utf8')).classes;
    // eslint-disable-next-line no-console
    console.log(`[chessClassifier] loaded ${path.basename(PATHS.model)}, input=${inputName}, output=${outputName}, ${classNames.length} classes`);
    return session;
  })();
  return sessionPromise;
}

/** Softmax over logits row. */
function softmax(row: Float32Array | number[]): number[] {
  const max = Math.max(...row);
  const exp = Array.from(row, (v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}

/** Preprocess one square PNG buffer (any size) → CHW Float32Array of length 3*224*224. */
async function preprocessSquare(buf: Buffer): Promise<Float32Array> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('unreadable square image');
  const scale = RESIZE / Math.min(meta.width, meta.height);
  const rw = Math.round(meta.width * scale);
  const rh = Math.round(meta.height * scale);
  const left = Math.max(0, Math.floor((rw - CROP) / 2));
  const top = Math.max(0, Math.floor((rh - CROP) / 2));
  const pixels = await sharp(buf)
    .removeAlpha()
    .resize(rw, rh, { kernel: 'cubic' })
    .extract({ left, top, width: CROP, height: CROP })
    .raw()
    .toBuffer();
  const plane = CROP * CROP;
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) chw[c * plane + p] = (pixels[p * 3 + c]! / 255 - MEAN[c]!) / STD[c]!;
  }
  return chw;
}

export interface ClassifierResult {
  className: string;                // one of the 13 classes
  confidence: number;               // top-1 softmax prob
  topK: Array<{ className: string; prob: number }>;
}

/** Fast path: caller pre-decodes the full board via a SINGLE sharp() call
 *  (see classifyBoardV2 in vision.service.ts) and passes 64 pre-normalized
 *  224x224 CHW Float32Arrays here.
 *
 *  DINOv2-base at batch=64 on CPU is MEMORY-BANDWIDTH-BOUND (~20s per call
 *  vs 2.5s for 64 sequential batch-1 calls), so we split into micro-batches
 *  and run them sequentially. Micro-batch of 8 keeps activation memory
 *  cache-friendly and beats both extremes (measured on France CPU). */
export async function classifyBatchFromCHW(cargo: Float32Array[]): Promise<ClassifierResult[]> {
  if (cargo.length === 0) return [];
  const session = await getSession();
  const plane = CROP * CROP;
  const numClasses = classNames.length;
  const results: ClassifierResult[] = [];
  // Empirically batch=1 is ~40ms per DINOv2-base forward on France CPU;
  // batch=8 is ~3s; batch=64 is ~20s. Memory-bandwidth bound. Sequential
  // batch-1 wins by a wide margin.
  const MICRO = 1;
  for (let start = 0; start < cargo.length; start += MICRO) {
    const end = Math.min(start + MICRO, cargo.length);
    const bs = end - start;
    const batchCHW = new Float32Array(bs * 3 * plane);
    for (let i = 0; i < bs; i++) batchCHW.set(cargo[start + i]!, i * 3 * plane);
    const input = new ort.Tensor('float32', batchCHW, [bs, 3, CROP, CROP]);
    const out = await session.run({ [inputName]: input });
    const logits = out[outputName]!.data as Float32Array;
    for (let i = 0; i < bs; i++) {
      const row = logits.subarray(i * numClasses, (i + 1) * numClasses);
      const probs = softmax(row);
      const ranked = probs
        .map((p, idx) => ({ className: classNames[idx]!, prob: p }))
        .sort((a, b) => b.prob - a.prob);
      results.push({
        className: ranked[0]!.className,
        confidence: ranked[0]!.prob,
        topK: ranked.slice(0, 3),
      });
    }
  }
  return results;
}

/** Legacy path: each item = raw PNG buffer of one 60x60 chess square. Kept
 *  for callers that don't have a pre-decoded pixel buffer. Slower because
 *  of 64 sharp subprocess calls. */
export async function classifyBatch(squares: Buffer[]): Promise<ClassifierResult[]> {
  if (squares.length === 0) return [];
  const session = await getSession();
  const plane = CROP * CROP;
  const batchCHW = new Float32Array(squares.length * 3 * plane);
  for (let i = 0; i < squares.length; i++) {
    const chw = await preprocessSquare(squares[i]!);
    batchCHW.set(chw, i * 3 * plane);
  }
  const input = new ort.Tensor('float32', batchCHW, [squares.length, 3, CROP, CROP]);
  const out = await session.run({ [inputName]: input });
  const logitsTensor = out[outputName];
  const logits = logitsTensor!.data as Float32Array;
  const numClasses = classNames.length;
  const results: ClassifierResult[] = [];
  for (let i = 0; i < squares.length; i++) {
    const row = logits.subarray(i * numClasses, (i + 1) * numClasses);
    const probs = softmax(row);
    const ranked = probs
      .map((p, idx) => ({ className: classNames[idx]!, prob: p }))
      .sort((a, b) => b.prob - a.prob);
    results.push({
      className: ranked[0]!.className,
      confidence: ranked[0]!.prob,
      topK: ranked.slice(0, 3),
    });
  }
  return results;
}
