// The codec seam (ADR-0008 D3). JSON today; swap the body to MessagePack/binary
// later without touching any call site or the message types. All transports hand
// us a decoded string (the socket adapter and ioredis both yield strings).
export function encode(msg: unknown): string {
  return JSON.stringify(msg);
}

export function decode<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
