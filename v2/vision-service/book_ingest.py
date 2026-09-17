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


_LOW_CONF = 0.70


def _conf_detail(r: dict) -> dict:
    """Per-square confidence, kept instead of averaged away.

    The stored `conf` is the MEAN over all 64 squares, and a mean hides exactly the
    squares worth looking at: a board with 62 easy empties plus one square scored
    0.37 still averages 0.98. Measured on Dvoretsky's Endgame Manual 2026-09-17 --
    169 of 683 diagrams contain a square below 0.70, and their stored average
    confidence is 0.977. Page 19's three "x" key-square marks scored 0.531, 0.768
    and 0.368 and were read as a queen, a knight and a queen; the diagram's stored
    confidence was 0.936.

    This is the GENERAL defence against anything the classifier has never seen --
    "?" mined-square marks, "x" key squares, arrows, circled squares, printed
    numbers, a coach's pen. The 13-class softmax has no "not a piece" output, so a
    novel glyph must come out as one of the twelve pieces or empty. What it cannot
    do is look confident while doing it -- so keep the doubt, and the reader can
    flag the diagram without anyone having to anticipate the glyph.

    Costs nothing: the numbers are already in the classify response.
    """
    grid = (r or {}).get("squares") or []
    confs = [
        c.get("confidence")
        for row in grid for c in (row or [])
        if isinstance(c, dict) and isinstance(c.get("confidence"), (int, float))
    ]
    if not confs:
        return {}
    return {
        "minConf": round(float(min(confs)), 4),
        "squaresBelow": int(sum(1 for c in confs if c < _LOW_CONF)),
    }


def _legal(fen: str) -> bool:
    b = (fen or "").split(" ")[0]
    return b.count("K") == 1 and b.count("k") == 1


def _read_text(book_id, page_no, img, page_fens, moves, ocr_pages, labels_dir):
    """Dream OCR over one page, with this page's diagrams as candidate positions.

    Optional on purpose. If dream_ocr or its engines are unavailable the book
    still ingests exactly as before — diagrams only — because a coach waiting on
    an upload should never lose the whole book to a missing OCR dependency.
    """
    try:
        import dream_ocr
    except Exception:
        return
    try:
        r = dream_ocr.read_page(img, candidate_fens=page_fens)
    except Exception as e:
        log.warning("book %s page %d text read failed: %s", book_id, page_no, e)
        return
    ocr_pages.append({"page": page_no, "text": r.get("text", ""),
                      "moves": r.get("moves", []),
                      "verified": r.get("movesVerified", 0)})
    for t in r.get("tokens", []):
        if t.get("kind") == "move" and t.get("verified"):
            moves.append({"page": page_no, "san": t.get("text"),
                          "printed": t.get("original") or t.get("text")})
    # Every PROVED move is a certain training pair, harvested for free.
    if labels_dir:
        try:
            toks = [dream_ocr.Token(**t) for t in r.get("tokens", [])]
            dream_ocr.export_training_pairs(img, toks, labels_dir,
                                            source="%s_p%04d" % (book_id, page_no))
        except Exception as e:
            log.warning("book %s page %d label export failed: %s", book_id, page_no, e)


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
    moves: list[dict[str, Any]] = []
    ocr_pages: list[dict[str, Any]] = []
    labels_dir = os.path.join(_book_dir(book_id), "proven-labels")
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
                                         "conf": r.get("meta", {}).get("avgConfidence"),
                                         **_conf_detail(r)})
                except Exception as e:
                    log.warning("book %s page %d classify failed: %s", book_id, i, e)
                _write_status(book_id, done=i + 1, diagrams=len(diagrams))
                continue

            page_fens: list[str] = []
            for box, cb in page_boards:
                if not cb:
                    continue
                try:
                    # Crop from the PAGE using the detector's box, rather than using
                    # the 512x512 thumbnail it hands back.
                    #
                    # That thumbnail is clipped on this book's diagrams — a whole file
                    # sliced through the middle — so the classifier read nonsense, the
                    # position failed _legal() below, and the diagram was DISCARDED
                    # with no trace. 44% of the Mammoth book's pages ended up with no
                    # diagram at all while the detector had actually found every board
                    # at 0.94+. Same two boards, measured 2026-09-17:
                    #   thumbnail : legal=False  minConf 0.013 / 0.002
                    #   page+box  : legal=True   minConf 0.999 / 0.999
                    # The FFT refinement cannot rescue it — it trims margins, it cannot
                    # give back board that was cropped away.
                    crop = None
                    if box and len(box) >= 4:
                        bx1, by1, bx2, by2 = [int(v) for v in box[:4]]
                        ph, pw = img.shape[:2]
                        bx1, by1 = max(0, bx1), max(0, by1)
                        bx2, by2 = min(pw, bx2), min(ph, by2)
                        if bx2 - bx1 > 32 and by2 - by1 > 32:
                            crop = img[by1:by2, bx1:bx2]
                    if crop is None or crop.size == 0:
                        buf = np.frombuffer(__import__("base64").b64decode(cb), dtype=np.uint8)
                        crop = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                    # Read the board in grey. Books print diagrams in colour as
                    # well as black — Dvoretsky's Endgame Manual runs whole
                    # chapters in blue — and on a blue board the classifier calls
                    # the OUTLINE white king a black bishop. The position then has
                    # no white king, `_legal` rejects it, and the diagram vanishes
                    # from the book with no trace: the reader shows a page with
                    # nothing to click. Dropping the colour fixes the read.
                    # Measured over 45 boards from that book: 44 unchanged,
                    # 1 fixed, 0 broken.
                    crop = cv2.cvtColor(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY),
                                        cv2.COLOR_GRAY2BGR)
                    r = classify_image(crop, warped=crop)
                except Exception as e:
                    log.warning("book %s page %d board classify failed: %s", book_id, i, e)
                    continue
                fen = (r or {}).get("fen", "")
                # A page of prose yields boards that cannot be legal positions.
                if not _legal(fen):
                    continue
                page_fens.append(fen)
                diagrams.append({
                    "page": i,
                    "bbox": [round(v) for v in box] if box else None,
                    "fen": fen,
                    "conf": (r.get("meta") or {}).get("avgConfidence"),
                    **_conf_detail(r),
                })

            # Read the page's TEXT too, with the diagrams we just found as the
            # candidate positions. This is what turns a book from a set of
            # pictures into something searchable and playable: the move list
            # beside each diagram, with the legal ones proved.
            _read_text(book_id, i, img, page_fens, moves, ocr_pages, labels_dir)
            _write_status(book_id, done=i + 1, diagrams=len(diagrams),
                          moves=len(moves))

        with open(os.path.join(_book_dir(book_id), "diagrams.json"), "w") as f:
            json.dump(diagrams, f)
        with open(os.path.join(_book_dir(book_id), "text.json"), "w") as f:
            json.dump(ocr_pages, f)
        with open(os.path.join(_book_dir(book_id), "moves.json"), "w") as f:
            json.dump(moves, f)
        _write_status(book_id, state="done", diagrams=len(diagrams),
                      moves=len(moves), seconds=round(time.time() - t0, 1))
        log.info("book %s ingested: %d pages, %d diagrams, %d proved moves, %.0fs",
                 book_id, n, len(diagrams), len(moves), time.time() - t0)
    except Exception as e:
        log.exception("book %s ingest failed", book_id)
        _write_status(book_id, state="error", error=str(e)[:300])


def start(book_id: str, pdf_path: str, classify_image, detect_boards) -> None:
    _write_status(book_id, state="queued", done=0, diagrams=0)
    threading.Thread(target=ingest, daemon=True,
                     args=(book_id, pdf_path, classify_image, detect_boards)).start()
