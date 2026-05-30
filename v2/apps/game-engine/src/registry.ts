import { RoundGrain } from "./grain";

/** In-memory set of game grains this node currently owns. */
export class Registry {
  private grains = new Map<string, RoundGrain>();

  get(g: string): RoundGrain | undefined {
    return this.grains.get(g);
  }
  set(g: string, grain: RoundGrain): void {
    this.grains.set(g, grain);
  }
  evict(g: string): void {
    this.grains.delete(g);
  }
  active(): string[] {
    return [...this.grains.keys()];
  }
}
