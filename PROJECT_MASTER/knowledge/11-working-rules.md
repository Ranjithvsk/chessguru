# ChessGuru — Working Rules (commit & documentation discipline)

These are the standing rules for anyone (human or AI) working on ChessGuru. Set 2026-05-29 by the
owner. They sit alongside [03-rules-and-gotchas](03-rules-and-gotchas.md) and the ADRs.

## 1. After every change: session note + commit
Each time you make a change (a fix, a feature, a config/ops change):
1. **Write a session note** in `PROJECT_MASTER/sessions/` named `YYYY-MM-DD-<short-topic>.md` —
   what changed, why, which files, how it was verified, and anything left open. (Append to the
   day's note if you make several related changes.)
2. **Commit it** to git. Keep the working tree from drifting — don't let changes pile up
   uncommitted. Small, scoped commits are preferred.

## 2. All ideas go in this folder
Every idea, plan, design, proposal, or decision — **write it into `PROJECT_MASTER/`**, don't leave
it only in a chat or in your head:
- Ideas / plans / proposals → `PROJECT_MASTER/plans/` (one file per idea; mark status:
  IDEA / PROPOSED / APPROVED / WIP / SHIPPED / DROPPED).
- Decisions with lasting consequences → `PROJECT_MASTER/decisions/` as an ADR.
- Reusable knowledge → `PROJECT_MASTER/knowledge/`.
- Then add it to `INDEX.md` so it's findable.

## 3. How to commit safely (this repo)
- The repo is owned by the `ubuntu` user. Run git **as ubuntu**:
  `sudo -u ubuntu git -C /home/ubuntu/chessguru <cmd>` (so authorship/ownership stay correct).
- **Scope every commit explicitly** — `git add <exact paths>` then `git commit -- <exact paths>`.
  The tree often contains unrelated in-progress changes from other work; never `git add -A`/`git add .`.
- Commit message style (matches existing history): `type: summary` — e.g. `fix(ui): …`,
  `feat: …`, `docs: …`, `chore: …`.

## 4. Don't skip the safety rules already in force
- **Test-page workflow** for frontend features ([ADR-0005](decisions/ADR-0005-test-page-workflow.md)):
  build in `public/test/` first, confirm, then merge to production — never hand-edit a live page as
  the first step.
- This is a **live production app**; prefer additive, reversible changes; verify before/after
  (e.g. `curl localhost:3000/api/health`, or a browser check for UI).
- Back up a file before overwriting it (drop a copy in `archive/`), since the move is reversible.

## TL;DR
**Change → session note → commit. Every idea → a file in `PROJECT_MASTER/`.**
