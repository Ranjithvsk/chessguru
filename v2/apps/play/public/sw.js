// Minimal service worker: network-first for HTML (never trap stale bundles),
// cache-first for /assets/* (Vite hashes them), fall back to network on miss.
// Kept intentionally simple — no precache manifest, no long-lived stale cache
// (memory of Aug 15 SW white-screen incident on ChessGuru main site).
const CACHE = "cg-play-v1";
const ASSET_RX = /\/assets\/|\/marketing\//;

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Drop any older cache generation from a previous SW.
    const keys = await caches.keys();
    for (const k of keys) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("push", (e) => {
  try {
    const data = e.data?.json?.() ?? {};
    const title = data.title || "ChessGuru Play";
    const body  = data.body  || "";
    const url   = data.url   || "/";
    e.waitUntil(self.registration.showNotification(title, {
      body, icon: "/marketing/hero-tournament.webp", badge: "/marketing/hero-tournament.webp",
      data: { url }, tag: url,
    }));
  } catch (err) { /* ignore malformed pushes */ }
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) if (c.url.includes(url) && "focus" in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the API — always live.
  if (url.pathname.startsWith("/v2api/")) return;
  if (ASSET_RX.test(url.pathname)) {
    // Cache-first for hashed assets — safe, they never change under a URL.
    e.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const net = await fetch(req);
      if (net.ok) cache.put(req, net.clone());
      return net;
    }));
    return;
  }
  // HTML + everything else: network-first with cache fallback for offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
      caches.open(CACHE).then((c) => c.put(req, res.clone()));
    }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || new Response("offline", { status: 503 }))));
});
