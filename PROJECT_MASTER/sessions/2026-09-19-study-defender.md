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
