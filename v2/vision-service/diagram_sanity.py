"""Is this actually a chess position, or did the classifier hallucinate one?

The extractor finds square-ish regions; the classifier then reads 64 squares off
whatever it is handed and always returns SOMETHING. On Pandolfini the front
cover — a diamond logo between two banner rules, aspect exactly 1.00 — became
"position 1", complete with six white knights. Owner: "position 1 is not a board
itself".

Two gates, because one is not enough:

1. LEGALITY. python-chess knows about promotion budgets, pawns on the back rank
   and impossible check configurations. But a diagram does not state whose turn
   it is, so both sides must be tried — and that leniency is exactly how the
   cover slipped through: it is illegal with White to move and legal with Black.

2. PLAUSIBILITY. Measured on 69 hand-checked Thursby diagrams, no side ever has
   more than 1 queen, 2 rooks, 2 knights or 2 bishops. Promotions do happen in
   real books, so the thresholds here are deliberately looser than observed —
   3 queens, 4 of any other piece. The cover's six knights are not close.
"""
from __future__ import annotations

import collections

MAX = {"q": 3, "r": 4, "b": 4, "n": 4, "p": 8}


def why_not_a_position(board_fen: str) -> list[str]:
    """Empty list = plausible. Otherwise, the reasons, in plain words."""
    import chess
    fen = (board_fen or "").split(" ")[0]
    why: list[str] = []
    c = collections.Counter(ch for ch in fen if ch.isalpha())

    if c.get("K", 0) != 1 or c.get("k", 0) != 1:
        why.append(f"{c.get('K',0)} white kings, {c.get('k',0)} black kings")

    for side, up in (("white", True), ("black", False)):
        for p, cap in MAX.items():
            ch = p.upper() if up else p
            if c.get(ch, 0) > cap:
                why.append(f"{side} has {c[ch]} {p}s")

    total = sum(c.values())
    if total > 32:
        why.append(f"{total} pieces (a chess set has 32)")

    if not why:
        # Only ask python-chess once the counts are sane — its message is far
        # less legible than the ones above.
        ok = False
        for stm in ("w", "b"):
            try:
                if chess.Board(f"{fen} {stm} - - 0 1").is_valid():
                    ok = True
                    break
            except Exception:
                pass
        if not ok:
            why.append("not reachable in a real game")
    return why


def is_position(board_fen: str) -> bool:
    return not why_not_a_position(board_fen)
