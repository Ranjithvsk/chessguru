// ChessGuru PWA service worker.
const VERSION = "cg-20260817113808";
const BASE = self.location.pathname.replace(/sw\.js$/, "");
const SHELL = [BASE, BASE + "manifest.webmanifest", BASE + "icons/icon-192.png", BASE + "icons/icon-512.png"];
const STATIC_RE = /\.(?:js|css|mjs|wasm|svg|png|jpg|jpeg|webp|gif|woff2?|ttf|otf|ico)$/;

// FORCE the upgrade — earlier "graceful" version left users stuck on broken old
// SW indefinitely. This is a rescue-mode deploy: take over immediately, drop
// stale caches, index.html's safety-net catches any race.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(v2api|api|auth|ws|ws-engine)(\/|$)/.test(url.pathname)) return;

  if (req.mode === "navigate") {
    // Stale-while-revalidate for pages: serve cache instantly (no blank
    // screen on refresh), fetch fresh in background so next load is current.
    // Users don't wait on network round-trip for the shell. Latest bundle
    // references still flow through — hashed JS/CSS below is network-first,
    // and cached HTML points at CURRENT hashed bundle names because vite
    // rewrites the shell on each deploy.
    e.respondWith(
      caches.match(BASE).then((cached) => {
        const fresh = fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(BASE, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  if (STATIC_RE.test(url.pathname)) {
    // network-first for immutable-hashed JS/CSS/etc — prevents any stale
    // asset from being served if it somehow got into cache
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req))
    );
  }
});

self.addEventListener("push", (e) => {
  let payload = { title: "ChessGuru", body: "" };
  try { payload = e.data ? e.data.json() : payload; } catch { /* accept non-JSON payloads */ }
  const options = {
    body: payload.body || "",
    tag: payload.tag || "cg-general",
    icon: payload.icon || (BASE + "icons/icon-192.png"),
    badge: payload.badge || (BASE + "icons/icon-192.png"),
    data: { url: payload.url || "/" },
  };
  e.waitUntil(self.registration.showNotification(payload.title || "ChessGuru", options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  const absolute = new URL(target, self.location.origin + BASE).href;
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) {
      if (c.url.startsWith(self.location.origin) && "focus" in c) {
        await c.focus();
        if ("navigate" in c) { try { await c.navigate(absolute); } catch { /* cross-origin nav */ } }
        return;
      }
    }
    await self.clients.openWindow(absolute);
  })());
});
