// Thin shell-out wrapper around JaVaFo, FIDE-endorsed pairing engine
// (rrweb.org/javafo, by Roberto Ricca — TEC secretary + author of Handbook
// C.04). We invoke it as a black-box CLI: TRF16 in, pairings out.
//
//   java -jar /opt/javafo/javafo.jar <in.trfx> -p <out.txt>
//
// Long-computation flag -q 10000 caps permutations per bracket at 10k so
// pathological brackets don't hang the request forever. On overflow, the
// output is a lone "0" line and we retry with -w (which lets JaVaFo take
// longer to escape the bracket).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { encodeTrf, parseJavafoOutput, type TrfTournament, type ParsedPair } from "./trf16";

const JAVAFO_JAR = process.env.JAVAFO_JAR || "/opt/javafo/javafo.jar";
const JAVA_BIN = process.env.JAVA_BIN || "java";

async function run(args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(JAVA_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
  });
}

export async function pairNextRound(t: TrfTournament): Promise<{ ok: true; pairings: ParsedPair[] } | { ok: false; error: string; stderr?: string }> {
  const id = randomBytes(6).toString("hex");
  const dir = tmpdir();
  const inPath = join(dir, `cg-trf-${id}.trfx`);
  const outPath = join(dir, `cg-trf-${id}.out`);
  const trf = encodeTrf(t);
  try {
    await fs.writeFile(inPath, trf, "utf8");
    // First pass with permutation cap
    let r = await run(["-jar", JAVAFO_JAR, inPath, "-p", outPath, "-q", "10000"]);
    let outText: string | null = null;
    try { outText = await fs.readFile(outPath, "utf8"); } catch { outText = null; }
    if (outText && (outText.trim().split(/\r?\n/)[0] || "").trim() === "0") {
      // Long computation retry — no permutation cap, no timeout uplift here
      // but JaVaFo will exit cleanly.
      try { await fs.unlink(outPath); } catch {}
      r = await run(["-jar", JAVAFO_JAR, inPath, "-p", outPath, "-w"], 90_000);
      try { outText = await fs.readFile(outPath, "utf8"); } catch { outText = null; }
    }
    if (!outText) {
      return { ok: false, error: "JaVaFo did not produce output", stderr: r.stderr };
    }
    return { ok: true, pairings: parseJavafoOutput(outText) };
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}
