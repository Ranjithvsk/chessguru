# Session 2026-05-30 — online-play plan: full Lichess map appendix

**What:** Expanded `plans/online-play-international.md` with **Appendix A — the complete Lichess map**,
so the international realtime roadmap is measured against 100% of what Lichess actually is, not a guess.

**Why:** Owner asked to "add more ideas — read 100% of the Lichess idea." The original plan covered the
realtime architecture well but only sampled the feature/repo surface. This pins down the whole target.

**Added (Appendix A1–A5):**
- **A1** — the full ~40-repo `lichess-org` ecosystem (core / realtime+edge / analysis / competitive /
  anti-cheat / data-dev-docs / mobile), each with a ChessGuru reuse-or-build stance. Confirmed from
  lichess.org/source + the GitHub org (read 2026-05-30).
- **A2** — complete user-facing feature catalog, tagged `[done]`/`[plan]`/`[gap]`. Surfaced the gaps:
  Storm/Racer/Streak, Studies, Broadcasts, Simuls, Insights, Teams+team-battles, TV, search, tablebase,
  web push, i18n, 2FA/GDPR, accessibility, OAuth/Bot-API, mod tools.
- **A3** — 7 lila patterns to copy verbatim (single-writer game actor, Redis-pubsub coordination,
  read-tier offload, bit-compression storage, queue+worker analysis, stateless-edge/stateful-core,
  offline batch anti-cheat).
- **A4** — folds the gaps into §12 phasing. Key call: **Puzzle Storm/Racer/Streak first** — ships value
  on our existing 5.9M-puzzle DB with no realtime engine needed; then vs-Stockfish / challenge-a-friend
  as a lower-stakes exercise of the realtime core.
- **A5** — 5 more open decisions (chessops vs chess.js, studies data model, i18n-now-vs-later,
  Flutter vs RN, explicit v1 OUT-of-scope list).

**Files:** `PROJECT_MASTER/plans/online-play-international.md` (appended; now 307 lines).

**Verification:** doc-only change; no code touched. Plan still PROPOSED — §10 infra/budget remains the blocker.

**Open items:** owner to decide A5 + the original §14 decisions; nothing built yet.
