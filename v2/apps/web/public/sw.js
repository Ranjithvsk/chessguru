// ChessGuru KILL-SWITCH SW (2026-08-17): unregister self + clear all caches
// so users stuck on stale bundles get a real fresh fetch. Root cause was
// the SW cache serving old shell/JS after each deploy. This SW takes over
// once, wipes everything, then does nothing on subsequent requests —
// browser goes back to normal network fetches without SW involvement.
self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
    try {
      await self.registration.unregister();
    } catch { /* ignore */ }
    try {
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) {
        try { c.navigate(c.url); } catch { /* cross-origin */ }
      }
    } catch { /* ignore */ }
  })());
});

// No fetch handler — let all requests hit the network directly.
