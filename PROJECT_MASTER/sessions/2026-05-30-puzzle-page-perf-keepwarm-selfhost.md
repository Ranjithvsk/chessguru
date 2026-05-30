# Session 2026-05-30 — puzzle page perf: keep-warm cron + self-host assets

**Symptom:** owner reported the puzzle page "takes so much time to load".

**Diagnosis (not the app):** server-side is fast warm — page HTML 8ms, `/api/puzzles/random` 18–40ms,
full page 256ms / 164KB / 22 reqs. Root cause = **memory pressure / swap cold-start**: the box (7.6GB)
is oversubscribed (mongod ~2GB + DreamWorld + POS + chess + Claude sessions → ~4GB in swap). The chess
server `chessguru` (pid 1028, :3000) had MORE memory swapped than resident (55MB RSS / 57MB swap), and
mongod had ~510MB swapped — so the FIRST load after idle pages back in from swap (slow), then warm loads
are fast. Same root cause as the earlier "website slow" report.

**Fixes applied:**
1. **keep-warm cron** — `scripts/keep-warm.sh` curls `/api/health` + a guest `/api/puzzles/random`
   every 2 min (added to ubuntu crontab: `*/2 * * * * /home/ubuntu/chessguru/scripts/keep-warm.sh`).
   Keeps the server + puzzle path + mongo working set resident so it never cold-starts from swap.
   Writes a stamp to `scripts/.keep-warm.last`. (Crontab is system state, not in git — recorded here.)
2. **self-hosted external piece assets** — repointed all `lichess1.org/assets/piece/cburnett/*` URLs to
   the local `/pieces/` (files already present in `public/pieces/`): `index.html` feedback kings (2) +
   `engine_battle.html` board `pieceTheme` (1). Board pieces were already local. Verified `/pieces/wK.svg`
   /`bK.svg` → 200. Removes the only external image dependency (lichess CDN, which can be slow/throttled
   from this datacenter IP — see opening-explorer note).

**Also freed RAM this session:** closed 5 idle web terminals (~1.4GB) + killed orphaned terminal-less
claude processes — available RAM 1.8 → ~2.7GB, swap 6.0 → 3.9GB.

**Still external (NOT changed):** Google Fonts (`fonts.googleapis.com` Inter + DM Serif). Render-blocking
but already `display=swap`. Could self-host woff2 later if the owner wants.

**Durable note:** the box is genuinely under-provisioned for everything running. Keep-warm masks the
cold-start; the real fixes are fewer concurrent heavy processes (Claude/terminal sessions), capping
mongod's WiredTiger cache, or more RAM.

**Files:** `scripts/keep-warm.sh` (new), `public/index.html`, `public/engine_battle.html`.
