// Lazy loader for face-api.js. Loads from CDN on first use so the base bundle
// stays small; only pages that use face features pay the ~7MB model cost.
// Cached in module-scope so repeated imports are instant.
//
// Models loaded (progressively — recognition first, expressions on demand):
//   tinyFaceDetector    — fast face detection (~1.5MB)
//   faceLandmark68Net   — 68 landmarks for alignment + blink EAR (~350KB)
//   faceRecognitionNet  — 128-dim descriptor extraction (~6.2MB)
//   faceExpressionNet   — 7-emotion probabilities for smile-liveness (~310KB)
//
// Owner ask 2026-08-23. Consent + enrollment flows live in the pages that
// import this module.
//
// If network is flaky, callers show a clear "couldn't load face models —
// retry" state.

const CDN_BASE = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights";
const SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";

let loading: Promise<any> | null = null;
let loaded: any | null = null;
let expressionsLoaded = false;

/** Load face-api.js from CDN + the 3 required base models. Cached. */
export function loadFaceApi(): Promise<any> {
  if (loaded) return Promise.resolve(loaded);
  if (loading) return loading;
  loading = (async () => {
    if (!(window as any).faceapi) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = SCRIPT_SRC;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load face-api.js from CDN. Check your internet connection."));
        document.head.appendChild(s);
      });
    }
    const faceapi = (window as any).faceapi;
    if (!faceapi) throw new Error("face-api.js didn't attach to window.");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(CDN_BASE),
      faceapi.nets.faceLandmark68Net.loadFromUri(CDN_BASE),
      faceapi.nets.faceRecognitionNet.loadFromUri(CDN_BASE),
    ]);
    loaded = faceapi;
    return faceapi;
  })();
  return loading;
}

/** Load expression net on demand — used only by the liveness challenge. */
export async function loadExpressionNet(): Promise<any> {
  const faceapi = await loadFaceApi();
  if (!expressionsLoaded) {
    await faceapi.nets.faceExpressionNet.loadFromUri(CDN_BASE);
    expressionsLoaded = true;
  }
  return faceapi;
}

/** Compute a 128-dim face descriptor from an HTMLImageElement or HTMLVideoElement. */
export async function detectFaceDescriptor(input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Promise<Float32Array | null> {
  const faceapi = await loadFaceApi();
  const detection = await faceapi.detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection?.descriptor || null;
}

/** Detect ALL faces + descriptors — coach's check-in multi-face batch. */
export async function detectAllFaces(input: HTMLVideoElement | HTMLImageElement): Promise<Array<{ descriptor: Float32Array; box: { x: number; y: number; width: number; height: number } }>> {
  const faceapi = await loadFaceApi();
  const detections = await faceapi.detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return detections.map((d: any) => ({
    descriptor: d.descriptor,
    box: { x: d.detection.box.x, y: d.detection.box.y, width: d.detection.box.width, height: d.detection.box.height },
  }));
}

/** Detect face + landmarks + descriptor + expressions — used by liveness UI.
 *  Also returns Eye Aspect Ratio (EAR) so caller can track blinks over time. */
export async function detectFaceRich(input: HTMLVideoElement): Promise<{
  descriptor: Float32Array;
  ear: number;                              // eye aspect ratio (lower = eyes closed)
  smile: number;                            // 0..1 probability
  yaw: number;                              // -1 (left) .. 1 (right), rough estimate
  box: { x: number; y: number; width: number; height: number };
} | null> {
  const faceapi = await loadExpressionNet();
  const det = await faceapi.detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor()
    .withFaceExpressions();
  if (!det) return null;
  const landmarks = det.landmarks;
  const positions = landmarks.positions as Array<{ x: number; y: number }>;
  // Eye Aspect Ratio — average of both eyes' vertical/horizontal distance.
  // Landmarks 36-41 = right eye, 42-47 = left eye.
  const earFor = (start: number) => {
    const p = (i: number) => positions[start + i]!;
    const v1 = Math.hypot(p(1).x - p(5).x, p(1).y - p(5).y);
    const v2 = Math.hypot(p(2).x - p(4).x, p(2).y - p(4).y);
    const h  = Math.hypot(p(0).x - p(3).x, p(0).y - p(3).y);
    return h > 0 ? (v1 + v2) / (2 * h) : 1;
  };
  const ear = (earFor(36) + earFor(42)) / 2;
  const smile = det.expressions?.happy ?? 0;
  // Yaw estimate — center of face vs nose tip lateral offset. Rough but
  // sufficient to distinguish "look left" vs "look right".
  const box = det.detection.box;
  const noseTip = positions[30]!;
  const centerX = box.x + box.width / 2;
  const yaw = box.width > 0 ? (noseTip.x - centerX) / (box.width / 2) : 0;
  return {
    descriptor: det.descriptor,
    ear, smile, yaw,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}

/** Average multiple descriptors into one (element-wise mean). Used only in
 *  the single-descriptor legacy path — new enrollment stores all descriptors
 *  separately so the server can take min-distance across them. */
export function averageDescriptors(descriptors: Float32Array[]): number[] {
  if (!descriptors.length) return [];
  const out = new Array(128).fill(0);
  for (const d of descriptors) for (let i = 0; i < 128; i++) out[i] += d[i]!;
  for (let i = 0; i < 128; i++) out[i] /= descriptors.length;
  return out;
}
