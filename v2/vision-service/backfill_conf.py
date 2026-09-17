#!/usr/bin/env python
"""Add per-square confidence (minConf, squaresBelow) to an ALREADY-ingested book.

New ingests get these from book_ingest._conf_detail. This backfills the books that
were read before that existed, without paying for a full re-ingest (28 minutes for a
400-page book against ~90 seconds here).

Why it matters: the stored `conf` is a MEAN over 64 squares, and a mean hides the
squares worth looking at. Dvoretsky's Endgame Manual, 2026-09-17 -- 169 of 683
diagrams contain a square below 0.70, and those diagrams' stored average confidence
is 0.977. Page 19's three "x" key-square marks scored 0.531 / 0.768 / 0.368 and were
read as a queen, a knight and a queen; the stored figure said 0.936.

    python backfill_conf.py                      # every book
    python backfill_conf.py <book-id>            # one
    python backfill_conf.py <book-id> --dry-run

Reads the board in grey, exactly as book_ingest does, so the numbers match what a
fresh ingest would have written.
"""
import json, os, sys, time
import numpy as np, cv2

sys.path.insert(0, "/opt/chessguru-vision/tandberg")
from ultralytics import YOLO

STORE = "/var/lib/chessguru/user-books"
MODEL = "/opt/chessguru-vision/mit-weights/chessguru-cls.pt"
LOW = 0.70


def score_board(model, crop):
    """Max probability per square, a8..h1. Grey, as the ingest reads it."""
    grey = cv2.cvtColor(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    board = cv2.resize(grey, (512, 512), interpolation=cv2.INTER_CUBIC)
    tiles = [cv2.cvtColor(board[r * 64:(r + 1) * 64, c * 64:(c + 1) * 64], cv2.COLOR_BGR2RGB)
             for r in range(8) for c in range(8)]
    res = model.predict(tiles, imgsz=64, verbose=False, device="cpu")
    out = []
    for r in res:
        p = r.probs.data
        p = p.cpu().numpy() if hasattr(p, "cpu") else np.asarray(p)
        out.append(float(p.max()))
    return np.array(out)


def backfill(book_id, model, dry=False):
    d = os.path.join(STORE, book_id)
    dj = os.path.join(d, "diagrams.json")
    if not os.path.exists(dj):
        print(f"    {book_id}: no diagrams.json, skipped"); return
    dia = json.load(open(dj))
    t0, done, page, img = time.time(), 0, None, None
    for x in dia:
        b = x.get("bbox")
        if not b or len(b) < 4:
            continue
        if x["page"] != page:
            page = x["page"]
            img = cv2.imread(os.path.join(d, "pages", f"p{page:04d}.jpg"))
        if img is None:
            continue
        x1, y1, x2, y2 = [int(v) for v in b]
        crop = img[max(0, y1):y2, max(0, x1):x2]
        if crop.size == 0:
            continue
        mx = score_board(model, crop)
        x["minConf"] = round(float(mx.min()), 4)
        x["squaresBelow"] = int((mx < LOW).sum())
        done += 1
    flagged = sum(1 for x in dia if x.get("squaresBelow", 0) > 0)
    print(f"    {book_id}: scored {done}/{len(dia)} in {time.time()-t0:.0f}s"
          f"  -> {flagged} diagram(s) with a square below {LOW}")
    if dry:
        print("    (dry run, nothing written)"); return
    bak = dj + ".bak-before-conf"
    if not os.path.exists(bak):
        json.dump(json.load(open(dj)), open(bak, "w"))
    json.dump(dia, open(dj, "w"))
    print(f"    written (backup: {os.path.basename(bak)})")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    model = YOLO(MODEL)
    ids = args or [b for b in sorted(os.listdir(STORE))
                   if os.path.isdir(os.path.join(STORE, b)) and not b.startswith("_")]
    for b in ids:
        backfill(b, model, dry)
