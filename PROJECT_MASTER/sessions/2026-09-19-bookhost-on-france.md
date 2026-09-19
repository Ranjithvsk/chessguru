# 2026-09-19 — Book host moved to France's data disk

**Before.** The reader's remote books came from `bookhost.py` on Vinayaka (E:\dreamocr, store
F:\chessguru-books, PDFs on G:\My Drive\Chess) through the reverse tunnel → every page crossed the
owner's home uplink. Singapore held only a copy of the store (3.7 GB, no PDFs).

**Now.** France runs the same host: `/srv/data/bookhost/bookhost.py` (ported: env paths, `localize()`
maps the Windows PDF paths in each meta.json onto `/srv/data/chess-library`, `BOOKHOST_WORKERS=0`
— ingest/GPU stays on Vinayaka — and `fetch_from_drive()` pulls a missing PDF from `gdrive:Chess`
on first open, ~5 s). Store copied Singapore → `/srv/data/chessguru-books` (16,311 files, 2,982
books); PDFs for the ingested books (~39 GB of the 54 GB Drive folder) pulled from Drive into
`/srv/data/chess-library` (data disk: 100 GB, 63 GB was free). Unit `chessguru-bookhost.service`
(user dreamworld, vision venv python) on 127.0.0.1:8791 — the API needed no change;
`chessguru-bookhost-tunnel.service` disabled (re-enable it and stop the host to roll back).
Nightly `sync-books.sh` (cron 03:30 UTC): `rclone sync pc:F:/chessguru-books` for new ingests +
PDF top-up from Drive (skips when < 8 GB free). Measured: mirrored page 494 ms first open (PDF
open + render), on-demand Drive book 5.3 s; the API's page cache/variants sit in front.

## Correction — the PDFs came from Singapore, not Drive
Singapore (`sg:/home/ubuntu/chess/chess-library`) holds the full de-duplicated library: 3,841 PDFs,
44 GB, flat (one directory, filenames as on Drive). It matches 2,962 of the 2,975 needed books by
filename; Drive had throttled the direct pull to ~1 MB/s, Singapore → France runs at ~25–30 MB/s.
Layout on France: `/srv/data/chess-library-flat/<file>.pdf` (the copy) + `/srv/data/chess-library/<Drive path>`
symlinks made by `link-library.py` from `needed-pdfs.txt`, so the host's localize() paths resolve.
The 13 books Singapore lacks still open through the on-demand Drive fetch. `sync-books.sh` now runs
the link pass before any Drive top-up.
Result: Singapore copy 3,841 PDFs / 42 GB in 30 min; 2,958 books linked (2,216 symlinks + 742 turned
from Drive-pulled duplicates into symlinks, 9.4 GB freed), 12 real files kept, 6 with no local copy
(Drive on-demand). Page via symlink 213 ms. Data disk after: 83 GB used / 15 GB free — tenants:
library 42 GB, chessguru-vision ~28 GB, borg 8.2 GB, store 3.7 GB, pgbackrest 0.9 GB.
