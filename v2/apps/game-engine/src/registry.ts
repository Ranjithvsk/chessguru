import { EchoGrain } from "./grain";

/** In-memory set of grains this node currently owns. */
export class Registry {
  private grains = new Map<string, EchoGrain>();

  get(g: string): EchoGrain | undefined {
    return this.grains.get(g);
  }
  set(g: string, grain: EchoGrain): void {
    this.grains.set(g, grain);
  }
  evict(g: string): void {
    this.grains.delete(g);
  }
  active(): string[] {
    return [...this.grains.keys()];
  }
}
