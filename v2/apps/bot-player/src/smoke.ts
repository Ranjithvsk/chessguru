import { Chess } from "chess.js";
import { Maia3Engine } from "./engine";
import { EnginePool, PLAIN_VARIETY, pickEngine, type EngineSpec } from "./engines";

const BLACKBURNE = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "c6d4"];

async function one(pool: EnginePool, spec: EngineSpec, moves: string[], rating: number): Promise<void> {
  const t0 = Date.now();
  try {
    const engine = pool.acquire(spec);
    const think = await engine.think({ moves, opponentRating: rating });
    console.log(`  ${spec.id.padEnd(16)} ${think.uci.padEnd(6)} collision=${think.collision.toFixed(3)}  ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`  ${spec.id.padEnd(16)} FAIL: ${(e as Error).message}  ${Date.now() - t0}ms`);
  }
}

async function main(): Promise<void> {
  const pool = new EnginePool(() => new Maia3Engine());

  console.log("maia-1 ladder, startpos:");
  for (const level of [1100, 1500, 1900]) await one(pool, { kind: "maia1", id: `maia1-${level}`, level }, [], 1500);

  console.log("maia-1 ladder, Blackburne Shilling x20 (f3d4 = correct Nxd4, f3e5 = the trap):");
  for (const level of [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]) {
    const engine = pool.acquire({ kind: "maia1", id: `maia1-${level}`, level });
    const seen = new Map<string, number>();
    for (let i = 0; i < 20; i++) {
      const { uci } = await engine.think({ moves: BLACKBURNE, opponentRating: 1500 });
      seen.set(uci, (seen.get(uci) ?? 0) + 1);
    }
    const parts = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${u}:${n}`);
    console.log(`  maia1-${level}  ${parts.join("  ")}`);
  }

  const plain: EngineSpec[] = [
    ...PLAIN_VARIETY.map((p) => ({ kind: "plain" as const, id: p.id, plain: p })),
    pickEngine(2400),
  ];

  console.log("variety engines, startpos:");
  for (const spec of plain) await one(pool, spec, [], 1800);

  console.log("maia-3, startpos:");
  await one(pool, { kind: "maia3", id: "maia3" }, [], 1500);

  // An engine that mishandles `position startpos moves ...` returns an illegal move, which
  // the server rejects and the session has no retry for — the bot would just stall.
  console.log("legality after a move list (Blackburne, white to play):");
  for (const spec of [...plain, { kind: "maia3" as const, id: "maia3" }]) {
    const board = new Chess();
    for (const m of BLACKBURNE) board.move({ from: m.slice(0, 2), to: m.slice(2, 4) });
    const legal = new Set(board.moves({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ""}`));
    try {
      const { uci } = await pool.acquire(spec).think({ moves: BLACKBURNE, opponentRating: 1800 });
      console.log(`  ${spec.id.padEnd(16)} ${uci.padEnd(6)} ${legal.has(uci) ? "legal" : "*** ILLEGAL ***"}`);
    } catch (e) {
      console.log(`  ${spec.id.padEnd(16)} FAIL: ${(e as Error).message}`);
    }
  }

  console.log("pickEngine distribution:");
  for (const rating of [900, 1200, 1500, 1800, 2000, 2400]) {
    const seen = new Map<string, number>();
    for (let i = 0; i < 400; i++) {
      const id = pickEngine(rating).id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const parts = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id}:${Math.round((n / 400) * 100)}%`);
    console.log(`  ${String(rating).padEnd(5)} ${parts.join("  ")}`);
  }

  pool.killAll();
  process.exit(0);
}

void main();
