import os from "node:os";

/** Stable per-process id. In dev we pass NODE_ID=e1 / e2; otherwise host:pid. */
export const NODE_ID = process.env.NODE_ID ?? `${os.hostname()}:${process.pid}`;
