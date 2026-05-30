# Session 2026-05-30 — v2 web app is an installable PWA

**What:** Made the ChessGuru v2 web app installable as a PWA — manifest, icons, a service worker
(offline-capable app shell), and an "Install" button that appears when the browser offers installation.
Verified in a real browser (vite preview + Playwright).

**Built (apps/web):**
- `public/manifest.webmanifest` — name/short_name ChessGuru, `display: standalone`, scope+start_url
  `/v2/`, theme `#7c3aed`, bg `#0b0f17`, 3 icons (192 any, 512 any, 512 maskable).
- `public/icons/{icon-192,icon-512,icon-maskable-512}.png` — brand-gradient + ♞, **rendered via
  headless Chromium** (no ImageMagick on the box) at exact sizes.
- `public/favicon.svg` — gradient knight (replaces the 404 favicon).
- `public/sw.js` — versioned cache (`cg-v1`): precache app shell on install, network-first for
  navigations (offline → cached shell), cache-first for hashed static assets; **never caches
  `/api`/`/auth` or cross-origin** (so the WS gateway + API are untouched). Cleans old caches on activate.
- `src/components/InstallButton.tsx` — captures `beforeinstallprompt`, shows "⬇ Install", calls
  `prompt()` on click; hides after install. Added to the Navbar.
- `index.html` — manifest link, theme-color, apple-touch-icon + apple-mobile-web-app meta (iOS
  add-to-home-screen). `main.tsx` — registers the SW in production only (`import.meta.env.PROD`).

**Verified (vite preview :4173 + Playwright):** manifest 200 & valid (standalone, 3 icons,
start_url /v2/); icon-192 200; theme-color `#7c3aed`; **service worker active, scope `/v2/`**; install
button appears on a (simulated) `beforeinstallprompt` and calls `prompt()` on click. typecheck + build
clean (122 modules; dist includes manifest/sw.js/favicon/icons). Console errors were only the expected
API-404 / WS-refused (no backend or gateway running under preview) — no PWA/SW errors.

**Notes:** SW registers only in prod builds (avoids dev/HMR interference). Real install needs Chrome's
engagement heuristic over HTTPS — installability *criteria* are all met (manifest + icons + SW with a
fetch handler, served over TLS in prod). For deploy, the app is under `/v2/`, so the SW scope/start_url
are `/v2/`; bump `cg-v1` in `sw.js` on each release to invalidate caches.

**Resource note:** icons were rendered with the existing Playwright Chromium; everything torn down
after (preview killed, browser closed). Earlier this session I also closed 5 idle web terminals at the
owner's request, recovering ~1.4 GB RAM (available 1.8→3.2 GB) — the slow-site report was memory/swap
pressure, not the app (origin responds <10 ms). 3 orphaned socket-less claude procs (~536 MB) remain;
left for the owner to decide.

**Files:** `v2/apps/web/{index.html, public/**, src/main.tsx, src/components/{Navbar,InstallButton}.tsx}`.

**Next:** browser e2e for the promotion chooser; challenge-a-friend link UI; production `/ws` proxy +
deploy (still gated on ADR-0008 + §infra/budget).
