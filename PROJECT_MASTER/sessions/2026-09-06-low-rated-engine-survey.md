# 2026-09-06 — Surveying open-source low-rated engines as bot opponents

Owner asked whether we could use engines other than Maia for the Play bot, and then:
*"download all open source low rated chess engine"*.

Ten candidates were cloned, built and UCI-smoke-tested into `/home/dreamworld/opt/engines`.
Manifest: `/home/dreamworld/opt/engines/engines.json`; smoke harness: `smoke.sh`.

## Result

**Six work, four are broken — and the working six are all ~1800–2000, none of them low.**

| engine | licence | claimed Elo | strength dial |
|---|---|---|---|
| sunfish 2026 | GPL-3.0 | ~1950 | none |
| Minace 1.0 | MIT | ~1900 | none |
| mchess.exe 1.02 | MIT | ~1800 | none |
| Weak v2.0.0-dev | MIT | unstated | none |
| Claudia 0.5.1 | BSD | ~2000 | none |
| Stockfish 19 | GPL-3.0 | ~3600 | `UCI_Elo` 1320–3190, `Skill Level` 0–20 |

Broken: **Achillees** (~800) returns the invalid move `a1a1p` from startpos under every `go`
variant; **Napoleon** (~800) only at tag 1.7.0 — HEAD now needs onnxruntime; **clever-girl**
(~700) fails to compile (`first_sq`/`last_sq` undeclared); **cpw-engine** segfaults on the
first `go`.

## Why this is a dead end

1. **The low ratings and the working builds are disjoint sets.** Everything genuinely rated
   under ~1500 is an abandoned student project that no longer compiles or is simply buggy.
   Anything still maintained is ≥1800. As one of the source threads puts it, implementing
   even basic alpha-beta is already worth ~1200, so nobody maintains a deliberately weak
   engine.
2. **None of the small engines has a strength dial.** Each plays at exactly one fixed level,
   so covering a student rating range would need dozens of separate engines — and we cannot
   get below ~1800 at all.
3. **Each has its own UCI quirks.** Claudia ignores `go movetime` and `go depth` entirely and
   only answers `go infinite` + `stop`; mchess2's Makefile cross-compiles to Windows unless
   `CC=g++` is forced. Every engine would need its own adapter in `apps/bot-player`.
4. **Fixed-depth weak engines are not human-like** in the way Maia is — the failure mode is
   "correct for twenty moves, then hangs a queen", which is what we were trying to avoid.

## Recommendation

Keep Maia-3 as the opponent. For the range Maia's compressed `SelfElo` dial covers badly,
the two real options are both already referenced in the repo:

- **Maia-1 weights** (`maia-1100` … `maia-1900`) via lc0 — nine genuinely human-like rating
  levels. `engine-battle/engines.json` already carries `maiaWeightsUrl`. lc0 is not yet
  installed on this box.
- **Stockfish `UCI_LimitStrength` + `UCI_Elo`** (floor 1320) for analysis and for any
  above-1900 opponent. Now built at `/home/dreamworld/opt/engines/src/Stockfish/src/stockfish`
  — note there was previously **no stockfish binary on this VPS at all**, despite
  `engine-battle/engines.json` listing eleven engines by binary name.

## Files

- `/home/dreamworld/opt/engines/engines.json` (new manifest)
- `/home/dreamworld/opt/engines/smoke.sh` (new)
- `/home/dreamworld/opt/engines/src/*` (ten clones, six built)
- `Minace/Minace/src/Util.h` — added `#include <cmath>` for gcc 14

## Open items

- `engine-battle/engines.json` references binaries (`stockfish`, `viridithas`, `berserk`, …)
  that do not exist on this host. Either the engine-battle pipeline has been dead for a
  while or it ran elsewhere — worth confirming before trusting `enginegames`.
- Nothing here is wired into `apps/bot-player` yet; this was a survey only.
- Disk is at 87% (26G free); Stockfish alone is 99MB.
