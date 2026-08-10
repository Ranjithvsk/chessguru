// One-time seed: populate visionRefs with the 12 Lichess-default
// (cburnett) chess-piece prototypes as DINOv2 embeddings so the
// server-side classifyBoard endpoint has something to match against
// before any coach corrections have been captured.
//
// Approach: read the chessground npm package's bundled cburnett CSS
// from apps/web/node_modules, regex-extract each piece's base64
// data-URI SVG (12 pieces total), rasterize to a 224x224 RGB PNG
// centred on a light-square background (so the embedding sees a
// natural piece-on-square image, not a floating silhouette on
// alpha), and record via VisionService.recordCorrection with
// setName="cburnett" + source="seed".
//
// Idempotent: skips pieces already present (piece + color +
// setName="cburnett") so re-running is safe.
//
// Run: cd apps/api && npx ts-node scripts/seed-cburnett-dinov2.ts

import { readFileSync, existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import { MongoClient } from "mongodb";
import { embedImageDinov2 } from "../src/lib/dinovImage";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";
const CSS_PATH = path.resolve(
  __dirname, "../../web/node_modules/chessground/assets/chessground.cburnett.css",
);

const CSS_TO_TYPE: Record<string, "P" | "N" | "B" | "R" | "Q" | "K"> = {
  pawn: "P", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K",
};

// Chessground's "light square" background colour (approx) so the embedded
// image looks like a real chess square, not a floating piece on transparent.
const LIGHT_SQUARE = { r: 240, g: 217, b: 181 };

async function svgToBoardTile(svgB64: string): Promise<Buffer> {
  const svgBuf = Buffer.from(svgB64, "base64");
  // Rasterise the SVG at 200px, then composite over a 224x224 light-square
  // background. DINOv2's preprocessor will centre-crop to 224 anyway --
  // we just want the piece proportional to a real board square.
  const piece = await sharp(svgBuf, { density: 300 }).resize(200, 200, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  const tile = await sharp({
    create: { width: 224, height: 224, channels: 3, background: LIGHT_SQUARE },
  })
    .composite([{ input: piece, top: 12, left: 12 }])
    .png()
    .toBuffer();
  return tile;
}

async function main(): Promise<void> {
  if (!existsSync(CSS_PATH)) {
    console.error("cburnett CSS not found at", CSS_PATH);
    process.exit(1);
  }
  const css = readFileSync(CSS_PATH, "utf8");
  const re = /piece\.(pawn|knight|bishop|rook|queen|king)\.(white|black)\s*\{[^}]*url\('data:image\/svg\+xml;base64,([^']+)'\)/g;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const col = db.collection("visionRefs");

  let m: RegExpExecArray | null;
  let seeded = 0, skipped = 0;
  while ((m = re.exec(css)) !== null) {
    const type = CSS_TO_TYPE[m[1]!]!;
    const color: "w" | "b" = m[2] === "white" ? "w" : "b";
    const existing = await col.findOne({ piece: type, color, setName: "cburnett", embeddingDinov2: { $exists: true } });
    if (existing) {
      console.log(`skip ${type}${color} (already seeded)`);
      skipped++;
      continue;
    }
    console.log(`embedding ${type}${color}...`);
    const tile = await svgToBoardTile(m[3]!);
    const emb = await embedImageDinov2(tile);
    // Also store a silhouette placeholder so legacy client-side matching
    // sees the seed too. 40x40 grayscale, all-black -- unused for the
    // DINOv2 path but keeps the schema-required silhouettePng field
    // populated (and pieceClassifier.ts fetches will silently ignore
    // anything that doesn't rasterise to a plausible template).
    const silhouetteBuf = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
    await col.insertOne({
      piece: type,
      color,
      setName: "cburnett",
      source: "seed",
      silhouettePng: silhouetteBuf.toString("base64"),
      embeddingDinov2: emb,
      createdBy: null,
      createdAt: new Date(),
      approved: true,
    } as any);
    seeded++;
  }
  console.log(`\ndone: ${seeded} seeded, ${skipped} skipped, total ${seeded + skipped}/12`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
