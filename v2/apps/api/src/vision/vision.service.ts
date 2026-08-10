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

export type PieceLetter = "P" | "N" | "B" | "R" | "Q" | "K";
export type PieceColor = "w" | "b";

const VALID_PIECES: PieceLetter[] = ["P", "N", "B", "R", "Q", "K"];

export interface FeedbackInput {
  piece: PieceLetter;
  color: PieceColor;
  silhouettePng: string;   // base64 40x40 grayscale PNG (data URL prefix optional)
  setHint?: string;        // free-form hint from the client, e.g. "lichess-neo"
}

export interface VisionRefDoc {
  piece: PieceLetter;
  color: PieceColor;
  setName: string;
  source: "seed" | "correction";
  silhouettePng: string;
  createdBy: string | null;
  createdAt: Date;
  approved: boolean;
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
   *  a malicious user can't blow up storage. Returns the inserted id. */
  async recordCorrection(userId: string | null, input: FeedbackInput): Promise<{ ok: true; id: string }> {
    if (!VALID_PIECES.includes(input.piece)) throw new Error("invalid piece");
    if (input.color !== "w" && input.color !== "b") throw new Error("invalid color");
    const raw = String(input.silhouettePng || "");
    // Strip data-URL prefix if present. We keep just the base64.
    const base64 = raw.replace(/^data:image\/[a-z]+;base64,/, "");
    if (base64.length < 40 || base64.length > 20_000) throw new Error("silhouette payload out of range");
    // Loose base64 shape check -- Mongo would still store garbage, but
    // this catches obvious client bugs.
    if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) throw new Error("silhouette not base64");
    const setName = (input.setHint && String(input.setHint).slice(0, 40)) || "coach-correction";
    const doc: VisionRefDoc = {
      piece: input.piece,
      color: input.color,
      setName,
      source: "correction",
      silhouettePng: base64,
      createdBy: userId,
      createdAt: new Date(),
      approved: true,
    };
    const r = await this.col().insertOne(doc as any);
    return { ok: true, id: String(r.insertedId) };
  }
}
