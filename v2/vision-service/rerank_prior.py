"""Choose among a reader's candidates with a chess move prior — Viterbi over
the sheet, no board required.

Per cell the reader offers up to K candidates in rank order; the prior says
how plausible each is after the previous chosen move. Score of a path is
  Σ rank_penalty(candidate) + λ · (−log P(candidate | previous))
and the best path is found exactly by dynamic programming. This is what a
strong club player does when reading a smudged sheet: "3 or 5? after Nf3 the
knight goes to c6, not c5". It is deliberately position-free, so it keeps
working on the 30 of 40 HCS sheets where a player's own error has made the
true position unknowable.
"""
from __future__ import annotations
import math, re
from san_prior import SanPrior

RANK_PENALTY = [0.0, 1.0, 1.6]          # measured: 2nd candidate right ~5 % of the time, 3rd ~1 %
SAN_RE = re.compile(r"^(?:O-O-O|O-O)[+#]?$|^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?$")


def rerank(cands_per_cell: list[list[str]], prior: SanPrior, lam: float = 0.35, K: int = 3) -> list[str]:
    cells = []
    for cands in cands_per_cell:
        cs = [c for c in cands[:K] if c]
        # a non-move-shaped candidate is kept only if nothing better exists
        shaped = [c for c in cs if SAN_RE.match(c)]
        cells.append(shaped if shaped else (cs[:1] or [""]))
    # Viterbi
    prev_scores = {c: RANK_PENALTY[min(i, 2)] + lam * -prior.logp("<s>", c) for i, c in enumerate(cells[0])}
    back = []
    for cell in cells[1:]:
        cur = {}; bp = {}
        for i, c in enumerate(cell):
            best, arg = math.inf, None
            for p, ps in prev_scores.items():
                s = ps + lam * -prior.logp(p, c)
                if s < best: best, arg = s, p
            cur[c] = best + RANK_PENALTY[min(i, 2)]; bp[c] = arg
        back.append(bp); prev_scores = cur
    last = min(prev_scores, key=prev_scores.get); out = [last]
    for bp in reversed(back):
        last = bp[last]; out.append(last)
    return out[::-1]
