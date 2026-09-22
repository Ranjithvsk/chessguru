# llama-server-pdeath — why the OCR model server needs a wrapper

Surya's llama.cpp backend starts the OCR model server like this
(`surya/inference/backends/llamacpp.py`):

```python
proc = subprocess.Popen(cmd, stdout=log_fp, stderr=subprocess.STDOUT,
                        start_new_session=True)
```

`start_new_session=True` calls `setsid()`, so the server leaves our session and does
**not** die with us. Its only cleanup is an `atexit` handler in
`surya/inference/backends/spawn.py` — and `atexit` does not run on `SIGKILL`, on the
OOM killer, or on a default `SIGTERM`. `scoresheet_jobs.py` runs every scoresheet read
as its own short-lived python process, so each run that is killed rather than exiting
cleanly strands a 1–3 GB `llama-server`, reparented to init (`ppid 1`), forever.

On 2026-09-22 two of them (5 and 12 days old, ~3.5 GB together) filled France's RAM.
The box thrashed on swap, `chessguru-v2-api` OOM-restarted and ChessGuru stopped
loading for everyone (TKT-255/257).

**The fix.** `dream_ocr.py:_ensure_llama_server()` points `LLAMA_CPP_BINARY` at this
wrapper and passes the real binary in `CG_LLAMA_REAL`. The wrapper sets
`PR_SET_PDEATHSIG(SIGKILL)` and `execv`s the real server. `PR_SET_PDEATHSIG` survives
`execve` and is unaffected by `setsid`, and the wrapper stays the direct child of the
python process — so the kernel kills the model server the moment its parent dies,
*however* it dies. There is a deliberate `getppid() == 1` check for the race where the
parent dies between `fork()` and `prctl()`.

Build (gcc, no dependencies):

```
gcc -O2 -Wall -o /opt/chessguru-vision/llama/llama-server-pdeath llama-server-pdeath.c
```

`ops/reap-orphan-llama.sh` (root cron, every 15 min) is the belt-and-braces half: it
kills any `llama-server` whose parent is init and which is older than 10 minutes. A
server in use is always the child of a live python process, so an orphan is
unambiguous. That covers servers started by code paths that never touch `dream_ocr.py`.
