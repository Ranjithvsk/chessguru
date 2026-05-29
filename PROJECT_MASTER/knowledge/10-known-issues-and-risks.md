# ChessGuru — Known Issues, Bugs & Risks

Consolidated from a full code read on 2026-05-29. Ordered by severity. None of these were *changed*
— this is a register of what exists. Verify against code before acting.

## 🔴 Security (treat as priority)

1. **Committed live Lichess API token.** `book_game_runner.js` hardcodes a personal token
   (`const TOKEN='lip_…'`) sent as a Bearer to the Lichess explorer. It is in git history.
   **Action:** revoke it on lichess.org, reissue, move to `.env` (`LICHESS_TOKEN` already exists for
   the runtime), and scrub if feasible.
2. **Unauthenticated privileged endpoints** (all under `/api`, guarded only by the 60/min limiter —
   **no admin check**):
   - `POST /api/status/extractor/start` and `/stop` **run shell commands** (`exec`/`pkill`).
   - `POST /api/status/extractor/start-game` spawns depth-50 Stockfish analysis (CPU DoS lever).
   - `POST /api/status/puzzles/:id/quality` with `quality:'bad'` **deletes** a puzzle.
   - `POST /api/generated/puzzles/:id/{approve,reject}` mutate the catalog.
   The `/status`, `/puzzle-status`, `/engine-battle`, `/board-editor`, `/terminal` pages are served
   without auth too. **Action:** put these behind an admin role / network restriction / Cloudflare
   Access.
3. **External shell via `/terminal`.** `terminal.html` embeds `https://term.harinitharanjith.com`
   behind only a *client-side* `/auth/me` check (bypassable by opening that host directly). Real
   protection must be Cloudflare Access on that host — confirm it is enforced. Iframe sandbox is
   permissive (`allow-same-origin allow-scripts`) + clipboard read/write.
4. **Stored XSS on the admin dashboards.** `puzzle-status.html` (and partly `extraction-live.html`)
   interpolate puzzle/game fields (`whiteName`, `blackName`, `themes`, `fen`, `_id`) and full puzzle
   JSON into `innerHTML` and inline `onclick` handlers **without escaping** (only log lines use
   `escHtml`). Engine/game-derived strings flow straight in. **Action:** escape on render.
5. **Hardcoded session secret + insecure cookie.** `SESSION_SECRET` falls back to
   `'cg_super_secret_2026'`; session `cookie.secure:false`. **Action:** set a real `SESSION_SECRET`
   in `.env`; set `secure:true` (TLS terminates at nginx — also needs `trust proxy`, already set).
6. **Wide-open CORS** (`origin:true, credentials:true`) with cookie auth and **no CSRF tokens** →
   state-changing POSTs are CSRF-reachable. **Action:** restrict origins or add CSRF protection.
7. **Server paths leaked** to clients (`/home/ubuntu/engines/stockfish` in board_editor.html) —
   minor info disclosure.

## 🟠 Correctness bugs

8. **Extractor drops `source`/`status`.** `puzzle_extractor.js` sets `source:'generated'` and
   `status:'pending'`, but `puzzleSchema` doesn't declare them, so Mongoose **silently discards**
   them; `verified` is always `true`. Net effect: the `/api/generated/*` review/approval workflow
   has no real pending gate for extractor output. **Action:** add the fields (or `strict:false`).
9. **Extractor FEN/solution alignment.** `fen = prevFen` (pre-blunder) while `solution[0]` is the
   blunder move prepended to a PV computed *after* the blunder — FEN, blunder move, and refutation
   may not line up. Likely should be the post-blunder FEN with `solution = verifiedMoves`. **Verify
   a sample of `cg_*` puzzles actually solve correctly** before trusting generated content.
10. **Opponent replies not re-verified** in extractor solutions (deliberate perf trade-off) → some
    "solutions" may not be uniquely forced.
11. **Runner dedupe collapses the Stockfish ladders.** `engine_runner.loadEngines()` dedups by
    binary path, so all `binary:"stockfish"` UCI_Elo/Skill entries become one engine. The intended
    `sf_limited` type doesn't exist in `engines.json`.
12. **`engine_updater.saveRegistry()` references `registry.meta`**, which `engines.json` lacks →
    `TypeError` on write. And no engine has download-source fields, so it can only ever update Maia
    weights.
13. **Maia is non-functional everywhere** — no `lc0` binary on disk, and the runner never sends
    Maia `uciOptions.WeightsFile`.
14. **index.html rating bugs:** repeated wrong moves each POST a loss (no dedup; `theme.html` fixes
    this with `_submittedFalse`); `viewSolution()` never `submit()`s and never sets `solved=true`.
15. **opening.html move-table clicks broken** — `data-uci=""+mv.uci+"` emits an empty attribute, so
    clicking explorer moves is a no-op (dragging still works).
16. **blindfold.html invalid markup** — a duplicate `#userWidget` + `<script>` sits *after*
    `</html>`; it targets a nonexistent `#myRating` (real id is `#myRat`) and shows `userId` instead
    of `username`; `THEMES` is declared twice.
17. **Move correctness is exact-UCI matching**, not position equality — legitimate alternative
    winning moves are rejected as "Not the best." (Matches Lichess single-line puzzles, but worth
    knowing.)
18. **Glicko seeding inconsistency** — logged-in users are seeded `d:200` (index/theme) vs the
    `d:500` default; blindfold uses `d:500`. Different deviations → different update aggressiveness
    by entry path. The complete-response also hardcodes `d:200`.

## 🟡 Data-quality / tagging

19. **`cook.clearance` is a stub returning `true`** → nearly every generated puzzle is tagged
    `clearance`. `zugzwang` ≈ "≤3 legal moves". Most mate-pattern detectors check piece *presence*,
    not geometry (`doubleBishopMate`===`bodenMate`, `morphysMate`===`operaMate`,
    `killBoxMate`===`cornerMate`); `deflection` over-tags. Treat engine-generated theme tags as
    approximate.
20. **Hardcoded "vs Lichess" quality metrics** in `/api/status/puzzles` and `puzzle-status.html`
    (`uniquePct:97`, `avgDepth:50`, the parity table) are static literals, not measured.
21. **Win-chance formula drift in docs/UI** — `extraction-live.html` shows the sigmoid form,
    `puzzle-status.html` shows an arctan form; the backend uses the sigmoid. Cosmetic.
22. **Duplicate-cased Mongo collection** `piecePools` (590) vs `piecepools` (0) — drop the empty one.

## 🟢 Performance / cleanliness

23. **`_getNextForUser` dedup uses `$where`** (server-side JS predicate per doc) — slow at scale;
    replace with an indexed key check.
24. **Extractor spawns a Stockfish process per position** (the persistent instance is vestigial) —
    runtime is spawn-bound.
25. **Duplicate/superseded scripts** — see [07-pools](07-pools-and-maintenance-scripts.md) and
    [plans/code-cleanup](../plans/code-cleanup.md).
26. **`module.exports = router` precedes ~220 lines of route registrations** in routes.js — works
    only because the export is a shared reference; fragile.

---

_This register is descriptive, not a work order. Pick fixes via the test-page / safe-change rules in
[03-rules-and-gotchas](03-rules-and-gotchas.md). The 🔴 security items are the ones worth raising
with the owner first._
