# ChessGuru — Rules & Gotchas

## Working conventions

- **Authority:** trust the **code** for current behaviour. `CLAUDE.md` is the authoritative
  engineering guide for Claude Code; `PROJECT_MASTER.md` (the original flat file) is a historical
  session log; this `PROJECT_MASTER/` folder is the human-readable knowledge hub.
- **This is a live production app** (24+ day uptime, real users). Prefer additive, reversible
  changes. Operate as the `ubuntu` user (`sudo -u ubuntu …`), never as `dreamworld`/root, so file
  ownership and git stay consistent.
- **Test-page workflow** ([ADR-0005](decisions/ADR-0005-test-page-workflow.md)): new features go in
  `public/test/feature.html` first, get confirmed working, *then* merge into `index.html` /
  `blindfold.html`. Editing production HTML directly has broken the live page before.
  > NOTE: as of 2026-05-29 there is **no `public/test/` directory** — the rule exists but isn't
  > being followed. Create it before the next feature.
- **No test framework.** `npm test` is unconfigured. Verify by hitting endpoints
  (`curl localhost:3000/api/health`) or exercising the UI in a browser.
- Restart via PM2 only — never `node server3.js` directly in prod.
- Root one-off scripts (`build_pools*.js`, `gen_*.js`, `diag*.js`, etc.) are maintenance helpers;
  **do not import them from server code**.

## Hard-won lessons (do not "fix" these)

| Symptom | Cause / Resolution |
|---|---|
| `bcrypt`: "data and hash must be strings" | `bpass` is a `Buffer` in the schema → Mongoose returns BSON Binary. Auth uses the **raw driver** and normalizes via `hash.buffer.toString('utf8')`. Don't switch auth to the Mongoose model. [ADR-0002] |
| `E11000 duplicate key lichessId_1` on register | Stale unique index on `users`. Fixed once with `db.users.dropIndex("lichessId_1")`. |
| Express catch-all crashes path-to-regexp | Express v5 needs a **named** wildcard: `app.get("/*splat", …)`. Bare `*` fails. [ADR-0004] |
| `MongoStore.create is not a function` | `require('connect-mongo').default` (v4+ ESM export), then `.create(...)`. |
| `req.session` undefined in routes.js | Session middleware must be mounted **before** `require("./routes")` — which is why routes load inside the connect callback. [ADR-0001] |
| `OverwriteModelError: Cannot overwrite User model` | Two files defined the `User` model. Define once in `models.js`, import elsewhere. |
| Production HTML left broken after a partial edit | Use the test-page workflow; never hand-edit production HTML in place. [ADR-0005] |
| Lost work because `.bak` files were stale | Repo is under git now — commit early. (`.gitignore` covers `node_modules/`, `*.csv`, `.env`, `*.bak*`, `public/*.bak*`, `public/result.txt`, `public/exit.txt`.) |

## Known follow-ups / risks

- `SESSION_SECRET` falls back to a hardcoded string if unset — set a real one in `.env`.
- Duplicate-cased Mongo collection `piecePools` (590) vs empty `piecepools` (0) — clean up.
- `engine-updater` PM2 process is stopped — confirm that's intended (run on demand).
