# 2026-08-28 · Fees MVP — W2c: invoice + receipt PDFs

## What
Fourth slice on `feat/fees-mvp-w1`. Owner can now download tenant-branded PDFs
for any invoice (any status) and any captured payment (as a receipt). Both
PDFs render identical to the on-screen numbers — same paise-integer math,
same `Intl.NumberFormat("en-IN")` currency, same status colour language.

Closes the W2 verifier from the plan doc: *"Guna's accountant closes the
month by importing our export."* Tally XML is still deferred to W6, but the
PDFs alone let the accountant reconcile paper-first.

## Files
### New deps
- `pdfkit` + `@types/pdfkit` added to `apps/api/` via pnpm workspace.
  Chosen over puppeteer to skip the ~120 MB Chromium download on the deploy
  target — pdfkit is 150 KB, no headless browser needed, and gives us
  precise print-ready layout.
- `apps/api/src/fees/fonts/DejaVuSans.ttf` + `DejaVuSans-Bold.ttf` bundled
  in the repo (~1.4 MB total). PDFKit's built-in Helvetica lacks ₹
  (U+20B9) → shows as superscript "1" — a non-negotiable rendering bug for
  an Indian-market invoice. DejaVu Sans is widely-licensed and has ₹
  natively. Registered as `Body` + `Body-Bold` in the PDF module.

### Backend
- `apps/api/src/fees/fees.pdf.ts` — new. Two entry points:
    - `buildInvoicePdf(inv, branding, ctx)` — A4, indigo GC-initials
      header (or logo if AcademyBranding has one), status pill matching
      web colours (OVERDUE fires when SENT/PARTIAL + past-due), metadata
      strip (FOR · PERIOD · DUE), BILL TO block, lines table with
      description/kind/amount, right-aligned totals with gold "Balance
      due", optional "Pay by …" callout, footer.
    - `buildReceiptPdf(payment, allocs, branding, ctx)` — same header
      shape with green "PAID" pill, RECEIVED-ON / METHOD / AMOUNT strip,
      "APPLIED TO" table = money-lineage per invoice, Total received /
      Applied / Wallet-credit totals, teal "Thank you!" strip, footer.
- `apps/api/src/fees/fees.service.ts` — added:
    - `brandingFor(academyId)` — best-effort lookup across `academies` +
      `academybrandings` collections, falls back to slug-based defaults.
      Decodes embedded logo dataUrl → Buffer if present.
    - `renderInvoicePdf(session, id)` — loads invoice + student + guardian
      + program + branding, dynamic-imports the PDF module (keeps
      pdfkit out of the cold-start hot path), returns `{buffer, filename}`.
    - `renderReceiptPdf(session, paymentId)` — same shape; batch-loads
      allocations + their invoices + their students to build the
      `invoiceLookup` map for the money-lineage table.
- `apps/api/src/fees/fees.controller.ts` — two new routes:
    - `GET /api/fees/invoices/:id/pdf` → inline application/pdf
    - `GET /api/fees/payments/:id/receipt.pdf`
  Both stream via `res.setHeader + res.end(buffer)`. Content-Disposition
  `inline` so a browser tab renders; user hits browser's Save to download.
  `Cache-Control: private, no-store` — money PDFs should never end up in
  a shared CDN cache.
- `apps/api/nest-cli.json` — added an `assets` entry that copies
  `src/fees/fonts/*.ttf` into `dist/` on `nest build`. Without this the
  compiled dist won't have the fonts and the runtime `readFileSync`
  fails. `watchAssets: true` keeps dev-mode nest-start hot-reloading
  when the ttf changes (rare but future-proof).

### Frontend
- `apps/web/src/lib/fees-api.ts` — added `invoicePdfUrl(id)` +
  `receiptPdfUrl(paymentId)` helpers that build the URL for a plain
  `<a href … target="_blank">` — browser sends the session cookie
  in-flight, no extra fetch code needed.
- `apps/web/src/pages/FeesInvoices.tsx` — added a Download PDF button
  in the invoice drawer (indigo outline, above the Waive/Cancel row),
  and a compact "📄 Receipt" link on every PaymentLine in the payments
  section (green outline). Both open in a new tab.

## Verification
- `tsc --noEmit` clean on both apps for the fees files.
- Standalone tsx script `/tmp/fees-preview/render-invoice-pdf.mjs`
  renders both a sample invoice PDF and a sample receipt PDF against the
  compiled module. Output rasterised via `pdftoppm` and eyeballed — ₹
  renders correctly, no line wraps, both PDFs at 25 KB.

## Design notes worth remembering
- **Fonts bundled inside the module** — never depend on host font stack.
  Regen: rerun `nest build` (or `pnpm --filter @chessguru/api build`)
  and confirm `dist/fees/fonts/*.ttf` land alongside the compiled JS.
- **`res: any`** in the two PDF routes — `@types/express` isn't a direct
  dep of the workspace so the transitive types aren't resolvable. Using
  `any` keeps the tsc surface clean without adding a new declared dep;
  behaviour is identical.
- **`Cache-Control: private, no-store`** on both PDF routes — a fee
  receipt is PII (guardian name + phone + amount + method); never cache
  in an intermediate proxy.
- **Dynamic import of `./fees.pdf`** inside the service — keeps the
  pdfkit chunk (~800 KB with dependencies) out of the cold-path modules
  for routes that never touch PDFs (dashboard, list, etc.).
- **Status pill colours match the web INVOICE_STATUS_META semantics** so
  a printed invoice reads the same as the on-screen row.

## Open items
- **Tally XML export (W6).** Accountants still ask for it — PDF alone
  covers the paper flow, XML closes the software flow. ~1 day of work.
- **Waive reason via modal** — currently uses `window.prompt()` in the
  drawer. Not urgent; prompt() works.
- **Payment settlement / bank reconciliation report** — needed once we
  have >1 payment method actually settling money into a real bank.
- **Parent-portal PDF download** — the parent should be able to grab the
  same receipt PDF from their side. Wire the same route with a token
  guard in the parent-portal slice (M3 per world-class doc).

## Deployment
Still on branch `feat/fees-mvp-w1`. Merge + `pnpm --filter @chessguru/api
build` + `pm2 restart chessguru` (or whatever runs the v2 API) to go
live. Confirm `dist/fees/fonts/DejaVuSans.ttf` exists after build.
