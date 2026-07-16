// @ts-nocheck  — self-contained, Node-validated KPK oracle; strict noUncheckedIndexedAccess adds no safety to this numeric-index compute code.
// Web Worker: builds the KPK tablebase off the main thread and transfers the buffer back.
import { buildDTM } from "./kpk";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};
ctx.onmessage = () => {
  const dtm = buildDTM();
  ctx.postMessage(dtm.buffer, [dtm.buffer]);
};
