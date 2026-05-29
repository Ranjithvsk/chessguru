# Plan: Lichess-exact puzzle feedback UI

**Status:** PENDING (attempted once, reverted — was incomplete/buggy)

## Goal
Replicate Lichess's puzzle feedback block ("Your turn" + hint/solution controls) exactly.

## Target structure (from Lichess `ui/puzzle/src/view/feedback.ts`)
```
div.puzzle__feedback.play
  div.player
    div.no-square → piece.king.{white|black}
    div.instruction
      strong → "Your turn"
      em → "Find the best move for White/Black"
  div.view_solution
    button.button (hint — active = filled green, inactive = .button-empty)
    button.button.button-empty (View the solution)
```

## Approach (MUST follow the test-page workflow — ADR-0005)
1. Build `public/test/feedback-ui.html` (the `public/test/` dir doesn't exist yet — create it).
2. Implement `piece.king.white/black`, the hint button states, and exact CSS.
3. Confirm zero bugs with Ranjith.
4. Only then merge into `index.html` **and** `blindfold.html`.
5. Git-commit after the merge.

## History
A direct edit to the `index.html` feedback block was attempted and **reverted** because it was
incomplete and broke the page — the reason ADR-0005 exists.
