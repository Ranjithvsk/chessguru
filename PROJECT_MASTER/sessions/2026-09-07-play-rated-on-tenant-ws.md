# 2026-09-07 — Play: rated ON (bots included), /ws on every tenant domain

Owner: *"add /ws to gunachess.com and tenant domains too, rated for bot also"*. Follow-on to
[play identity / abort / claim](2026-09-07-play-identity-abort-claim.md).

## `/ws` on tenant domains

`location = /ws` → `127.0.0.1:18080` was only in the main `chessguru` vhost, so online Play could
not connect from gunachess.com (or results.chessguru.cc). Added, with nginx reload, to:

- `/etc/nginx/coach-domains/gunachess.com.conf` (live tenant) — backup `*.bak-ws-<ts>` beside it
- `/etc/nginx/sites-enabled/chessguru-results`
- the generator templates `academy-domain.service.ts::buildNginxConf` and
  `coach-domain.service.ts` (new custom domains get it automatically), API rebuilt in the ubuntu
  clone and `chessguru-v2-api` restarted at 16:57 UTC with zero live class sockets
- `scripts/regen-guna-vhost.sh`

Verified: `wss://gunachess.com/ws` and `wss://results.chessguru.cc/ws` both answer `hello-ok`.

## Rated play

- **Web** `Play.tsx`: quick pairing and challenge links seek **rated by default**; a Rated /
  Casual toggle for signed-in users, "Sign in for rated games" for guests; a Rated/Casual label
  on the game and the rating change ("Rating +12") on the result. `usePlay` exposes `rated` and
  `ratingDiff` (from `game-end`).
- **Lobby**: `canRate(by)` — only `u:` accounts can be rated; a guest's rated seek or challenge is
  silently casual, so a "rated" game can never be one the engine refuses to rate.
- **Bot**: answers rated and casual seeks alike, and seeks with the **same rated flag** as the
  seek it answers (pools are keyed by it — a casual bot seek could never meet a rated human).
  Before a rated game `stampRating()` upserts the bot's `live_perfs[speed]` to the skill it will
  play at (`gl.r = skill, d = 80, nb = 25`), so Glicko treats it as an established player at
  exactly that level and the student's update is fair. The engine's own post-game update drifts
  it; it is re-stamped every game. `bot_games` rows now carry `rated`.
- Engine unchanged: it already rated any finished game with both seats `u:`; aborted games are
  never rated or archived.

## Verification

| check | result |
|---|---|
| `bash v2/scripts/run-play-test.sh` | **28/28** — the 24 from earlier plus T7: two cookie-authenticated accounts seeking rated get `rated: true`, resign → `ratingDiff {white:+242, black:-242}`, `live_perfs.bullet` 1742 / 1258; guests asking for rated are paired casual |
| production smoke (temporary `sessions` row for `e2e_rated`, deleted afterwards) | identity `u:e2e_rated`; rated 1+0 seek → `rohan_kulkarni` in 15.8s, `matched.rated: true`, `game-state.rated: true`; bot's `live_perfs.bullet` stamped `{r:1500,d:80}`; abort → no rating, no archive, `live_games` still 16 |
| `wss://gunachess.com/ws` | `hello-ok` |

## Harness landmine found on the way

The cluster test failed three runs in a row with the lobby pairing a seeker **with itself**. Cause:
`tsx` forks a node child that survives `kill` of its parent; an orphaned lobby from the previous
run reconnected to the new run's redis and processed every seek a second time. `run-play-test.sh`
now `pkill -u $(id -un)`s play processes before and after (never touching `ubuntu`'s production
ones), and the lobby logs every seek + sweep decision (`[lobby] seek …`, `[lobby] sweep …`), the
gateway every hello (`[ws gw1] hello <conn> → <userId>`).

## Open

- No classical time control in the quick-pairing menu (1+0, 3+2, 5+3, 10+0 only), so the
  classical rating can only move through challenge links.
- The Play page still does not show either player's rating.
- Bot names now accumulate `live_perfs` rows (one per name that played rated) — expected, they
  make the names look like real accounts; nothing reads them except the engine.
