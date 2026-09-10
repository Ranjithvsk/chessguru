"""Collapse duplicate diagrams in an ingested book, and flag the disagreements.

A diagram is detected in more than one view (whole spread, left half, right
half), so the same physical board is stored two or three times. The reader then
lists positions the book does not have — owner: "SAME 14, 15 HIGHLIGHT SAME
POSITION WHY..?" and "IN DOWN 21 POSITION SHOWS, BUT IN BOOK 21 NOT AVAILABLE".

WHICH READING TO KEEP IS NOT DECIDABLE AUTOMATICALLY, and it is worth writing
down why, because two obvious rules were tried and both failed on the same page:

  diagram 14 vs 15 — the SAME board, 1px apart, differing only in the colour of
  two bishops. By eye (rank 2 reads: empty, WHITE bishop, white pawn, empty,
  black bishop, empty, WHITE bishop) #14 is correct.
     higher confidence  -> picks #15 (0.97 vs 0.96)   WRONG
     larger board       -> picks #15 (1px wider)      WRONG
     a third re-read    -> a third answer again, mixing the two

So this keeps the first reading and does NOT pretend to arbitrate. What it does
instead is USE THE DISAGREEMENT: when two views of one diagram return different
positions, that is far better evidence of an unreliable read than the model's
own confidence — which rated a perfect position 0.89 and a wrong one 0.97. Those
diagrams are marked low-confidence so the reader paints them amber, and a coach
looking at the printed board can settle in seconds what no heuristic could.
"""
from __future__ import annotations

import json
import os
import shutil
import sys

STORE = "/var/lib/chessguru/user-books"


def same_diagram(a, b) -> bool:
    if not a or not b or len(a) < 4 or len(b) < 4:
        return False
    acx, acy = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
    bcx, bcy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    tol = max(40, min(a[2] - a[0], b[2] - b[0]) * 0.5)
    return abs(acx - bcx) < tol and abs(acy - bcy) < tol


def dedupe(book_id: str, apply: bool = False) -> dict:
    d = os.path.join(STORE, book_id)
    path = os.path.join(d, "diagrams.json")
    diagrams = json.load(open(path))
    kept: list = []
    dropped = disputed = 0
    for dg in diagrams:
        hit = next((k for k in kept
                    if k["page"] == dg["page"] and same_diagram(k.get("bbox"), dg.get("bbox"))), None)
        if hit is None:
            kept.append(dict(dg))
            continue
        dropped += 1
        if hit.get("fen") != dg.get("fen"):
            # Two views, two answers. Trust neither.
            disputed += 1
            hit["conf"] = min(float(hit.get("conf") or 1.0), 0.5)
            hit["disputed"] = True
    if apply:
        shutil.copyfile(path, path + ".pre-dedupe")
        json.dump(kept, open(path, "w"))
    return {"book": book_id, "before": len(diagrams), "after": len(kept),
            "dropped": dropped, "disputed": disputed}


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    books = [a for a in sys.argv[1:] if not a.startswith("-")] or [
        b for b in os.listdir(STORE) if os.path.isdir(os.path.join(STORE, b))]
    for b in books:
        if not os.path.exists(os.path.join(STORE, b, "diagrams.json")):
            continue
        r = dedupe(b, apply)
        print("  %-24s %3d -> %3d  (%d duplicates removed, %d disputed reads flagged)"
              % (r["book"], r["before"], r["after"], r["dropped"], r["disputed"]))
    print("\n" + ("APPLIED" if apply else "DRY RUN — pass --apply to write"))
