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
