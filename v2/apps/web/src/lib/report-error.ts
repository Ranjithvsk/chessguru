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
  // A deploy replaces the hashed chunks. A tab that was ALREADY open still holds the
  // old index in memory, so the moment it lazily imports a route it asks for a file
  // that is no longer on disk and the import rejects. Nothing handled that: the
  // failure was reported and the person was left looking at a page that had stopped
  // working. 71 of these in 21 days, across 11 accounts, every single day — and it
  // lands hardest on exactly the tab nobody reloads, a class left open for an hour.
  // On 2026-09-22 a student hit it at 13:11:49, the second a challenge started.
  //
  // The page cannot recover in place — the code it needs is gone from the server —
  // but a reload fetches the new index and its chunks, so do that instead of dying.
  // Once per session per build: a chunk that is missing for any other reason must
  // not put the tab in a reload loop.
  const RELOAD_KEY = "cg-chunk-reload";
  const isStaleChunk = (m: string): boolean =>
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(m);
  const recoverStaleChunk = (m: string): boolean => {
    if (!isStaleChunk(m)) return false;
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return false;   // already tried — let it surface
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch { /* private mode: reload anyway, the loop guard is best-effort */ }
    try { location.reload(); } catch { /* */ }
    return true;
  };
  // Vite raises this for a failed lazy import before it ever becomes an error event,
  // which is the earliest and cleanest place to catch it.
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    recoverStaleChunk("Failed to fetch dynamically imported module");
  });

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
  /** Never let a credential reach the errors page. The LiveKit signalling URL
   *  carries the room JOIN TOKEN in its query string, so every dropped-socket
   *  report was writing a live (if short-lived) JWT into errorEvents, where it
   *  sits in the database and renders on /admin/errors. Keep the origin+path —
   *  that is the part that identifies WHAT failed — and drop the query. */
  const redactUrl = (u: string): string => {
    const cut = u.indexOf("?");
    const base = (cut === -1 ? u : u.slice(0, cut)).slice(0, 120);
    return cut === -1 ? base : `${base}?…`;
  };

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
        t.currentSrc || t.src || t.url ? `src=${redactUrl(String(t.currentSrc || t.src || t.url))}` : null,
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
    if (recoverStaleChunk(String((e as ErrorEvent).message ?? ""))) return;
    if (isPositionInputNoise(e.message || String(e.error))) return;
    // Failed <img>/<script> loads also fire this with no `error` object; those
    // are noise, not crashes.
    if (!e.error && !e.message) return;
    reportClientError(e.message || String(e.error), e.error?.stack);
  });
  /** The LiveKit SIGNALLING socket drops whenever a phone changes network, sleeps
   *  or loses a bar — several times a lesson on mobile data. The SDK owns the
   *  reconnect and the class carries straight on, but the dead socket's `error`
   *  event is wired into a reject, so each one landed here as an "Unhandled
   *  rejection" and 16 filled the errors page in two days from a single class
   *  (2026-09-20). Only an ALREADY-CLOSED signalling socket is dropped: a real
   *  LiveKit failure still reports, because LiveKitRoom's own onError path is
   *  separate and untouched by this. */
  const isLivekitSignalDrop = (r: any): boolean => {
    if (typeof Event === "undefined" || !(r instanceof Event) || r.type !== "error") return false;
    const t: any = r.target || {};
    const url = String(t.url || t.src || "");
    // WebSocket.CLOSING = 2, CLOSED = 3 — the socket is already gone, nothing to act on.
    return /^wss?:\/\/[^/]+\/rtc\b/.test(url) && (t.readyState === 2 || t.readyState === 3);
  };
  window.addEventListener("unhandledrejection", (e) => {
    if (recoverStaleChunk(String((e as PromiseRejectionEvent).reason ?? ""))) return;
    const r: any = e.reason;
    if (isLivekitSignalDrop(r)) return;
    reportClientError(`Unhandled rejection: ${describeReason(r)}`, r?.stack);
  });
}
