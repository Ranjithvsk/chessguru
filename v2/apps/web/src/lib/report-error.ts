// Ships browser crashes to POST /api/client-error so a white screen on a
// student's phone becomes an email + a row on /admin/errors, instead of
// something we only hear about when a parent complains.
//
// Everything here is best-effort and must never throw — a reporter that can
// crash makes the original crash worse.
const BASE = import.meta.env.VITE_API_BASE ?? "";

// Same fault repeated (a render loop retrying every frame) must not become a
// request loop. Dedupe by message for the life of the page.
const seen = new Set<string>();
let sent = 0;

export function reportClientError(message: string, stack?: string, route?: string) {
  try {
    const key = `${route || ""}|${message}`.slice(0, 300);
    if (seen.has(key) || sent >= 10) return;
    seen.add(key);
    sent++;
    void fetch(`${BASE}/api/client-error`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      keepalive: true,   // survives the navigation away that often follows a crash
      body: JSON.stringify({
        message: String(message).slice(0, 500),
        stack: stack ? String(stack).slice(0, 4000) : undefined,
        route: route || location.pathname,
        url: location.href,
      }),
    }).catch(() => {});
  } catch { /* never let reporting break the page */ }
}

/** Global handlers for errors that escape React entirely — async callbacks,
 *  event handlers, rejected promises. */
export function installGlobalErrorReporting() {
  window.addEventListener("error", (e) => {
    // Failed <img>/<script> loads also fire this with no `error` object; those
    // are noise, not crashes.
    if (!e.error && !e.message) return;
    reportClientError(e.message || String(e.error), e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r: any = e.reason;
    reportClientError(r?.message ? `Unhandled rejection: ${r.message}` : `Unhandled rejection: ${String(r)}`, r?.stack);
  });
}
