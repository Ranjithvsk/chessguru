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
import { embedImageDinov2, DINOV2_EMBEDDING_DIM } from "../lib/dinovImage";

export type PieceLetter = "P" | "N" | "B" | "R" | "Q" | "K";
export type PieceColor = "w" | "b";

const VALID_PIECES: PieceLetter[] = ["P", "N", "B", "R", "Q", "K"];

export interface FeedbackInput {
  piece: PieceLetter;
  color: PieceColor;
  silhouettePng: string;   // base64 40x40 grayscale PNG (data URL prefix optional)
  rawCropPng?: string;     // optional base64 raw square crop (for DINOv2 embedding — RGB natural pixels, not silhouette)
  setHint?: string;        // free-form hint from the client, e.g. "lichess-neo"
}

export interface VisionRefDoc {
  piece: PieceLetter;
  color: PieceColor;
  setName: string;
  source: "seed" | "correction";
  silhouettePng: string;
  /** 768-dim L2-normed DINOv2 embedding of the original raw square crop.
   *  Optional -- present only when a rawCropPng was supplied at record
   *  time (or when the seed script embedded a synthetic reference). Used
   *  by classifyBoard for nearest-neighbour piece classification. */
  embeddingDinov2?: number[];
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
    if (!VALID_PIECES.includes(input.piece)) throw new Error("invalid piece");
    if (input.color !== "w" && input.color !== "b") throw new Error("invalid color");
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
    const doc: VisionRefDoc = {
      piece: input.piece,
      color: input.color,
      setName,
      source: "correction",
      silhouettePng: base64,
      ...(embedding ? { embeddingDinov2: embedding } : {}),
      createdBy: userId,
      createdAt: new Date(),
      approved: true,
    };
    const r = await this.col().insertOne(doc as any);
    return { ok: true, id: String(r.insertedId), embedded: !!embedding };
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
    if (boardB64.length < 500 || boardB64.length > 2_000_000) {
      throw new Error("board png out of range (need 500-2MB base64)");
    }
    const boardBuf = Buffer.from(boardB64, "base64");
    const meta = await sharp(boardBuf).metadata();
    if (!meta.width || !meta.height) throw new Error("unreadable board image");
    // Resize to a canonical 480x480 so per-square math is stable.
    const canonical = await sharp(boardBuf).resize(480, 480, { fit: "fill" }).png().toBuffer();

    // Load ALL approved refs with a DINOv2 embedding. Kept in memory for
    // the request -- typical bank is < 500 rows at 3KB each = ~1.5MB.
    const refs = await this.col().find(
      { approved: true, embeddingDinov2: { $exists: true } },
      { projection: { _id: 0, piece: 1, color: 1, setName: 1, embeddingDinov2: 1 } as any },
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
}

/** Cosine similarity nearest-neighbour against L2-normed refs.
 *  Below a confidence floor (0.35), returns empty -- means "no piece
 *  looks close enough; assume this square is blank." Higher = better. */
function nearestNeighbour(
  query: number[],
  refs: Array<{ piece: PieceLetter; color: PieceColor; setName: string; embeddingDinov2: number[] }>,
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
