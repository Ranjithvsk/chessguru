// ChessGuru PWA service worker. Bump VERSION to invalidate caches on deploy.
const VERSION = "cg-20260808133841";
// Derive base from this SW's own URL so it's correct for both "/" and "/v2/" deploys.
const BASE = self.location.pathname.replace(/sw\.js$/, "");
const SHELL = [BASE, BASE + "manifest.webmanifest", BASE + "icons/icon-192.png", BASE + "icons/icon-512.png"];
const STATIC_RE = /\.(?:js|css|mjs|wasm|svg|png|jpg|jpeg|webp|gif|woff2?|ttf|otf|ico)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return; // never touch cross-origin (WS gateway, etc.)

  // NEVER cache dynamic endpoints — APIs are per-user and must hit the network.
  if (/^\/(v2api|api|auth|ws|ws-engine)(\/|$)/.test(url.pathname)) return;

  if (req.mode === "navigate") {
    // network-first for pages; fall back to a cached shell only when offline
    e.respondWith(fetch(req).catch(() => caches.match(BASE).then((r) => r || caches.match(req))));
    return;
  }

  // cache-first ONLY for genuine static assets (Vite hashes filenames, so safe)
  if (STATIC_RE.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
  // everything else: let the browser handle it normally (no SW caching)
});
