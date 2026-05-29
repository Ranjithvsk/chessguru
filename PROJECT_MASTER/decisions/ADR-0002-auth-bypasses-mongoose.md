# ADR-0002: Auth uses the raw MongoDB driver, not Mongoose

**Status:** Accepted · **Date:** 2026-04-25 (documented 2026-05-29)

## Context
The `User` schema declares `bpass` (the bcrypt hash) as `type: Buffer`. Mongoose therefore
returns it as a **BSON `Binary`** object, and `bcrypt.compare(password, binary)` throws
`"data and hash must be strings"`. Sign-in failed even with the correct password.

## Decision
`auth.js` accesses users via the **raw driver** — `mongoose.connection.db.collection('users')`
— for `register`/`signin`, bypassing the `User` model entirely. On read it normalizes `bpass`
to a string before comparing:

```js
let hash = user.bpass;
if (hash && typeof hash === 'object') {
  if (hash.buffer) hash = hash.buffer.toString('utf8');         // BSON Binary
  else if (Buffer.isBuffer(hash)) hash = hash.toString('utf8'); // Node Buffer
  else hash = String(hash);
}
```

## Consequences
- **Do not** "clean this up" by switching auth to the `User` Mongoose model — it reintroduces the
  BSON Binary bug.
- Username lookup is case-insensitive (regex), and the regex input is escaped in `signin`.
- A historical blocker — a stale `lichessId_1` unique index — was dropped with
  `db.users.dropIndex("lichessId_1")`.
