// React.lazy that survives a dropped chunk.
//
// A lazy page is one network request for a script the browser has never seen.
// On a phone on mobile data that request fails now and then for no reason that
// lasts — and React.lazy has no second try: the import rejects once and the
// route renders nothing. On 25 Sep 2026 a student on Android hit exactly that
// on the live-class page and reloaded her way through it, each reload throwing
// her out of the LiveKit room (TKT-269). Three attempts with a short back-off
// ride out the blip; only a chunk that is genuinely gone (an old build after a
// deploy) still fails, and lib/report-error reloads the page for that case.
//
// Also refuses a module that resolved to nothing: Vite's preload helper returns
// undefined instead of throwing when the `vite:preloadError` event has been
// default-prevented, which is how "Cannot read properties of undefined (reading
// 'default')" reached eight users in two days. Treat it as the failure it is.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export function lazyRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  tries = 3,
): LazyExoticComponent<T> {
  return lazy(async () => {
    let delay = 800;
    for (let attempt = 1; ; attempt++) {
      try {
        const mod = await factory();
        if (!mod || !("default" in mod)) throw new Error("Failed to fetch dynamically imported module (empty module)");
        return mod;
      } catch (e) {
        if (attempt >= tries) throw e;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  });
}
