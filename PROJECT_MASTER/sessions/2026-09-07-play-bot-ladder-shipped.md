# 2026-09-07 — Play bot now picks from the lc0 + Maia-1 ladder (shipped)

Follow-on from [lc0 + Maia-1 install](2026-09-07-lc0-maia1-install.md). Owner: *"commit the
ladder and ship it to the ubuntu clone"*.

## What landed

- **Commit `e94b90e`** `feat(play-bot): pick the opponent from an lc0 + Maia-1 strength ladder`
  — `apps/bot-player/src/{engines,uci,smoke}.ts` new; `engine.ts`, `main.ts`, `session.ts`
  reworked; `pnpm-lock.yaml` gains the bot-player workspace entry it was missing.
- `EnginePool` keyed by engine spec, reaped every 60s when idle. Primary = nearest Maia-1 net
  (1100–1900) via lc0 `--backend=eigen`, `go nodes 1` only. 25% variety draw
  (`BOT_VARIETY_CHANCE`): Maia-3 inside 1130–1690, weak plain UCI engines + Elo-capped
  Stockfish at 1700–2100, Stockfish alone above 2100.
- Maia-1 plays argmax and only breaks near-ties (`TIE_RATIO` 0.8). Full-distribution sampling
  is deliberately not done — it would drop a net below its own band.
- `bot_games` rows record `engine` (e.g. `maia1-1500`) instead of `selfElo`.

## Ship

The play services are not symlinked to the dreamworld clone, so this was an rsync:

```bash
sudo rsync -a --delete --chown=ubuntu:ubuntu v2/apps/bot-player/src/ /home/ubuntu/chessguru/v2/apps/bot-player/src/
sudo rsync -a --chown=ubuntu:ubuntu v2/apps/bot-player/package.json /home/ubuntu/chessguru/v2/apps/bot-player/
sudo -u ubuntu env HF_HOME=/home/ubuntu/.cache/huggingface HF_HUB_OFFLINE=1 bash -c 'cd /home/ubuntu/chessguru/v2 && corepack pnpm --filter @chessguru/bot-player smoke'
sudo -u ubuntu pm2 restart play-bot --update-env   # 16:05 UTC, no game in progress
```

No new npm dependency, so no install on the ubuntu side. `ecosystem.play.config.cjs` is
unchanged — every new path (`LC0_BIN`, `MAIA1_WEIGHTS`, `ENGINE_SRC`) defaults to
`/home/dreamworld/opt/engines/…`, which the ubuntu user can traverse and execute.

## Verification

| check | result |
|---|---|
| `tsc --noEmit` (dreamworld clone) | clean |
| `pnpm smoke` as dreamworld and again as **ubuntu** from the ubuntu clone | all 9 Maia-1 levels, 5 variety engines, Stockfish and Maia-3 answer with legal moves; 1500+ always play Nxd4 in the Blackburne trap, 1100–1400 split ≈ 50/50 on the near-tie |
| `pm2 restart play-bot` | `[bot] up — 720 names`; warmup spawned one lc0 `maia-1500.pb.gz` process; error log empty |
| live seek through the gateway (`ws://127.0.0.1:18080/ws`, 1+0 unrated, user `e2e_ladder`) | matched after 13s to `manoj_raman` on **`maia1-1500`**; bot answered random white moves with d5, Nc6, Bg4, Bxf3 within 0.4s each; game recorded in `bot_games` with `engine: "maia1-1500"` |

## Open items

- Test rows from this check, both `rated: false`: `live_games` `g-9589ed6f-ed0` and the
  `bot_games` row with `opponent: "u:e2e_ladder"`. Delete with the earlier ones once the owner
  OKs.
- Rated play is still off (`Play.tsx` seeks `rated: false`; `main.ts` filters `!m.rated`).
  The Maia-1 ladder removes the calibration gate, so flipping it is now an owner decision —
  but see the next item first.
- **Gateway `hello` trusts the token as the userId** (`apps/ws/src/router.ts:126` —
  `u:${msg.d.token}` with no verification). Anyone can seek as any user. Harmless while
  everything is unrated; must be fixed before rated go-live.
- Bot abort / disconnect behaviour is still not implemented.
- The variety engines and lc0 live under `/home/dreamworld/opt/engines`, a cross-user
  dependency like the Maia-3 venv. If that tree moves, `play-bot` warmup logs
  `[bot] warmup:` and every seek falls back to Maia-3 or fails.
