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

## Follow-up — all users cleaned, creation fixed
- Trashed 21 more truly-blank studies older than 24 h (no moves, standard start position, no
  headers/tags) across chess-guru (5), Guna (10), Shriguru (6) → `studies_trash` /
  `studyChapters_trash`, `trashedBy: empty-sweep-2026-09-19`. Position-only puzzle studies
  (custom FEN, e.g. "Puzzle #DcmTO") were kept — a saved position is content.
- `studies.service.ts create()`: if the user already owns a blank study with the same title and
  source (book + chapter, or intent when there is no source) the request lands in it
  (`reused: true`) instead of creating a twin. Requests carrying a PGN or a custom position
  always create.
- `studies/empty-study-sweep.service.ts`: daily (first run 5 min after boot) moves blank studies
  older than 48 h to the trash collections; logs `[empty-study-sweep] scanned N, trashed M`.
