# Always test a build thoroughly before saying it's done

## The lesson

On 2026-08-17 I deployed ~8 fixes for the board-editor over 3 hours,
each time telling the owner "should work now, please retest". The owner
retested each time and each time it was still broken — freezing, no
banner, stale JS, silent failures. I wasn't verifying the build in a
real browser before claiming success; I was inferring correctness from
server logs and source-code reads.

That workflow burnt hours of the owner's day and their patience.

## The rule

**Before saying "please retest," open the deployed URL in a real
browser and reproduce the flow yourself.** Server-log checks and
static grep of the minified bundle are NECESSARY but INSUFFICIENT.

Working browser check on this box:

```bash
# Chrome-for-testing binary (already installed under playwright cache)
CHROME=/home/dreamworld/.cache/ms-playwright/chrome-1237/chrome-linux64/chrome

# Playwright driver (installed into /tmp on 2026-08-17)
node - << 'JS'
import { chromium } from '/tmp/node_modules/playwright-core/index.mjs';
(async () => {
  const b = await chromium.launch({
    executablePath: '/home/dreamworld/.cache/ms-playwright/chrome-1237/chrome-linux64/chrome',
    headless: true, args: ['--no-sandbox'],
  });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[JSERR]', e.message.slice(0,200)));
  page.on('response', r => { if (r.status() >= 400) console.log(r.status(), r.url()); });
  await page.goto('https://harinitharanjith.com/board-editor', { waitUntil: 'domcontentloaded' });
  // ... reproduce the specific flow you just fixed
  await page.screenshot({ path: '/tmp/verified.png', fullPage: true });
  await b.close();
})();
JS
```

## Symptoms that meant I skipped this

1. Owner reports "still stuck" after each deploy — I was testing the
   HYPOTHESIS in code, not the actual DEPLOYED artifact.
2. Owner's iOS Safari served stale JS via SW cache; my hot-path
   assumptions in source didn't match the OLD code the browser was
   still running.
3. Multiple deploys in short succession invalidated hashed-JS names the
   owner's browser was mid-request for → 404 on assets → blank page.

## Concrete checks before a "please retest" message

- Load the DEPLOYED URL (not a local dev build) in headless Chrome
- Verify the specific action end-to-end (upload, click, submit — whatever the fix was for)
- Confirm no JS errors in the console
- Confirm no HTTP 4xx/5xx on API calls
- Confirm the visible UI state changes as expected (via
  `page.screenshot({ fullPage: true })` and `page.evaluate` on the
  relevant text/element)
- For SW-heavy apps: also test with `browser_context({ serviceWorkers: 'block' })`
  to catch cases where the SW-cache masks a broken deploy

## When you MUST NOT deploy again

- While the owner is mid-interaction on the site (my 12:01 deploy
  overwrote hashed JS names the owner's SW-refresh had just fetched
  the HTML for → their next fetch was a 404 → blank page).
- Give at least ~2 min quiet after each deploy before considering
  another change.

## Only exception

Purely server-side changes that don't touch the SPA bundle (e.g. Python
vision service classifier hot-swap, nginx config, backend API) can go
out without a browser check — but STILL curl the endpoint you touched
to confirm it responds correctly.
