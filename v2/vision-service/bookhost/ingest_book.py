"""Ingest ONE book on Vinayaka: render its pages, find and read every diagram.

Runs entirely here. Everything the Linux ingest learned today is applied:
  - split a two-page spread at the gutter, since a diagram on a spread is small
    and the extractor misses it (4 of 8 spreads found nothing before this)
  - de-duplicate by POSITION, keeping the largest board — the same diagram is
    detected in several views and the readings differ
  - drop regions that are not chess positions at all (a front COVER was stored
    as a position with six white knights)
  - keep the logic engine's warnings instead of discarding them
  - never overwrite a coach's ruling; match by proximity, not by a rounded key

Called by bookhost.py's worker, one book at a time.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, r"E:\dreamocr")
import chess
import chess_logic as _cl
from diagram_sanity import why_not_a_position
from ultralytics import YOLO

STORE = r"F:\chessguru-books"
SEG = r"E:\vision-weights\chessguru-board-seg.pt"
CLS = r"E:\vision-weights\chessguru-cls.pt"
ORDER = ["b", "k", "n", "p", "q", "r", "f", "B", "K", "N", "P", "Q", "R"]
LAB = ["B", "K", "N", "P", "Q", "R", "b", "k", "n", "p", "q", "r", "f"]
NAMES = [chess.square_name(chess.square(c, 7 - r)) for r in range(8) for c in range(8)]
DPI = 150

_seg = _cls = None


def models():
    global _seg, _cls
    if _seg is None:
        _seg, _cls = YOLO(SEG), YOLO(CLS)
    return _seg, _cls


def warps(img, conf=0.5, max_n=12):
    seg, _ = models()
    out = []
    r = seg.predict(img, conf=conf, verbose=False)[0]
    if r.masks is None:
        return out
    for m in r.masks.xy[:max_n]:
        pts = np.asarray(m, dtype=np.float32).reshape(-1, 1, 2)
        if len(pts) < 4:
            continue
        ap = cv2.approxPolyDP(pts, 0.02 * cv2.arcLength(pts, True), True)
        if len(ap) != 4:
            x, y, w, h = cv2.boundingRect(pts.astype(np.int32))
            ap = np.array([[[x, y]], [[x + w, y]], [[x + w, y + h]], [[x, y + h]]], dtype=np.float32)
        q = ap.reshape(4, 2).astype(np.float32)
        s, d = q.sum(1), np.diff(q, axis=1).ravel()
        src = np.array([q[np.argmin(s)], q[np.argmin(d)], q[np.argmax(s)], q[np.argmax(d)]], dtype=np.float32)
        dst = np.array([[0, 0], [512, 0], [512, 512], [0, 512]], dtype=np.float32)
        x, y, w, h = cv2.boundingRect(pts.astype(np.int32))
        out.append((cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (512, 512)),
                    [x, y, x + w, y + h]))
    return out


def board_fen(warp):
    """Returns (fen, per-square probabilities in LAB order, confidence).

    It used to return the FEN alone and drop the probabilities on the floor,
    which cost twice. The logic pass downstream had to invent a flat 0.95 for
    every square, so it could not tell a square it was sure of from one it had
    guessed. And every diagram was stored with modelConf: None, so the reader
    had nothing to colour and the low-confidence marker never appeared on a
    book read here.

    Confidence is the WEAKEST square, not the average: one badly-read square is
    enough to make the whole position wrong, and an average over 64 squares
    drowns it — 63 easy empty squares hide the one piece that was a guess.
    """
    _, cls = models()
    tiles = [cv2.cvtColor(warp[r * 64:(r + 1) * 64, c * 64:(c + 1) * 64], cv2.COLOR_BGR2RGB)
             for r in range(8) for c in range(8)]
    a = cls.predict(tiles, imgsz=64, verbose=False)
    b = cls.predict([cv2.flip(t, 1) for t in tiles], imgsz=64, verbose=False)
    avg = np.stack([0.5 * (x.probs.data.cpu().numpy() + y.probs.data.cpu().numpy())
                    for x, y in zip(a, b)])                     # (64, 13) in ORDER
    chars = [ORDER[int(row.argmax())] for row in avg]
    conf = float(avg.max(axis=1).min())
    # chess_logic indexes by LAB, the classifier outputs ORDER — same labels,
    # different order. Handing it the raw matrix would silently mislabel every
    # square.
    lab_probs = np.stack([avg[:, ORDER.index(l)] for l in LAB], axis=1)
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
    return "/".join(rows), lab_probs, conf


def logic_pass(fen: str, probs=None):
    """Auto-fixes the engine is confident about, plus warnings worth showing."""
    labels = []
    for row in fen.split("/"):
        for ch in row:
            labels += ["f"] * int(ch) if ch.isdigit() else [ch]
    if len(labels) != 64:
        return fen, []
    if probs is None:
        # Only for a board whose probabilities were not kept. A flat 0.95 tells
        # the logic pass every square is equally certain, so it cannot prefer
        # changing the square it was least sure of.
        probs = np.full((64, 13), 0.01, dtype=np.float32)
        for i, l in enumerate(labels):
            probs[i, LAB.index(l)] = 0.95
    try:
        out, fixes, warns = _cl.apply_chess_logic(list(labels), probs, NAMES, LAB)
    except Exception:
        return fen, []
    if fixes:
        rows = []
        for r in range(8):
            row, blank = "", 0
            for c in range(8):
                ch = out[r * 8 + c]
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
        fen = "/".join(rows)
    return fen, warns


def same_spot(a, b) -> bool:
    if not a or not b:
        return False
    tol = max(60, min(a[2] - a[0], b[2] - b[0]) * 0.5)
    return (abs((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2) < tol
            and abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) < tol)


def main(pdf_path: str, book_id: str, title: str) -> None:
    try:
        import pymupdf as fitz
    except Exception:
        import fitz
    dest = os.path.join(STORE, book_id)
    os.makedirs(os.path.join(dest, "pages"), exist_ok=True)

    def status(**kw):
        p = os.path.join(dest, "status.json")
        cur = {}
        try:
            cur = json.load(open(p))
        except Exception:
            pass
        cur.update(kw)
        json.dump(cur, open(p, "w"))

    # A coach's rulings on THIS book survive a re-ingest, matched by position.
    ruled = []
    cp = os.path.join(dest, "corrections.jsonl")
    if os.path.exists(cp):
        for line in open(cp, encoding="utf8"):
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("now") and r.get("bbox"):
                ruled.append(r)

    # The source path matters now: pages are rendered from the PDF on demand
    # rather than kept as JPEGs, so the book host needs to find the file again.
    json.dump({"title": title, "owner": os.environ.get("BOOK_OWNER", "ranjith_vsk"),
               "pdf": pdf_path},
              open(os.path.join(dest, "meta.json"), "w"))
    doc = fitz.open(pdf_path)
    n = len(doc)
    status(state="rendering", pages=n, done=0, diagrams=0, startedAt=time.time())
    mat = fitz.Matrix(DPI / 72, DPI / 72)
    diagrams, t0 = [], time.time()
    for i in range(n):
        jpg = os.path.join(dest, "pages", "p%04d.jpg" % i)
        if not os.path.exists(jpg):
            doc[i].get_pixmap(matrix=mat).save(jpg, jpg_quality=82)
        img = cv2.imread(jpg)
        if img is None:
            status(done=i + 1)
            continue
        h, w = img.shape[:2]
        views = [(img, 0)]
        if w >= h * 1.25:                      # a two-page spread
            views += [(img[:, : w // 2], 0), (img[:, w // 2:], w // 2)]
        found = []
        for view, dx in views:
            for warp, box in warps(view):
                try:
                    fen, probs, conf = board_fen(warp)
                except Exception:
                    continue
                bb = [box[0] + dx, box[1], box[2] + dx, box[3]]
                found.append((bb, fen, probs, conf, (bb[2] - bb[0]) * (bb[3] - bb[1])))
        kept = []
        for bb, fen, probs, conf, area in sorted(found, key=lambda t: -t[4]):
            if any(same_spot(bb, k[0]) for k in kept):
                continue
            kept.append((bb, fen, probs, conf, area))
        for bb, fen, probs, conf, _a in kept:
            fen, warns = logic_pass(fen, probs)
            if why_not_a_position(fen):
                continue
            entry = {"page": i, "bbox": [round(v) for v in bb], "fen": fen,
                     # The reader colours anything under 0.9 amber. This was
                     # None on every diagram, which became 1 in the reader, so
                     # no position on a book read here was ever flagged.
                     "modelConf": round(conf, 3)}
            if warns:
                entry["warnings"] = warns
            for r in ruled:
                if r["page"] == i and same_spot(bb, r["bbox"]):
                    entry.update({"fen": r["now"], "conf": 1.0,
                                  "corrected": r.get("was") != r.get("now")})
                    entry.pop("warnings", None)
                    break
            diagrams.append(entry)
        status(done=i + 1, diagrams=len(diagrams))
    json.dump(diagrams, open(os.path.join(dest, "diagrams.json"), "w"))

    # The pages have done their job: the positions are extracted and stored.
    # Keeping them would cost ~3.2x the PDF in JPEGs — about 127 GB across the
    # library — to hold a second copy of a book we already have. Rendering a
    # page from the PDF takes ~88ms, which is fast enough to do when someone
    # actually turns to it, so the images are dropped and the diagrams kept.
    pages_dir = os.path.join(dest, "pages")
    if os.environ.get("KEEP_PAGES") != "1" and os.path.isdir(pages_dir):
        freed = 0
        for fn in os.listdir(pages_dir):
            f = os.path.join(pages_dir, fn)
            try:
                freed += os.path.getsize(f)
                os.remove(f)
            except OSError:
                pass
        print("dropped rendered pages, freed %.0f MB" % (freed / 1e6), flush=True)
    status(state="done", diagrams=len(diagrams), seconds=round(time.time() - t0, 1))
    print("%s: %d pages, %d diagrams, %.0fs" % (book_id, n, len(diagrams), time.time() - t0))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else sys.argv[2])
