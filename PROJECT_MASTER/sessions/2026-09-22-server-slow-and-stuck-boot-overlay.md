# 2026-09-22 — TKT-255 server slow/not loading, TKT-257 stuck "Loading" overlay

## TKT-255 — the box ran out of RAM (ops, no code)
France (23 GB RAM + 12 GB swap) filled up and thrashed: swap 8.9/12 GB, load 6.3,
`chessguru-v2-api` OOM-restarted 13:19 IST and nginx logged
`connect() failed (111: Connection refused)` to :4000, so every page 502'd.

Hogs, both safe to kill and both recurring:
- `dedup_after_ingest.sh` → `dedup_pass.py` (chessdb dedup batch, ~2 GB, heavy I/O).
- **TWO leaked Surya OCR `llama-server` processes**, orphaned to init (ppid=1), 5 and 12
  days old, ~3.5 GB together. `dream_ocr.py:_ensure_llama_server` spawns them and never
  reaps them. **Follow-up owed: reap/limit these.**

Killed both → RAM 13.1→9.7 GB used, swap 8.9→5.8 GB. `swapoff -a && swapon -a` then reset
stale swap, but **`swapon -a` only restored `/swapfile` — `/swapfile2` (8 GB) needed an
explicit `swapon /swapfile2`**; check `swapon --show` shows 4G+8G after any swap reset.
After: load 1.6, RAM 8.9 GB free, chessguru.cc 106 ms, api 76 ms, chessdb 67-81 ms.

## TKT-257 — the "Loading ChessGuru…" overlay stranded on top of a working app
The owner's screenshot showed the boot overlay frozen over a puzzle board that had fully
rendered underneath (rating 1753, "Find the best move", themes all present).

`index.html` paints `#cg-boot-status` (`position:fixed; inset:0`, opaque) as the
white-screen safety net. **The only thing that removed it was a 250 ms poller in the same
file that gave up after 60 s.** Boot took longer than that under the memory pressure, so
by the time React mounted nothing was left to take the overlay down.

Fix (all three needed):
1. `main.tsx` renders a `<BootDone/>` component whose `useEffect` calls
   `window.__cgBootDone()` — it must fire on **commit**: a bare call at module scope runs
   *before* DOMContentLoaded, i.e. before the overlay is even created. The first attempt
   did exactly that and made it worse (killed the poller, then the overlay appeared) —
   caught by the headless check, not by eye.
2. `__cgBootDone` sets an `appBooted` flag; `ensureStatus()`/`markStuck()` refuse to
   create or re-show the overlay after it, and the node is removed outright.
3. The 60 s give-up is gone (10 min ceiling instead) so the poller alone still wins.

## Academy name on the boot screen (owner request)
`applyBrand()` publishes `window.__cgBrandName`; the splash builds its title from it, so an
academy domain shows "Loading Guna Chess Academy…". On an unresolved tenant host it says
plain "Loading…" rather than leaking "ChessGuru" (tenant-branding rule).

## Verified
Headless on the live build, both domains: overlay `present:false` after mount; tenant splash
read "Loading Guna Chess Academy…". Server: load 1.6, API stable, no further restarts.
