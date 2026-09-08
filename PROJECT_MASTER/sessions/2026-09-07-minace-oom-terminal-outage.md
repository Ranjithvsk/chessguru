# 2026-09-07 — Minace ate 20 GB four times and took the web terminal down with it

**Symptom.** term.dreamcy.com / term.dwp.in down for ~100 s at 02:44, 03:38, 08:58, 16:09 UTC;
every open Claude tab lost its session each time.

**Chain.** A `minace` process (uid dreamworld, spawned from a terminal tab during the engine
survey / ladder work) grew to 10-20 GB → kernel OOM-killed it → its cgroup was `ttyd.service`,
whose systemd default `OOMPolicy=stop` then stopped the *whole* unit → every dtach session +
Claude Code session got SIGTERM, hung 90 s, SIGKILL, unit auto-restarted.

**Why Minace grew.** `Uci::run()` ignored a failed `getline`: on stdin EOF it looped forever on an
empty line, and every iteration appended to the default log — a `std::stringstream` nobody ever
read. 100% CPU, ~50 MB/s, forever. Any parent that died (a Claude tab, `smoke.ts` calling
`process.exit`, a pm2 restart) left one behind. Second bug: `getMove()` cleared the stop flag on
the search thread, so a `stop`/EOF that landed before that line was lost → `go infinite` could
never be stopped and `join()` blocked forever.

**Fixes (all live).**
- `/etc/systemd/system/ttyd.service.d/oom.conf` — `OOMPolicy=continue`, `MemoryMax=14G`,
  `MemorySwapMax=4G`, `KillMode=process`. Outside git; see operational/TERM_DWP_WEB_TERMINAL.md.
- Minace source (`~/opt/engines/src/Minace/Minace/src`, uncommitted in that clone):
  `Uci.h` breaks on EOF, re-asserts stop until the search thread ends, `cleanup()` before a Hash
  `setoption`; `main.cpp` default log is a null streambuf. `make CONF=Release`; old binary kept as
  `minace.bak-2026-09-06`. Verified: 31 MB flat over 300 moves, EOF → exit in 60 ms in every
  state (idle, `go infinite`, `go movetime`), `stop` returns `bestmove`.
- bot-player (`apps/bot-player/src`, uncommitted here, rsynced to the ubuntu clone, `pm2 restart
  play-bot` 16:27 UTC with no game live): `PlainUciEngine` spawns via `prlimit --as`
  (`PLAIN_ENGINE_AS_MB`, default 2048); `EnginePool.killAll()` on exit/SIGINT/SIGTERM and at the
  end of `smoke.ts`; `UciProc` takes a `label` for log lines.
- `~/opt/engines/capped.sh [-m MiB] <cmd>` for anything run by hand from a tab.

**Verify a repeat.** `sudo journalctl -u ttyd | grep -E "oom-kill|Consumed"`;
`sudo journalctl -k | grep "Killed process"` (the `task_memcg` names the cgroup).
