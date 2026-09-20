# 2026-09-20 — Book reader: small board after tapping a diagram, hotspots off on phones, library books 404

Owner: "in book reader the chess board size after clicking an image became small why".

## What was wrong (measured with a mocked book on the live site, five window sizes)
| Window | Board after tap (before) | Diagram box vs printed diagram |
|---|---|---|
| desktop 1440×900 | 350 px | exact |
| desktop window 900×800 (or a zoomed browser) | 274 px | exact |
| tablet 820×1180 | 494 px | exact |
| phone 390×844 | 300 px | 11 % too big, shifted |
| phone 360×640 | 181 px | 11 % too big, shifted |

1. **Board.** Below 1024 px wide the position panel pins to the lower 58 % of the window
   and the board was capped at `calc(58vh-190px)` (d478df5, 2026-09-10, to keep the
   controls reachable). On small phones and half-width/zoomed desktop windows that is a
   tiny board next to a large printed diagram.
2. **Hotspots.** Since yesterday's sized page variants (1af4f57) a phone loads an 800 px
   page while the scan's bboxes are in the 887 px original; the reader took the bbox space
   from `naturalWidth`, so every hotspot was scaled by 887/800.
3. **Found on the way:** every library book not already in the bookhost cache returned 404.
   `ensure_local()` fetched the PDF from B2 fine, then `trim_cache()` deleted it: rclone
   stamps the file with the object's August mtime/atime, so a full cache treated the new
   file as the least-recently-read.

## Fix
- `bookhost.py`: `GET /book/<id>/pagesizes` → `(page.rect*Matrix(150/72)).irect` per page,
  no render (48 pages checked against real pixmaps, 0 mismatches). `ensure_local()`
  touches the fetched file and calls `trim_cache(keep=path)`.
- API `user-books.controller.ts`: `pageSizes` on the book detail — host books from the new
  route, France-ingested books from the JPEG headers under `pages/` (`jpegSize()`, cached
  as `pagesizes.json`). Pages within one book differ (884 vs 887 px), so per page.
- `BookReader.tsx`: hotspots and the aspect-ratio reservation use `book.pageSizes[p]`,
  natural size only as fallback. Pinned panel from 32 % of the height, board capped at
  `min(100%, calc(68dvh-150px))`; sidebar 440 px from 1280 px wide.

## After
desktop 410 px · 900×800 window 394 px · tablet 652 px · phone 390 → 340 px · phone 360 →
285 px; hotspots exact at every size; uncached library books render in ~2.5 s, cache hit
0.1 s. Deployed: bookhost restarted, API rebuilt + restarted, web published.
