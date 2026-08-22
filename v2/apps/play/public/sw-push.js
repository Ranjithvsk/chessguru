// Web push handler — appended to the main SW at build/registration time.
// Kept separate so the SW-registration in index.html can concatenate without
// disturbing the caching logic.
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
