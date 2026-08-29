# 2026-08-29 · Fees MVP — W4a: auto-reminder cron (email)

## What
Overnight reminders now go out automatically. Owner stops clicking 🔔 on
every overdue row — the cron sweeps invoices matching the cadence
`[-3, 0, +3, +7]` days-from-`dueOn` between 06:00–11:00 IST and emails
the guardian via the existing self-hosted dw-otp mail path.

WhatsApp / SMS auto-send stays deferred (needs Meta Cloud API approval —
tracked in world-class §M2 decision point). The manual 🔔 button in the
drawer + dashboard still works untouched.

## Files
### Backend (apps/api/src/fees/)
- `fees.reminder-cron.service.ts` — NEW.
  - `setInterval(60_000)` inside `OnModuleInit`, matches
    `class-reminder.service.ts` shape (no `@nestjs/schedule` dep).
  - IST hour gate — only fires between 06:00–11:00 IST so parents get a
    morning ping, not a middle-of-the-night ping.
  - Cadence `CADENCE_DAYS = [-3, 0, +3, +7]`. For each offset, computes
    the IST-day range `dueOn ∈ [start, end)` and pulls candidate invoices
    where `status ∈ {SENT, PARTIAL, OVERDUE}`.
  - Atomic claim via `insertOne` on `fees_reminders` — E11000 =
    already-nudged-today, skip. Same unique index the manual `🔔` button
    uses; scheduler + manual don't collide.
  - `sendMail()` (existing `lib/mail.ts`) — self-hosted dw-otp path,
    no-ops with a stdout log if `DWOTP_INTERNAL_TOKEN` is missing (dev
    stays green).
  - HTML template — accent-tinted top bar (indigo pre-due, amber
    overdue), 3-row summary (Invoice / Amount / Due), single **View
    invoice** CTA to `chessguru.cc/fees/invoices?id=<id>`, footer copy
    about how to opt out.
  - Plain-text template as fallback — always sent alongside HTML per
    `sendMail` shape.
  - Failure path — if `sendMail` returns not-ok OR throws, we
    `updateOne` the reminder row to `status: FAILED` + `errorText` so a
    future operator dashboard can surface stuck sends. The claim
    (unique-index) stays, so we don't infinite-retry.
  - `BATCH_CAP = 200` per tick — safety guard so a data glitch doesn't
    email 10 K parents in one minute.

- `fees.module.ts` — registers `FeesReminderCron` as a provider. Cron
  starts 30 s after Nest boots (avoids hammering the DB while indexes
  warm) then ticks every 60 s.

## Design decisions
- **IST-day boundaries + IST hour gate.** `class-reminder` uses UTC
  windows because classes have exact start times. Fees are calendar-day
  events — "September 10 due" means "IST midnight boundary." Every
  bucket, every unique-key stamp, every "morning notify" gate anchors
  to IST.
- **Single template family, offset-driven copy.** `offset < 0` =
  "coming up," `offset === 0` = "due today," `offset > 0` = "overdue"
  — three text variants inside one `sendOne`. Keeps the module small
  vs a per-cadence-offset template registry.
- **Atomic claim first, send second.** If sending is slow / times out /
  crashes, the claim still exists so a retry (next tick, next
  hour) won't double-nag. Trade-off: a claim + send failure "burns"
  today's slot for that invoice+channel. Acceptable for MVP —
  owner still has the manual 🔔.
- **Skip on no-email.** Guardian has no `email` field → silent skip
  (log the reminder row anyway? — no, that would eat today's slot for
  a fallback channel we can't send on yet). Owner's 🔔 WhatsApp still
  covers those parents.
- **No new deps.** `@nestjs/schedule` would be cleaner cron syntax but
  costs a package + config; `setInterval` matches the four existing
  ChessGuru crons (class-reminder / class-abandoned-sweep /
  class-auto-summary / streak-reminder / weekly-digest).

## Verification
- `tsc --noEmit` clean on API for all fees files.
- Cron will start emitting `[fees-cron] sent=N skipped=M` log lines
  during 06:00–11:00 IST windows once there are eligible invoices.
- `sendMail` with `DWOTP_INTERNAL_TOKEN` unset logs the body to
  stdout — safe for a first prod boot without emailing anyone. Confirm
  env has the token if you want live sends (already set in
  `/home/ubuntu/chessguru/v2/apps/api/.env`).

## Open items (W4b onward)
- **Razorpay integration** — needs Guna's merchant credentials.
  Order-create + webhook signature verify + FIFO alloc into existing
  allocations pipe. Highest-value unlock left in the MVP path.
- **Cadence config UI** — currently hardcoded `[-3, 0, +3, +7]`.
  Later: `fees_settings.reminderCadence: number[]` per academy (already
  scaffolded in the world-class doc).
- **Per-guardian opt-out.** Currently every guardian with an email
  gets nudged. `guardian.emailOptIn: false` field + UI toggle → cron
  filter check. Small addition to W4c.
- **Reminder log admin surface.** Right now cron sends are invisible
  to the owner unless they check server logs. A "Recent sends" tab
  under Fees would show today's + last 7 days.
- **Digest-style summary email** — for many-parent academies, one
  weekend "you have 12 unpaid parents" digest to the owner might beat
  per-parent nagging.
