# 2026-09-06 — Ticket screenshots: clicking a thumbnail opened a blank tab

## What
Owner report (gunachess): in Help & feedback → "Your tickets", the small screenshot
previews render, but clicking one opens a new tab with no image.

## Why
Screenshots are stored as `data:image/jpeg;base64,…` (widget compresses via
`canvas.toDataURL`, ChessGuru's `/support/ticket` proxy and pos-api both pass the
string through). The thumbnails were wrapped in `<a href={src} target="_blank">`,
which asks the browser to navigate a top-level tab to a `data:` URL. Chrome, Edge
and Firefox have blocked that since 2017 (phishing vector) — the tab opens and the
navigation is refused. The stored image was always fine.

## Fix
Replaced the anchor with a clickable `<img>` that opens an in-page overlay showing
the same data URI full size (click anywhere or Esc to close). No new request, no
change to how screenshots are stored.

- `v2/apps/web/src/components/SupportWidget.tsx` — ChessGuru SPA (both the ticket's
  own screenshots and reply-thread ones)
- `packages/support-widget/src/SupportWidget.tsx` (dreamcy repo) — same bug in the
  standalone bundle used by till / pos-owner / staff

New hooks (`zoom` state + Esc listener) sit above the `hideOnPath` early return.
The overlay carries `data-support-widget="1"` so the widget's own auto-screenshot
capture keeps excluding it, at `zIndex: 10000` (widget backdrop is 9999).

## Verification
- ChessGuru: `scripts/deploy.sh` → gunachess.com serves `index-VNfCQfij.js`, which
  contains the new marker string.
- POS widget: `packages/support-widget/deploy.sh` → both pos-api instances serve the
  230234-byte bundle (`:3016` DWP, `:3019` tenants), HTTP 200, marker present.

## Landmines found
- `apps/web` `npm run build` is unusable: its `tsc -b` step fails on 101 pre-existing
  type errors across the repo. Only `scripts/deploy.sh` (direct `vite build`) works.
- `packages/support-widget/deploy.sh` was rsyncing as `ubuntu@148.113.43.16`, which
  has no key from France. Fixed to `dreamworld@`, the account the France→Mumbai
  tunnel units already use, and which owns the target file.

## Open
- Previous widget.js kept at `apps/pos-api/support-widget/widget.js.bak-20260906`
  on Mumbai; delete once the fix has been exercised on a till.
