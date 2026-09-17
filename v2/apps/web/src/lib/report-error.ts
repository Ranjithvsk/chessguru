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
  // A half-built position is not a fault. The board editor validates what the user is typing or
  // painting through chess.js, whose validator throws "Invalid FEN: missing black king" and the
  // like until the position is complete; 24 of those reached the admin errors page in one week
  // from /board-editor alone, each one somebody mid-edit. Real editor faults still report.
  /** Say something USEFUL about a rejection reason.
   *
   *  `String(reason)` on an Event gives "[object Event]" and Events carry no stack,
   *  so three real failures on the live-class page (2026-09-17, two Android + one
   *  iPhone) arrived as "Unhandled rejection: [object Event]" — unactionable, and
   *  indistinguishable from each other. Events are the usual reason shape when a
   *  media element, a WebSocket or a resource load is wired straight into a reject,
   *  which is exactly what a class page is full of. Pull out what identifies it. */
  const describeReason = (r: any): string => {
    if (r == null) return String(r);
    if (typeof r === "string") return r;
    if (r.message) return r.message;
    if (typeof Event !== "undefined" && r instanceof Event) {
      const t: any = r.target || {};
      const bits = [
        `${r.type} event`,
        t.tagName ? `<${String(t.tagName).toLowerCase()}>` : null,
        // A failed media/resource load is identified by what it was loading.
        t.currentSrc || t.src || t.url ? `src=${String(t.currentSrc || t.src || t.url).slice(0, 120)}` : null,
        typeof t.readyState === "number" ? `readyState=${t.readyState}` : null,
        t.error && t.error.code ? `mediaErrorCode=${t.error.code}` : null,
      ].filter(Boolean);
      return bits.join(" ");
    }
    try { return JSON.stringify(r).slice(0, 200); } catch { return String(r); }
  };

  const isPositionInputNoise = (msg: string) =>
    /^(Uncaught )?(Error: )?Invalid FEN\b/i.test(msg) && /\/(board-editor|class-v2)\b/.test(location.pathname);
  window.addEventListener("error", (e) => {
    if (isPositionInputNoise(e.message || String(e.error))) return;
    // Failed <img>/<script> loads also fire this with no `error` object; those
    // are noise, not crashes.
    if (!e.error && !e.message) return;
    reportClientError(e.message || String(e.error), e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r: any = e.reason;
    reportClientError(`Unhandled rejection: ${describeReason(r)}`, r?.stack);
  });
}
