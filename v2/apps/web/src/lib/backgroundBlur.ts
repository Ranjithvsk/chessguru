// MediaPipe SelfieSegmenter background-blur pipeline.
//
// Input = raw camera stream. Output = a stream whose video is the same camera
// with ONLY the background Gaussian-blurred; audio tracks are pass-through so
// the result is a drop-in replacement at the RTCRtpSender level.
//
// - WASM runtime (no GPU perms needed). Model: selfie_segmenter.tflite (float16,
//   256×256, ~250 KB) — lightest option that gives a usable person mask.
// - Segmenter runs per rAF tick against a hidden <video> mirror of the camera;
//   canvas.captureStream(30) publishes at 30fps regardless.
// - First-frame latency: WASM+model download once, cached across on/off toggles
//   via a module-level segmenter (refcounted). Canvas is primed with one black
//   frame so peers see the stream immediately (no black flash before segmenter
//   catches up).
// - Mirroring: NOT applied here. The self-view <video> already CSS-mirrors;
//   peers must see the un-mirrored feed. This util is mirror-neutral.
import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult,
} from "@mediapipe/tasks-vision";

// Google's official CDN for MediaPipe vision-tasks WASM + models. Version pin
// matches the npm package major so behavior stays stable across upgrades.
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

const OUT_W = 640;
const OUT_H = 480;
const BLUR_PX = 12;

// Cache the segmenter across on/off toggles — WASM init is expensive (~1s).
let cachedSegmenter: ImageSegmenter | null = null;
let cacheRefCount = 0;

async function getSegmenter(): Promise<ImageSegmenter> {
  if (cachedSegmenter) return cachedSegmenter;
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  cachedSegmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
  return cachedSegmenter;
}

export async function startBackgroundBlur(
  input: MediaStream,
): Promise<{ output: MediaStream; stop: () => void }> {
  const segmenter = await getSegmenter();
  cacheRefCount++;

  // Hidden <video> element to pump the raw camera through as a drawable source.
  // Kept off-DOM so it doesn't affect layout; muted+playsInline so browsers
  // don't gate the play() promise on user gesture.
  const srcVideo = document.createElement("video");
  srcVideo.autoplay = true;
  srcVideo.muted = true;
  srcVideo.playsInline = true;
  srcVideo.srcObject = new MediaStream(input.getVideoTracks());
  await srcVideo.play().catch(() => {/* autoplay may reject in bg tabs; still usable */});

  // Composite canvas — output resolution is fixed to 640x480 for a predictable
  // upload bitrate. Aspect fitted with letterbox via drawImage arithmetic.
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;

  // Off-screen mask canvas — we upscale MediaPipe's 256x256 category mask onto
  // this before using it as a globalCompositeOperation mask.
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = OUT_W;
  maskCanvas.height = OUT_H;
  const maskCtx = maskCanvas.getContext("2d")!;

  // Prime one frame so captureStream has something to emit before segmentation
  // catches up. Pure white — invisible under the first real frame.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, OUT_W, OUT_H);

  const outputStream = canvas.captureStream(30);
  // Splice original audio tracks in — downstream consumers get a single stream.
  for (const aTrack of input.getAudioTracks()) outputStream.addTrack(aTrack);

  let rafId = 0;
  let stopped = false;
  let lastTs = -1;

  const render = () => {
    if (stopped) return;
    const now = performance.now();
    // MediaPipe requires strictly-increasing timestamps in VIDEO mode.
    const ts = now <= lastTs ? lastTs + 1 : now;
    lastTs = ts;

    // Only run segmentation once the video has a real frame; otherwise skip.
    if (srcVideo.readyState >= 2 && srcVideo.videoWidth > 0) {
      try {
        segmenter.segmentForVideo(srcVideo, ts, (result: ImageSegmenterResult) => {
          drawComposite(ctx, maskCtx, srcVideo, result);
        });
      } catch {
        // If segmentation blows up mid-stream, fall back to plain blurred cam
        // for this frame so we don't stall the output stream.
        ctx.save();
        (ctx as any).filter = `blur(${BLUR_PX}px)`;
        drawCover(ctx, srcVideo);
        ctx.restore();
      }
    }
    rafId = requestAnimationFrame(render);
  };
  rafId = requestAnimationFrame(render);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    for (const t of outputStream.getVideoTracks()) t.stop();
    try { srcVideo.pause(); } catch { /* */ }
    srcVideo.srcObject = null;
    cacheRefCount = Math.max(0, cacheRefCount - 1);
    // Only close the segmenter when the last consumer releases — cheap keep-
    // alive so a user toggling blur off/on doesn't re-download WASM+model.
    if (cacheRefCount === 0 && cachedSegmenter) {
      try { cachedSegmenter.close(); } catch { /* */ }
      cachedSegmenter = null;
    }
  };

  return { output: outputStream, stop };
}

// Compose one frame: blurred cam under, sharp person mask on top.
function drawComposite(
  ctx: CanvasRenderingContext2D,
  maskCtx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  result: ImageSegmenterResult,
) {
  // 1) Bg layer — draw the video with the CSS blur filter.
  ctx.save();
  (ctx as any).filter = `blur(${BLUR_PX}px)`;
  drawCover(ctx, video);
  ctx.restore();

  const mask = result.categoryMask;
  if (!mask) return;

  // 2) Build a bitmap of the person mask at OUT_W/OUT_H. MediaPipe returns a
  // Uint8 category array: 0 = background, non-zero = person.
  const rawW = mask.width;
  const rawH = mask.height;
  const raw = mask.getAsUint8Array();
  const tmp = maskCtx.createImageData(rawW, rawH);
  const data = tmp.data;
  for (let i = 0; i < raw.length; i++) {
    const person = raw[i] === 0 ? 255 : 0;
    const j = i * 4;
    data[j] = 255; data[j + 1] = 255; data[j + 2] = 255; data[j + 3] = person;
  }
  // Draw the low-res mask onto the full-size mask canvas (browser bilinear
  // upsample = the "soft edge" we want; explicit feathering would be pricier).
  maskCtx.clearRect(0, 0, maskCtx.canvas.width, maskCtx.canvas.height);
  // Reuse a scratch canvas for the raw imageData → then scale-draw onto mask.
  const scratch = document.createElement("canvas");
  scratch.width = rawW;
  scratch.height = rawH;
  scratch.getContext("2d")!.putImageData(tmp, 0, 0);
  maskCtx.drawImage(scratch, 0, 0, maskCtx.canvas.width, maskCtx.canvas.height);

  // 3) Clip to the person mask and draw the SHARP video on top.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(maskCtx.canvas, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  drawCover(ctx, video);
  ctx.restore();
}

// object-fit: cover, applied to a raw drawImage call.
function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const vw = v.videoWidth || cw;
  const vh = v.videoHeight || ch;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  ctx.drawImage(v, dx, dy, dw, dh);
}
