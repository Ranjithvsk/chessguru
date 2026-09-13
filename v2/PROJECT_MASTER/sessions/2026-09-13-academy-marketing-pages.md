# 2026-09-13 — Academy marketing pages, ChessPlay-style (multiple pages)

**What.** Owner: "read chessplay.io, need academy signup pages like that, multiple
pages". ChessPlay.io is a warm cream + orange multi-page marketing site (home,
built-for academies/coaches/schools, why, compare, feature pages), demo-led,
$99/month flat unlimited. Rebuilt our /signup-academy as the same kind of set,
in that style, keeping our self-serve 30-day trial form in the hero.

**Pages (all under `MarketingShell`: top strip, sticky nav with Features menu,
CTA banner, 3-column footer, WhatsApp FAB).**
- `/signup-academy` — home: hero + trial form, live stats strip, "what is" tiles,
  tabbed product tour, for-students, operations, built-for cards, why,
  testimonials (honest placeholders), pricing (#pricing), FAQ (#faq).
- `/for-academies`, `/for-coaches`, `/for-schools` — `marketing/BuiltFor.tsx`, copy in
  `marketing/data.ts` AUDIENCES.
- `/why-chessguru` — problems → fixes, hidden cost of the DIY stack in ₹, flat price.
- `/compare` — ChessGuru vs ChessPlay.io / ChessLang / ChessKid / Sheets+WhatsApp;
  marks from their public sites on 2026-09-13, "?" shown as "not stated".
- `/features/:category` — driven by `lib/features.ts` (8 categories).

**Files.** `apps/web/src/pages/SignupAcademy.tsx` (rewritten),
`apps/web/src/pages/marketing/{MarketingShell,TrialSignupForm,BuiltFor,WhyChessGuru,Compare,FeaturePage}.tsx`,
`apps/web/src/pages/marketing/data.ts` (single source for price/trial/WhatsApp/FAQ copy),
`apps/web/src/AppRest.tsx` (routes), `apps/web/src/App.tsx` (`isMarketing` regex hides app chrome).

**Gotcha.** react-router matches whole segments only: `for-:audience` never matched
and fell to the catch-all (→ "/"). Explicit `for-academies|coaches|schools` routes
pass the key as a prop.

**Verification.** tsc clean; deployed via scripts/deploy.sh; all 7 routes 200; desktop
+ 390px screenshots of home, for-academies, compare checked; only console noise is the
known by-domain 404 fallback.

**Open.** Testimonials are placeholders until academies give permission. No real app
screenshots of academy dashboard / live class yet (only puzzle/blindfold/engine shots).
Competitor marks should be rechecked periodically.

## Later the same day — "make it more like chessplay, add more pages"

Added `/about`, `/contact` (form hands the message to WhatsApp or email — no backend),
`/blog` + `/blog/:slug` (6 articles in `marketing/content.ts`), `/changelog` (from real
git history, piece-named releases, tag filter), `/help` (12 guides by audience),
`/terms`, `/privacy`. `/features/:category` now has ChessPlay's shape: hero → 3 blocks ×
3 bullets → catalogue → 5 FAQ. Nav: Home · Features ▾ (+Compare, Changelog) · Why ·
Pricing · Blog · About · Contact · Sign in · CTA; footer gained Company + Support columns.
Home gained a feature marquee under the live numbers.

Fixes from owner feedback: public stats counted a non-existent `students` collection
(showed 0) → counts `users` with role "student" (`misc.controller.ts`); the word
"business" removed from all marketing copy ("Running an academy, finally easy").

## TKT-224 — Fees page "looks empty": every student + parent WhatsApp

Owner (via view-as Shriguruchessacademy; screenshot = a CoFee WhatsApp fee-request reel):
"our fees build is not friendly and looks empty, show all students, name, and option to
add WhatsApp number". Added `GET /api/fees/students` (`fees.service.listStudents`) and
`components/FeesStudentsTable.tsx` on `/fees` (under the stats) and `/fees/students`:
name, batch·coach, parent WhatsApp (inline "Add WhatsApp" → academy link-parent), fee
programme, dues, "Request on WhatsApp" (reminderTextGuardian → wa.me), filters + search.
Dropped the "Beta · W3" chip. Commits 4566bd8, 6fed4ef. Ticket resolved on Mumbai
`platform.support_ticket` with captioned notes, two AFTER shots and a reply. Open: automated
WhatsApp Business sending (the reel's flow) — today's is one-tap manual via wa.me.

## Fees: manual mark-paid, UPI QR + ID in WhatsApp requests, screenshot verification

Owner: "option for owner to manually mark that fees is paid; in WhatsApp while asking for
fees send QR and UPI id and link to upload the screenshot; verify the screenshot → fees
marked as paid".
- Settings: `upiId` + `upiPayeeName` on `fees_settings` (Fees → Settings).
- WhatsApp text (both reminder builders) ends with `Pay by UPI: <id> (<payee>)` and the
  pay-page link (`payLines()` in fees.service).
- Pay page `/pay/:token`: `UpiPanel` (QR of `upi://pay?pa=&pn=&am=&cu=INR&tn=` via
  `qrcode`, copy button, open-in-app link) + `ProofUpload` (client downsizes to 1280px
  JPEG, amount + UTR, `POST /api/fees/portal/:token/proof`, list of own proofs with
  status). `fees_payment_proofs` {academyId, guardianUserId, invoiceIds, amountPaise,
  utr, imageDataUrl, status PENDING|ACCEPTED|REJECTED}. JSON limit 2 MB on
  `/api/fees/portal` (main.ts).
- Owner: `FeesProofsPanel` on /fees (pending only) → Accept = `recordManualPayment`
  (UPI, note with UTR + proof id) + proof ACCEPTED; Reject with a reason the parent sees.
  `Mark paid` on each student row with dues (amount/method/note → same manual-payment
  endpoint; `openInvoiceIds` added to `FeesStudentRow`).
Open: automated WhatsApp Business sending; proofs kept as base64 in Mongo (cap 1.2 MB).
