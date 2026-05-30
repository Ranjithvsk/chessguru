// ChessGuru PWA service worker. Bump VERSION to invalidate caches on deploy.
const VERSION = "cg-v1";
const BASE = "/v2/";
const SHELL = [BASE, BASE + "manifest.webmanifest", BASE + "icons/icon-192.png", BASE + "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // don't touch the WS gateway / cross-origin
  if (url.pathname.startsWith("/api") || url.pathname.includes("/auth")) return; // never cache API/auth

  if (req.mode === "navigate") {
    // network-first for pages, fall back to the cached app shell when offline
    e.respondWith(fetch(req).catch(() => caches.match(BASE).then((r) => r || caches.match(req))));
    return;
  }
  // cache-first for static assets (Vite hashes filenames, so this is safe)
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
