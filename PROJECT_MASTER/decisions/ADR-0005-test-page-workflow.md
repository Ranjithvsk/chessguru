# ADR-0005: New features ship via `public/test/` pages first

**Status:** Accepted (but not currently followed) · **Date:** 2026-04-25 (documented 2026-05-29)

## Context
Editing the production `index.html` / `blindfold.html` directly left the live page broken on more
than one occasion (partial edits, no staging). There is no build step and no test framework, so a
bad edit is immediately live.

## Decision
Every new frontend feature is built and verified in a throwaway page under `public/test/` first:

1. Build `public/test/feature-name.html`.
2. Test fully; confirm zero bugs.
3. Only then merge into production `index.html` / `blindfold.html`.
4. Git-commit after each successful merge.

## Consequences
- Production HTML is never the first place a feature is written.
- **Current gap (2026-05-29):** the `public/test/` directory does not exist. Create it before the
  next feature. The Lichess-exact feedback UI (see plans/) is the first candidate to follow this.
