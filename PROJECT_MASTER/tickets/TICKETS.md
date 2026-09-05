# Ticket ledger — ChessGuru

One line per super-admin support ticket (`platform.support_ticket` in `dreamcy_db`
on Mumbai) that was worked on for ChessGuru. The closing workflow is in
`PROJECT_MASTER/knowledge/11-working-rules.md`; the short form is:

repro → fix → deploy → visually re-verify → attach **marker-annotated**
BEFORE/AFTER screenshots + `admin_notes` captions per index + commit sha →
`replyToTicket` → RESOLVED → a line here.

| Ticket | Tenant | Summary | Commits | Verified | Status |
|---|---|---|---|---|---|
| TKT-127 | guna-chess-academy (`gunachess`) | Reset-password result was unmounted before it could render; linked parents were returned as bare ids so the roster never showed them; the ⋯ menu always opened upward and went off-screen on first-row cards; reassign-coach closed on the tap that opened it; parent name rendered white-on-pale in light mode. | `e96334f`, `d720466` | 2026-09-05 — geometry measured in-browser (before y=−141px → after y=179px); parent resolution simulated against the live 86-student roster | RESOLVED 2026-09-05, reply TKT-130 |

## Note on notifications

TKT-127 has `tenant_id = NULL` and `contact = NULL`, so neither `notifyReply`
nor `notifyResolution` sent an email — both bail early without a `tenant_id`.
ChessGuru tickets reach the owner through the in-app **Help & feedback** thread
instead. If email notice matters for a ChessGuru ticket, the ticket needs a
`tenant_id` (or a `contact`) at creation time.
