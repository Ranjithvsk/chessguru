# 2026-09-04 — Auto-alerting when a user hits an error

Owner ask, straight after the puzzle-picker fix: *"all three"* — email me when a user
hits an error, covering server errors, browser crashes, and slow requests. Then:
*"ALSO I CAN SEE THESE DETAILS IN SUPER ADMIN RANJITH_VSK LOGIN RIGHT..?"* — yes, and
that's the `/admin/errors` page below.

## Why

The 26s puzzle load in the session note next to this one was live **for weeks** and the
only reason we found out is that the owner's daughter complained. Nothing on the platform
turned "a user is having a bad time" into a signal anyone would see. A 200 that takes 26
seconds is invisible to logs-as-a-monitoring-strategy, and so is a white-screened phone.

## What was built

One sink, three feeds, two outputs (Mongo + throttled email).

### `errors/error-alerts.service.ts` — the sink

`report()` is fire-and-forget and can't throw. Every event is written to `errorEvents`;
only a throttled subset is emailed.

Throttling is the part that matters: a single bad deploy throws the same 500 thousands of
times a minute, and an unthrottled mailer would both bury the signal and get the domain
rate-limited. Two gates:

- **per-signature cooldown** — 1 mail per distinct fault per hour. Signature is
  `kind|route|normalized(message)`, where normalize collapses digits and hex runs to `#`
  so "user 4821 not found" and "user 9917 not found" share one bucket.
- **global cap** — 20 mails/hour no matter how many *distinct* faults.

Events are stored regardless of either gate, so the admin page keeps the full picture and
email is only the notification. 30-day TTL index on `at`.

### Feed 1 — server 5xx · `errors/all-exceptions.filter.ts`

Extends Nest's `BaseExceptionFilter` and delegates to `super.catch()`, so response bodies
and statuses are byte-identical to before. Purely an observation layer.

Only `>= 500` is reported. 4xx (bad login, forbidden, not found) is normal traffic, not
breakage, and would drown the signal.

### Feed 2 — browser crashes · `errors/errors.controller.ts` + `web/src/lib/report-error.ts`

`POST /api/client-error`, fed by the existing `ErrorBoundary.componentDidCatch` plus new
`window.onerror` / `unhandledrejection` handlers installed in `main.tsx` before render.

Deliberately **unauthenticated** — the crashes worth knowing about include the ones on the
login page. Defences instead: every field truncated server-side, per-IP limiter of 10/min,
and rows land in a TTL'd collection, so the worst a hostile caller achieves is wasted rows.

Client side dedupes by message for the life of the page and caps at 10 sends, so a render
loop retrying every frame doesn't become a request loop. `keepalive: true` so the report
survives the navigation-away that usually follows a crash.

### Feed 3 — slow requests · `errors/slow-request.ts`

`res.on("finish")` timer mounted early in `main.ts` (before body parsing) so the measured
window is the whole request. The finish handler reads `req.session`, which is populated by
the time it actually runs.

Two thresholds so the mailbox stays useful: **record at >5s, email at >15s**. Plus a skip
list for endpoints that are legitimately slow (500MB class-recording upload, vision
inference, engine search, materials/profile uploads) and a bail-out for request bodies over
2MB — a slow request that was slow because the client uploaded 40MB is not a server fault.

### The admin view — `GET /api/admin/errors` + `web/src/pages/AdminErrors.tsx`

Route `/admin/errors`, linked in the Navbar admin section, gated by the same
`isAdmin` / `CHESSGURU_ADMINS` allowlist as the mail log. Shows 24h counts per kind, a
**"Most frequent (24h)"** roll-up grouped by signature (the thing worth fixing is usually
the one repeating hundreds of times, not the newest one-off), and the raw feed with
click-to-expand stack traces.

## Verification

Filter and slow-watcher were exercised directly against the **compiled `dist/`** — no
natural 500 was reachable by probing (the app is genuinely robust: 8 malformed-id probes
all returned 404/403).

| check | result |
|---|---|
| `AllExceptionsFilter` reports 500 + 502, ignores 403 | 2 reported ✓ |
| slow watcher: 26s + 7s reported; 900ms, recording upload, vision, 9MB body ignored | 2 reported ✓ |
| 26s report flagged `notify=true`, 7s flagged `notify=false` | ✓ |
| 5 identical faults → 5 rows stored, **1** mail attempt | ✓ cooldown works |
| `POST /api/client-error` unauthenticated through nginx | 201 ✓ |
| `GET /api/admin/errors` without session | 403 ✓ |
| `GET /api/admin/errors` as `Ranjith_vsk` | returns rows/top/counts ✓ |
| TTL + query indexes on `errorEvents` | `at_-1`, `kind_1_at_-1`, `at_1` (expireAfter 30d) ✓ |
| `tsc --noEmit` apps/api | 0 errors |
| `tsc --noEmit` apps/web | 101 — unchanged baseline, none in touched files |

Smoke rows and the forged test session were deleted afterwards; `errorEvents` is back to 0.

## ⚠️ Found while testing: all ChessGuru email had been dead since ~30 Aug — FIXED

The very first alert failed to send with `ECONNREFUSED 127.0.0.1:4025`.

`dwotp-tunnel.service` (France → Mumbai, forwards dw-otp) has been in a restart loop with
**`ubuntu@148.113.43.16: Permission denied (publickey)`** — restart counter **35,472** and
climbing every 12s. Journal only retains back to Sep 2, where the counter was already
21,307; extrapolating 12s/restart puts the first failure around **30 Aug ~09:00**, which
matches the last successful row in `mailLog` (30 Aug 08:06, a digest).

This box's key `SHA256:usTbKVF/5FIvcVqk41Euym+gMwITyOxtxu58SS57Hbo` is offered and rejected
for **all three** of `ubuntu@`, `dreamworld@`, `root@` on Mumbai — so Mumbai's
`authorized_keys` was changed/rotated, it is not a per-user mistake.

`pgpitr-tunnel` still looks healthy only because its SSH session has been open since
5 Aug and SSH never re-authenticates. It will die the same way on its next restart.

**Blast radius — everything that mails is silently failing, not just the new alerts:**
password resets, OTP sign-in, weekly digests, streak reminders, class/fee reminders.
`sendMail` logs and returns `{ok:false}`; nothing surfaces to the user.

### Fix — 2026-09-04 07:31 UTC

The initial read ("the key is rejected for all three users") was wrong, and wrong in an
instructive way. Re-testing after the failed-auth flood had quietened showed:

```
ubuntu@148.113.43.16     → Permission denied (publickey)
dreamworld@148.113.43.16 → Server accepts key ✓  uid=1001(dreamworld)
```

The key was never revoked. Only `~ubuntu/.ssh/authorized_keys` was rotated; `dreamworld`'s
was untouched. The earlier all-three-rejected result came from probing while France's own
tunnel was hammering sshd every 12s — that's 35,472 failed auths, enough to trip
`MaxStartups` and make healthy users look dead. **Lesson: never conclude "the key is
revoked" from probes taken during a restart storm.** Stop the flapping unit first, then probe.

So no change to Mumbai was needed. The fix is one line on France — point the unit at the
user whose `authorized_keys` still holds our key:

```
-L 4025:127.0.0.1:4025 ubuntu@148.113.43.16
-L 4025:127.0.0.1:4025 dreamworld@148.113.43.16
```

Also added explicit `-i /home/dreamworld/.ssh/id_ed25519` and `-o BatchMode=yes` so the unit
names the key it depends on instead of inheriting whatever the default happens to be —
matching `pg-tunnel-mumbai.service`, which uses `dreamworld@` and was therefore never at risk.

| check | result |
|---|---|
| `systemctl is-active dwotp-tunnel` | active, `NRestarts=0` |
| `curl 127.0.0.1:4025/health` on France | `{"ok":true}` |
| `POST /send` through the tunnel to a Gmail address | `{"ok":true,"mx":"gmail-smtp-in.l.google.com"}` |
| audit of every France unit targeting 148.113.43.16 | only these two; `pg-tunnel-mumbai` already on `dreamworld@` |

Previous unit saved as `/etc/systemd/system/dwotp-tunnel.service.bak-20260904`.

## Files

- `v2/apps/api/src/errors/error-alerts.service.ts` (new)
- `v2/apps/api/src/errors/all-exceptions.filter.ts` (new)
- `v2/apps/api/src/errors/slow-request.ts` (new)
- `v2/apps/api/src/errors/errors.controller.ts` (new)
- `v2/apps/api/src/main.ts` · `v2/apps/api/src/app.module.ts` (wiring)
- `v2/apps/web/src/lib/report-error.ts` (new)
- `v2/apps/web/src/pages/AdminErrors.tsx` (new)
- `v2/apps/web/src/components/ErrorBoundary.tsx` · `main.tsx` · `AppRest.tsx` · `components/Navbar.tsx`

## Open items

- ~~**Nothing watches the tunnel.**~~ Built the same day — see
  [2026-09-04-mail-health-monitoring.md](2026-09-04-mail-health-monitoring.md).
- `ERROR_ALERT_TO` env overrides the recipient; defaults to `ranjith.vsk@gmail.com`.
- The slow-request skip list is a static prefix list. If a new legitimately-slow endpoint
  ships and starts emailing, add its prefix to `SKIP` rather than raising the threshold.
- Thresholds (5s record / 15s email) are guesses tuned to catch the 26s bug with margin.
  Worth revisiting once a week of real data is in `errorEvents`.
