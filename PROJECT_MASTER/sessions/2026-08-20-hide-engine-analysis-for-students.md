---
date: 2026-08-20
topic: Hide engine analysis panel for students in Puzzle Trainer
---

# What

Owner ask: "students can't use engine analysis in puzzle trainer" → "yeah, don't need the engine, remove engine analysis for students".

The `EngineAnalysisPanel` on `/puzzles` was rendered unconditionally (`{g.fen && <EngineAnalysisPanel fen={g.fen} />}`). Owner wants students to NOT see the option; coaches, academy owners, admins and logged-out visitors keep it.

# Files

- `v2/apps/web/src/pages/Puzzles.tsx`
  - Added `useQuery(["auth-me"], api.me)` inside `PuzzlesPage`.
  - Derived `hideEnginePanel = authMe?.loggedIn === true && authMe.role === "student"`.
  - Gated the render: `{g.fen && !hideEnginePanel && <EngineAnalysisPanel fen={g.fen} />}`.

# Verification

- `bash v2/scripts/deploy.sh` — clean build.
- Playwright hit prod as a guest: engine panel visible, checkbox works, engine loaded to depth 22 with top-3 lines.
- First attempt put the hook inside `SuggestedThemesRow`, causing a ReferenceError in the deployed bundle (`hideEnginePanel is not defined`). Fixed by moving the hook into `PuzzlesPage`, rebuilt, redeployed, retested.
- Gate logic:
  - Student (`loggedIn:true, role:"student"`) → `hideEnginePanel === true` → panel hidden.
  - Coach / academy_owner / admin → `role !== "student"` → panel shown.
  - Guest (no session) → `loggedIn` falsy → panel shown.

# Open items

- None. Owner may later choose to hide it from guests too — trivial follow-up (drop the `loggedIn === true` clause and gate on `role !== "student"`).
