// Simulate coach corrections that mark the 34 EMPTY squares in the
// Final Theory 1.e4 e5 diagram as isEmpty=true. Together with the
// 30 piece refs already seeded (setName="final-theory-2008"), this
// gives the classifier a complete 64-square reference for this
// specific board, so re-classify should return ~ground-truth FEN.

import { readFileSync } from "fs";
import sharp from "sharp";
import { MongoClient } from "mongodb";
import { embedImageDinov2 } from "../src/lib/dinovImage";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";

// Same GRID as simulate-corrections.ts but here we care about the NULL cells.
type Cell = { piece: "P"|"N"|"B"|"R"|"Q"|"K"; color: "w"|"b" } | null;
const GRID: Cell[][] = [
  [ {piece:"R",color:"w"}, {piece:"N",color:"w"}, {piece:"B",color:"w"}, {piece:"K",color:"w"}, {piece:"Q",color:"w"}, {piece:"B",color:"w"}, {piece:"N",color:"w"}, {piece:"R",color:"w"} ],
  [ {piece:"P",color:"w"}, {piece:"P",color:"w"}, {piece:"P",color:"w"}, null, null, {piece:"P",color:"w"}, {piece:"P",color:"w"}, {piece:"P",color:"w"} ],
  [null,null,null,null,null,null,null,null],
  [null,null,null, {piece:"P",color:"w"}, null,null,null,null],
  [null,null,null, {piece:"P",color:"b"}, null,null,null,null],
  [null,null,null,null,null,null,null,null],
  [ {piece:"P",color:"b"}, {piece:"P",color:"b"}, {piece:"P",color:"b"}, null, null, {piece:"P",color:"b"}, {piece:"P",color:"b"}, {piece:"P",color:"b"} ],
  [ {piece:"R",color:"b"}, {piece:"N",color:"b"}, {piece:"B",color:"b"}, {piece:"K",color:"b"}, {piece:"Q",color:"b"}, {piece:"B",color:"b"}, {piece:"N",color:"b"}, {piece:"R",color:"b"} ],
];

async function main(): Promise<void> {
  const raw = readFileSync("/home/dreamworld/book-cropped.png");
  const canonical = await sharp(raw).resize(480, 480, { fit: "fill" }).png().toBuffer();
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const col = client.db().collection("visionRefs");
  // Wipe any prior "empty" refs for this specific book to reset the test.
  await col.deleteMany({ setName: "final-theory-2008-empty" });

  let seeded = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (GRID[r]?.[c]) continue;   // skip pieces — already seeded elsewhere
      const sq = await sharp(canonical).extract({ left: c*60, top: r*60, width: 60, height: 60 }).png().toBuffer();
      const emb = await embedImageDinov2(sq);
      const rawCropPng = sq.toString("base64");
      const silhouette = (await sharp({create:{width:40,height:40,channels:3,background:{r:0,g:0,b:0}}}).png().toBuffer()).toString("base64");
      await col.insertOne({
        piece: "P", color: "w",                      // sentinel, ignored when isEmpty=true
        setName: "final-theory-2008-empty",
        source: "correction",
        silhouettePng: silhouette,
        rawCropPng,
        embeddingDinov2: emb,
        isEmpty: true,
        createdBy: "simulated-coach",
        createdAt: new Date(),
        approved: true,
      } as any);
      seeded++;
    }
  }
  console.log(`Seeded ${seeded} empty-square refs for final-theory-2008.`);
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
