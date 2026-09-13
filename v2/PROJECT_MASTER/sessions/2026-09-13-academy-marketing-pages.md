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
