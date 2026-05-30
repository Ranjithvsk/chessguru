// Consistent-hash ring for cold placement (ADR-0008 D2). Deterministic across
// processes: any node (or gateway) computes the same owner for a gameId given
// the same live-node set, so placement needs no coordinator.

/** FNV-1a 32-bit — small, fast, dependency-free, good enough for placement spread. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const VNODES = 64; // virtual nodes per real node → smoother distribution

/**
 * Pick the owning node for `gameId` from `nodes` using a hash ring.
 * Returns null only when there are no live nodes.
 */
export function pickOwner(gameId: string, nodes: string[]): string | null {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0]!;
  const ring: Array<{ pos: number; node: string }> = [];
  for (const n of nodes) {
    for (let v = 0; v < VNODES; v++) ring.push({ pos: hash32(`${n}#${v}`), node: n });
  }
  ring.sort((a, b) => a.pos - b.pos);
  const h = hash32(gameId);
  for (const e of ring) if (e.pos >= h) return e.node;
  return ring[0]!.node; // wrap around
}
