# Plan: Server migration — STATUS: DONE (different from original plan)

## Original plan (PROJECT_MASTER.md, April 2026)
Move off GCP `e2-small` (`34.143.245.57`, 2GB RAM, disk ~86% full) onto a dedicated **OVH Kimsufi
KS-5** (Singapore, 32GB RAM, 2×450GB) — then run `gen_piece_pools.js` there and DNS-cutover.

## What actually happened
ChessGuru was instead **co-located on the existing Dream World Plants OVH VPS** (`vps-2c160fde`,
7.6 GiB RAM), under the `ubuntu` Linux user, with its own nginx site and its own MongoDB database.
It is live and stable (24+ day uptime as of 2026-05-29). The separate KS-5 was not used.

## Implications / follow-ups
- Shared 7.6 GiB box: heavy work (engine analysis, pool builds, DreamWorld `next build`) can
  contend for RAM. See the DreamWorld "OVH build OOM" note — watch memory during big jobs.
- GCP host and all `34.143.245.57` references in the old master are **superseded**.
- `piecePools` is only partially built (590) — finish if/when needed.
