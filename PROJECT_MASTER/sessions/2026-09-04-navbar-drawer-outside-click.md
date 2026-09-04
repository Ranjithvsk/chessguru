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

## Codebase-wide audit for the same bug

Owner: "check the same issue in other places also".

**Result: Navbar was the only real instance.**

A source audit flagged nine more overlays in Dream Meet — `AudiencePickerModal`,
`SendPositionModal`, `TeachOpeningModal`, `PositionEditorModal`, `ChatToastStack`,
`ChallengeMarkToastHost`, `ChallengeRibbon`, `StudentAnswerReviewRibbon`,
`ChallengeScratchpad` — all nested inside `ClassV2.tsx:2389`:

    <div className="relative flex min-h-0 flex-1 ..." style={{ containerType: 'size' }}>

The reasoning was that `container-type: size` applies `contain: size layout style`,
and layout containment creates a containing block for `fixed` descendants.

**That is wrong in practice.** Measured directly in Chrome 153 — a 300x200 host
with a `position:fixed; inset:0` child:

| host style | fixed child size | traps? |
|---|---|---|
| (none) | 420x860 (viewport) | no |
| `container-type: size` | 420x860 | **no** |
| `container-type: inline-size` | 420x860 | **no** |
| `backdrop-filter: blur(8px)` | 300x200 | yes |
| `transform: translateX(0)` | 300x200 | yes |
| `filter: blur(1px)` | 300x200 | yes |
| `contain: layout` | 300x200 | yes |
| `contain: paint` | 300x200 | yes |
| `will-change: transform` | 300x200 | yes |

`container-type` does NOT create a containing block for fixed descendants, even
though explicit `contain: layout` does. Note `getComputedStyle(el).contain` stays
`"none"` under `container-type`, so a `contain`-based check correctly skips it.

No changes made to ClassV2/SharedClassBoard — the Dream Meet modals are fine.

### The predicate to use
Only these ancestor properties trap `fixed` descendants: `transform`, `filter`,
`backdrop-filter`, `perspective`, `contain: layout|paint|strict|content`,
`will-change: transform|filter|perspective`.

### Runtime sweep
Ran that predicate over the live DOM of `/` and `/signup-academy` after the
Navbar fix: zero trapped elements. A static pass over the remaining ~29
`fixed inset-0` modals found them under plain flex/grid/card ancestors. All four
`createPortal` call sites (`Navbar`, `History`, `ClassV2` x2) target
`document.body` correctly.

### Untested
Only Chrome 153 was measured. If Safari/Firefox ever do treat `container-type` as
a containing block, the nine Dream Meet overlays above are where it would show —
worth one look at an open Dream Meet modal on an iPhone.
