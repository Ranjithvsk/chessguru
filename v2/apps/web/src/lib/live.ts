import type { ClientMsg, ServerMsg, TimeControl } from "@chessguru/protocol";

type Handler = (m: ServerMsg) => void;

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/** Thin browser client for the realtime engine (apps/ws gateway). Types come
 *  from @chessguru/protocol (erased at build); the wire format is plain JSON.
 *
 *  Reconnects on its own: a dropped socket (mobile radio, sleeping tab, gateway
 *  restart) used to leave the page silently dead — the board looked live but
 *  nothing was sent or received. Now the socket comes back with backoff and the
 *  owner re-introduces itself via `onOpen` (hello + resync of the current game). */
export class LiveClient {
  private ws?: WebSocket;
  private url = "";
  private handlers = new Set<Handler>();
  private openHandlers = new Set<(reconnect: boolean) => void>();
  private statusHandlers = new Set<(connected: boolean) => void>();
  private closed = false;
  private attempt = 0;
  private everOpened = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  connect(url: string): Promise<void> {
    this.url = url;
    return new Promise((resolve, reject) => this.open(resolve, reject));
  }

  private open(resolve?: () => void, reject?: (e: unknown) => void): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let settled = false;
    ws.onopen = () => {
      settled = true;
      const reconnect = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      resolve?.();
      for (const h of this.statusHandlers) h(true);
      for (const h of this.openHandlers) h(reconnect);
    };
    ws.onerror = (e) => {
      if (!settled) {
        settled = true;
        reject?.(e);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded
      for (const h of this.statusHandlers) h(false);
      this.scheduleReconnect();
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg | null = null;
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerMsg;
      } catch {
        return;
      }
      if (m) for (const h of this.handlers) h(m);
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.timer) return;
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    const delay = base + Math.random() * 500;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  /** Fires on every successful open; `reconnect` is false for the first one. */
  onOpen(h: (reconnect: boolean) => void): () => void {
    this.openHandlers.add(h);
    return () => this.openHandlers.delete(h);
  }
  onStatus(h: (connected: boolean) => void): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  private send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Identity comes from the session cookie on the upgrade; `guest` only names a
   *  signed-out visitor (and is ignored when a session resolves). */
  hello(guest?: string): void {
    this.send({ v: 1, t: "hello", d: guest ? { guest } : {} });
  }
  seek(clock: TimeControl, rated = false, academyOnly = false): void {
    this.send({ v: 1, t: "seek", d: { clock, rated, ...(academyOnly ? { academyOnly: true } : {}) } });
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
  resync(g: string, havePly: number): void {
    this.send({ v: 1, t: "resync", g, d: { havePly } });
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
  abort(g: string): void {
    this.send({ v: 1, t: "abort", g });
  }
  claim(g: string): void {
    this.send({ v: 1, t: "claim", g });
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
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
  }
}
