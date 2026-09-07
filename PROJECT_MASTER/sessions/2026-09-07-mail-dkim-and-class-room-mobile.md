# 2026-09-07 — Mail DKIM outage fixed; Dream Meet class room unusable on phones (3 causes)

## 1. Outbound mail: "no DKIM selector for sending domain harinitharanjith.com"

**Root cause.** dw-otp (Mumbai, `apps/otp-service/mailer.js`) signs per sending domain from
`DKIM_BY_DOMAIN`. The `harinitharanjith.com` entry was committed on Mumbai only (612af99,
2026-08-09). On 2026-09-06 20:54 IST a whole-`apps/` sync from the dreamworld box overwrote
Mumbai's `mailer.js` with the older copy (pos-owner, frontend, kiosk, otp-service all got fresh
mtimes); a `pm2` stop/start of dw-otp at 06:11 IST 2026-09-07 loaded it, and from 07:00 IST every
ChessGuru send returned HTTP 502. The API's mail-health monitor never tripped: send failures were
counted on the same counter as `/health` probes, and every healthy probe (2 min) reset it.

**Fixed 22:35 IST.** `git checkout HEAD -- mailer.js` on Mumbai + `pm2 restart dw-otp`; test send
accepted by Gmail's MX. The dreamworld clone's copy now carries the entry too (commit e46dea7) so
a re-sync is harmless. No user-facing mail was lost today: zero OTP / reset requests in the
window; the three failed sends were owner alert emails.

**Monitor hardened** (`mail-health.service.ts`, `mail.ts`; API rebuilt + restarted 22:37 IST):
send failures have their own counter (trip at 2), a healthy probe can no longer "recover" a path
whose sends are failing (only a real successful send can), and the DOWN alert is sent from
dw-otp's own identity (`noreply@otp.dreamworldplants.com`, `observe: false`) with the exact
error and the fix — so "reachable but cannot sign for our domain" is no longer a silent failure.

**Observation, not chased (owner: "not gmail, our own mail host"):** mail from
`harinitharanjith.com` (noreply@ and alerts@) and from `noreply@dreamworldplants.com` is accepted
by Gmail's MX but never appears in the owner's Gmail (inbox, spam or trash, 30 days), while
`support@dreamcy.com`, `orders@dreamworldplants.com` and `noreply@otp.dreamworldplants.com` do —
same server, same DKIM key, all `dkim=pass spf=pass dmarc=pass`. Looks like recipient-side
filters/blocks on those two addresses. Worth the owner checking Gmail → Filters and blocked
addresses; the Mumbai CF DNS token (`~/.cf-dns-token`) is still valid and covers
harinitharanjith.com if a DMARC `rua` to the owner's mailbox is wanted for a definitive verdict.

## 2. Dream Meet class room on a phone / tablet (owner, Android Chrome, 22:33 IST)

Reproduced with a signed session cookie in a Playwright mobile context (412×915, touch).

| symptom | cause | fix |
|---|---|---|
| "when I click it shows students, can't make moves" | `AudiencePickerModal` (auto-opens on every coach entry, by design) scrolled as ONE box, so with 92 students the Skip / Start & notify row sat below the fold; every tap landed in the roster | dialog is now a column: header + action row always on screen, only the middle scrolls; bottom sheet on small screens; roster capped at 38vh |
| board's top ranks don't respond | `CoachWaitingOverlay` — a 280px card `absolute right-3 top-3` inside the board container — covered ~¾ of a 363px board on a phone | card is `hidden lg:block`; phones get a one-line strip under the top bar (`variant="strip"`), in flow, never over the board |
| "click and move creates an arrow instead of a move" | `SharedClassBoard` used `useAnnotationTool()`, which reads `cg_annot_tool` from localStorage — the tool the coach last picked on **/openings** on that device. With "arrow" persisted, `isDrawing` set `movableColor="none"` and taps drew arrows; the class room has no toolbar to switch back. Desktop was fine because that browser's stored tool was "cursor" (right-click draws there) | `useAnnotationTool({ persistTool: false })` in the class board: always starts in cursor mode, never writes the tool back; `/openings` keeps its persisted preference |

Verified after deploy (bundle `index-DbSj99Tk.js`) with `cg_annot_tool=arrow` pre-seeded: picker
actions at y=851 of 915; waiting strip present, card hidden, `elementFromPoint` on the board's
top-right = `CG-BOARD`; drag e2→e4 played `1. e4`, zero arrows. (That one test move was made in
the owner's own ad-hoc test class `cmtrhp5zr5h5m`.) Temporary sessions removed afterwards.

Not related: `meet.harinitharanjith.com` (the retired Jitsi install) still shows a "not available
on mobile" deep-link page on phones; nothing in the app links there any more.

## 3. Follow-up 23:55 IST — "in PC also I can't click and move"

Not the phone bugs above: the owner had the same class open on the **PC and the phone at once**.
`class-ws` treated the second connection of the same coach as a takeover — it closed the first
socket (`coach_takeover`), that client reconnected, was promoted again and closed the *other*
one, and the two devices kicked each other every ~2 s (hellos at 18:38:57, :59, :59, 19:01,
19:05 with "async coach promote … creator" each time). Whichever device connected last could move;
the other only showed local selection highlights and right-click arrows. Meanwhile 7 moves were
played from the phone, so "mobile works, PC doesn't" was exactly the takeover order.

**Fix** (`class-ws.ts`, API rebuilt + restarted 18:50 UTC): a second socket of the SAME user
joins as an extra coach — no close, no token re-mint, `room.coach` unchanged. A different user
(academy owner / another coach reclaiming an abandoned room) still takes over as before.
Verified with two coach sessions of `gunachess` (desktop + mobile contexts) in a throwaway room:
both kept the coach role for 9 s, PC played 1. e4, phone answered e5, PC played 2. Nf3, all
synced both ways; the log shows one "async coach join (same user, extra device)" and no takeover.
