# 2026-09-17 — "gunachess users always have to log in"

## The question

Owner: *"why user in chess guru, gunachess always need to login..?"*

## What the data said

63 Guna Chess users were holding **286 separate sessions**. One student
(`akshayprathab`) alone had **38**, spread over a month — several on the same day.
With `rolling: true` a returning user should keep re-using ONE.

Ruled out first, so nobody re-chases them:

| Suspected | Reality |
| --- | --- |
| Session expiry | 30-day `maxAge`, `rolling:true` refreshes on every request |
| API restarts | sessions live in Mongo, `SESSION_SECRET` stable |
| Server-side invalidation | nothing destroys a session but `POST /auth/logout` |
| Renamed/duplicated students | `me()` returns `loggedIn:true` on `session.userId` alone; it never re-checks the user |
| The 2026-08-22 domain fix failing | it worked — it just cannot solve this |

## Root cause: three hostnames, three cookie jars

The same people use **three** hosts, and a cookie cannot cross registrable domains:

| Host | Scope issued | Where it came from |
| --- | --- | --- |
| `gunachess.com` | **host-only** | their branded site (`academyProfiles.customDomain`) |
| `chessguru.cc` | `.chessguru.cc` | the platform |
| `harinitharanjith.com` | `.harinitharanjith.com` | **every link the API sent out** |

Scopes recorded on gunachess's own sessions: **110 host-only / 70 `.chessguru.cc` /
56 `.harinitharanjith.com`**, and in the week of 09-13, 12 of 18 logins were still
host-only.

Two independent faults fed it:

1. **Tenant domains got host-only cookies.** `main.ts` special-cased chessguru.cc
   and harinitharanjith.com and sent everything else to `undefined`. Host-only
   cannot be shared with `www.`, and it is what produced the duplicate-`cgsid`
   "twin" that `clearHostOnlyTwin()` has been mopping up.
2. **`PUBLIC_URL` was `https://harinitharanjith.com` in the running process** — the
   legacy host — so invites, password resets and check-in QRs all pointed there.
   `.env` had said `https://chessguru.cc` for some time and was being **ignored**:
   `dotenv.config()` does not override a variable pm2 already has, and pm2's saved
   dump held the old value. Same trap as `DREAMCY_INTERNAL_TOKEN` that morning.

## Changes

- **`cookie-domain.ts`** (new) — `registrableDomain()` / `cookieDomainForHost()`.
  Every host now gets the widest scope it may legally set. The multi-label suffix
  list is not decoration: `shriguruchessacademy.co.in` would otherwise be handed
  `.co.in`, a public suffix every browser **rejects**, logging that academy out on
  every request — strictly worse than the host-only it replaces.
- **`public-base.ts`** (new) — `publicBaseForAcademy()`: outbound links target the
  academy's own domain, falling back to `PUBLIC_URL`. Wired into the invite link,
  the reset link and the attendance QR.
- **Sessions never expire** (owner ask). `SESSION_MAX_AGE_MS` = 10 years on the
  cookie and the Mongo store. Legacy 30-day sessions are lifted in place on their
  next request — by a **threshold**, not `!==`, because express-session recomputes
  `originalMaxAge` as `expires - Date.now()` and it drifts a millisecond per touch;
  an equality check would re-save on nearly every request. The upgrade writes one
  field on purpose: `resave:false` hashes the session *without* its cookie, so
  otherwise only `expires` would move and `originalMaxAge` would stay at 30 days —
  the number `admin-academies.service.ts` subtracts to get "last request".
- **"Keep me logged in" now does something.** It used to set the same 30 days the
  global config already applied, so the box changed nothing in either position.
  Unticking now gives a real browser-session cookie (`noKeep` stops the upgrade
  pass from overriding the choice); the label says "untick on a shared computer".
- **`dotenv.config({ override: true })`** in `main.ts` + `class-ws-main.ts`, so
  `.env` is the source of truth. Checked first: `PUBLIC_URL` was the *only*
  conflicting key of 29, so nothing else moved — in particular `SESSION_SECRET`
  is not in `.env`, so no session was invalidated.
- **Lichess OAuth redirect pinned** to `LICHESS_REDIRECT_BASE`, defaulting to the
  old `harinitharanjith.com`. It is registered with Lichess; letting `PUBLIC_URL`
  drag it would break account linking with `redirect_uri_mismatch`.

## Verified on the running API

Throwaway session, one request per host, then deleted:

    chessguru.cc                 Domain=.chessguru.cc                 expires 2036
    www.chessguru.cc             Domain=.chessguru.cc                 expires 2036
    gunachess.com                Domain=.gunachess.com                expires 2036
    www.gunachess.com            Domain=.gunachess.com                expires 2036
    shriguruchessacademy.co.in   Domain=.shriguruchessacademy.co.in   expires 2036
    harinitharanjith.com         Domain=.harinitharanjith.com         expires 2036
    localhost / 127.0.0.1        <host-only>                          expires 2036

and the 30-day session was upgraded in place — `originalMaxAge 315360000000`,
`policy=never-expire`. Live link generation:

    guna-chess-academy  ->  https://gunachess.com/checkin/...
    chess-guru          ->  https://chessguru.cc/checkin/...

The second line is the proof that `.env`'s `PUBLIC_URL` is now live; before the
change it would have read `harinitharanjith.com`.

## Still open

- **A cookie still cannot cross `gunachess.com` ↔ `chessguru.cc`.** Nothing can.
  Anyone who uses both hosts still signs in on each. The remaining fix is one
  canonical host per academy (redirect the other), or a one-time SSO handoff
  token. Both are real work and were not done here.
- `clearHostOnlyTwin()` can be retired once the legacy host-only cookies age out.
- Sessions now never expire, so the `sessions` collection no longer self-prunes.
  286 docs today; revisit if it ever gets large.
