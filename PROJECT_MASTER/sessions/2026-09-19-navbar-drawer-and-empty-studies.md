# 2026-09-19 — Drawer opens late on gunachess.com; empty studies in the owner's notebook

**Drawer.** Measured headless on a 4× CPU-throttled mobile profile: first open ~600 ms, later
opens ~140 ms. Cause: the left drawer was portalled only while open, so every tap mounted the
whole menu, and the overlay painted a full-screen `backdrop-blur-sm`. Fix (Navbar.tsx): the
drawer + overlay are always mounted and toggled with `translate-x` / opacity (150 ms), no blur;
`aria-hidden` + `pointer-events-none` when closed. Pathname-close and body-scroll-lock unchanged.

**Empty studies.** `studies` for owner `gunachess` had 8 entries whose every chapter held 0 moves —
auto-created from book chapters / game awards and never filled (Build Up Your Chess Ch 1 twice,
Mastering Checkmates Ch 1, Middlegame Strategies Ch 1, Best Play Ch 1, Guna Anna Tips Ch 1,
Dvoretsky notes, 🎯 Game awards ×6 chapters). Moved to `studies_trash` / `studyChapters_trash`
(`trashedBy: owner-request-2026-09-19`) — reversible; "Fork mastery — Ch1 notes" (15 moves) kept.
Other users have similar empties (e.g. Harinitha's two "Triangulation"); not touched.
Root cause to fix next: the book reader / awards create a study before the user adds anything.
