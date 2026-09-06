# 2026-09-06 — Play board was unmovable; clock now ticks smoothly

Owner report: *"opponent played 1st move i can't play why..?"* — after matching with the
bot, the board refused every move. Followed by *"click [clock] should be changing in one
second, and in last 10 seconds also milli second change should be visible."*

## What was wrong

Three independent defects, all in `apps/web/src/components/Board.tsx`, all rooted in the
same chessground behaviour: **chessground binds its input listeners only while
`state.viewOnly` is false, and only at bind time.** Bind time is `Chessground()` and
`redrawAll()`. Nothing re-binds later.

1. **Dead on arrival.** `Play.tsx` renders `<Board viewOnly={!playing} />`, so the board is
   constructed while `viewOnly` is `true` (status `connecting`/`idle`). `bindBoard()` and
   `bindDocument()` both early-return, and the board stays inert for the whole game even
   once `viewOnly` flips to `false`. Every React prop and every field of chessground's own
   state reads correct — which is why this was invisible from the outside.

2. **Dead again on the orientation flip (black games only).** `api.set({ orientation })`
   calls `toggleOrientation()` → `redrawAll()`, which does `element.innerHTML = ""`,
   creates a fresh `cg-board`, and re-runs `bindBoard()`. At that instant `state.viewOnly`
   is still `true` — `configure()` applies the new value *later in the same `set()`*. So
   fix 1 held for white but not for black: the pre-game board was live, and the flip to
   black-at-bottom killed it.

3. **Clicks landed one rank off.** chessground memoises the board rect and only invalidates
   it on document scroll, window resize, and its own `ResizeObserver` on the wrap. None of
   those fire when the board is *moved* without being *resized*, which is what the Play
   layout does when the seek panel collapses. The cached rect read 74px too high, so a
   click on e2 resolved to e1 and the move was silently rejected as illegal.

## Fixes

- Construct chessground with `viewOnly: false`, then `api.set({ viewOnly })` immediately
  after. The handlers re-check `s.viewOnly` on every event, so spectator boards stay inert.
- Set `api.current.state.viewOnly = false` before the sync `api.set()` in effect 2, so any
  `redrawAll()` it triggers binds against a live board.
- `manipulable` (the `cursor: pointer` class) is applied by chessground only at
  construction/redraw, so it is toggled by hand in both places to match the real `viewOnly`.
- Clear the rect memo on capture-phase `mousedown`/`touchstart` at the document level —
  one `getBoundingClientRect()` per interaction, always fresh.

Clock (`apps/web/src/hooks/usePlay.ts`, `apps/web/src/pages/Play.tsx`): the server
broadcasts every `CLOCK_TICK_MS = 2000`, so the raw value visibly jumped. Keep the
authoritative snapshot plus its arrival time and interpolate locally on a 50ms interval;
each broadcast re-anchors, so drift cannot accumulate. Only the side to move counts down.
`fmtClock` switches to `S.hh` under 10 seconds.

## Files

- `v2/apps/web/src/components/Board.tsx`
- `v2/apps/web/src/hooks/usePlay.ts`
- `v2/apps/web/src/pages/Play.tsx`
- `v2/apps/web/public/sw.js` (VERSION stamp, written by `scripts/deploy.sh`)

## Verification

Played real games against the bot through `https://chessguru.cc/play`:

- **White**: `1. e4` accepted, bot replied `e5`.
- **Black** (the case fix 2 addresses): bot opened `1. e4`; drag `e7-e5` and `b8-c6` both
  landed, click-to-move `f8-c5` landed, reaching `1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3`.
- Clock sampled at 250ms: `9:27 → 9:21` one second at a time, opponent frozen at `9:52`
  while it was my move. Sampled at 90ms under 10s: `9.74, 9.64, 9.54 … 7.99`.
- Bot names differed every game (`deepak_patel`, `ramya_nair`, `nikhil_kumar`,
  `manoj_murthy`, `sandeep_kumar`, `swathi_iyer`, `harish_sundar`) and both colours came up.

## Open items

- Test rows to clean up once the owner OKs: `live_games` `g-b3af1586-ab5`, `g-485b1658-cee`,
  `g-2b4c2f65-1eb`, `g-7b37109a-73d`, `g-2a365718-850` plus this session's, and their
  `bot_games` rows. All `rated: false`.
- `/home/ubuntu/chessguru`'s git origin URL contains a plaintext GitHub PAT, and that clone
  has ~376 dirty files. Needs rotating.
- Consider symlinking `apps/{ws,lobby,game-engine,bot-player}/src` from the ubuntu clone to
  this one, matching the existing api/web pattern, so the play services can't drift.
