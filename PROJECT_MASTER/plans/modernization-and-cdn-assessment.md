# Plan: stack modernization & CDN self-hosting assessment

**Status:** ASSESSMENT / PROPOSED (2026-05-29) — not started; needs owner OK to action.

## Current state (honest)
**Backend — modern/current:** Node 20, Express 5, Mongoose 9, MongoDB 7, Redis. Fine.

**Frontend — dated & inconsistent:**
- Plain HTML files with large inline `<script>`/`<style>`. **No bundler, no build step, no
  TypeScript, no linter, no tests.**
- Two board libraries: `chessground` (Puzzles/Blindfold/Theme) vs `chessboard.js` + **jQuery**
  (Opening, Engine Battle).
- Three `chess.js` versions in use: 1.x (puzzle pages), 0.12.0 (opening), 0.10.3 (board editor).
- Consequence demonstrated 2026-05-29: a single missing `}` made `/opening` fail to parse and the
  whole page broke — nothing caught it before deploy.

## Asset hosting (CDN dependency)
- **Self-hosted (good):** puzzle pages — `/js/chess.min.js`, `/js/chessground.min.js`, `/pieces/`,
  client Stockfish `/js/sf/`.
- **External CDN (fragile):** `opening.html` + `engine_battle.html` load jQuery, chessboard.js,
  chess.js from `cdnjs.cloudflare.com`. Also external: `explorer.lichess.ovh` (client-side,
  per-visitor — OK), `fen2image.chessvision.ai` (admin thumbnails).
- Risk: if cdnjs is unreachable, Opening/Engine Battle break.

## Proposed steps (incremental, low-risk first)
1. **Vendor the CDN libs** into `/js/` (jQuery, chessboard.js, chess.js) and repoint the 2 pages →
   no CDN dependency. (Quick, safe.)
2. **Add a linter / syntax-check** (even a simple `node --check` pre-deploy hook, or ESLint) so a
   stray brace can't ship. (Quick, high value — would have caught the /opening bug.)
3. Consolidate to **one board library** and **one chess.js version** across pages. (Medium.)
4. Optional larger: introduce a build step / framework (e.g. Vite + a light framework) and
   TypeScript; add a test harness. (Large — only if the app keeps growing.)

## Notes
- Cross-ref: known-issues register (`knowledge/10-known-issues-and-risks.md`) and frontend doc
  (`knowledge/06-frontend.md`).
- Do steps via the test-page / safe-change rules; each step = its own commit + session note.
