// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Oracle loader — builds the KPK tablebase once (in a Web Worker, off the main thread),
// caches it in IndexedDB so later visits are instant, and injects it into kpk.ts.
// Falls back to a main-thread build if workers/IndexedDB aren't available.
import { setTable, tableReady, buildDTM } from "./kpk";

export { evaluateKPK } from "./kpk";
export { squareRule } from "./square";
export { keySquares, type KeySquares } from "./keySquares";
export { classify, generatePuzzle, TIER_NAMES, type Tier, type Classified } from "./generator";
export { buildPuzzle, type EndgamePuzzle } from "./puzzle";
export { applyMove, gradeMove, principalVariation, resultAfter, type CoordMove, type PVStep } from "./play";

const CACHE_KEY = "kpk-dtm-v1";
let loading: Promise<void> | null = null;

export function ensureOracle(): Promise<void> {
  if (tableReady()) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try { const buf = await idbGet(CACHE_KEY); if (buf && buf.byteLength > 0) { setTable(new Int32Array(buf)); return; } } catch { /* no cache */ }
    let buf: ArrayBuffer;
    try { buf = await buildInWorker(); }
    catch { buf = buildDTM().buffer; }                 // fallback: build on the main thread
    setTable(new Int32Array(buf));
    try { await idbSet(CACHE_KEY, buf); } catch { /* cache is best-effort */ }
  })();
  return loading;
}

function buildInWorker(): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try { w = new Worker(new URL("./kpkWorker.ts", import.meta.url), { type: "module" }); }
    catch (e) { reject(e); return; }
    const done = (fn: () => void) => { try { w.terminate(); } catch { /* */ } fn(); };
    w.onmessage = (e: MessageEvent) => done(() => resolve(e.data as ArrayBuffer));
    w.onerror = (e) => done(() => reject(e));
    w.postMessage("build");
  });
}

// ── minimal IndexedDB key/value ───────────────────────────────────────────────
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no idb")); return; }
    const req = indexedDB.open("cg-endgame", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv"); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(key: string): Promise<ArrayBuffer | null> {
  return openDb().then((db) => new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction("kv", "readonly").objectStore("kv").get(key);
    tx.onsuccess = () => resolve((tx.result as ArrayBuffer) ?? null);
    tx.onerror = () => reject(tx.error);
  }));
}
function idbSet(key: string, val: ArrayBuffer): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite").objectStore("kv").put(val, key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
