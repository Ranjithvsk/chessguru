# 2026-09-09 — Board scan moved off the API thread (TKT-166); vision retrain pipelines revived

Owner: *"what is the status of scan position in our chess guru"*, then TKT-166 (*"Check this"*, a
screenshot of `/board-editor` showing `Manual warp failed: classify 502`), then *"what happened to
live class, this is dangerous"*, *"fix the retrain pipelines first"*, *"fix the watchdog too"*.

## The incident

A coach scanned a photo of a book page. Access log, his session:

```
14:25:52  classify-board-ultra   201   auto scan SUCCEEDED
14:26:20  warp-with-corners      201   tapped Adjust corners
14:26:39  save-corner-labels     201
14:27:10  classify-board-v2      502   died here
```

Three faults stacked:

1. **The manual "Adjust corners" path called the old `/classify-board-v2`.** That route runs 64
   sequential DINOv2-base forwards *inside* the API process. Node is single-threaded, so for ~31s
   nothing else the API serves could be answered.
2. **A watchdog cron (`scripts/watchdog.sh`, every minute) restarted the API for it.** It polled
   `/api/health` with an 8s timeout and restarted on a *single* failed poll. A busy API and a dead
   API were indistinguishable to it. `watchdog-chessguru-v2-api.log`:
   `14:27:01Z DOWN (body='<none>') — restarting chessguru-v2-api`.
   That killed the in-flight scan (the coach's 502, via nginx `upstream prematurely closed`) **and
   every live class WebSocket** — room `cmtu664auxjbl` on gunachess.com dropped for ~4s; both
   clients auto-reconnected at 14:27:14/15. 14 such restarts since 2026-08-15.
3. **His crop included the a-h / 1-8 coordinate labels**, so the 8×8 split landed half a square off,
   every piece was sliced across two tiles, and each real square read "empty" at 0.99–1.00
   confidence. Verified by replaying his own warp:

   | crop | FEN | conf |
   |---|---|---|
   | his (labels inside) | `1b6/P7/P7/P7/8/8/3Pn3/4N3` | 0.887 |
   | label margins trimmed | `8/8/8/6pP/6P1/8/8/K7` | 0.990 |

   Same photo, same model, 63/64 squares correct once the margins are gone. (The one miss: the
   black king on g5 reads as a pawn.)

## What landed

**Web** (`apps/web`, no API change — `classify-board-ultra` was already deployed):
- `BoardEditor.tsx` — `runUltraScan()` now takes `HTMLCanvasElement | string`, so a server-warped
  board can be handed to it directly. Both remaining callers of the old in-process route now go
  through it: the Adjust-corners handler, and the visible button formerly labelled *"🚀 Try Server
  AI (DINOv2)"* (its own tooltip said "3-30s"), now *"🚀 Re-read my crop"*. `classify-board-v2`
  appears **0 times** in the shipped bundle.
- `BoardEditor.tsx` — missing-king guard. Every real position has both kings and a printed diagram
  always shows them, so an absent king means the read failed; the message names the likely cause
  and points at the corner tool. Deliberately **not** gated on `warpQuality.parity`: measured on
  real logged crops parity does not separate good reads from bad (a verified 64/64 scan scored
  0.641, the broken TKT-166 crop scored 0.719).
- `CornerAdjuster.tsx` — handles go on "the corners of the 64 squares", *inside* the labels, with
  the consequence spelled out.
- Upload copy replaced. It still claimed detection was "naive — colours + occupancy only; piece TYPE
  comes back as a pawn placeholder", untrue since the Ultra pipeline shipped in August.

**`scripts/watchdog.sh`** — restarts are now confirmed before acting. A socket that *refuses* the
connection (curl 7) means nothing is listening: confirm twice, restart in ~10s. A socket that
*accepts but answers slowly* means the process is alive and busy: it takes 4 failed probes over
~70s to act. `flock` stops overlapping cron minutes from double-restarting. Tested against real
listeners — healthy → no-op; refused → restart; accept-but-hang-40s-then-recover → **no restart**,
logged `TRANSIENT`; permanently wedged → restart.

**Vision retrain — all three pipelines were dead, each differently.**

| pipeline | root cause | fix |
|---|---|---|
| 22:00 cron, classifier | venv lived in `/tmp`, which is cleaned on a 10-day policy; `cairosvg` had been partly eaten since ~2026-09-04 | venv rebuilt at `/opt/chessguru-vision/.retrain-venv`; `gen-train-data.py` + `hourly_vision_check.sh` moved out of `/tmp`; cron repointed |
| 02:15 systemd, extractor | unit ran as `ubuntu`, but the `vinayaka` ssh alias exists only in dreamworld's config → `skip: vinayaka unreachable` every night since install | `User=dreamworld`; log + state dir made writable |
| every-24-min loop, extractor | input pool fixed at 476 web photos and exhausted (`kept=0` on 1615 of 1619 cycles); trainer needs +500 new diagrams, sat at +183 forever; still wrote an identical 6.7MB `.pt` each cycle and logged a false "HOT-SWAP done"; ran `taskkill /IM python.exe` on Vinayaka every cycle | **retired**; `hourly_vision_check.sh` no longer resurrects it (reasoning inlined there) |

Both surviving pipelines were run, not just edited: the classifier generator produced 4620 images
across 13 classes, and the extractor job reached Vinayaka and trained 30 epochs on the RTX 3080 with
the 6 coach corner corrections upweighted 5× on top of the previous best.

Disk: the retired loop had left **1621 byte-identical backups, 11 GB**, growing 0.37 GB/day, on a
disk at 89% (a full disk previously aborted mongod). Deleted all but one copy of each of the three
distinct versions plus the newest five. 89% → 84%, weights dir 12 GB → 1.1 GB.

## Verification

- Bundle `AppRest-p3SdukIY.js`: `classify-board-v2` 0, `classify-board-ultra` 1, new corner copy and
  king guard present. `index.html → index-DNLBIn6H.js → AppRest-p3SdukIY.js`.
- Public edge through Cloudflare returns 200 on the new entry chunk (not a stale cache); old bundles
  still 200 so open tabs survive (deploy does not `rsync --delete`).
- API restarts unchanged at 197, uptime unbroken — a web deploy never touches pm2. 0 5xx since.
- Ultra path on the coach's own warp: ~3s vs the ~31s the old route took.

## Open

- **ChessVision oracle is one env var from working.** Route, service method and controller all exist
  (`classify-board-chessvision`); `CHESSVISION_API_KEY` is set nowhere, so it throws immediately.
  Per `reference_chessvision_dev_api.md`: fallback when confidence is low or the position is illegal,
  show both answers and let the coach pick — never bulk-label through it.
- **Auto-crop refinement is unsolved.** Three attempts have now failed on photographed halftone book
  print: the existing FFT `_refine_crop_to_checker` (a no-op that over-crops), gradient-projection
  autocorrelation (locked onto the hatching, pitch 32 vs the real ~59, parity 0.719 → 0.500), and a
  4-D box sweep (correct but 14k candidates, too slow). The durable answer is the corner-correction
  loop above feeding the extractor, now that it runs again — only 6 labels exist today.
- **`visionRefs` holds 128 crops, `visionCornerLabels` 6.** Both grow only when coaches scan; usage
  is very low (228 scans 12–18 Aug, 17 in the three weeks since).
- TKT-166 still needs its before/after screenshots and a reply before it can be marked RESOLVED.
