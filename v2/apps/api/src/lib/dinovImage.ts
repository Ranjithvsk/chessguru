// Visual product search — DINOv2 (ViT-B/14) image embedder (server-side, CPU).
//
// Second embedder alongside clipImage.ts. DINOv2 is self-supervised and excels at
// *instance* / fine-grained "is this the same object" retrieval — complementary to CLIP's
// semantic space. Same self-consistency rule: the query photo AND every stored reference
// go through THIS exact pipeline, so the DINOv2 vector space is internally consistent.
//
// Model: onnx/model.onnx from onnx-community/dinov2-base-ONNX (fp32). Outputs
//   last_hidden_state [1,257,768] (+ pooler_output [1,768] when present). We take the CLS
//   token (768-d), L2-normed. https://huggingface.co/onnx-community/dinov2-base-ONNX
//
// Preprocessing (DINOv2 image processor): resize shortest edge to 256 (bicubic),
// centre-crop 224², scale [0,1], ImageNet per-channel normalise, RGB, CHW.

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { existsSync, statSync } from 'fs';
import path from 'path';

export const DINOV2_MODEL_VERSION = 'dinov2-base-v1';
export const DINOV2_EMBEDDING_DIM = 768;
const RESIZE = 256;
const CROP = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function resolveModelPath(): string {
  const candidates = [
    process.env.DINOV2_MODEL_PATH,
    path.resolve(__dirname, '../../models/dinov2-base-vision.onnx'),
    path.resolve(__dirname, '../models/dinov2-base-vision.onnx'),
    path.resolve(process.cwd(), 'models/dinov2-base-vision.onnx'),
    '/home/dreamworld/apps/backend/models/dinov2-base-vision.onnx',
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) || candidates[1]!;
}
const MODEL_PATH = resolveModelPath();

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let inputName = 'pixel_values';

async function getSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    if (!existsSync(MODEL_PATH)) {
      throw new Error(`DINOv2 model not found at ${MODEL_PATH}. Download onnx/model.onnx from onnx-community/dinov2-base-ONNX.`);
    }
    const sz = statSync(MODEL_PATH).size;
    const session = await ort.InferenceSession.create(MODEL_PATH);
    inputName = session.inputNames[0] || 'pixel_values';
    // eslint-disable-next-line no-console
    console.log(`[dinovImage] loaded ${path.basename(MODEL_PATH)} (${(sz / 1e6).toFixed(0)}MB), input=${inputName}, outputs=${session.outputNames.join(',')}`);
    return session;
  })();
  return sessionPromise;
}

function l2norm(a: Float32Array | number[]): number[] {
  let s = 0;
  for (const v of a) s += v * v;
  s = Math.sqrt(s) || 1;
  return Array.from(a, (v) => v / s);
}

export async function embedImageDinov2(buf: Buffer): Promise<number[]> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('Unreadable image');
  const scale = RESIZE / Math.min(meta.width, meta.height);
  const rw = Math.round(meta.width * scale);
  const rh = Math.round(meta.height * scale);
  const left = Math.floor((rw - CROP) / 2);
  const top = Math.floor((rh - CROP) / 2);
  const pixels = await sharp(buf)
    .rotate()
    .resize(rw, rh, { kernel: 'cubic' })
    .extract({ left, top, width: CROP, height: CROP })
    .removeAlpha()
    .raw()
    .toBuffer();

  const plane = CROP * CROP;
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) chw[c * plane + p] = (pixels[p * 3 + c]! / 255 - MEAN[c]!) / STD[c]!;
  }

  const session = await getSession();
  const out = await session.run({ [inputName]: new ort.Tensor('float32', chw, [1, 3, CROP, CROP]) });

  // Prefer pooler_output [1,768]; else CLS token = last_hidden_state[0,0,:].
  let vec: Float32Array;
  const pooler = out['pooler_output'];
  if (pooler && pooler.dims[pooler.dims.length - 1] === DINOV2_EMBEDDING_DIM && pooler.dims.length === 2) {
    vec = pooler.data as Float32Array;
  } else {
    const lhs = out['last_hidden_state'] ?? out[session.outputNames[0]!];
    const data = lhs!.data as Float32Array;
    // dims [1, tokens, 768] → CLS is the first token
    vec = data.subarray(0, DINOV2_EMBEDDING_DIM);
  }
  if (vec.length !== DINOV2_EMBEDDING_DIM) throw new Error(`Unexpected DINOv2 dim ${vec.length}`);
  return l2norm(vec);
}

export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
