// Phase 3 by hand: list the labelled decisions, refit, print the model and
// its leave-one-out replay, and score a few students under hand vs model.
//   corepack pnpm --filter @chessguru/api exec tsx scripts/fairplay-model.ts [users…]
//   REPORT=guna-chess-academy:2026-09 … also print that academy's fairness report
import mongoose from "mongoose";
import { FairplayService } from "../src/fairplay/fairplay.service";
import { FEATURES, handWeights, HAND_BIAS, modelScore } from "../src/fairplay/model";

(async () => {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chessguru");
  const svc = new FairplayService(mongoose.connection as any);
  const ex = await svc.labelledExamples();
  console.log(`labelled examples: ${ex.length}`);
  for (const e of ex) console.log(`  ${e.at.toISOString().slice(0, 10)} ${e.label.padEnd(8)} ${e.userId.padEnd(16)} ${e.source.padEnd(12)} ${JSON.stringify(e.components)}`);
  const m = await svc.refitModel();
  console.log(`model: ${m.reason}`);
  console.log("  weights (hand → fitted):");
  const hw = handWeights();
  FEATURES.forEach((f, i) => console.log(`    ${f.padEnd(10)} ${hw[i]!.toFixed(3)} → ${m.weights[i]!.toFixed(3)}`));
  console.log(`    bias       ${HAND_BIAS.toFixed(3)} → ${m.bias.toFixed(3)}`);
  console.log(`  leave-one-out: ${JSON.stringify(m.cv)}`);
  for (const e of ex) console.log(`  ${e.userId.padEnd(16)} ${e.label.padEnd(8)} model ${modelScore(m, e.components)}`);
  for (const u of process.argv.slice(2)) {
    const usr: any = await mongoose.connection.db!.collection("users").findOne({ _id: u as any }, { projection: { academyId: 1 } as any });
    const r = await svc.scoreUser(u, usr?.academyId ?? null, { notify: false });
    console.log(`${u}: hand ${r.handScore} · model ${r.modelScore} · in use ${r.score} (${r.band}) ${JSON.stringify(r.components)}`);
  }
  if (process.env.REPORT) {
    const [academyId, month] = process.env.REPORT.split(":");
    const rep = await svc.fairnessReport(academyId!, month!);
    console.log(JSON.stringify(rep, null, 1).slice(0, 3000));
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
