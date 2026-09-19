# 2026-09-19 — Study trainer: real defence (Easy / Hard / Best)

**Complaint.** "In one-rook-mate the engine is not defending optimum, the king just runs to the
corner… all the defence in study are poor like this?"

**Why.** Every drill's opponent was browser Stockfish 16 with **400 ms** (`StudyTrainer.tsx`
`bestMove(fen, 400)`), ≈250k nodes on a phone. In K+R vs K the mate is ~30 plies deep — beyond
that horizon — and SF16's neural eval carries no "lone king stays central" knowledge (that lived
in the old handcrafted eval), so every square looks equally lost and the king drifts to the edge.
Measured with the server engine, node-limited to mimic the browser: 250k nodes → mated in 12
(best defence 16); 2.5M nodes (3–5 s on a phone) → still 2 moves short; Stockfish 18 with Syzygy
at 300 ms → 1 move short; direct DTZ probe → exact. Same shallow search fails pawn endings too.

**Built.**
- Syzygy 3-4-5 tablebases (290 files, 939 MB) on France `/home/ubuntu/engines/syzygy`, backup
  copy on the storage box `sbox:engines/syzygy-3-4-5`. (6-piece would be 150 GB, 7-piece 18 TB.)
- `apps/api/tools/tb_oracle.py` + system unit `cg-tb-oracle.service` (python-chess, loopback
  :4731, ~5 ms/probe): exact best move for ≤5 pieces, `mateIn` where DTZ == DTM.
- `apps/api/src/study/defender.service.ts` + `POST /api/study/defend {fen, level}`: best → oracle
  (else SF18 + tables 400 ms); hard → SF18 250 ms; one engine per level, serialized, 4 s cap.
- Trainer: Defence chips Auto · Easy · Hard · Best (`localStorage cg_study_defence`); auto by
  drill rating (<1000 easy, <1600 hard, else best); easy = browser SF Skill Level 3 / 150 ms;
  server replies capped at 3 s then fall back to browser SF; status shows "tablebase · mate in N".
  `lib/engine.ts` gained `setOption`.

**Verified.** `/api/study/defend` best → e4e5, mate in 14, 24 ms; hard → 250 ms warm; oracle
sim vs SF18 attacker holds the full distance; deployed API (pm2 restart) + web.

## Follow-up — "still it don't play best move"
Owner's rook-mate rating is 1446 → Auto had picked **Hard** (Stockfish 250 ms, no tables). Mate
drills now Auto → **Best** (exact tablebase) from rating 1000 up; Hard gained the tablebases
(300 ms, near-perfect); every defence request is logged (`[study-defend] level source move …`)
so a report can be replayed. A first cut used `kind` before its declaration (TDZ crash on the
trainer page for ~10 min, 03:15–03:25 IST) — fixed and redeployed.

## Levels renamed (owner: "easy medium hard, these 3")
Easy = browser Stockfish Skill 3 / 150 ms · Medium = Stockfish 18 + tablebases 300 ms (near-perfect)
· Hard = exact tablebase (was "Best"). No Auto chip: the rating-based default is preselected and
marked "auto" until the student taps a level (`localStorage cg_study_defence_v2`). API accepts
medium | hard ("best" from older bundles = hard).

## Play modes + advice (owner: "play both sides or vs engine"; "advise the mistake … after each move or at the end … give reason")
- Play chips **vs engine / both sides** (`cg_study_mode`): both sides = no engine reply, nothing rated,
  the tablebase still shows "White/Black mates in N" after every move.
- Tempo feedback in engine mode: consecutive tablebase counts must fall by one — else "you gave
  away N tempi (mate in X was there)".
- `GET /advise?fen=&move=` on the oracle + `POST /api/study/advise {fen, move}`: verdict
  best / inaccuracy / mistake / blunder, best move, tempi lost, a rule-based reason (stalemate,
  piece hanging next to the king, box not tightened, king let back to the centre, king route,
  waiting rook move, opposition lost, pawn pushed before the king) and a 3-ply best line; beyond
  5 pieces Stockfish 18 compares evals (300 ms ×2) with a generic reason.
- Advice chips **each move / at the end / off** (`cg_study_advice`, default each move): each-move
  shows the verdict card under the status; at-the-end lists every non-best move with reasons once
  the game finishes. Works in both play modes and for both colours.

## Notation panel with variations (owner: "add the notation panel we already have, with multi-branch")
The trainer's board is now `SharedClassBoard` in local mode (sized container, `min(66vh, 620px)`)
with `ClassNotationPanel` beside it — step back, play another move, and a variation branch opens,
promote/delete/annotate as in class. The engine answers through a new `triggerClassPlayMove`
(SharedClassBoard) at whatever node the student played from, so variations get replies too.
`onLocalChange` drives everything: new node = student move → advice + engine reply; the engine's
own move is recognised by `injectedRef`; navigation (seek/step) changes nothing. Rated results only
on the mainline; variations are analysis. Headless smoke (playwright-core + local Chromium) on the
live page: move accepted, engine reply in the notation, "tablebase · mate in N", zero errors.
