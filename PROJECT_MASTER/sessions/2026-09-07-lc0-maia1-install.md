# 2026-09-07 — lc0 + Maia-1 (1100–1900) installed

Follow-on from the [low-rated engine survey](2026-09-06-low-rated-engine-survey.md), which
concluded that no working open-source engine exists below ~1800 and none of them has a
strength dial. Owner: *"install lc0 and maia 1100 to 1900 weights"*.

## What landed

- **lc0 v0.32.1**, built from source at `/home/dreamworld/opt/engines/src/lc0/build/lc0`
  (2.6 MB). There are **no Linux binaries in the lc0 releases** — Windows and Android only —
  so it is a meson/ninja build with the CPU backends: `-Dblas=true -Dcudnn=false
  -Dopencl=false`, abseil + eigen pulled as subprojects. meson 1.7.0 / ninja 1.12.1 were
  already on the box.
- **Nine Maia-1 networks**, `maia-1100 … maia-1900`, 12 MB total, in
  `/home/dreamworld/opt/engines/weights/maia1`. Source is the `maiaWeightsUrl` pattern that
  `engine-battle/engines.json` already carried. All nine verified as valid gzip.
- Harness `maia1-smoke.sh`; manifest updated at `/home/dreamworld/opt/engines/engines.json`.

## Two things that will bite whoever wires this up

1. **Maia-1 is policy-only — every `go` must be `go nodes 1`.** The human-likeness *is* the
   raw policy head. Give it a real search and you get a weak Leela, not a human at that
   rating. This is the most common way these weights get misused.
2. **lc0 quits on stdin EOF**, and the EOF can arrive before the network has even finished
   loading. That is what made all nine levels report FAIL on the first run — the engine was
   fine, the test harness was closing the pipe. A long-lived process (which is what
   `apps/bot-player` uses) is unaffected; one-shot pipes must hold stdin open until
   `bestmove`.

## Verification

| test | result |
|---|---|
| startpos | all nine play `e2e4` — correct, and proves nothing |
| Blackburne Shilling: `1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4!?` | **maia-1100 plays `Nxe5??` and falls for the trap; 1200–1900 all play the correct `Nxd4`** |
| Noah's Ark: `…6.Bb3 Nxd4 7.Nxd4 exd4` | all nine play `Qxd4` — the whole ladder walks in |

The Blackburne result is the one that matters: it demonstrates genuine, human-shaped
strength separation at the bottom of the ladder. The Noah's Ark result is an honest
negative and is *also* the expected behaviour — a 1100 and a 1900 play the same move in most
positions and diverge only in specific ones. Do not read "all nine agree" as "the levels are
identical".

## Why this matters for rated play

Maia-3's `SelfElo` dial is compressed 0.46x (see
[plans/human-like-bot-opponent.md](../plans/human-like-bot-opponent.md)), so it cannot map
1:1 to a student rating, which is what still gates rated go-live. Maia-1 sidesteps that
entirely: each network was trained on human games *at that rating band*, so the level is the
rating by construction rather than by a dial that needs calibrating.

## Files

- `/home/dreamworld/opt/engines/src/lc0/` (new build)
- `/home/dreamworld/opt/engines/weights/maia1/maia-{1100..1900}.pb.gz` (new)
- `/home/dreamworld/opt/engines/maia1-smoke.sh` (new)
- `/home/dreamworld/opt/engines/engines.json` (manifest, `maia1` section added)

## Open items

- ~~Not wired into `apps/bot-player` yet~~ — **done 2026-09-07**, see
  [2026-09-07-play-bot-ladder-shipped.md](2026-09-07-play-bot-ladder-shipped.md).
- Nine separate processes vs one: Maia-3 is a single process whose `SelfElo` is set per
  game; Maia-1 needs a distinct process per level, so the bot pool needs a process cache
  keyed by level.
- lc0 is CPU/eigen only here. Fine for `nodes 1` (no search), but do not expect it to do
  analysis work at speed.
- Disk now at 87%; the lc0 build tree is the bulk of the new footprint.
