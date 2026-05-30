import type { ClientMsg, ServerMsg, TimeControl } from "@chessguru/protocol";

type Handler = (m: ServerMsg) => void;

/** Thin browser client for the realtime engine (apps/ws gateway). Types come
 *  from @chessguru/protocol (erased at build); the wire format is plain JSON. */
export class LiveClient {
  private ws?: WebSocket;
  private handlers = new Set<Handler>();

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
      ws.onmessage = (ev) => {
        let m: ServerMsg | null = null;
        try {
          m = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerMsg;
        } catch {
          return;
        }
        if (m) for (const h of this.handlers) h(m);
      };
    });
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  hello(token?: string): void {
    this.send({ v: 1, t: "hello", d: token ? { token } : {} });
  }
  seek(clock: TimeControl, rated = false): void {
    this.send({ v: 1, t: "seek", d: { clock, rated } });
  }
  unseek(): void {
    this.send({ v: 1, t: "unseek" });
  }
  challenge(clock: TimeControl, rated = false): void {
    this.send({ v: 1, t: "challenge", d: { clock, rated } });
  }
  challengeAccept(id: string): void {
    this.send({ v: 1, t: "challenge-accept", d: { id } });
  }
  sub(g: string): void {
    this.send({ v: 1, t: "sub", g });
  }
  join(g: string): void {
    this.send({ v: 1, t: "join", g });
  }
  move(g: string, uci: string, ply: number): void {
    this.send({ v: 1, t: "move", g, d: { uci, ply } });
  }
  premove(g: string, uci: string): void {
    this.send({ v: 1, t: "premove", g, d: { uci } });
  }
  resign(g: string): void {
    this.send({ v: 1, t: "resign", g });
  }
  drawOffer(g: string): void {
    this.send({ v: 1, t: "draw-offer", g });
  }
  drawAccept(g: string): void {
    this.send({ v: 1, t: "draw-accept", g });
  }
  drawDecline(g: string): void {
    this.send({ v: 1, t: "draw-decline", g });
  }
  rematch(g: string): void {
    this.send({ v: 1, t: "rematch", g });
  }
  close(): void {
    this.ws?.close();
  }
}
