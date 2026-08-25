# ADR-0025 — Tenant PWA branding: no ChessGuru leaks on tenant surfaces

**Status:** ⚠️ STANDING (2026-08-25) — treat any regression as P0.

**Context.** ChessGuru is multi-tenant. Every academy can attach a custom
domain (e.g. Guna Chess Academy → `gunachess.com`). When a student on that
domain installs the PWA, opens the browser tab, or sees the address-bar
color, they must see the **tenant's** brand — never "ChessGuru".

Owner reported (2026-08-25) that `deepakcharan` and other guna-chess-academy
students complained that the installed PWA on their Android home screen
showed the ChessGuru name and ChessGuru knight icon instead of Guna. This
affected all 82 students in guna-chess-academy.

## Rule

Every browser-visible brand surface on a tenant custom domain MUST render
the tenant's name, logo, and theme color. Enumerated leak surfaces:

| Surface | Where the brand is set | How it's rendered on a tenant host |
|---|---|---|
| PWA `.name` / `.short_name` | `<link rel="manifest">` fetched at install time | nginx `location = /manifest.webmanifest` proxies to `/api/academy-page/manifest?host=$host` |
| PWA icon (Android home screen) | manifest `.icons[]` | Endpoint returns `/academy/<slug>-192.webp` etc.; if tenant has no upload, returns an inline `data:image/svg+xml,...` monogram of the tenant initial |
| PWA `.theme_color` | manifest `.theme_color` | Endpoint returns tenant accent (`#14a2b8`) |
| iOS "Add to Home Screen" title | `<meta name="apple-mobile-web-app-title">` | Tenant vhost `sub_filter` swaps `ChessGuru` → tenant name |
| iOS home-screen icon | `<link rel="apple-touch-icon">` | Tenant vhost `sub_filter` swaps `/icons/icon-192.png` → tenant sized logo |
| Browser tab title (first paint) | `<title>` in index.html | Tenant vhost `sub_filter` swaps to tenant displayName |
| Mobile address-bar color | `<meta name="theme-color">` | Tenant vhost `sub_filter` swaps `#7c3aed` → `#14a2b8` |
| Favicon | `<link rel="icon">` | Tenant vhost `sub_filter` swaps `/favicon.svg` → tenant logo |
| Error fallback text (SW self-heal) | inline HTML in `index.html:104` | Tenant vhost `sub_filter` swaps "ChessGuru failed to load twice" → tenant name |
| In-app navbar logo + name | React `useTenantBrand()` hook | API call → localStorage cache; already worked before this ADR |

**Explicitly allowed to keep the ChessGuru name** (owner instruction 2026-08-25):
- "Powered by ChessGuru" footer link (attribution, not brand confusion)

## Implementation

- Dynamic manifest: `apps/api/src/academy-profile/academy-profile.controller.ts::manifest()`
  - Resolves host → academy via `lookupByDomain()` then slug-first-label fallback
  - Returns tenant name / short_name / icons / theme_color
  - **Monogram data URI fallback** (`monogramDataUri(name, color)`) for tenants without an uploaded logo — SVG initial letter over the tenant accent gradient, embedded as `data:image/svg+xml,...`. Never falls through to ChessGuru knight.
- Tenant nginx vhost generator: `apps/api/src/academy-profile/academy-domain.service.ts::buildNginxConf()`
  - `location = /manifest.webmanifest { proxy_pass http://localhost:4000/api/academy-page/manifest?host=$host; }`
  - `sub_filter` block that swaps every meta hardcoded above
  - Both `id="cg-favicon"` and `id="cg-apple-icon"` and `id="cg-theme-color"` and `id="cg-apple-title"` sub_filter patterns must include the `id=` selector — nginx `sub_filter` needs exact character match, and `index.html` has the `id=` attr between `name=`/`rel=` and `content=`/`href=` (learned from the first pass on this fix).

## How the leak happened

1. App originally single-tenant (only ChessGuru). Static PWA manifest at `/var/www/chessguru/manifest.webmanifest` hardcoded name + icons.
2. Multi-tenant retrofit added:
   - React `useTenantBrand()` hook (works AFTER JS runs)
   - Tenant nginx vhost with `sub_filter` for `<title>` + favicon (works on first paint)
   - Dynamic `/api/academy-page/manifest?host=X` endpoint (built AND working)
3. **Missing wire-up**: the tenant vhost NEVER contained a `location = /manifest.webmanifest` proxy — so browsers always fetched the static ChessGuru manifest. Apple meta tags (apple-mobile-web-app-title, apple-touch-icon, theme-color) also lacked sub_filter rules because they weren't in the original template.

Every new brand-visible surface must be reviewed against this ADR at PR time.

## Regression test

`v2/scripts/test-pwa-branding.sh` (or a permanent home when we adopt a test runner) — asserts:

- **Tenant (`gunachess.com`)** manifest name/short_name/icons/theme_color = Guna; NO 'ChessGuru' literal appears anywhere in the manifest body; all 6 index.html meta swaps landed.
- **Canonical (`chessguru.cc`)** manifest still returns "ChessGuru" (regression guard).
- **Unknown host** falls back to ChessGuru (regression guard).
- **`/v2api/` proxy** on tenant vhost still works (regression guard on nginx rewrite).

Run before any nginx template / manifest endpoint change:

```
.v2/scripts/test-pwa-branding.sh
```

Expect: `19 passed, 0 failed`.

## When to re-review

- New tenant onboards with a custom domain — vhost auto-regens from
  `buildNginxConf`. Test their host with the test script.
- New brand surface added to `index.html` — add its swap to the template
  AND the test.
- `noindex.html` gains new hardcoded strings — CI grep for
  `>ChessGuru<` or `content="ChessGuru"` on any tenant host.
- A tenant WITHOUT a logo signs up — verify the monogram fallback fires
  in their manifest, not the ChessGuru knight.

## Related

- `PROJECT_MASTER/plans/CHESSGURU-SAAS-VISION.md`
- `feedback_dreamcy_tenant_theme_mandate.md` (POS side, same principle)
