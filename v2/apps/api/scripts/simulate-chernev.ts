// Simulate one coach's full-board correction pass on the Chernev
// "Ending 17" diagram (Capablanca vs Salwe, page 62). Position:
//   r2r2k1/2pq1pp1/p5p1/1pPpP3/3P4/3Q2PP/PP6/5RK1  (21 pieces, 43 empties)
//
// Loads /home/dreamworld/chernev-diag.png, splits it into 64 60x60
// cells (after canonical 480x480 resize), embeds each via DINOv2,
// and inserts into visionRefs with the correct label per the FEN
// above. Same code path as BoardEditor.applyEditor -> POST /vision/feedback
// but batched for the demo.
//
// After running: server v3.1 classify on the same image should return
// near-perfect FEN.

import { readFileSync } from "fs";
import sharp from "sharp";
import { MongoClient } from "mongodb";
import { embedImageDinov2 } from "../src/lib/dinovImage";

type Piece = "P"|"N"|"B"|"R"|"Q"|"K";
type Color = "w"|"b";
type Cell = { piece: Piece; color: Color } | null;

// FEN: r2r2k1/2pq1pp1/p5p1/1pPpP3/3P4/3Q2PP/PP6/5RK1
// Parse into [row=0=rank8 top][col=0=a-file] grid.
function fenToGrid(fen: string): Cell[][] {
  const board = fen.split(" ")[0]!.split("/");
  const g: Cell[][] = [];
  for (const rank of board) {
    const row: Cell[] = [];
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < parseInt(ch); i++) row.push(null);
      } else {
        const isUpper = ch === ch.toUpperCase();
        row.push({ piece: ch.toUpperCase() as Piece, color: isUpper ? "w" : "b" });
      }
    }
    g.push(row);
  }
  return g;
}

const GRID = fenToGrid("r2r2k1/2pq1pp1/p5p1/1pPpP3/3P4/3Q2PP/PP6/5RK1");

async function main(): Promise<void> {
  const raw = readFileSync("/home/dreamworld/chernev-diag.png");
  const canonical = await sharp(raw).resize(480, 480, { fit: "fill" }).png().toBuffer();
  const client = new MongoClient(process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru");
  await client.connect();
  const col = client.db().collection("visionRefs");

  // Wipe any prior chernev refs so each demo run starts clean.
  await col.deleteMany({ setName: { $in: ["chernev-capa-1970s", "chernev-capa-1970s-empty"] } });

  let pieces = 0, empties = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = GRID[r]?.[c];
      const sq = await sharp(canonical)
        .extract({ left: c * 60, top: r * 60, width: 60, height: 60 })
        .png().toBuffer();
      const emb = await embedImageDinov2(sq);
      const rawCropPng = sq.toString("base64");
      const silhouette = (await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()).toString("base64");
      if (cell) {
        await col.insertOne({
          piece: cell.piece, color: cell.color,
          setName: "chernev-capa-1970s",
          source: "correction",
          silhouettePng: silhouette,
          rawCropPng,
          embeddingDinov2: emb,
          createdBy: "simulated-coach",
          createdAt: new Date(),
          approved: true,
        } as any);
        pieces++;
      } else {
        await col.insertOne({
          piece: "P" as any, color: "w" as any,
          setName: "chernev-capa-1970s-empty",
          source: "correction",
          silhouettePng: silhouette,
          rawCropPng,
          embeddingDinov2: emb,
          isEmpty: true,
          createdBy: "simulated-coach",
          createdAt: new Date(),
          approved: true,
        } as any);
        empties++;
      }
    }
  }
  console.log(`Seeded ${pieces} piece refs + ${empties} empty refs for chernev.`);
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
