// Run the Fair Play nightly by hand (crowd baselines → score every student →
// owner notices for new Reviews). The API pod runs the same thing at 21:00 UTC.
//   corepack pnpm --filter @chessguru/api exec tsx scripts/fairplay-nightly.ts
//   DIGEST=dry  … also render the Monday digest without sending it
import mongoose from "mongoose";
import { FairplayService } from "../src/fairplay/fairplay.service";

(async () => {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chessguru");
  const svc = new FairplayService(mongoose.connection as any);
  if (process.env.DIGEST === "dry") {
    const mail = require("../src/lib/mail");
    mail.sendMail = async (m: any) => { console.log(`\n--- would send to ${m.to}: ${m.subject}\n${m.text}`); return { ok: true, id: "dry" }; };
    await svc.runDigest();
  } else {
    const r = await svc.runNightly();
    console.log(JSON.stringify(r));
    const fp = await mongoose.connection.db!.collection("fairplay").find({ band: { $ne: "clear" } }, { projection: { score: 1, band: 1, hold: 1, components: 1, windowStart: 1 } as any }).sort({ score: -1 }).toArray();
    for (const x of fp) console.log(`${x._id}: ${x.score} ${x.band} hold=${x.hold} ${JSON.stringify(x.components)} since ${new Date(x.windowStart).toISOString().slice(0, 10)}`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
