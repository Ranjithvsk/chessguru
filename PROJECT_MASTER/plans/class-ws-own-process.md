# Plan — move class-ws (and video signalling) out of the API process

_Owner, 2026-09-10: "OK THE MOVE IT, MAKE SURE ANY CHANGES SHOULD NOT DISTURB
LIVE CLASS FOR STUDENTS OR COACH."_

## Why

`main.ts:173` attaches the class WebSocket bus to **the same http.Server Nest
listens on**, and `class-ws.ts:324` keeps room state in a plain
`const rooms = new Map()`. So restarting the API to ship *anything* — a book
endpoint, a puzzle fix — tears down every class socket in progress.

That is what forced tonight's book-correction deploy to wait on a "is any class
live?" check. It should never have to.

## What already protects a class (do not rebuild these)

Both were added after real incidents and both are what make this migration safe:

- **Board state persists.** `classBoardState` in Mongo, debounced 1s, restored by
  `restoreRoomFromDb()` when a room is recreated: fen, move tree, cursor, arrows,
  orientation, coach token.
- **Clients reconnect themselves.** `SharedClassBoard.tsx:841` — exponential
  backoff 500ms → 15s cap, a 20s heartbeat, and an immediate reconnect on
  `visibilitychange`.

So a restart today is survivable; it is just *unnecessary*.

## Target

| | now | after |
|---|---|---|
| class-ws | inside `chessguru-v2-api` :4000 | `chessguru-class-ws` :4100 |
| video signalling | inside `chessguru-v2-api` :4000 | same new process |
| API deploys | drop every class socket | touch no class at all |

Video moves too. Leaving it behind would mean an API restart still kills the
video half of a live class, which defeats the point.

## The one real hazard: SPLIT BRAIN

Room state is in-memory *and* mirrored to Mongo. If the old process and the new
one both serve the same class for even a moment, both hold a `Room`, both write
`classBoardState`, and last-write-wins silently discards a coach's moves.

Mitigations, in order:

1. **Cut over with no class live.** Verified by zero established WS connections
   AND no `class-ws.hello` in the log for the preceding hour.
2. **nginx switch is atomic per new connection.** `reload` does not drop
   established upgrades, so the drain is natural: existing sockets finish on
   :4000, new ones land on :4100.
3. **Remove `attachClassWs` from the API only AFTER the new process serves all
   traffic** — never in the same step as the nginx switch.

## Steps

1. `apps/api/src/class-ws-main.ts` — minimal entry. **Must not import
   AppModule**: eight services carry `@Cron`/`setInterval` (fees reminders,
   streak nudges, digests, abandoned-class sweep) and a second copy would
   double-send to real students. Instead: mongoose connect, `new PushService(conn)`
   (its only dependency is the connection), `http.createServer()`,
   `attachClassWs` + `attachVideoSignalWs`, listen on `CLASS_WS_PORT`.
2. pm2 entry `chessguru-class-ws`, started but taking no traffic yet.
3. Smoke-test :4100 directly — connect, hello, make a move, confirm
   `classBoardState` is written.
4. nginx: `location /v2api/class-ws/` and `/v2api/api/video-signal/` → :4100,
   before the general `/v2api/` block. `nginx -t`, then reload.
5. Watch: new connections land on the new process, old ones drain.
6. LATER, separately: delete the two `attach*` calls from `main.ts`.

Until step 6 the API still *can* serve class-ws, which is the rollback: revert
the nginx location and reload.

## Rollback

Remove the two nginx locations, `nginx -t`, reload. Traffic returns to :4000,
which is still attached. No code revert, no deploy.

## Verification

- `ss -tn` shows established connections on :4100 and none arriving at :4000
- a real coach+student pair can join, move, draw an arrow, and see each other
- restarting `chessguru-v2-api` while a class is live changes nothing
