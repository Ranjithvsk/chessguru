# 2026-09-19 — Library shelf / book reader slow

**Why.** `GET /api/user-books` (the shelf) merged the local books with Vinayaka's catalogue by
fetching `http://127.0.0.1:8791/books` through the reverse tunnel on every call — 2,983 books,
630 KB, ~1 s at best over the PC's residential uplink and up to 24 s when that uplink was busy
(12 slow-route events this week). And `MyBooks.tsx` re-fetched the shelf every 5 s unconditionally.
Reading a Vinayaka-hosted book pulled every page through the tunnel each time, after a `/meta`
round trip per page for the ownership check.

**Fix.**
- API (`user-books.controller.ts`): the host catalogue is memoised for 45 s and each book's meta
  for 5 min (failures are not cached; a 12 s cap so the shelf can't hang); remote pages are cached
  on France under `/var/lib/chessguru/user-books-cache/<id>/pNNNN.jpg` (owner ubuntu) and the next
  two pages are warmed in the background after each page served.
- Web (`MyBooks.tsx`): polls every 5 s only while a book is queued/rendering, otherwise every
  60 s and on window focus.
Local books were never the problem (22 books, diagrams.json ≤ 140 KB).
