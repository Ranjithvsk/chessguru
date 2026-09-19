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

## "Can we make it super fast" (same day)
- **Sized pages**: `GET :id/page/:n?w=` serves a bucket (w800 / w1200 / w1600, mozjpeg progressive)
  built once with sharp into the France cache; `GET :id/thumb/:n` = 320 px cover (~26 KB vs
  ~290–457 KB). Measured on a text page: original 457 KB → w800 189 KB, w1200 325 KB; WebP would
  only save a further ~13 % (pages are already grayscale), so JPEG stays.
- Reader picks the bucket from screen width × DPR (capped at 2×) and prefetches the next three
  pages; server warms the next three variants after each page it serves. Everything is
  `Cache-Control: private, max-age=31536000, immutable`.
- **HTTP/2** switched on for chessguru.cc and every academy/coach domain (`http2 on;` in
  sites-enabled/chessguru, coach-domains/*.conf and both vhost templates) — dozens of small
  page requests now share one connection.
- `apps/api/tools/prewarm-book-variants.js` pre-builds thumb + w800 + w1200 for every local book
  (run as ubuntu with nice; ran once on 2026-09-19 night).
