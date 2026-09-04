# 2026-09-04 — Hamburger drawer ignored outside clicks

Owner: "in the three line, on top left, click opens, but it should close when
clicked outside the side bar also right..?"

Yes — and the code already tried to. `Navbar.tsx` renders a dim backdrop with
`onClick={() => setMenuOpen(false)}` behind the drawer. It never received a
click because it had **zero height**.

## Root cause — backdrop-filter creates a containing block

The drawer and its backdrop were nested inside

    <header className="sticky top-0 z-50 ... backdrop-blur">

An element with `backdrop-filter` other than `none` becomes the containing block
for its `position: fixed` descendants. The header is 56px tall, so the backdrop's
`fixed inset-0 top-14` resolved *against the header*, not the viewport:

    top: 56px; bottom: 0  →  rect { y: 56, width: 420, height: 0 }

Zero height = no dim, no hit target. `document.elementFromPoint(390, 400)` with
the menu open returned `CG-BOARD` — the chessboard underneath.

The `<aside>` drawer escaped the same trap only by accident: it sets an explicit
`h-[calc(100dvh-3.5rem)]`, so it rendered at full height and looked correct.

## Fix

`createPortal(<backdrop + aside/>, document.body)` — the drawer no longer lives
under the blurred header, so `fixed` resolves against the viewport again. No
style changes; the backdrop still starts at `top-14` on purpose so the navbar
itself (including the ✕ toggle) stays clickable.

## Files
- `v2/apps/web/src/components/Navbar.tsx`

## Verification (live, chessguru.cc, 420x860)
- Before: backdrop rect height 0; click at (390,400) hit `CG-BOARD`.
- After: backdrop rect height 804; click at (390,400) hits the backdrop, drawer
  unmounts, hamburger `aria-label` returns to "Open menu".
- Web `tsc --noEmit` at its 101-error baseline; 7/7 vitest tests pass.

## Note for future work
Any other `position: fixed` child of a `backdrop-blur` container has this bug.
Portal such overlays to `document.body`.
