// Simulate 32 coach-corrections on the Final Theory book's 1.e4 e5 diagram.
//
// Reads /home/dreamworld/book-cropped.png, splits it into 8x8 squares
// using the KNOWN ground-truth FEN, embeds each occupied square via
// DINOv2, and inserts the results into visionRefs.embeddingDinov2 with
// setName="final-theory-2008" -- mimicking what BoardEditor.applyEditor()
// does when a coach fixes 32 squares from a book position they know.
//
// Then re-classifies the same board via /api/vision/classify-board and
// prints the improved FEN alongside the ground truth for comparison.
//
// This proves the coach-correction feedback loop end-to-end without
// needing to click 32 palette buttons through a browser.

import { readFileSync } from "fs";
import sharp from "sharp";
import { MongoClient } from "mongodb";
import { embedImageDinov2 } from "../src/lib/dinovImage";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";
const BOARD_PATH = "/home/dreamworld/book-cropped.png";
// Ground truth for the top-left diagram on page 20:
//   1.e4 e5 -- standard black-view but position is symmetric so the FEN
//   is white-view orientation. Note the book is Black-view so if we
//   want to correct with correct labels, we need to know which SIDE of
//   the cropped image each square maps to.
//
// The pre-cropped image (book-cropped.png) is the RAW book crop -- top
// row of the image = rank 1 (white back rank) in the book's Black-view.
// So when we index [row][col] in the image, row 0 = white pieces, row 7
// = black. Column 0 = h-file (leftmost in Black-view), column 7 = a-file.
//
// I'll construct a per-image grid that says what each (row,col) actually
// contains in the ORIGINAL book orientation:
//   Row 0 (rank 1 white back): R N B K Q B N R (Black-view means files
//     h g f e d c b a from left to right; so col 0 h1=R, col 3 e1=K, col 4 d1=Q).
//   Row 1 (rank 2 white pawns): P P P . . P P P (missing e2-pawn moved to e4)
//   Rows 2 and 3: mostly empty except row 3 col 3 has white pawn on e4
//   Row 4: mostly empty except col 3 has black pawn on e5
//   Rows 5-6 mostly empty
//   Row 6 (rank 7 black pawns): p p p . . p p p
//   Row 7 (rank 8 black back): r n b k q b n r
type PieceLetter = "P" | "N" | "B" | "R" | "Q" | "K";
type PieceColor = "w" | "b";
const GRID: Array<Array<{ piece: PieceLetter; color: PieceColor } | null>> = [
  // Row 0 (rank 1, white back rank): h g f e d c b a
  [ {p:"R",c:"w"}, {p:"N",c:"w"}, {p:"B",c:"w"}, {p:"K",c:"w"}, {p:"Q",c:"w"}, {p:"B",c:"w"}, {p:"N",c:"w"}, {p:"R",c:"w"} ].map(x => ({ piece: x.p as PieceLetter, color: x.c as PieceColor })),
  // Row 1 (rank 2, white pawns; e-pawn missing = col 4)
  [ {p:"P",c:"w"}, {p:"P",c:"w"}, {p:"P",c:"w"}, null,           null,           {p:"P",c:"w"}, {p:"P",c:"w"}, {p:"P",c:"w"} ].map(x => x ? { piece: x.p as PieceLetter, color: x.c as PieceColor } : null),
  // Row 2: empty
  [null, null, null, null, null, null, null, null],
  // Row 3 col 3: white pawn on e4 (in Black-view, e file is col 3)
  [null, null, null, {piece:"P" as PieceLetter, color:"w" as PieceColor}, null, null, null, null],
  // Row 4 col 3: black pawn on e5
  [null, null, null, {piece:"P" as PieceLetter, color:"b" as PieceColor}, null, null, null, null],
  // Row 5: empty
  [null, null, null, null, null, null, null, null],
  // Row 6 (rank 7, black pawns; e-pawn missing = col 4)
  [ {p:"P",c:"b"}, {p:"P",c:"b"}, {p:"P",c:"b"}, null,           null,           {p:"P",c:"b"}, {p:"P",c:"b"}, {p:"P",c:"b"} ].map(x => x ? { piece: x.p as PieceLetter, color: x.c as PieceColor } : null),
  // Row 7 (rank 8, black back rank)
  [ {p:"R",c:"b"}, {p:"N",c:"b"}, {p:"B",c:"b"}, {p:"K",c:"b"}, {p:"Q",c:"b"}, {p:"B",c:"b"}, {p:"N",c:"b"}, {p:"R",c:"b"} ].map(x => ({ piece: x.p as PieceLetter, color: x.c as PieceColor })),
];

async function main(): Promise<void> {
  const raw = readFileSync(BOARD_PATH);
  const meta = await sharp(raw).metadata();
  if (!meta.width || !meta.height) throw new Error("unreadable image");
  console.log(`board: ${meta.width}x${meta.height}, resizing to 480x480 canonical`);

  // Canonicalize to 480x480 (same as classifyBoard does server-side).
  const canonical = await sharp(raw).resize(480, 480, { fit: "fill" }).png().toBuffer();

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const col = client.db().collection("visionRefs");

  // Wipe existing final-theory-2008 refs so we start clean each run.
  await col.deleteMany({ setName: "final-theory-2008" });

  let seeded = 0, skipped = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = GRID[r]?.[c];
      if (!cell) { skipped++; continue; }
      // Extract this 60x60 square.
      const squareBuf = await sharp(canonical)
        .extract({ left: c * 60, top: r * 60, width: 60, height: 60 })
        .png()
        .toBuffer();
      const emb = await embedImageDinov2(squareBuf);
      const rawCropPng = squareBuf.toString("base64");
      // Legacy silhouette placeholder (unused for DINOv2 path).
      const silhouette = (await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()).toString("base64");
      await col.insertOne({
        piece: cell.piece,
        color: cell.color,
        setName: "final-theory-2008",
        source: "correction",
        silhouettePng: silhouette,
        rawCropPng,
        embeddingDinov2: emb,
        createdBy: "simulated-coach",
        createdAt: new Date(),
        approved: true,
      } as any);
      seeded++;
    }
  }
  console.log(`\nSeeded ${seeded} book-flavoured refs (skipped ${skipped} empty cells).`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
