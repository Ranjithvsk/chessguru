# 2026-05-30 — Remove redundant Themes section (v2 web)

## What
Removed the standalone **Themes** page from the v2 web app — the navbar link, the `/theme` route +
import in `main.tsx`, and the `pages/Theme.tsx` file.

## Why
`Theme.tsx` and `Puzzles.tsx` are functionally the same: both drive the shared `usePuzzleGame` hook,
and the Puzzles page already has a **Theme** dropdown (backed by `/api/themes`). The Themes page only
added a row of featured-motif chips on top of the identical solver, so it was duplicate surface area.
Owner asked to drop it.

## Files
- `v2/apps/web/src/components/Navbar.tsx` — removed the `{ to: "/theme", label: "Themes" }` link.
- `v2/apps/web/src/main.tsx` — removed the `ThemePage` import and the `<Route path="theme">`.
- `v2/apps/web/src/pages/Theme.tsx` — deleted (git rm).

## Behaviour
Old `/theme` links/bookmarks no longer 404: with the explicit route gone they fall through the
`<Route path="*">` catch-all → `<Navigate to="/" replace>`, i.e. redirect to Puzzles. Theme-based
training is still available via the Puzzles page dropdown. `/api/themes` is untouched.

## Verification
- `pnpm --filter @chessguru/web typecheck` → clean (118 modules, one fewer than before).
- Deployed via `scripts/deploy.sh`; memory stayed safe (~1.8Gi available).
- Live check: navbar shows Puzzles · Blindfold · Opening · Engine · Editor · Factory (no Themes);
  `https://harinitharanjith.com/theme` redirects to `/`.
