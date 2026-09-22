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

## The OCR leak itself (root cause of TKT-255), fixed
`surya/inference/backends/llamacpp.py` spawns the model server with
`subprocess.Popen(..., start_new_session=True)` — `setsid()`, so it leaves our session
and survives us — and `stop()` is a no-op that defers to an `atexit` handler in
`spawn.py`. `atexit` does not run on SIGKILL, on the OOM killer, or on a default
SIGTERM. `scoresheet_jobs.py` runs each scoresheet read as its own short-lived
`.venv-ocr/bin/python read_scoresheet.py` process, so every run that was killed rather
than exiting cleanly stranded a 1-3 GB `llama-server` reparented to init. Hence two
orphans (ubuntu 5 days, dreamworld 12 days, different HF caches, random ports).

Fix: `llama-server-pdeath.c` (gcc, no deps) sets `PR_SET_PDEATHSIG(SIGKILL)` and execs
`$CG_LLAMA_REAL`; `PR_SET_PDEATHSIG` survives `execve`, is unaffected by `setsid`, and
the wrapper stays the direct child of python — so the kernel kills the server with its
parent however it dies. Guards a `getppid()==1` race. `_ensure_llama_server()` points
`LLAMA_CPP_BINARY` at it (and no longer early-returns when a bare `llama-server` is on
PATH, which would have skipped the wrapper). Safety net for paths that never touch
`dream_ocr.py`: `/usr/local/sbin/reap-orphan-llama.sh`, root cron */15, kills
`llama-server` with ppid=1 older than 10 min.

Proven: parent SIGKILLed → child gone (the exact case atexit cannot cover).

## Why no alert mail — and the alarm that was missing
Owner asked why no error mail arrived. Three independent reasons:
1. **Nothing alerted on memory.** `server-monitor` collected MEM/SWAP for the dashboard,
   but the only resource alarm was `diskCheck(mounts, 85)`. The exact condition that took
   the site down had no alarm at all. **Added `memCheck(12, 80)`** to France, Mumbai and
   Singapore: `SVC=Memory pressure|inactive|1` when MemAvailable < 12% or swap >= 80%,
   which flows through the existing 2-cycle → alert-mail pipeline (the svc alert filter
   was widened from `^(Backup|Disk)` to `^(Backup|Disk|Memory)` with its own detail line).
   The signal is MemAvailable, not "used" — Linux spends idle RAM on cache, so "used %"
   is high on a healthy box. The pill name is CONSTANT on purpose: an alert key carrying a
   live percentage changes every cycle and can never hold for the two cycles required.
   Verified live: all three boxes report `active`; simulated incident levels (avail 4%,
   swap 72%) report `inactive`, i.e. it would have mailed.
2. **The API probe never tripped.** pm2 restarted `chessguru-v2-api` in about 3 seconds —
   far inside the 2-cycle (~2 min) confirmation window — so the health probe never failed
   twice in a row. A fast crash/restart is invisible to it by design.
3. **The blocking symptom was client-side** (stranded boot overlay); no server check sees it.

Mail was NOT broken: the monitor mailed backup-stale and Mumbai-flapping alerts the same
morning (`[alert] mail 200`), and mailHealth was ok. Monitor alerts go direct via :4025 and
never appear in ChessGuru's `mailLog`, so an empty mailLog is not evidence of silence.

`server-monitor/` is gitignored (it holds the internal token) — the change is carried by
the nightly France borg backup, which now includes that directory.
