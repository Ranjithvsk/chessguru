// Minimal ambient types for the subset of `ws` we use in class-ws.ts.
// Full types live in `@types/ws` on npm — not installed here to keep the api's
// dependency footprint small. Extend this file if you start using more of the API.

declare module "ws" {
  import type { IncomingMessage } from "http";
  import type { Duplex } from "stream";

  export class WebSocket {
    static OPEN: 1;
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: "message", cb: (raw: Buffer | ArrayBuffer | Buffer[]) => void): this;
    on(event: "close", cb: () => void): this;
    on(event: "error", cb: (err: Error) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { noServer?: boolean });
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void): void;
    on(event: "connection", cb: (ws: WebSocket, req: IncomingMessage) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
  }
}
