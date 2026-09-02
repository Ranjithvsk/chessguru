import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import LoginPage from "./pages/Login";
import TenantLoginPage from "./pages/TenantLogin";
import "./index.css";

// Fast-path bundle (2026-08-30): only what's needed to render the first
// paint on `/login`, `/`, and tenant-login. Everything else — the ~60
// post-auth pages — lives in AppRest.tsx and is downloaded as ONE lazy
// chunk that we prefetch in `requestIdleCallback` right after mount.
// By the time a user finishes typing their password, the "rest of the
// app" chunk is already in cache and the click on Login is instant.
//
// Landing-page-heavy routes (CoachPublic, AcademyPublic, ParentPay)
// also get their own lazy chunks — first-visit hits on those still
// need to fetch the chunk, but they save first-visit-on-`/login` from
// having to pay for them.
const AppRest         = lazy(() => import("./AppRest"));
const CoachPublicPage  = lazy(() => import("./pages/CoachPublic"));
const AcademyPublicPage = lazy(() => import("./pages/AcademyPublic"));
const ParentPayPage    = lazy(() => import("./pages/parent/PayHome"));

function LazyFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="animate-spin h-8 w-8 rounded-full border-2 border-ink-800 border-t-brand-500" />
    </div>
  );
}

// Dispatch /login → tenant-branded login on custom domains (gunachess.com),
// canonical ChessGuru login on harinitharanjith.com / localhost / bare IP.
function SmartLoginRoute() {
  if (typeof window === "undefined") return <LoginPage />;
  const h = window.location.hostname.toLowerCase();
  const isCanonical =
    /(^|\.)harinitharanjith\.com$/.test(h) ||
    /(^|\.)chessguru\.cc$/.test(h) ||
    /(^|\.)chessguru\.com$/.test(h) ||
    h === "localhost" || h === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(h);
  return isCanonical ? <LoginPage /> : <TenantLoginPage />;
}

// Kick off the AppRest chunk download in the browser's idle time, right
// after first paint. This is the whole point of the split — the login
// screen renders fast, and while the user reads/types the ~250 KB gzip
// "rest of app" chunk streams in the background. Fallback to setTimeout
// for Safari (no requestIdleCallback), still off the critical path.
function PrefetchRest() {
  useEffect(() => {
    const kick = () => { void import("./AppRest"); };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(kick, { timeout: 2500 });
    } else {
      setTimeout(kick, 1200);
    }
  }, []);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <PrefetchRest />
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/+$/, "")}>
        <Routes>
          {/* Standalone landing pages (no App chrome) — each is its own
              lazy chunk so first-visit-on-/login doesn't pay for them. */}
          <Route path="coach/:username" element={<Suspense fallback={<LazyFallback />}><CoachPublicPage /></Suspense>} />
          <Route path="academy-page/:slug" element={<Suspense fallback={<LazyFallback />}><AcademyPublicPage /></Suspense>} />
          <Route path="pay/:token" element={<Suspense fallback={<LazyFallback />}><ParentPayPage /></Suspense>} />

          {/* Login stays in the initial bundle — the whole point of the
              fast-path is to render this instantly on cold cache. */}
          <Route element={<App />}>
            <Route path="login" element={<SmartLoginRoute />} />
            <Route path="a/:slug/login" element={<TenantLoginPage />} />
          </Route>

          {/* Everything else = one lazy chunk (AppRest). Contains its own
              <Route element={<App />}> so App wrapper works there too. */}
          <Route path="*" element={<Suspense fallback={<LazyFallback />}><AppRest /></Suspense>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // Nudge SW to check for updates on load, but do NOT auto-reload —
        // that killed user sessions mid-upload (state lost, "no update"
        // reported). Users get the new bundle on their next natural
        // navigation instead.
        reg.update().catch(() => {});
      })
      .catch(() => {});
  });
  // Deep-link from notification click. The push SW posts { type: 'cg:navigate',
  // url } to already-open tabs when the user taps a notification, so we can
  // reuse the same window instead of piling up new ones. history.pushState
  // is enough because BrowserRouter listens to popstate — dispatch one so it
  // re-renders the matched route.
  navigator.serviceWorker.addEventListener?.("message", (event) => {
    const msg = event.data as { type?: string; url?: string } | undefined;
    if (!msg || msg.type !== "cg:navigate" || !msg.url) return;
    try {
      history.pushState({}, "", msg.url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch { /* ignore */ }
  });
}
