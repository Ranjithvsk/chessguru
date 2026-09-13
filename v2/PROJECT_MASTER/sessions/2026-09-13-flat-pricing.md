# 2026-09-13 — Flat ₹1,000/month, unlimited students

**What.** Owner: "unlimited students pricing for 1000". The student tiers committed
this morning (₹1,000 ≤50 / ₹1,500 ≤100 / +₹500 per 50 / quotation >500) are replaced
by one price: ₹1,000/month, unlimited students and coaches, yearly ₹10,000 (2 months
free). Per-academy `customMonthlyPricePaise` override is kept.

**Files.** `apps/api/src/billing/billing.service.ts` (`monthlyPricePaise()` → `FLAT_MONTHLY_PAISE`,
never quotation), `apps/web/src/pages/SignupAcademy.tsx` (one plan card, FAQ, headline;
growth ladder + quotation card removed), `apps/web/src/pages/AcademyBilling.tsx` (copy).

**Verification.** API + web tsc clean; live-now empty before `pm2 restart chessguru-v2-api`;
`scripts/deploy.sh` published; live bundle contains the new headline and no tier copy.
Commit 81bd5fc.

**Open.** `QUOTATION_ABOVE` guards in billing.service.ts are now unreachable — harmless,
remove on next billing touch. Existing academies' stored `monthlyPricePaise` snapshots
were already ₹1,000 (all ≤50 students), so no data migration.
