# 2026-09-07 — Play: verified identity, abort, claim-on-abandon, resume, seek countdown

Owner: *"let's continue chess guru, play build"*. Picked up the open items from
[play-bot ladder shipped](2026-09-07-play-bot-ladder-shipped.md) that did not need the owner's
call, plus the questions asked mid-session (pairing, bot ratings, names, "will there be an
animation so the user doesn't leave").

## What landed (all LIVE on chessguru.cc / harinitharanjith.com)

**Gateway identity — the security hole is closed.** `apps/ws/src/identity.ts`: the `cgsid`
cookie on the WebSocket upgrade is looked up in Mongo `sessions` (same rule as the API's
video-signal WS) → `u:<userId>`. Signed-out visitors are `g:<guest>`; a guest cannot smuggle a
`u:` prefix. The bot proves itself with `play:bot:key`, a secret minted into Redis with SET NX
by whichever of gateway / play-bot boots first, and is seated as `u:<name>` so it stays
indistinguishable on the wire. `hello.token` is honoured only under `PLAY_TRUST_TOKENS=1`, which
the M1–M5 harness scripts now set and production never does. `hello-ok` returns `userId`.

**Abort.** Either side, while fewer than two moves exist → `game-end` reason `aborted`, result
`*`, no `live_games` row, nothing rated. The Play page shows *Abort* instead of *Resign* until
move two.

**Abandonment → claim.** The gateway sends the engine a `leave` when a user's *last* socket on a
game closes (a second tab keeps them present). The grain records `gone[color]`, broadcasts
`presence`, and the opponent may `claim` after `abandonGraceMs(tc)` = clamp(initial/10, 15s,
60s): 1+0 → 15s, 3+2 → 30s, 10+0 → 60s. Result: the present player wins, status `abandoned`,
archived. Coming back (any `sub`/`resync`) clears it. `game-state` now carries `gone` + `graceMs`.

**Reconnect + resume.** `LiveClient` reconnects with backoff (1s→15s) and on every open
re-hellos and resyncs the current game. The game id lives in `sessionStorage`, so a refresh
mid-game comes back to the live board with the clocks where the server has them (verified: a
10+0 game reloaded at 8:19 / 9:55 with "Your move"). "Reconnecting…" pill while the socket is down.

**Bot manners.** When the human's socket drops the bot aborts (before two moves, 8–18s later) or
claims a few seconds after the grace period — like a person would. It never vanishes itself.

**Seek wait UI.** Spinner + phase text ("Looking for an opponent…" → "Checking players near your
rating…" → "Almost there — pairing you now…" → "Any moment now…"), "Opponent expected in about
Ns" counting down from 18s, elapsed timer, progress bar, and a *Cancel* button (there was no way
to cancel a seek before). 18s is the bot's outer trigger, so the bar nearly always completes.

**Bot strength now follows the student.** `live_perfs` is empty because every game is unrated,
so every bot had been playing at 1500. The lobby now stamps `skill` on each seek = live rating if
one exists, else the trainer's **puzzle rating** (`userperfs.puzzle.gl.r`, 72 students, median
1587, range 478–3028), else 1500. Pairing between humans still uses the pool rating (1500
default) so two humans keep finding each other instantly; only the bot reads `skill`.

## Verification

| check | result |
|---|---|
| `tsc --noEmit` protocol / ws / game-engine / lobby / bot-player | clean (web has 4 pre-existing Study-page errors, untouched) |
| `bash v2/scripts/run-play-test.sh` — private redis :6390 + Mongo `chessguru_playtest` | **24/24**: forged token → guest; cgsid session → `u:`; wrong bot key → guest; abort (1 move ok, 2 moves `too-late`, no archive); presence → `not-claimable` inside grace → claim wins `abandoned` at 15003ms; resync after reconnect restores ply 2 and clears presence; second tab is not a leave; unseek empties the pool |
| production gateway smoke (`ws://127.0.0.1:18080/ws`) | forged token → `g:`; two guests pair; `game-state.graceMs` 15000; abort → `aborted`; `live_games` unchanged (16) |
| Playwright on chessguru.cc/play as a guest | seek → *Cancel* → "Ready to play"; seek 1+0 → bot `rahul_kulkarni` joined at 15s, *Abort* shown not *Resign*; abort → "Game aborted"; seek 10+0 → `karthik_chandran` at 17.5s → page reload → resumed "Your move" 8:19/9:55 → abort; countdown panel at 2s "about 16s / 12%" and at 8s "about 10s / 46%" |

## Ship

```bash
# services (not symlinked) — engine → gateway → bot order, then lobby+bot again for the skill fallback
sudo rsync -a --delete --chown=ubuntu:ubuntu v2/packages/protocol/src/ /home/ubuntu/chessguru/v2/packages/protocol/src/
for a in ws game-engine bot-player lobby; do sudo rsync -a --delete --chown=ubuntu:ubuntu v2/apps/$a/src/ /home/ubuntu/chessguru/v2/apps/$a/src/; done
sudo rsync -a --chown=ubuntu:ubuntu v2/apps/ws/package.json v2/ecosystem.play.config.cjs v2/pnpm-lock.yaml …
sudo -u ubuntu corepack pnpm install --filter @chessguru/ws --offline     # ws gained mongodb
sudo -u ubuntu pm2 restart ecosystem.play.config.cjs --only play-engine|play-gateway|play-bot|play-lobby --update-env
bash v2/scripts/deploy.sh   # web, twice (second added the seek countdown)
```

Noticed in `pm2.log`: play-bot was SIGINT-restarted at 16:24:56 and 16:27:23 UTC by something
other than this session (another agent or the owner). Not a crash; error log empty.

## Open items

- **`/ws` is proxied only on the main `chessguru` vhost.** Tenant custom domains (gunachess.com
  etc.) and play.chessguru.cc have no `location = /ws`, so online Play cannot connect there.
  Add the block to `regen-guna-vhost.sh` and the tenant vhost template.
- Rated play: purely the owner's decision now. Flipping it needs `Play.tsx` `rated: true` and
  dropping the `!m.rated` filter in `bot-player/main.ts` (bots must still never play rated).
- Opponent rating is not shown on the Play page; a bot would show 1500 for everyone, a tell.
- Test rows from earlier sessions (`live_games` `g-9589ed6f-ed0`, `bot_games` for `u:e2e_ladder`)
  plus today's `bot_games` rows for `g:guest_icku4t` (two aborted games — aborted games write no
  `bot_games` row, so only the earlier ones remain). Delete once the owner OKs.
