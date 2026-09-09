"""Measure the chess constraint pass on many games, not one lucky line.

Three numbers matter, and only one of them is accuracy:

  baseline    — how many tokens OCR got right before we touched them
  recovered   — how many are right after the constraint pass
  FALSE CONF  — tokens we marked `verified` that are WRONG

The third is the one to watch. A reader that says "I am certain" and is wrong is
worse than one that says "I am unsure", because a coach will not check it. The
pass may only claim certainty when exactly one candidate was legal, so this
number is expected to be zero; if it ever is not, the claim is broken.
"""
from __future__ import annotations

import random
import sys

sys.path.insert(0, "/opt/chessguru-vision")

import chess

import dream_ocr as d

# Reverse the confusion tables: given the TRUE character, what might OCR emit?
_PIECE_NOISE = {p: [a for a in alts if a != p]
                for p, alts in d.FIGURINE_OCR_CONFUSIONS.items()}
_RANK_NOISE: dict[str, list[str]] = {}
for _k, _v in d.RANK_CONFUSIONS.items():
    if _k != _v:
        _RANK_NOISE.setdefault(_v, []).append(_k)
_FILE_NOISE: dict[str, list[str]] = {}
for _k, _v in d.FILE_CONFUSIONS.items():
    if _k != _v:
        _FILE_NOISE.setdefault(_v, []).append(_k)


def garble(san: str, rng: random.Random, p_piece=0.45, p_rank=0.15,
           p_file=0.10, p_junk=0.03) -> str:
    """Corrupt a move the way OCR actually corrupts one."""
    s = san
    if s.startswith("O-O") and rng.random() < 0.3:
        return s.replace("O", "0")
    if s and s[0] in "KQRBN" and rng.random() < p_piece:
        s = rng.choice(_PIECE_NOISE.get(s[0], [s[0]])) + s[1:]
    # rank digit (last char before any +/#/=)
    core = s.rstrip("+#")
    suf = s[len(core):]
    if core and core[-1] in "12345678" and rng.random() < p_rank:
        alt = _RANK_NOISE.get(core[-1])
        if alt:
            core = core[:-1] + rng.choice(alt)
    if len(core) >= 2 and core[-2] in "abcdefgh" and rng.random() < p_file:
        alt = _FILE_NOISE.get(core[-2])
        if alt:
            core = core[:-2] + rng.choice(alt) + core[-1]
    s = core + suf
    # Pure junk: a smudge no table can undo. Kept in deliberately — the point is
    # to check we degrade to "unsure" rather than to "confidently wrong".
    if rng.random() < p_junk and len(s) > 1:
        i = rng.randrange(len(s))
        s = s[:i] + rng.choice("~`^*_") + s[i + 1:]
    return s


def random_game(rng: random.Random, plies: int) -> tuple[list[str], str]:
    b = chess.Board()
    out = []
    for _ in range(plies):
        moves = list(b.legal_moves)
        if not moves:
            break
        m = rng.choice(moves)
        out.append(b.san(m))
        b.push(m)
    return out, chess.STARTING_FEN


def main(games=60, plies=40, seed=7):
    rng = random.Random(seed)
    tot = base_ok = rec_ok = false_conf = verified = 0
    for _ in range(games):
        truth, start = random_game(rng, plies)
        noisy = [garble(s, rng) for s in truth]
        toks = d.apply_chess_constraints([d.Token(text=n) for n in noisy], start)
        for t, n, g in zip(toks, noisy, truth):
            tot += 1
            base_ok += (n == g)
            ok = (t.text == g)
            rec_ok += ok
            if t.verified:
                verified += 1
                false_conf += (not ok)
    pct = lambda x: 100.0 * x / tot if tot else 0.0
    print(f"games {games} x {plies} plies = {tot} move tokens\n")
    print(f"  OCR as-is (baseline)   {base_ok:5d}  {pct(base_ok):5.1f}%")
    print(f"  after constraint pass  {rec_ok:5d}  {pct(rec_ok):5.1f}%")
    print(f"  claimed as verified    {verified:5d}  {pct(verified):5.1f}%")
    print(f"  FALSE CONFIDENCE       {false_conf:5d}  {pct(false_conf):5.2f}%   <- must be 0")
    return 0 if false_conf == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
