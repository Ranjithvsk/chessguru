/**
 * Per-game serialization — the actor "mailbox" without an actor framework.
 * Events for the same game run strictly one-at-a-time (promise-chained);
 * different games run concurrently. The stored tail never rejects, so one
 * failing handler can't break the chain for later events on that game.
 */
export class Mailbox {
  private chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(
      key,
      next.then(
        () => {},
        () => {},
      ),
    );
    return next;
  }
}
