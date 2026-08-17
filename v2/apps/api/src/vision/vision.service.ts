// Board-vision reference bank + coach-correction pipeline.
//
// The client-side board detector (apps/web/src/lib/pieceClassifier.ts)
// classifies pieces on an uploaded chess screenshot by template-matching
// against the 12 bundled Lichess "cburnett" silhouettes. That covers
// lichess.org screenshots but nothing else -- Chess.com "neo", Wikipedia
// diagrams, and textbook fonts fail out.
//
// This service is the "gets better over time" layer. Two flows:
//
//   1. Seed / admin adds reference piece crops (v2 will bulk-load ~10
//      popular sets here).
//   2. When a coach fixes a mis-classified square in the position
//      editor, the client sends the ORIGINAL 60x60 square crop along
//      with the correct piece letter and colour. We normalise it to
//      a 40x40 grayscale silhouette and store it as a new reference.
//
// The client fetches the whole bank at boot and merges it into the
// nearest-neighbour template pool. So every correction becomes a
// permanent detection improvement for every future coach.
//
// Storage schema (`visionRefs` collection):
//   { piece: "P"|"N"|"B"|"R"|"Q"|"K",
//     color: "w"|"b",
//     setName: string,       -- e.g. "cburnett" | "coach-correction"
//     source: "seed"|"correction",
//     silhouettePng: string, -- base64 40x40 grayscale PNG
//     createdBy: userId | null,
//     createdAt: Date,
//     approved: boolean       -- false for coach-corrections until admin OK
//   }
//
// Silhouette shape is fixed (40x40 grayscale, black background, white
// piece pixels) to match the client's classifier. Client and server
// agree via the SILHOUETTE_SIZE constant duplicated in
// pieceClassifier.ts -- keep the two in sync.
//
// v1 default: coach-corrections are IMMEDIATELY approved (`approved: true`)
// so the improvement loop closes without admin friction. If we ever see
// abuse we flip the default to false and add an admin approval UI.

import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import sharp from "sharp";
import { existsSync, writeFile, mkdir } from "fs";
import path from "path";
import { embedImageDinov2, DINOV2_EMBEDDING_DIM } from "../lib/dinovImage";
import { classifyBatch as chessClassifyBatch, classifyBatchFromCHW as chessClassifyBatchFromCHW, CHESS_CLASSIFIER_VERSION } from "../lib/chessClassifier";
import { classifyBatchV4, classifyBatchV4FromCHW, tilesFromBoardPixels, repairForLegalFen, CHESS_CLASSIFIER_V4_VERSION } from "../lib/chessClassifierV4";

/** Persist every classify-board request's input PNG to disk under a
 *  timestamped name. Failing scans can then be re-fetched + debugged
 *  offline. Fails silently -- must never break the classify response
 *  path. Log dir provisioned by ops (chown ubuntu:ubuntu). */
const VISION_LOG_DIR = process.env.VISION_LOG_DIR ?? "/var/lib/chessguru/vision-log";
function logScanImage(pngBuf: Buffer, tag: string): void {
  try {
    if (!existsSync(VISION_LOG_DIR)) {
      mkdir(VISION_LOG_DIR, { recursive: true }, () => {});
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${ts}-${tag}.png`;
    writeFile(path.join(VISION_LOG_DIR, name), pngBuf, () => {});
  } catch { /* silent */ }
}

export type PieceLetter = "P" | "N" | "B" | "R" | "Q" | "K";
export type PieceColor = "w" | "b";

const VALID_PIECES: PieceLetter[] = ["P", "N", "B", "R", "Q", "K"];

export interface FeedbackInput {
  /** For piece squares: one of "P"|"N"|"B"|"R"|"Q"|"K". For an empty
   *  square correction, pass "empty" (client marks a square as empty
   *  when vision falsely detected a piece there). */
  piece: PieceLetter | "empty";
  color: PieceColor;               // ignored when piece==="empty"
  silhouettePng: string;
  rawCropPng?: string;
  setHint?: string;
}

export interface VisionRefDoc {
  piece: PieceLetter;
  color: PieceColor;
  setName: string;
  source: "seed" | "correction";
  silhouettePng: string;
  /** Base64 PNG of the raw natural-pixel square crop that produced this
   *  ref. Populated whenever the client sent rawCropPng at feedback time
   *  (or when a seed script inserted one). This is what the retraining
   *  pipeline mines to build per-book training data -- without it we'd
   *  only ever train on synthetic cburnett variants. */
  rawCropPng?: string;
  /** 768-dim L2-normed DINOv2 embedding of the original raw square crop.
   *  Optional -- present only when a rawCropPng was supplied at record
   *  time (or when the seed script embedded a synthetic reference). Used
   *  by classifyBoard for nearest-neighbour piece classification. */
  embeddingDinov2?: number[];
  /** True when this ref represents an EMPTY square. Nearest-neighbour
   *  match against an isEmpty ref means the classifier should output
   *  "empty" (piece=null) for that board square. Piece / color fields
   *  are set to arbitrary placeholders when isEmpty is true (Mongo
   *  doesn't allow missing required fields), and callers should ignore
   *  them. */
  isEmpty?: boolean;
  createdBy: string | null;
  createdAt: Date;
  approved: boolean;
}

export interface ClassifiedSquare {
  piece: PieceLetter | null;    // null = empty
  color: PieceColor | null;     // null when empty
  confidence: number;           // 0..1, cosine similarity of the winning ref
  matchedSetName: string | null;
}

export interface ClassifyBoardResult {
  fen: string;
  squares: ClassifiedSquare[][]; // [row=0-top][col=0-left], 8x8
  meta: {
    refsMatched: number;
    refsSkipped: number;
    latencyMs: number;
  };
}

export interface ClassifyBoardV2Result {
  fen: string;
  squares: ClassifiedSquare[][];
  meta: {
    modelVersion: string;
    latencyMs: number;
    avgConfidence: number;
  };
}

export interface ClassifyBoardV4Result {
  fen: string;
  squares: ClassifiedSquare[][];
  meta: {
    modelVersion: string;
    latencyMs: number;
    avgConfidence: number;
    repairedSquares: number;   // how many top-1 predictions the chess-rules pass overrode
    fenIsLegal: boolean;
  };
}

@Injectable()
export class VisionService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection<VisionRefDoc>("visionRefs"); }

  /** All approved references, newest first. Client fetches this once at
   *  boot and merges into its template pool. Capped at 2000 (payload
   *  stays ~4MB even at that cap). */
  async listApproved(): Promise<VisionRefDoc[]> {
    return this.col()
      .find({ approved: true }, { sort: { createdAt: -1 } as any })
      .limit(2000)
      .toArray();
  }

  /** Store one coach-correction. Basic input validation only; the
   *  silhouette payload is trusted as long as it's small enough that
   *  a malicious user can't blow up storage.
   *  When rawCropPng is supplied, we ALSO run DINOv2 on it and store
   *  the embedding so classifyBoard can nearest-neighbour against
   *  this reference. Silhouettes stay in place so client-side legacy
   *  matching still works. Returns the inserted id. */
  async recordCorrection(userId: string | null, input: FeedbackInput): Promise<{ ok: true; id: string; embedded: boolean }> {
    const isEmpty = input.piece === "empty";
    if (!isEmpty && !VALID_PIECES.includes(input.piece as PieceLetter)) throw new Error("invalid piece");
    if (!isEmpty && input.color !== "w" && input.color !== "b") throw new Error("invalid color");
    const raw = String(input.silhouettePng || "");
    // Strip data-URL prefix if present. We keep just the base64.
    const base64 = raw.replace(/^data:image\/[a-z]+;base64,/, "");
    if (base64.length < 40 || base64.length > 20_000) throw new Error("silhouette payload out of range");
    // Loose base64 shape check -- Mongo would still store garbage, but
    // this catches obvious client bugs.
    if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) throw new Error("silhouette not base64");

    // Optional DINOv2 embedding for the raw natural-pixel crop. Fails
    // silent -- silhouette-only refs are still valuable for legacy path.
    let embedding: number[] | undefined;
    if (input.rawCropPng) {
      try {
        const rawB64 = input.rawCropPng.replace(/^data:image\/[a-z]+;base64,/, "");
        if (rawB64.length < 100 || rawB64.length > 200_000) throw new Error("rawCropPng out of range");
        embedding = await embedImageDinov2(Buffer.from(rawB64, "base64"));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[vision] rawCropPng embed failed:", (e as Error).message);
      }
    }

    const setName = (input.setHint && String(input.setHint).slice(0, 40)) || "coach-correction";
    // Trim data-URL prefix off rawCropPng for storage (server accepts both
    // forms; we canonicalize to bare base64).
    const rawCropBase64 = input.rawCropPng
      ? input.rawCropPng.replace(/^data:image\/[a-z]+;base64,/, "")
      : undefined;
    const doc: VisionRefDoc = {
      // For "empty" corrections we still need to satisfy the schema's
      // required piece/color -- use a sentinel that the classifier
      // ignores because isEmpty takes precedence.
      piece: isEmpty ? ("P" as PieceLetter) : (input.piece as PieceLetter),
      color: isEmpty ? ("w" as PieceColor) : input.color,
      setName,
      source: "correction",
      silhouettePng: base64,
      ...(rawCropBase64 ? { rawCropPng: rawCropBase64 } : {}),
      ...(embedding ? { embeddingDinov2: embedding } : {}),
      ...(isEmpty ? { isEmpty: true } : {}),
      createdBy: userId,
      createdAt: new Date(),
      approved: true,
    };
    const r = await this.col().insertOne(doc as any);
    return { ok: true, id: String(r.insertedId), embedded: !!embedding };
  }

  /** Fire-and-forget input logger for the client (called on every image
   *  upload so we capture inputs even when the coach only uses the
   *  client-side detector, never touches Server AI). */
  async logScanOnly(boardPngBase64: string, source: string): Promise<void> {
    const b64 = boardPngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    if (b64.length < 100 || b64.length > 5_000_000) return;
    const buf = Buffer.from(b64, "base64");
    const tag = source.replace(/[^a-z0-9]/gi, "-").slice(0, 20) || "upload";
    logScanImage(buf, `client-${tag}`);
  }

  /** Server-side board classification: split the cropped 480x480 board
   *  image into 64 60x60 squares, embed each via DINOv2, and pick the
   *  nearest-neighbour reference. Empty squares are decided by whether
   *  the winning ref beats a cosine-similarity confidence floor (0.35).
   *
   *  Runs sequentially (each embed is CPU-bound ~50-100ms). Total budget
   *  for a full board is ~3-6 seconds -- acceptable for a coach who
   *  opts into "🚀 Server AI" mode when the client-side classifier fails
   *  on their book/screenshot font. */
  async classifyBoard(boardPngBase64: string): Promise<ClassifyBoardResult> {
    const started = Date.now();
    const boardB64 = boardPngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    if (boardB64.length < 500 || boardB64.length > 10_000_000) {
      throw new Error("board png out of range (need 500B-10MB base64)");
    }
    const boardBuf = Buffer.from(boardB64, "base64");
    logScanImage(boardBuf, "v3-nn");
    const meta = await sharp(boardBuf).metadata();
    if (!meta.width || !meta.height) throw new Error("unreadable board image");
    // Resize to a canonical 480x480 so per-square math is stable.
    const canonical = await sharp(boardBuf).resize(480, 480, { fit: "fill" }).png().toBuffer();

    // Load ALL approved refs with a DINOv2 embedding. Kept in memory for
    // the request -- typical bank is < 500 rows at 3KB each = ~1.5MB.
    const refs = await this.col().find(
      { approved: true, embeddingDinov2: { $exists: true } },
      { projection: { _id: 0, piece: 1, color: 1, setName: 1, embeddingDinov2: 1, isEmpty: 1 } as any },
    ).limit(2000).toArray();
    if (refs.length === 0) {
      throw new Error("reference bank has no DINOv2 embeddings — run seed-cburnett first");
    }

    // Embed every square + find its nearest ref.
    let matched = 0, skipped = 0;
    const squares: ClassifiedSquare[][] = [];
    for (let r = 0; r < 8; r++) {
      const row: ClassifiedSquare[] = [];
      for (let c = 0; c < 8; c++) {
        const squareBuf = await sharp(canonical)
          .extract({ left: c * 60, top: r * 60, width: 60, height: 60 })
          .png()
          .toBuffer();
        let cell: ClassifiedSquare;
        try {
          const emb = await embedImageDinov2(squareBuf);
          cell = nearestNeighbour(emb, refs as any);
          matched++;
        } catch {
          cell = { piece: null, color: null, confidence: 0, matchedSetName: null };
          skipped++;
        }
        row.push(cell);
      }
      squares.push(row);
    }

    const fen = squaresToFen(squares);
    return {
      fen, squares,
      meta: { refsMatched: matched, refsSkipped: skipped, latencyMs: Date.now() - started },
    };
  }

  /** v3.5 direct chess-piece classifier -- one softmax per square, no
   *  reference bank lookup. Trained on Vinayaka RTX 3080 with DINOv2-base
   *  frozen backbone + 256->13 MLP head, exported to ONNX for CPU inference
   *  here. Batches all 64 squares into a single ort.session.run() call so
   *  latency is a single forward pass, not 64 sequential ones. Typical
   *  cold-start ~10s (model load), warm ~2-3s per board. */
  async classifyBoardV2(boardPngBase64: string): Promise<ClassifyBoardV2Result> {
    const started = Date.now();
    const boardB64 = boardPngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    if (boardB64.length < 500 || boardB64.length > 10_000_000) {
      throw new Error("board png out of range (need 500B-10MB base64)");
    }
    const boardBuf = Buffer.from(boardB64, "base64");
    logScanImage(boardBuf, "v2");
    // FAST-PATH preprocessing: single sharp() call decodes + resizes the
    // whole board to 1792x1792 raw RGB, then tilesFromBoardPixels shuffles
    // bytes into 64 pre-normalized CHW tensors in pure JS. Cheaper than
    // the legacy 128 sharp subprocess calls, especially when the box is
    // under load.
    // NB: inference itself is the ceiling on this model (DINOv2-base CPU
    // forward ~400ms/square × 64 = ~26s on a loaded box). Sub-second
    // latency needs GPU or distillation to a smaller model. See Option C
    // post-mortem for details.
    const megaBoard = 8 * 224;
    const rawRGB = await sharp(boardBuf)
      .removeAlpha()
      .resize(megaBoard, megaBoard, { fit: "fill", kernel: "cubic" })
      .raw()
      .toBuffer();
    const chwTiles = tilesFromBoardPixels(rawRGB, megaBoard);
    const results = await chessClassifyBatchFromCHW(chwTiles);
    void chessClassifyBatch;   // legacy path kept for callers with per-square PNGs

    // Map 64 flat results back to 8x8 grid + build FEN.
    const grid: ClassifiedSquare[][] = [];
    let confSum = 0;
    for (let r = 0; r < 8; r++) {
      const row: ClassifiedSquare[] = [];
      for (let c = 0; c < 8; c++) {
        const res = results[r * 8 + c]!;
        confSum += res.confidence;
        // className is "empty" or "<piece><color>" like "Kw", "Pb".
        if (res.className === "empty") {
          row.push({ piece: null, color: null, confidence: res.confidence, matchedSetName: CHESS_CLASSIFIER_VERSION });
        } else {
          const piece = res.className[0] as PieceLetter;
          const color = res.className[1] as PieceColor;
          row.push({ piece, color, confidence: res.confidence, matchedSetName: CHESS_CLASSIFIER_VERSION });
        }
      }
      grid.push(row);
    }
    const fen = squaresToFen(grid);
    return {
      fen, squares: grid,
      meta: {
        modelVersion: CHESS_CLASSIFIER_VERSION,
        latencyMs: Date.now() - started,
        avgConfidence: confSum / 64,
      },
    };
  }

  /** v4 super-fast classifier -- MobileNetV3-small (INT8 quantized, ~3MB)
   *  + chess-rules FEN legality repair via top-3 beam search. Target:
   *  <200ms warm CPU inference, 98%+ accuracy on unfamiliar book fonts.
   *  Same request shape as classify-board / -v2; the meta block adds
   *  repairedSquares + fenIsLegal so callers can see how much the
   *  legality pass had to intervene. */
  async classifyBoardV4(boardPngBase64: string): Promise<ClassifyBoardV4Result> {
    const started = Date.now();
    const boardB64 = boardPngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    if (boardB64.length < 500 || boardB64.length > 10_000_000) {
      throw new Error("board png out of range (need 500B-10MB base64)");
    }
    const boardBuf = Buffer.from(boardB64, "base64");
    logScanImage(boardBuf, "v4");
    // Fast path: single sharp call to produce a 1792×1792 raw RGB buffer
    // (8×224 for the model's per-tile input size). Then slice into 64
    // 224×224 tiles in pure JS. Beats the previous 64-subprocess approach
    // by ~10× (2s → ~200ms) because sharp process start-up dominated.
    const megaBoard = 8 * 224;
    const rawRGB = await sharp(boardBuf)
      .removeAlpha()
      .resize(megaBoard, megaBoard, { fit: "fill", kernel: "cubic" })
      .raw()
      .toBuffer();
    const chwTiles = tilesFromBoardPixels(rawRGB, megaBoard);

    // Single batched inference -- MobileNetV3-small on CPU handles 64 squares
    // in <200ms with INT8.
    const flat = await classifyBatchV4FromCHW(chwTiles);
    void classifyBatchV4;   // legacy path kept for callers with per-square PNGs
    // Reshape flat[64] to 8x8 rows for the repair pass.
    const rows2d = [];
    for (let r = 0; r < 8; r++) rows2d.push(flat.slice(r * 8, (r + 1) * 8));

    // Beam search over top-3 candidates per square to guarantee a LEGAL FEN.
    const repair = repairForLegalFen(rows2d);

    // Build ClassifiedSquare grid using the (possibly repaired) labels.
    const grid: ClassifiedSquare[][] = [];
    let confSum = 0;
    for (let r = 0; r < 8; r++) {
      const row: ClassifiedSquare[] = [];
      for (let c = 0; c < 8; c++) {
        const finalName = repair.labels[r]![c]!;
        // Confidence: use the top-K entry whose className matched the chosen label.
        const conf = rows2d[r]![c]!.topK.find(k => k.className === finalName)?.prob ?? rows2d[r]![c]!.confidence;
        confSum += conf;
        if (finalName === "empty") {
          row.push({ piece: null, color: null, confidence: conf, matchedSetName: CHESS_CLASSIFIER_V4_VERSION });
        } else {
          row.push({
            piece: finalName[0] as PieceLetter,
            color: finalName[1] as PieceColor,
            confidence: conf,
            matchedSetName: CHESS_CLASSIFIER_V4_VERSION,
          });
        }
      }
      grid.push(row);
    }
    const fen = squaresToFen(grid);
    return {
      fen, squares: grid,
      meta: {
        modelVersion: CHESS_CLASSIFIER_V4_VERSION,
        latencyMs: Date.now() - started,
        avgConfidence: confSum / 64,
        repairedSquares: repair.repaired,
        fenIsLegal: repair.legal,
      },
    };
  }

  /** Save a user-adjusted set of 4 board corners for future YOLO retraining.
   *  Client sends { rawImagePngBase64, corners: [{x,y}×4], sourceRef }.
   *  We store the raw photo + corner coords in Mongo `visionCornerLabels`
   *  so the nightly retrain can fold real user corrections into training. */
  async saveCornerLabels(
    userId: string | null,
    rawImagePngBase64: string,
    corners: Array<{ x: number; y: number }>,
    sourceRef?: string,
  ): Promise<{ ok: true; id: string }> {
    const b64 = rawImagePngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    if (b64.length < 500 || b64.length > 20_000_000) {
      throw new Error("raw image out of range (need 500B-20MB base64)");
    }
    if (!Array.isArray(corners) || corners.length !== 4) {
      throw new Error("need exactly 4 corners");
    }
    for (const c of corners) {
      if (typeof c?.x !== "number" || typeof c?.y !== "number") throw new Error("corner {x,y} must be numbers");
    }
    logScanImage(Buffer.from(b64, "base64"), "corner-adjust");
    const doc = {
      userId,
      rawImagePngBase64: b64,
      corners,
      sourceRef: sourceRef || null,
      createdAt: new Date(),
    };
    const res = await this.conn.collection("visionCornerLabels").insertOne(doc as any);
    return { ok: true, id: String(res.insertedId) };
  }

  /** "ChessVision AI" fallback — proxies to chessvision.dev commercial API.
   *  Called when our own classifier has low confidence or returns illegal
   *  FEN. Env-configured: CHESSVISION_API_URL (endpoint), CHESSVISION_API_KEY
   *  (auth), CHESSVISION_API_AUTH_HEADER (default "X-Api-Key"), and
   *  CHESSVISION_API_BODY_FIELD (default "image_base64" — some APIs use
   *  "image" for multipart or "url" for a hosted URL). Adjust once we see
   *  the actual API contract.
   *
   *  Never send more than 1 request every 2s (rate limit protection) and
   *  never log the API key. Returns { fen, source: "chessvision.dev" }. */
  async classifyBoardChessVision(rawImagePngBase64: string): Promise<{ fen: string; source: string; raw?: any }> {
    const apiUrl    = process.env.CHESSVISION_API_URL  || "https://chessvision.dev/api/v1/predict";
    const apiKey    = process.env.CHESSVISION_API_KEY  || "";
    const authHdr   = process.env.CHESSVISION_API_AUTH_HEADER || "X-Api-Key";
    const bodyField = process.env.CHESSVISION_API_BODY_FIELD  || "image_base64";
    if (!apiKey) throw new Error("CHESSVISION_API_KEY not configured");

    const b64 = rawImagePngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    logScanImage(Buffer.from(b64, "base64"), "chessvision-raw");
    const body: any = {};
    body[bodyField] = b64;

    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [authHdr]: apiKey,
        // Some APIs also accept Bearer — leave as extra header if user configures both
        ...(process.env.CHESSVISION_API_BEARER ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => r.statusText);
      throw new Error(`chessvision.dev ${r.status}: ${txt.slice(0, 200)}`);
    }
    const data = await r.json() as any;
    // Response shape TBD — try common field names
    const fen = data?.fen || data?.result?.fen || data?.data?.fen || data?.prediction || "";
    if (!fen) throw new Error(`chessvision.dev: no FEN in response ${JSON.stringify(data).slice(0, 200)}`);
    return { fen, source: "chessvision.dev", raw: data };
  }

  /** "Ultra AI" end-to-end: proxies to the local Python :5100 microservice
   *  which runs the MIT YOLOv8n-seg extractor + 3-model classifier ensemble
   *  (YOLOv8n-cls + DINOv2-small + DINOv3-small) with 4-rotation autopick.
   *  If warpedBoardPngBase64 is supplied, the microservice uses that tight
   *  crop and skips its own extractor — fixes iPad/tablet UI-chrome bleed
   *  where the server-side YOLO picks up title bar + bezel and misaligns
   *  the 8×8 tile split. Client already computed a tight OpenCV.js warp,
   *  so trust it. */
  async classifyBoardUltra(rawImagePngBase64: string, warpedBoardPngBase64?: string) {
    const rawB64 = rawImagePngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
    if (rawB64.length < 500 || rawB64.length > 20_000_000) {
      throw new Error("raw image out of range (need 500B-20MB base64)");
    }
    logScanImage(Buffer.from(rawB64, "base64"), "ultra-raw");
    const body: { image_base64: string; warped_board_base64?: string } = { image_base64: rawB64 };
    if (warpedBoardPngBase64) {
      const wB64 = warpedBoardPngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
      body.warped_board_base64 = wB64;
      logScanImage(Buffer.from(wB64, "base64"), "ultra-warp");
    }
    const t0 = Date.now();
    const r = await fetch("http://127.0.0.1:5100/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const extractLatencyMs = Date.now() - t0;
    if (!r.ok) {
      const txt = await r.text().catch(() => r.statusText);
      throw new Error(`ultra service ${r.status}: ${txt.slice(0, 200)}`);
    }
    const j = await r.json() as any;
    return { ...j, extractLatencyMs };
  }
}

/** Cosine similarity nearest-neighbour against L2-normed refs.
 *  A winning ref with isEmpty=true is interpreted as "this square is
 *  empty" (piece=null, color=null). A winning piece ref returns its
 *  piece/color. Below a global confidence floor (0.35), we bail to
 *  empty rather than surface a low-confidence guess. */
function nearestNeighbour(
  query: number[],
  refs: Array<{ piece: PieceLetter; color: PieceColor; setName: string; embeddingDinov2: number[]; isEmpty?: boolean }>,
): ClassifiedSquare {
  if (query.length !== DINOV2_EMBEDDING_DIM) {
    return { piece: null, color: null, confidence: 0, matchedSetName: null };
  }
  let best = -1, bestIdx = -1;
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i]!;
    const emb = r.embeddingDinov2;
    if (!emb || emb.length !== DINOV2_EMBEDDING_DIM) continue;
    let dot = 0;
    for (let k = 0; k < DINOV2_EMBEDDING_DIM; k++) dot += query[k]! * emb[k]!;
    if (dot > best) { best = dot; bestIdx = i; }
  }
  if (bestIdx < 0 || best < 0.35) {
    return { piece: null, color: null, confidence: Math.max(0, best), matchedSetName: null };
  }
  const w = refs[bestIdx]!;
  if (w.isEmpty) {
    return { piece: null, color: null, confidence: best, matchedSetName: w.setName };
  }
  return { piece: w.piece, color: w.color, confidence: best, matchedSetName: w.setName };
}

/** Build a FEN placeholder from the classified 8x8 grid. Assumes row 0
 *  is rank 8 (top of board from white-view) and col 0 is file a. Callers
 *  can flip after the fact if they know the input was rotated. */
function squaresToFen(squares: ClassifiedSquare[][]): string {
  const ranks: string[] = [];
  for (let r = 0; r < 8; r++) {
    let s = "", empty = 0;
    for (let c = 0; c < 8; c++) {
      const cell = squares[r]![c]!;
      if (!cell.piece || !cell.color) { empty++; continue; }
      if (empty > 0) { s += empty; empty = 0; }
      s += cell.color === "w" ? cell.piece : cell.piece.toLowerCase();
    }
    if (empty > 0) s += empty;
    ranks.push(s);
  }
  return `${ranks.join("/")} w - - 0 1`;
}
