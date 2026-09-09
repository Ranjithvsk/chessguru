"""Read a whole book once: render its pages, find every diagram, read the position.

Ingest is deliberately a ONE-TIME cost per book. Measured on Thursby's 75 Chess
Problems (29 pages, 150 dpi): 67 boards found on the 19 problem pages, 65 legal,
whole book in 100 seconds. Scanning on every page-turn would be absurd next to
that; scanning once and storing {page, bbox, fen} is what makes a reader
feel instant.

Runs in a background thread with a status file, because a FastAPI worker must
not sit blocked for two minutes.

Skipping non-diagram pages is a REQUIREMENT, not a nicety. Every book has title
pages and solution pages, and the classifier will happily return a confident
nonsense position for a page of prose — measured: 10 of 29 pages in that book
have no diagram at all, and each produced a garbage board. A reader that sprouts
a fake position on every solutions page is worse than one that finds nothing.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any

log = logging.getLogger("chessguru-vision.book")

ROOT = "/var/lib/chessguru/user-books"


def _book_dir(book_id: str) -> str:
    return os.path.join(ROOT, book_id)


def status_path(book_id: str) -> str:
    return os.path.join(_book_dir(book_id), "status.json")


def read_status(book_id: str) -> dict[str, Any]:
    try:
        with open(status_path(book_id)) as f:
            return json.load(f)
    except Exception:
        return {"state": "unknown"}


def _write_status(book_id: str, **kw) -> None:
    os.makedirs(_book_dir(book_id), exist_ok=True)
    cur = read_status(book_id)
    cur.update(kw)
    tmp = status_path(book_id) + ".part"
    with open(tmp, "w") as f:
        json.dump(cur, f)
    os.replace(tmp, status_path(book_id))


def _legal(fen: str) -> bool:
    b = (fen or "").split(" ")[0]
    return b.count("K") == 1 and b.count("k") == 1


def ingest(book_id: str, pdf_path: str, classify_image, detect_boards,
           dpi: int = 150, max_pages: int = 400) -> None:
    """Render every page, detect boards, read each one. Blocking; call in a thread.

    `classify_image(bgr) -> dict` and `detect_boards(bgr) -> list` are injected so
    this module never imports the service and stays unit-testable.
    """
    import cv2
    import numpy as np
    try:
        import pymupdf as fitz          # newer name
    except Exception:
        import fitz                      # noqa: F401

    pages_dir = os.path.join(_book_dir(book_id), "pages")
    os.makedirs(pages_dir, exist_ok=True)
    diagrams: list[dict[str, Any]] = []
    t0 = time.time()
    try:
        doc = fitz.open(pdf_path)
        n = min(len(doc), max_pages)
        _write_status(book_id, state="rendering", pages=n, done=0,
                      diagrams=0, startedAt=t0)
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        for i in range(n):
            pix = doc[i].get_pixmap(matrix=mat)
            # JPEG, not PNG: a 300-page book at 150 dpi is hundreds of MB as PNG
            # and these are page scans, which JPEG carries at a fraction of it.
            jpg = os.path.join(pages_dir, "p%04d.jpg" % i)
            pix.save(jpg, jpg_quality=82)

            img = cv2.imread(jpg)
            if img is None:
                _write_status(book_id, done=i + 1)
                continue

            # One classify gives every board on the page with its box.
            page_boards: list[tuple[list[float], Any]] = []
            try:
                cands = detect_boards(img)
            except Exception as e:
                log.warning("book %s page %d detect failed: %s", book_id, i, e)
                cands = []
            for c in cands:
                page_boards.append((c.get("box") or [], c.get("boardPngBase64")))
            if not page_boards:
                # Single-board page (or none). Ask the full pipeline once; if the
                # answer is not a legal position we treat the page as prose.
                try:
                    r = classify_image(img)
                    if r and _legal(r.get("fen", "")):
                        diagrams.append({"page": i, "bbox": None,
                                         "fen": r["fen"],
                                         "conf": r.get("meta", {}).get("avgConfidence")})
                except Exception as e:
                    log.warning("book %s page %d classify failed: %s", book_id, i, e)
                _write_status(book_id, done=i + 1, diagrams=len(diagrams))
                continue

            for box, cb in page_boards:
                if not cb:
                    continue
                try:
                    buf = np.frombuffer(__import__("base64").b64decode(cb), dtype=np.uint8)
                    crop = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                    r = classify_image(crop, warped=crop)
                except Exception as e:
                    log.warning("book %s page %d board classify failed: %s", book_id, i, e)
                    continue
                fen = (r or {}).get("fen", "")
                # A page of prose yields boards that cannot be legal positions.
                if not _legal(fen):
                    continue
                diagrams.append({
                    "page": i,
                    "bbox": [round(v) for v in box] if box else None,
                    "fen": fen,
                    "conf": (r.get("meta") or {}).get("avgConfidence"),
                })
            _write_status(book_id, done=i + 1, diagrams=len(diagrams))

        with open(os.path.join(_book_dir(book_id), "diagrams.json"), "w") as f:
            json.dump(diagrams, f)
        _write_status(book_id, state="done", diagrams=len(diagrams),
                      seconds=round(time.time() - t0, 1))
        log.info("book %s ingested: %d pages, %d diagrams, %.0fs",
                 book_id, n, len(diagrams), time.time() - t0)
    except Exception as e:
        log.exception("book %s ingest failed", book_id)
        _write_status(book_id, state="error", error=str(e)[:300])


def start(book_id: str, pdf_path: str, classify_image, detect_boards) -> None:
    _write_status(book_id, state="queued", done=0, diagrams=0)
    threading.Thread(target=ingest, daemon=True,
                     args=(book_id, pdf_path, classify_image, detect_boards)).start()
