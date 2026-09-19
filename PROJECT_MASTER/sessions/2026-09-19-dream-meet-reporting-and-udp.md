# 2026-09-19 — Dream Meet: report the room, and stop forcing media over TCP

Two things, one in git and one deliberately not.

## Why

On 18 Sep a Guna class read like a platform failure. A coach taught an empty room for
half an hour and sent a position pack to eight absent students. A student dropped at
17:56 and the superadmin dashboard still showed him present forty minutes later. Seven
of eight invited students never opened the class at all.

Reading the logs, almost none of it was a fault:

* The board socket already had a heartbeat, unlimited backoff retries and a reconnect
  on tab wake (added 1 Sep). It reconnected and kept reconnecting.
* LiveKit's own resume recovered the same student **twice** that hour, once in ~1 s and
  once in ~17 s.
* The one connection that never came back took both sockets with it and was followed by
  total silence — no token request, no page load. That is a device that stopped
  running, which nothing server-side can reach.

What actually failed was that **none of it was visible**. Both recoveries were silent,
so the student reloaded the page twice — once 42 s after a recovery that had already
succeeded. A reload is far more destructive than the drop: it tears the room down and
rejoins from scratch.

The owner pushed back three separate times on adding retry logic, and was right each
time. Nothing in this change retries anything.

## What changed (commit 37b2448)

`v2/apps/api/src/class/class-ws.ts`
* New `presence` frame carrying names and a cause. The socket previously broadcast only
  a participant count, which cannot answer the question a coach has: who went, and was
  it them or us. Close code 1000/1001 = deliberate exit; anything else (1006 especially)
  = the far end vanished, i.e. their device or network. Never this server — if it were,
  the frame could not be sent.
* `lastSeenAt` now moves on the ping the client already sends every 20 s, throttled to
  one write per minute per socket. It previously moved only on join/disconnect, so it
  was not a heartbeat at all but "time of the last doorway event". That is why the
  dashboard froze a coach at 17:44, and why the Dream Meet end-time fallback inherited
  the same wrong number. **Expect class durations on that page to now read longer —
  that is the correction, not a regression.**

`v2/apps/web/src/components/SharedClassBoard.tsx`
* Presence store + `useClassPresence()`; new `warn` notice tone; presence frames become
  named coach notices (joined / left / dropped out).

`v2/apps/web/src/pages/ClassV2.tsx`
* Coach-only "no students in the room" line, shown only once the server has reported a
  count so empty and unknown never look alike.
* Student-facing connection state with an explicit "no need to reload".

## LiveKit config — NOT IN GIT

`/etc/livekit/livekit.yaml` on France: `force_tcp: true` → **`false`**.
Backup: `/etc/livekit/livekit.yaml.bak-20260919-080013`.

That setting existed to fix "Client initiated disconnect" on networks blocking UDP.
Tested properly with `livekit-cli` 2.18.7 before keeping the change:

| Test | Setup | Result |
|---|---|---|
| baseline | force_tcp on | CLI could not connect **at all** — it has no ICE-over-TCP, so a TCP-only server excludes any such client. Browsers do have it, which is why they worked. |
| A | UDP on, from France | connected, held 35 s |
| B | UDP on, from Mumbai over the internet | connected, held 35 s, 0 failures |
| C | UDP on, **UDP dropped from Mumbai at the server firewall** | connected anyway, held 40 s, 0 failures |

Test C is the one that matters: it simulates a school/mobile network blocking UDP, and
the fallback caught it. The firewall rule was removed and verified gone. Browsers have
more fallback routes than the CLI had, so C is a conservative result.

Gain: direct UDP where the network allows it — lower latency to India, and several
times more capacity per server since nothing is relayed through TCP.

If any student cannot connect over the coming days, restore the backup and restart the
container. That is the whole rollback.

## Verification

* API type-check clean for class-ws; web type-check held at its pre-existing 91 errors,
  i.e. nothing new introduced. (Caught a real mistake this way: removing the retry also
  removed the hook the empty-room banner reads — 93 errors — which would have been a
  blank class page. Fixed before shipping.)
* Deployed at 12:37 IST with no class live; site, class feed and drive all verified
  after. API restarted again at 13:09 for the heartbeat change, also with no class live.
* LiveKit verified listening on UDP 7882, TCP 7881 and TURN/TLS 5349 after the change.

## Open

* **A class record still only gets `endedAt` when the coach presses End.** The abandoned
  sweep (`class-abandoned-sweep.service.ts`, Aug) deletes the live-now announcement and
  closes the ws room after 5 min, but never writes `endedAt` — which is why classes read
  as "never ended" on the Dream Meet page. Next item.
* Capacity is nowhere near a constraint: LiveKit sits at ~0.3% CPU; last 7 days were 25
  classes averaging 2.4 people.
