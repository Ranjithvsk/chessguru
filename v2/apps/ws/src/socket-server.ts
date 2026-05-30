import * as uWS from "uWebSockets.js";
import { randomUUID } from "node:crypto";

// ── The D1 seam ───────────────────────────────────────────────────────────
// The router only ever talks to this interface, so swapping uWebSockets.js for
// `ws` (or anything else) is a new implementation, not a rewrite.
export interface Socket {
  readonly id: string;
  send(data: string): void;
  close(): void;
}

export interface SocketServer {
  onConnection(cb: (s: Socket) => void): void;
  onMessage(cb: (s: Socket, data: string) => void): void;
  onClose(cb: (s: Socket) => void): void;
  listen(port: number): Promise<void>;
}

/** uWebSockets.js implementation of SocketServer. */
export class UwsSocketServer implements SocketServer {
  private app = uWS.App();
  private sockets = new Map<string, uWS.WebSocket<{ id: string }>>();
  private onConn?: (s: Socket) => void;
  private onMsg?: (s: Socket, data: string) => void;
  private onCls?: (s: Socket) => void;

  constructor() {
    const self = this;
    this.app.ws<{ id: string }>("/ws", {
      maxPayloadLength: 64 * 1024,
      idleTimeout: 120,
      open(ws) {
        const id = randomUUID();
        ws.getUserData().id = id;
        self.sockets.set(id, ws);
        self.onConn?.(self.wrap(id));
      },
      message(ws, message) {
        const id = ws.getUserData().id;
        self.onMsg?.(self.wrap(id), Buffer.from(message).toString("utf8"));
      },
      close(ws) {
        const id = ws.getUserData().id;
        self.sockets.delete(id);
        self.onCls?.(self.wrap(id));
      },
    });
    this.app.get("/healthz", (res) => {
      res.writeStatus("200 OK").end("ok");
    });
    this.app.any("/*", (res) => {
      res.writeStatus("404 Not Found").end();
    });
  }

  private wrap(id: string): Socket {
    const sockets = this.sockets;
    return {
      id,
      send(data: string) {
        const ws = sockets.get(id);
        if (ws) {
          try {
            ws.send(data, false);
          } catch {
            /* socket gone mid-send */
          }
        }
      },
      close() {
        const ws = sockets.get(id);
        if (ws) {
          try {
            ws.end();
          } catch {
            /* already closed */
          }
        }
      },
    };
  }

  onConnection(cb: (s: Socket) => void): void {
    this.onConn = cb;
  }
  onMessage(cb: (s: Socket, data: string) => void): void {
    this.onMsg = cb;
  }
  onClose(cb: (s: Socket) => void): void {
    this.onCls = cb;
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.app.listen(port, (token) => (token ? resolve() : reject(new Error(`uWS listen failed on :${port}`))));
    });
  }
}
