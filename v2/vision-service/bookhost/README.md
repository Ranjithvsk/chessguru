# Book host (runs on Vinayaka)

The owner's chess library lives in their Google Drive and is read by the GPU box,
not by the API server. These files are the copy of record; the originals run from
`E:\dreamocr` on Vinayaka as the scheduled task `ChessGuruBookHost`.

- `bookhost.py` — catalogue, queue, worker and page server on `127.0.0.1:8791`.
  It has **no authentication of its own**: it binds localhost, reaches this box
  only through `chessguru-bookhost-tunnel.service`, and the session and
  ownership checks live in `user-books.controller.ts`. Do not expose it.
- `organise.py` — turns dump-site filenames into titles, authors and shelves.
- `move_dupes.py` — moves duplicate copies into `_duplicates` for review.
  Moves, never deletes, and `--undo` reverses the whole run from its manifest.
- `ingest_book.py` — reads one book: render, find diagrams, OCR, sanity-check.

## Deduplication, 2026-09-10

4,101 files held 3,031 distinct books. 1,065 redundant copies were moved to
`G:\My Drive\Chess\_duplicates` (13.6 GB "identical", 0.5 GB "probable"), with
`F:\chessguru-books\duplicates-manifest.csv` recording every original path.
The distinct-title count did not change, which is the check that matters: no
book left the library.

Five look-alikes were deliberately left alone. "Chess.pdf" exists at 3.5 MB and
at 44.1 MB — two different books that share a generic filename, and a title
match alone would have removed one of them.
