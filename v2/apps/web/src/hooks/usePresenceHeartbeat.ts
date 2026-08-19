import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
const INTERVAL_MS = 60_000;

/** Fire a presence beacon every 60s + on every route change while the tab is
 *  visible. Coaches read the aggregated view via /api/academy/presence to see
 *  who is online and where. Failures are swallowed — presence must never
 *  block the UI or spam the console. Gated on `enabled` so we don't ping
 *  anonymous users (the endpoint 401s them anyway). */
export function usePresenceHeartbeat(enabled: boolean) {
  const loc = useLocation();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const beat = async (path: string) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        await fetch(`${BASE}/api/academy/heartbeat`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
      } catch { /* offline / rate-limited — silent */ }
    };
    // Kick immediately on mount / route change so the coach sees the student
    // land on the new page without waiting up to a minute.
    if (loc.pathname !== lastPath.current) {
      lastPath.current = loc.pathname;
      void beat(loc.pathname);
    }
    const id = window.setInterval(() => {
      if (!cancelled) void beat(loc.pathname);
    }, INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled, loc.pathname]);
}
