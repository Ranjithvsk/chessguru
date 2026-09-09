"""Chess-logic repair pass over a scanned position.

The classifier reads each of the 64 squares independently, so it has no idea it
has just given Black three rooks. Chess itself constrains the answer hard, and
we still hold the full 64x13 probability matrix at this point, so a violated
rule can often be repaired by moving one square to its runner-up class.

What was here before: exactly one active rule (no pawns on the back ranks). The
one-king rule sat commented out in the vendored AGPL file. Everything below is
ours.

Two grades of finding, deliberately separated:

  FIX      a hard chess impossibility, repaired when the swap is cheap in
           probability terms. Two kings, nine pawns, a pawn on the eighth rank.
  WARN     legal but implausible, never auto-changed. Three rooks IS legal after
           a promotion, so silently "correcting" it would corrupt a real study
           position. The coach is told which side and which piece instead.

Repair is greedy and cost-ordered: among the squares that could resolve a
violation, switch the one that costs the least probability. Measured on a real
coach scan, that is the right call in both directions -- a phantom rook on g8
read at 0.599 is cheap to drop, while a knight misread as a bishop at 0.926 is
expensive and must NOT be auto-changed, only flagged.
"""
from __future__ import annotations

from typing import Any

WHITE = "KQRBNP"
BLACK = "kqrbnp"
EMPTY = "f"

# Starting complement. Anything above needs a promotion.
START_MAX = {"Q": 1, "R": 2, "B": 2, "N": 2, "P": 8, "K": 1}


def _is_white(p: str) -> bool:
    return p in WHITE


def _side_of(p: str) -> str | None:
    if p in WHITE:
        return "w"
    if p in BLACK:
        return "b"
    return None


def _counts(labels: list[str], side: str) -> dict[str, int]:
    pool = WHITE if side == "w" else BLACK
    out = {k: 0 for k in "KQRBNP"}
    for p in labels:
        if p in pool:
            out[p.upper()] += 1
    return out


def _alternatives(probs, idx: int, exclude: set[str], label_names: list[str]):
    """Runner-up classes for one square, best first, with their probability."""
    row = probs[idx]
    order = sorted(range(len(row)), key=lambda j: -float(row[j]))
    return [(label_names[j], float(row[j])) for j in order
            if label_names[j] not in exclude]


def apply_chess_logic(labels: list[str], probs, square_names: list[str],
                      label_names: list[str]) -> tuple[list[str], list[dict[str, Any]], list[str]]:
    """Returns (labels, fixes, warnings). `probs` is (64, 13)."""
    labels = list(labels)
    fixes: list[dict[str, Any]] = []
    warnings: list[str] = []

    def prob_of(i: int, piece: str) -> float:
        try:
            return float(probs[i][label_names.index(piece)])
        except Exception:
            return 0.0

    def swap(i: int, to: str, rule: str) -> None:
        fixes.append({"square": square_names[i], "from": labels[i],
                      "to": to, "rule": rule})
        labels[i] = to

    # --- Rule: no pawns on the first or last rank -------------------------
    for i, name in enumerate(square_names):
        if labels[i] in ("P", "p") and name and name[-1] in ("1", "8"):
            alts = _alternatives(probs, i, {"P", "p"}, label_names)
            if alts:
                swap(i, alts[0][0], "no_pawns_on_ends")

    # --- Rule: exactly one king a side ------------------------------------
    for king, side in (("K", "w"), ("k", "b")):
        idxs = [i for i, p in enumerate(labels) if p == king]
        if len(idxs) > 1:
            # Keep the most confident; the rest become their best non-king class.
            idxs.sort(key=lambda i: -prob_of(i, king))
            for i in idxs[1:]:
                alts = _alternatives(probs, i, {"K", "k"}, label_names)
                if alts:
                    swap(i, alts[0][0], "one_king_per_side")
        elif not idxs:
            # A missing king is usually a bad crop, not a misread square, so
            # only invent one when some square genuinely wanted to be a king.
            best = max(range(len(labels)), key=lambda i: prob_of(i, king))
            if prob_of(best, king) >= 0.15 and labels[best] != ("k" if king == "K" else "K"):
                swap(best, king, "missing_king")
            else:
                warnings.append(
                    f"No {'white' if king == 'K' else 'black'} king found — the crop is "
                    f"probably off rather than a single square being misread.")

    # --- Rule: at most 8 pawns a side -------------------------------------
    for pawn, side in (("P", "w"), ("p", "b")):
        idxs = [i for i, p in enumerate(labels) if p == pawn]
        while len(idxs) > 8:
            i = min(idxs, key=lambda i: prob_of(i, pawn))
            alts = _alternatives(probs, i, {"P", "p"}, label_names)
            if not alts:
                break
            swap(i, alts[0][0], "max_eight_pawns")
            idxs.remove(i)

    # --- Rule: promotions must be affordable ------------------------------
    # Every piece above the starting complement needs a promoted pawn, and a
    # side cannot have promoted more pawns than it is missing.
    for side, pool in (("w", WHITE), ("b", BLACK)):
        c = _counts(labels, side)
        need = sum(max(0, c[k] - START_MAX[k]) for k in ("Q", "R", "B", "N"))
        afford = 8 - c["P"]
        if need > afford:
            # Impossible. Retire the cheapest surplus pieces until it balances.
            for k in ("Q", "R", "B", "N"):
                while need > afford and c[k] > START_MAX[k]:
                    sym = k if side == "w" else k.lower()
                    idxs = [i for i, p in enumerate(labels) if p == sym]
                    if not idxs:
                        break
                    i = min(idxs, key=lambda i: prob_of(i, sym))
                    alts = _alternatives(probs, i, {sym}, label_names)
                    if not alts:
                        break
                    swap(i, alts[0][0], "promotion_budget")
                    c = _counts(labels, side)
                    need = sum(max(0, c[q] - START_MAX[q]) for q in ("Q", "R", "B", "N"))
                    afford = 8 - c["P"]

    # --- Rule: colour balance ---------------------------------------------
    # The strongest correctable signal we have. If BOTH sides' counts of a
    # piece type still add up to the starting total (4 rooks, 4 knights, 4
    # bishops, 2 queens) but the split is wrong -- one side over, the other
    # under -- then nothing was promoted or captured: a COLOUR was misread.
    # Flip the one that is cheapest to flip and both counts come right.
    #
    # This is what a bare legality check misses. Reported 2026-09-09: a scan
    # read a white rook on d1 as a black rook at 0.954, giving Black three
    # rooks and White one. Promotions were affordable on paper (Black had five
    # pawns, so three were missing), so a promotion-budget rule stays silent —
    # yet four rooks on the board with a 3/1 split can only be a colour error.
    START_TOTAL = {"Q": 2, "R": 4, "B": 4, "N": 4}
    for k, total in START_TOTAL.items():
        w_sym, b_sym = k, k.lower()
        w = sum(1 for p in labels if p == w_sym)
        b = sum(1 for p in labels if p == b_sym)
        if w + b != total:
            continue                      # a real capture or promotion happened
        for over, under in ((w_sym, b_sym), (b_sym, w_sym)):
            n_over = sum(1 for p in labels if p == over)
            n_under = sum(1 for p in labels if p == under)
            while n_over > START_MAX[k] and n_under < START_MAX[k]:
                idxs = [i for i, p in enumerate(labels) if p == over]
                if not idxs:
                    break
                # Cheapest flip = the square least sure it is this colour and
                # most willing to be the other.
                i = min(idxs, key=lambda i: prob_of(i, over) - prob_of(i, under))
                swap(i, under, "colour_balance")
                n_over -= 1
                n_under += 1

    # --- Warn: legal but implausible --------------------------------------
    # Above the starting complement is legal after a promotion, so this is NEVER
    # auto-corrected. It is, however, far likelier to be a misread piece.
    names = {"Q": "queens", "R": "rooks", "B": "bishops", "N": "knights"}
    for side, word in (("w", "White"), ("b", "Black")):
        c = _counts(labels, side)
        over = [f"{c[k]} {names[k]}" for k in ("Q", "R", "B", "N") if c[k] > START_MAX[k]]
        if over:
            warnings.append(
                f"{word} has {', '.join(over)} — legal only after a promotion, so "
                f"at least one piece is probably misread.")

    # --- Warn: two bishops on one colour ----------------------------------
    for side, word, pool in (("w", "White", "B"), ("b", "Black", "b")):
        squares = [square_names[i] for i, p in enumerate(labels) if p == pool]
        if len(squares) > 1:
            def light(sq: str) -> bool:
                return (ord(sq[0]) - 97 + int(sq[1])) % 2 == 1
            same = len([s for s in squares if light(s)])
            if same in (0, len(squares)) and len(squares) > 1:
                warnings.append(
                    f"{word}'s bishops are all on one colour ({', '.join(squares)}) — "
                    f"also only possible after a promotion.")

    return labels, fixes, warnings
