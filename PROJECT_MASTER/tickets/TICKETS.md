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
| TKT-247 | guna-chess-academy (`gunachess`) | Student not yet on the class audience got "Could not join room → 404" and the page never retried — locked out for 7 min after being added (24 Sep). Now a waiting card that re-checks every 5 s and joins on its own; server refusals carry a reason code and are logged. | 9a2ba49 (+ 4de85c0 eligibility, e516266 answer path, a3f39e3 late-join, 8c9c957 / f8624aa audio) | Live on chessguru.cc 2026-09-25: refused → waiting → added → joined in 3 s | RESOLVED 2026-09-25 |
| TKT-266 | guna-chess-academy (`gunachess`) | Auto-filed by Claude's own headless test run (room `zze2e-68062d`), not a user report. | — | — | NOISE 2026-09-25 |
| TKT-249 | guna-chess-academy (`sarika`) | Rename chapters in a study — shipped (pencil on chapter rows), coach confirmed. | — | coach: "Ok anna" | RESOLVED 2026-09-25 |
| TKT-86 | guna-chess-academy (`akshayprathab`) | "Rating 2820 → 22" — data showed 2122 over 852 puzzles, last-100 range 2056–2281; answered, acknowledged. | — | userperfs read-back | RESOLVED 2026-09-25 |
| TKT-151 | guna-chess-academy (`gunachess`) | Change a student's password — duplicate of TKT-127 (⋯ → 🔑 Password on the student card, live since 2026-09-04); replied with steps. | — | — | RESOLVED 2026-09-25 |
| TKT-251 | guna-chess-academy (`gunachess`) | "Ready stopped for books" — 11 books uploaded within 30 min on 18 Sep; 7 showed "0 positions · 0%" for hours. They were queued behind one another (all finished 23:16 IST that night), but the shelf could not say so, and the in-memory queue would have stranded them for good after any restart. Vision service now re-adopts stranded books (sweep at boot + every 5 min), a re-upload restarts a stuck read, shelf says queued/failed instead of 0%. | 7026fed | Staged queued book adopted 8 s after a service restart; all 16 of gunachess's books state=done with positions | RESOLVED 2026-09-25 |
| TKT-242 | guna-chess-academy (`harinitharanjith`) | Mate-in-3 #MRZuh: student played Qh5+, marked wrong, "solved correctly why?" — Stockfish 18: after Qh5+ Kxg3! escapes (−5.3 for Black); only Qh4+ mates (queen on h4 guards g3). App was right; the review panel now says WHY: engine's reply to the wrong move under "You played". | e65538c | `GET /api/puzzles/MRZuh/refute?wrong=g5h5` → Kxg3, cp −525, live on chessguru.cc | RESOLVED 2026-09-25 |
| TKT-269 | guna-chess-academy (`harinitharanjith`) | "why student auto kicked" — 13 DUPLICATE_IDENTITY closes in 6 min, each one a page reload (28 loads from her phone); the reloads came from blank pages caused by our own `vite:preloadError` preventDefault (failed chunk → React.lazy gets undefined), and after a real network drop the aborted reconnect was shown as a fatal "Could not join room" card. Lazy routes now retry, connect errors are non-fatal, replaced tabs say so. | f2d0a4e | chessguru.cc: chunk aborted once → renders in 2.2 s; second tab → first shows card in 1.4 s, no reload; "Use this tab" swaps back | RESOLVED 2026-09-25 |
| TKT-273 | guna-chess-academy (`gunachess`) | "Bug not allowing to move" — challenge ended by timer at 6:59:25 pm while the coach's class socket was reconnecting; challenge_end lost → page kept the challenge active at 0s → coach board frozen by design. Server now replays the last challenge on reconnect / on End with nothing running; snapshot carries challengeActive; client self-clears. | cf36192 | Live: coach offline across the timer end → page heals on reconnect, pill gone, Challenge button back | RESOLVED 2026-09-25 |
| TKT-272 | guna-chess-academy (`gunachess`) | Leaderboard game awards showed Lichess / chess.com ids ("<id> vs <id>"). Now "<student> vs opponent"; original-game link only for the student and coaches. | cf36192 | API `/game-motifs/student/:id` returns sanitised labels (code path; no external-game events in the test academy to display) | RESOLVED 2026-09-25 |

## Note on notifications

TKT-127 has `tenant_id = NULL` and `contact = NULL`, so neither `notifyReply`
nor `notifyResolution` sent an email — both bail early without a `tenant_id`.
ChessGuru tickets reach the owner through the in-app **Help & feedback** thread
instead. If email notice matters for a ChessGuru ticket, the ticket needs a
`tenant_id` (or a `contact`) at creation time.
