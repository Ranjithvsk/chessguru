# 2026-09-04 — Monitoring for the mail path

Owner ask, immediately after the dwotp-tunnel fix: **"BUILD THE MONITORING"**.

## Why

Outbound mail died on 30 Aug and nobody knew until 4 Sep. It was found by luck —
a brand-new alerting feature happened to try to send a mail that afternoon and got
`ECONNREFUSED`. Without that coincidence it would still be down.

The reason it could hide for five days is structural, not accidental: `sendMail`
fails open. It logs, returns `{ ok: false }`, and **not one caller checks the return
value**. That is a deliberate design — a failed digest must not break a request — but
it means a total outage and a perfectly healthy system look identical from every
surface we had.

## The awkward part

The thing being monitored is the alerting channel. When mail is down we cannot email
about it. So the design has to answer "where does the alert go when the alert can't be
sent", and the answer is three places with different timing:

| when | channel |
|---|---|
| during the outage | red banner in the header, on every page, for admins |
| during the outage | `errorEvents` row + status strip on `/admin/errors` |
| the moment it recovers | emailed postmortem with the outage duration |

The recovery mail is the only message that can ever be *delivered* about a mail
outage, because it's sent at the exact instant sending starts working again.

## What was built

### `errors/mail-health.service.ts` — two independent signals

**1. Active probe** — `GET ${DWOTP_URL}/health` every 2 min. Catches the transport
being down (tunnel dead, service down, wrong port) *even when nothing is sending*,
which matters because the Aug outage began during a quiet period.

**2. `sendMail` observer** — `lib/mail.ts` now reports every real send's outcome
through a hook. Catches the opposite failure: sends the transport accepts but that
are rejected downstream (DKIM, MX refusal, a relay 403 — which is exactly how the
Resend era failed). A `/health` probe calls that case perfectly healthy.

Neither signal subsumes the other, which is why there are two.

**Trip threshold: 2 consecutive misses.** The tunnel unit restarts on a 10s timer, so
a single miss is routinely just a reconnect in flight. One miss would page constantly.

**State is persisted** to a `mailHealth` doc and re-read on boot. Without that, a pm2
restart mid-outage would reset the clock, re-alert, and — worse — report a "recovery"
that never happened. A nightly restart would have hidden a permanent outage forever.

**The recursion guard is the subtle bit.** Reporting a mail outage tries to send mail,
which fails, which fires the observer, which lands back in the same service. The state
flag is therefore flipped *before* the alert is raised, so the re-entry is a no-op
instead of an infinite loop. Verified explicitly (see below).

### `components/Navbar.tsx` — the banner that does the actual work

A page that reports an outage is useless if nobody opens it, and `/admin/errors` is
not somewhere anyone goes unprompted. So the outage rides in the header on every page
for admins: if mail is broken, the person who can fix it sees it the next time they
use the site for any reason at all. It links to `/admin/errors` and names the blast
radius in the banner text, because "mail down" understates it.

### `pages/AdminErrors.tsx`

Status strip (green/red, with outage duration and last error) and `mail` added to the
kind filter. The red state also prints the first diagnostic step —
`sudo journalctl -u dwotp-tunnel -n 20` — since that is what the last two incidents
both needed.

## Verification

The state machine was exercised against the **compiled `dist/`** with a stubbed
connection, which is the only sane way to test transitions without deliberately
breaking production mail:

| check | result |
|---|---|
| 1 missed probe → no alert | ok=true, 0 reports ✓ (blip doesn't trip) |
| 2nd consecutive miss → DOWN | ok=false, 1 report, kind=`mail` ✓ |
| 3rd miss while already down | still 1 report ✓ (no re-alert storm) |
| observer re-entry during a down-alert | still 1 report ✓ **recursion guard holds** |
| probe succeeds again | ok=true, postmortem composed with duration ✓ |
| persisted doc after recovery | `{ok:true, lastError:null}` ✓ |

Live, through nginx:

| check | result |
|---|---|
| `GET /v2api/api/admin/mail-health` unauthenticated | 403 ✓ |
| same as `Ranjith_vsk` | `{ok:true, since, lastOkAt, lastError, checkedAt}` ✓ |
| `mail` block present in `/v2api/api/admin/errors` | ✓ |
| probe writes `mailHealth` on boot | ✓ |
| `tsc --noEmit` api / web | 0 / 101 (unchanged baseline) |

In a real browser as an admin, with the endpoint stubbed to report an outage: header
banner appears within one poll cycle reading *"⚠️ Outbound email is DOWN (3h) —
password resets, OTP sign-in and all reminders are failing silently · connect
ECONNREFUSED 127.0.0.1:4025"*, and the page strip flips red. Caught during that pass:
the strip's explanatory text was `text-rose-200` and unreadable in **light** mode —
the page was written dark-first — so the new elements got explicit
`text-rose-700 dark:text-rose-200` pairs and were rebuilt.

Forged test session deleted; `errorEvents` has 0 `mail` rows (production never actually
transitioned).

## Found while verifying: 47 slow requests in 24h

The alerting from the previous session is already returning real data, and it is not
noise:

| n | route | time |
|---|---|---|
| 26× | `POST /api/parent-reports/mistakes-self` | 15.5s |
| 13× | `GET /api/puzzles/master-players` | 6.0s |
| 6× | `GET /api/explorer` | 5.0s |
| 2× | `GET /api/puzzles/random` | 6.0s |

`mistakes-self` at 15.5s, 26 times a day, is sitting right on the 15s email threshold.
Not investigated here.

## Files

- `v2/apps/api/src/errors/mail-health.service.ts` (new)
- `v2/apps/api/src/lib/mail.ts` — send-outcome observer hook
- `v2/apps/api/src/errors/error-alerts.service.ts` — `mail` kind + label
- `v2/apps/api/src/errors/errors.controller.ts` — `GET admin/mail-health`, `mail` in the errors payload
- `v2/apps/api/src/app.module.ts` — provider
- `v2/apps/web/src/components/Navbar.tsx` — `MailDownBanner`
- `v2/apps/web/src/pages/AdminErrors.tsx` — status strip + kind filter

## Open items

- **Single-process assumption.** The probe is a `setInterval` in the API process, same
  as every other cron here. If the API is ever run with more than one replica, each
  gets its own state and its own postmortem.
- The banner only reaches admins. A tenant academy whose own mail is failing has no
  signal — but mail is global today, so there is nothing per-tenant to show yet.
- Nothing watches the *watcher*: if the API process is down, so is the probe. That
  gap needs an external check (the `server.dreamcy.com` fleet monitor is the obvious
  home for it).
- `mistakes-self` at 15.5s, above.
