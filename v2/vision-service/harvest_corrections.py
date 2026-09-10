"""Turn coach corrections into labelled square crops for the piece classifier.

WHY THIS IS THE BEST DATA WE HAVE
The chess constraint pass proves a MOVE is legal; it cannot know what was
PRINTED. A coach fixing a square while looking at the printed diagram beside it
knows exactly what was printed. That makes a correction the only label in the
system verified against the paper itself.

WHAT IT EXPORTS
All 64 squares of a corrected position, not just the squares that changed. The
coach confirmed the WHOLE board when they saved, so every square is verified —
the changed ones are hard negatives the model demonstrably gets wrong, and the
unchanged ones stop a fine-tune forgetting what it already knows.

Corrected squares are written to a separate tree so training can weight them,
and so it is always possible to answer "what did the model actually get wrong".
"""
from __future__ import annotations

import json
import os
import sys

import cv2

STORE = "/var/lib/chessguru/user-books"
OUT = "/opt/chessguru-vision/training-data/cls-corrections"

# The class directory names the existing classifier training already uses.
CLASS_DIR = {
    "P": "wpawn", "N": "wknight", "B": "wbishop", "R": "wrook", "Q": "wqueen", "K": "wking",
    "p": "bpawn", "n": "bknight", "b": "bbishop", "r": "brook", "q": "bqueen", "k": "bking",
    "": "empty",
}


def board_grid(fen: str) -> list[str]:
    """64 chars, a8..h1, matching how the classifier splits a board."""
    out: list[str] = []
    for row in (fen.split(" ")[0]).split("/"):
        cells: list[str] = []
        for ch in row:
            if ch.isdigit():
                cells += [""] * int(ch)
            else:
                cells.append(ch)
        out += (cells + [""] * 8)[:8]
    return (out + [""] * 64)[:64]


def harvest_book(book_id: str) -> dict:
    d = os.path.join(STORE, book_id)
    cpath = os.path.join(d, "corrections.jsonl")
    if not os.path.exists(cpath):
        return {"book": book_id, "corrections": 0, "squares": 0, "changed": 0}
    diagrams = json.load(open(os.path.join(d, "diagrams.json")))
    rows = [json.loads(l) for l in open(cpath) if l.strip()]
    n_sq = n_ch = 0
    for r in rows:
        idx = int(r.get("n", 0)) - 1
        if idx < 0 or idx >= len(diagrams):
            continue
        dg = diagrams[idx]
        page = dg.get("page")
        bbox = dg.get("bbox")
        img = cv2.imread(os.path.join(d, "pages", "p%04d.jpg" % int(page)))
        if img is None:
            continue
        if bbox and len(bbox) >= 4:
            x1, y1, x2, y2 = [int(v) for v in bbox[:4]]
            x1, y1 = max(0, x1), max(0, y1)
            crop = img[y1:y2, x1:x2]
        else:
            crop = img
        if crop.size == 0:
            continue
        # 512x512 then 64x64 tiles — the same split _classify_via_own uses, so a
        # crop harvested here looks like what the model sees at inference.
        board = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_CUBIC)
        was, now = board_grid(str(r.get("was", ""))), board_grid(str(r.get("now", "")))
        for i in range(64):
            label = CLASS_DIR.get(now[i])
            if label is None:
                continue
            changed = was[i] != now[i]
            sub = "corrected" if changed else "confirmed"
            outdir = os.path.join(OUT, sub, label)
            os.makedirs(outdir, exist_ok=True)
            row, col = divmod(i, 8)
            tile = board[row * 64:(row + 1) * 64, col * 64:(col + 1) * 64]
            name = "%s_d%03d_s%02d.png" % (book_id, idx + 1, i)
            cv2.imwrite(os.path.join(outdir, name), tile)
            n_sq += 1
            n_ch += int(changed)
    return {"book": book_id, "corrections": len(rows), "squares": n_sq, "changed": n_ch}


def main() -> None:
    books = sys.argv[1:] or [b for b in os.listdir(STORE)
                             if os.path.isdir(os.path.join(STORE, b))]
    tot = {"corrections": 0, "squares": 0, "changed": 0}
    for b in books:
        r = harvest_book(b)
        if r["corrections"]:
            print("  %-24s %d corrections -> %d squares (%d were wrong)"
                  % (r["book"], r["corrections"], r["squares"], r["changed"]), flush=True)
        for k in tot:
            tot[k] += r[k]
    print("\nTOTAL %d corrections -> %d labelled squares, %d of them the model got WRONG"
          % (tot["corrections"], tot["squares"], tot["changed"]))
    for sub in ("corrected", "confirmed"):
        base = os.path.join(OUT, sub)
        if not os.path.isdir(base):
            continue
        counts = {c: len(os.listdir(os.path.join(base, c))) for c in sorted(os.listdir(base))}
        print("  %-10s %s" % (sub, ", ".join(f"{k}={v}" for k, v in counts.items() if v)))


if __name__ == "__main__":
    main()
