"""Re-read every stored diagram from the FULL-RESOLUTION page crop.

THE ERROR CLASS THIS FIXES. Ingest classifies whatever crop the extractor hands
back for the view it was looking at. On a two-page spread the whole-page view
sees a board at roughly half the linear resolution of the half-page view, and
the reading is measurably worse. The pipeline then stored whichever came first.

Proven on the coach's own corrections. On every square they fixed, the
classifier's TOP prediction — given the proper crop — was already the right
answer, at 0.66 to 0.99 probability:

    a2  stored queen  -> empty  p=0.975
    e2  stored knight -> empty  p=0.987
    f2  stored rook   -> empty  p=0.985
    c1  stored black queen -> WHITE queen  p=0.979
    h7  stored pawn   -> empty  p=0.983

The model was never wrong about these. The pipeline stored a worse reading.

So this re-reads each kept diagram from the page at native resolution, using the
bbox already stored. Nothing is re-detected; only the position is re-derived.
Diagrams the coach has already corrected or confirmed are LEFT ALONE — a human
answer outranks any re-read.
"""
from __future__ import annotations

import json
import os
import shutil
import sys

import cv2

STORE = "/var/lib/chessguru/user-books"
ORDER = ["b", "k", "n", "p", "q", "r", "f", "B", "K", "N", "P", "Q", "R"]
_cls = None


def model():
    global _cls
    if _cls is None:
        from ultralytics import YOLO
        _cls = YOLO("/opt/chessguru-vision/mit-weights/chessguru-cls.pt")
    return _cls


def read_board(board512) -> str:
    """64 tiles + the horizontal-flip average, exactly as the service does."""
    cls = model()
    tiles = [cv2.cvtColor(board512[r * 64:(r + 1) * 64, c * 64:(c + 1) * 64],
                          cv2.COLOR_BGR2RGB) for r in range(8) for c in range(8)]
    a = cls.predict(tiles, imgsz=64, verbose=False)
    b = cls.predict([cv2.flip(t, 1) for t in tiles], imgsz=64, verbose=False)
    chars = [ORDER[int((0.5 * (x.probs.data.cpu().numpy()
                               + y.probs.data.cpu().numpy())).argmax())]
             for x, y in zip(a, b)]
    rows = []
    for r in range(8):
        row, blank = "", 0
        for c in range(8):
            ch = chars[r * 8 + c]
            if ch == "f":
                blank += 1
                continue
            if blank:
                row += str(blank)
                blank = 0
            row += ch
        if blank:
            row += str(blank)
        rows.append(row)
    return "/".join(rows)


def reread(book_id: str, apply: bool = False) -> dict:
    d = os.path.join(STORE, book_id)
    path = os.path.join(d, "diagrams.json")
    diagrams = json.load(open(path))
    changed = skipped = human = 0
    for x in diagrams:
        if x.get("corrected") or (x.get("conf") == 1):
            human += 1                      # a coach already ruled on this one
            continue
        b = x.get("bbox")
        if not b or len(b) < 4:
            skipped += 1
            continue
        img = cv2.imread(os.path.join(d, "pages", "p%04d.jpg" % int(x["page"])))
        if img is None:
            skipped += 1
            continue
        x1, y1, x2, y2 = [int(v) for v in b[:4]]
        crop = img[max(0, y1):y2, max(0, x1):x2]
        if crop.size == 0:
            skipped += 1
            continue
        fen = read_board(cv2.resize(crop, (512, 512), interpolation=cv2.INTER_CUBIC))
        if fen != x.get("fen"):
            x["fen"] = fen
            x["reread"] = True
            changed += 1
    if apply:
        shutil.copyfile(path, path + ".pre-reread")
        json.dump(diagrams, open(path, "w"))
    return {"book": book_id, "total": len(diagrams), "changed": changed,
            "left_to_human": human, "skipped": skipped}


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    books = [a for a in sys.argv[1:] if not a.startswith("-")] or [
        b for b in os.listdir(STORE) if os.path.isdir(os.path.join(STORE, b))]
    for b in books:
        if not os.path.exists(os.path.join(STORE, b, "diagrams.json")):
            continue
        r = reread(b, apply)
        print("  %-24s %3d diagrams: %3d re-read differently, %d left to the coach, %d skipped"
              % (r["book"], r["total"], r["changed"], r["left_to_human"], r["skipped"]))
    print("\n" + ("APPLIED" if apply else "DRY RUN — pass --apply to write"))
