# 2026-09-12 — Bot engine timeouts: the Maia-1 weights had been deleted

**Symptom:** play-bot log full of `think failed: engine timeout on "go nodes 1"` (48 in the 09h
window, 45 in the 16h window). On a timeout `session.ts` plays a RANDOM legal move, so every
Maia-1 bot game since the deletion was against a random mover — which is why a 1400 student was
mating "1400" bots in 7 moves and why several games ended by flag after 2–5 moves.

**Cause:** `/home/dreamworld/opt/engines/weights/maia1/` (installed 2026-09-07) no longer existed.
lc0 still answers `uciok`/`readyok`, then prints `error Cannot read weights from …` on the first
`go` and never sends `bestmove` → 20 s UciProc timeout → kill → respawn → same again next move.

**Fix:** re-downloaded the nine nets from CSSLab/maia-chess `maia_weights/maia-{1100..1900}.pb.gz`
into that directory (12 MB, mode 644, dirs 755 so `ubuntu` can read them), verified
`go nodes 1` returns the policy head + `bestmove g1f3` for e4 e5, restarted `play-bot`.

**Also today:** bot strength is drawn from a ±150 band around the student instead of the exact
rating (`humanLike()` in bot-player/src/main.ts).

**Guard to add:** a startup check in bot-player that every `maia-*.pb.gz` exists and is readable,
logging loudly (and refusing to seek) when one is missing — a silent random-mover is worse than no bot.
