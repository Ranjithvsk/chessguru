# 2026-09-13 — Superadmin leads module (academy conversion pipeline)

**What:** `/admin/leads` in the v2 web app + `GET/POST/PATCH /api/admin/leads*` in the Nest API. One row per
academy we want on ChessGuru, seeded with 121 Chennai academies mined the same day (names, localities,
phones, emails, websites, coach names, estimated students/coaches with a stated-vs-estimated flag).
Status pipeline new → contacted → interested → demo → trial → converted / lost; per-lead follow-up log
(call / WhatsApp / email / visit / note), next-follow-up date with "due" highlighting, inline edit,
add-by-hand, CSV export, summary strip with conversion %.

**Why:** the owner asked for the mined list to live inside chessguru.cc so conversions are tracked where
the academies end up.

**Files:** `apps/api/src/admin/admin-leads.service.ts`, `admin-leads.controller.ts` (superadmin-only via
`isAdmin`), `app.module.ts`; `apps/web/src/pages/AdminLeads.tsx`, `AppRest.tsx` (route), `Navbar.tsx`
(Admin — Leads), `lib/api.ts` (types + helpers). Mongo collection `academyLeads` (indexes on name+city,
status, nextFollowUpAt). Seed: scratch script inserted the mined rows directly (import endpoint also exists).

**Verification:** API tsc clean; web tsc clean for the new files; `nest build` as ubuntu, pm2 restart of
`chessguru-v2-api` at 16:32 IST with 0 live classes; `/api/admin/leads/summary` answers 401 anonymously
(route mounted); web deployed via `scripts/deploy.sh`.

**Open:** WhatsApp outreach from the page (Meta Cloud API) needs a WABA, approved templates and an opt-in
record per lead — not built; the page links to wa.me for manual 1:1 messages.
