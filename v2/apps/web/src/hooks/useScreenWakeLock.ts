// Screen Wake Lock — asks the browser to keep the phone/tablet screen
// on while a Dream Meet class is open (owner ask 2026-09-01: "will the
// screen time out on mobile?").
//
// Behaviour:
//   * On mount, request a "screen" wake lock via the standard Web API.
//   * On unmount, release it.
//   * Browsers auto-release when the tab becomes hidden (backgrounded).
//     We re-request on `visibilitychange → visible` so returning to the
//     tab restores the lock without a page reload.
//   * Silent no-op on unsupported browsers (older Safari, some in-app
//     browsers). We never throw — worst case the phone dims normally.
//
// Trade-off: burns battery faster. Called deliberately from ClassV2 only —
// study/dashboard pages don't need it.

import { useEffect, useRef } from "react";

type WakeLock = { release: () => Promise<void> | void; released?: boolean };

export function useScreenWakeLock(enabled: boolean = true): void {
  const lockRef = useRef<WakeLock | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;
    const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLock> } };
    if (!nav.wakeLock || typeof nav.wakeLock.request !== "function") return;

    let disposed = false;

    const request = async () => {
      if (disposed) return;
      if (lockRef.current && !lockRef.current.released) return;
      try {
        lockRef.current = await nav.wakeLock!.request("screen");
      } catch {
        // "NotAllowedError" (some browsers require gesture) or
        // "SecurityError" (iframe / non-https). Silent — screen just
        // dims as normal.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const l = lockRef.current;
      lockRef.current = null;
      if (l && !l.released) { try { void l.release(); } catch { /* noop */ } }
    };
  }, [enabled]);
}
