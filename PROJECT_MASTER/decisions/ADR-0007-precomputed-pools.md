# ADR-0007: Puzzle selection uses pre-computed pools, not live sampling

**Status:** Accepted · **Date:** 2026-05 (documented 2026-05-29)

## Context
The `puzzles` collection has ~5.88M documents. Running `$match` + `$sample` (or `skip`+`limit`)
against it on every `/api/puzzles/random` request is too slow and load-heavy, especially with the
multi-axis filters the app needs (theme × rating band × piece count × quality tier).

## Decision
Candidate puzzle-ID lists are **pre-computed offline** into small pool documents and refreshed by
maintenance scripts. Five pool collections, each a different slicing axis:
- `paths` — Lichess "puzzle path" model (`theme|tier|rating`, vote-tiered), built by `gen_paths2.js`.
- `piecePools` — `theme|maxPc`, built by `gen_piece_pools.js`.
- `bfPools` — `theme|ratingBand|pc` (blindfold), built by `gen_bf_pools_v2.js`.
- `themePools` / `enginePools` — engine-generated puzzles by theme (duplicates; app uses `enginePools`).

At request time `routes.js` reads these for fast selection, with a live DB scan only as a last
resort, plus a per-user in-memory **session** (200 IDs, 1h TTL) layered on top for logged-in users.

## Consequences
- Selection is fast and cheap, at the cost of **staleness**: pools must be rebuilt when the puzzle
  set changes materially. `/api/health` exposes `pathsStale` (newest path > 24h old).
- Pool builders are destructive or resumable depending on the script — see
  [07-pools-and-maintenance-scripts](../knowledge/07-pools-and-maintenance-scripts.md).
- Sampling uniformity varies by builder (`$sample` is uniform; the `*_fast` contiguous samplers are
  biased).
- This is a deliberate port of Lichess's `PuzzlePathApi`/`PuzzleSession` design.
