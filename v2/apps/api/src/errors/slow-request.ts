// Watches wall-clock time per request and records the pathological ones.
//
// Motivated by 2026-09-04: /api/puzzles/random took 26 SECONDS for an active
// student for weeks and nothing surfaced it — the owner found out from the
// student. A 200 that takes half a minute is a breakage the exception filter
// can never see.
//
// Two thresholds so the mailbox stays useful: everything over RECORD_MS lands
// in `errorEvents` (searchable at /admin/errors), only NOTIFY_MS gets an email.
import type { ErrorAlertsService } from "./error-alerts.service";

const RECORD_MS = 5_000;
const NOTIFY_MS = 15_000;

// Endpoints that are legitimately slow — large uploads, GPU inference, engine
// search. Alerting on these would be pure noise.
const SKIP = [
  "/api/class/",           // recording / snap-audio / notes-image uploads
  "/api/vision",
  "/api/engine",
  "/api/academy/materials/",
  "/api/me/coach-profile/upload",
  "/api/me/academy-profile/upload",
  "/api/support/ticket",
];

export function slowRequestWatcher(alerts: ErrorAlertsService) {
  return (req: any, res: any, next: any) => {
    const started = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - started;
      if (ms < RECORD_MS) return;
      const route = String(req.originalUrl || req.url || "");
      if (SKIP.some((p) => route.startsWith(p))) return;
      // A slow request that was slow because the client uploaded 40MB isn't a
      // server fault.
      if (Number(req.headers?.["content-length"] || 0) > 2_000_000) return;
      alerts.report({
        kind: "slow",
        notify: ms >= NOTIFY_MS,
        ms,
        status: res.statusCode,
        message: `${req.method} ${route.split("?")[0]} took ${(ms / 1000).toFixed(1)}s`,
        route: route.split("?")[0],
        method: req.method,
        url: route,
        userId: req.session?.userId,
        academyId: req.session?.academyId,
        userAgent: req.headers?.["user-agent"],
        ip: req.ip,
      });
    });
    next();
  };
}
