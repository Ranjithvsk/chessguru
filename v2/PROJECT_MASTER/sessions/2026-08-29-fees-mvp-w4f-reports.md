# 2026-08-29 · Fees MVP — W4f: Reports page + recharts

## What
`/fees/reports` — three visualisations:
1. **Collection by month** (last 12) — dual bar: invoiced (light) vs
   collected (bright).
2. **Collection by head** — donut + legend showing where the money's
   going (Tuition / Exam / Book / Late / Other) with % share.
3. **Defaulters aged** — 0-30 / 30-60 / 60-90 / 90+ buckets with a
   horizontal proportional bar + a card per bucket showing invoice
   count + guardian count + outstanding.

## Files
### Deps
- `recharts` added via `pnpm --filter @chessguru/web add recharts`
  (~35 KB gzip, standard React chart lib listed in world-class §Stack).

### Backend (apps/api/src/fees/)
- `fees.types.ts` — `CollectionByMonthResponse`, `CollectionByHeadResponse`,
  `DefaultersAgedResponse`.
- `fees.service.ts`:
  - `collectionByMonth({months?})` — 2 parallel aggregates: captured
    payments per IST calendar month (via allocations ⨝ payments), invoices
    generated per IST month. Bucket labels use `%Y-%m` + `$add 5.5h`.
    Fills zero for months with no activity so the chart backbone is
    always 12 bars wide.
  - `collectionByHead` — invoices `$unwind` on lines, then a per-line
    proportional share of the invoice's paidPaise (line.amount /
    total × paid, `$round` to nearest paise). Honest interpretation
    for a FIFO allocator that doesn't track per-line allocation. Groups
    by head kind, sums.
  - `defaultersAged` — open invoices past `dueOn`, `$switch` bucketed by
    age in days into 4 windows, `$addToSet` guardianUserId so we can
    count unique guardians per bucket (not just invoice count).
  - `clamp()` helper moved to module scope (used by report opts).
- `fees.controller.ts` — 3 GET routes under `/api/fees/reports/*`.

### Frontend (apps/web/src/)
- `lib/fees-api.ts` — response types + `feesApi.{collectionByMonth,
  collectionByHead, defaultersAged}` helpers.
- `pages/FeesReports.tsx` NEW — full-width layout. Section 1 (monthly
  bar) full-width; sections 2+3 (head donut, aging) side-by-side on
  ≥lg. Recharts styled to match the dashboard's brand palette:
    - Monthly bar: invoiced #818cf8 40% opacity, collected #6366f1.
    - Head donut: per-kind colours matching KIND_META in the list.
    - Aging: gradient across brand → gold → orange → red so older
      buckets visually pop.
  Axis labels use a compact `₹1.2K / ₹3.4L / ₹1.5Cr` formatter; tooltips
  use full en-IN currency.
- `main.tsx` — `/fees/reports` route.
- `pages/Fees.tsx` — new **📊 Reports** button on the dashboard header
  next to Programs / Invoices / ⚙️.

## Design decisions
- **Recharts, not framer-motion animations.** Data density > motion for
  this surface. Static bars are easier to read than animating totals.
- **Per-line proportional allocation for collection-by-head.** The
  invoice-level FIFO allocator doesn't record per-line allocation. Two
  honest options: (a) skip the report until we track it, (b) proportional
  share. Option (b) is defensible because the invoice-total math is
  correct, so proportional split matches how the invoice was structured
  at creation time.
- **`$dateToString $add 5.5h` for IST bucketing.** Same trick used across
  the dashboard's daily buckets — a single owner-facing timezone truth.
- **Fill-zero months in the backbone.** Without this, a month with no
  activity would just disappear from the axis. Owners want a
  continuous 12-month strip so trend reads correctly.
- **Unique-guardian count via `$addToSet`.** Owner cares more about "how
  many families are behind" than "how many invoices are behind" — same
  guardian with sibling invoices shouldn't be counted twice in the
  aging list.

## Verification
- `tsc --noEmit` clean on both apps for the fees files.
- Post-deploy smoke:
  ```
  curl -sS -o /dev/null -w '%{http_code}\n' https://chessguru.cc/v2api/api/fees/reports/collection-by-month
  # → 401 (auth) — route wired
  ```

## Open items (later)
- **CSV export per report.** Small — server just streams the aggregate
  result as CSV. Would satisfy accountants who want raw rows.
- **Coach breakdown** — per-coach commission report once split payments
  land (world-class M6).
- **Predictive forecast** — Monte Carlo over historical pay-lag from
  world-class §9. Would show the "you'll collect ₹1.62L this month with
  90% confidence" hero on the dashboard.
- **Print-friendly variant** — one-page PDF of all three charts for
  monthly board meetings.
