// ChessGuru Service Worker — PUSH-ONLY (2026-09-02).
//
// History: was a kill-switch (2026-08-17) that unregistered itself + cleared
// caches to escape the stale-shell issue that trapped users after each
// deploy. Now that the deploy script preserves hashed bundles across deploys
// (2026-08-27 rsync-without-delete + prune-old janitor), the caching issue
// is gone — we're free to keep a permanent SW again, this time doing ONE
// job only: receiving Web Push notifications for chat + Play + streak
// reminders.
//
// Explicit non-goals (landmine avoidance — feedback_sw_white_screen_landmine
// + feedback_chessguru_pwa_killswitch_sw):
//   * NO fetch handler. Every request goes to network. No app-shell cache,
//     no stale index.html, no white-screen after deploy.
//   * NO precache. NO runtime caching.
//   * VERSION is stamped by scripts/deploy.sh on every publish (sed line
//     below) so we can tell "SW is stale — user hasn't picked up new
//     bundle" from browser devtools.
//
// Migration from kill-switch: browsers still holding the old kill-switch
// version run its `activate` once (which unregisters). Their next page load
// fetches THIS sw.js from network + registers it fresh. Users who had a
// push subscription against the OLD SW need to re-subscribe — the endpoint
// is tied to a browser-vendor-issued key that dies on unregister. The
// Dashboard push toggle handles that automatically.

// Bumped on every deploy by scripts/deploy.sh (sed).
const VERSION = "cg-20260905083605";
// eslint-disable-next-line no-console
console.log("[sw] boot", VERSION);

self.addEventListener("install", (event) => {
  // Take over as soon as installed so the very next page load can use the
  // new push handler without a manual browser restart.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Sweep any caches left behind by earlier SW generations (kill-switch
    // or caching-shell). Safe: no fetch handler here, no in-flight request
    // depends on them.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
    // Claim already-open tabs so their next PushManager.getSubscription()
    // resolves against this SW instead of an old one that just went away.
    try { await self.clients.claim(); } catch { /* ignore */ }
  })());
});

// ── Push handler ─────────────────────────────────────────────────────────
// Payload contract (server-side: apps/api/src/push/push.service.ts):
//   { title: string, body: string, url?: string, tag?: string,
//     icon?: string, badge?: string }
// A missing/malformed payload still surfaces a generic notification so users
// aren't left staring at a silent phone.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* keep {} */ }
  const title = (data && data.title) || "ChessGuru";
  const body  = (data && data.body)  || "You have a new notification";
  const url   = (data && data.url)   || "/";
  const tag   = (data && data.tag)   || undefined;
  const icon  = (data && data.icon)  || "/pwa-192.png";
  const badge = (data && data.badge) || "/pwa-192.png";
  event.waitUntil(
    self.registration.showNotification(title, {
      body, tag, icon, badge,
      // Vibrate on Android (ignored on iOS). Short two-pulse.
      vibrate: [80, 40, 80],
      // renotify=true so a same-tag update (e.g. 2nd message in same
      // thread) buzzes the phone again instead of silently replacing.
      renotify: !!tag,
      data: { url },
    }),
  );
});

// ── Click handler ────────────────────────────────────────────────────────
// If the app is already open in a tab, focus it and post a nav message —
// otherwise open a new window straight at the deep link. Keeps the user in
// ONE tab across notifications instead of piling up new windows.
self.addEventListener("notificationclick", (event) => {
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const origin = self.location.origin;
    const target = new URL(url, origin).href;
    for (const c of clients) {
      if (c.url.startsWith(origin)) {
        try { await c.focus(); } catch { /* */ }
        try { c.postMessage({ type: "cg:navigate", url }); } catch { /* */ }
        return;
      }
    }
    try { await self.clients.openWindow(target); } catch { /* */ }
  })());
});
