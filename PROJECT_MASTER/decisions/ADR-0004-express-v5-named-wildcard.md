# ADR-0004: Express v5 catch-all uses the named wildcard `/*splat`

**Status:** Accepted · **Date:** 2026-04 (documented 2026-05-29)

## Context
The app runs **Express v5**, whose router uses a newer `path-to-regexp`. The classic catch-alls
(`app.use('*', …)` / `app.get('*', …)`) throw at startup under v5.

## Decision
Use a **named** wildcard for the SPA catch-all:

```js
app.get("/*splat", (req, res) => res.sendFile(__dirname + "/public/index.html"));
```

## Consequences
- Any future catch-all / wildcard route must use the named form.
- The catch-all is registered **last**, after auth routes, `/api`, and `/blindfold`, so it only
  serves `index.html` for unmatched paths.
