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
    """Strict: a complete position with both kings.

    Still the right test where a board was NOT detected and we are asking whether a
    page of prose accidentally read as a position, and as a tie-break when ranking
    two crops of the same board.
    """
    b = (fen or "").split(" ")[0]
    return b.count("K") == 1 and b.count("k") == 1


def _plausible(fen: str) -> bool:
    """Permissive: is this a readable DIAGRAM, rather than an impossible read?

    Chess books routinely print pawn-structure and fragment diagrams with no kings on
    the board at all -- Winning Chess Manoeuvres and the endgame manuals are full of
    them. Demanding one king per side silently threw every one of them away: measured
    2026-09-19 over 234 square, board-like detections, 3.4% hold no kings and a
    further 2.6% some other count, so **6% of genuine diagrams never reached the
    reader**, with no trace anywhere that they had existed.

    Used only where the DETECTOR has already said "there is a board here". That
    endorsement is what makes it safe to be permissive: reject what is impossible,
    not what is merely unusual.
    """
    b = (fen or "").split(" ")[0]
    ranks = b.split("/")
    if len(ranks) != 8:
        return False
    counts: dict[str, int] = {}
    for ri, rk in enumerate(ranks):
        n = 0
        for ch in rk:
            if ch.isdigit():
                n += int(ch)
            else:
                n += 1
                counts[ch] = counts.get(ch, 0) + 1
                if ch in "Pp" and ri in (0, 7):
                    return False          # a pawn cannot stand on rank 1 or 8
        if n != 8:
            return False
    if counts.get("P", 0) > 8 or counts.get("p", 0) > 8:
        return False
    if sum(counts.values()) < 2:
        return False                      # an all-but-empty board is not a diagram
    # Either a COMPLETE position (one king each) or a PURE FRAGMENT (neither king).
    # One king and not the other is the suspicious shape, and the six boards this
    # gate recovered on Nimzowitsch say why: the two king-less fragments were both
    # read correctly, while three of the four single-king boards were wrong -- and
    # two of those were the book's numbered move markers (a filled dot beside the
    # square) read as a king. The classifier has no "not a piece" class, so a novel
    # glyph must come out as one of the twelve, and a lone king is what it picks.
    wk, bk = counts.get("K", 0), counts.get("k", 0)
    return (wk == 1 and bk == 1) or (wk == 0 and bk == 0)


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


def _read_best_crop(classify_image, img, box, cb, book_id, page_no):
    """Read one board from BOTH available crops and keep the better answer.

    Neither crop wins everywhere, which is only visible once you re-ingest a
    whole book and compare (2026-09-17):

      Mammoth (thumbnails CLIPPED)   page-box crop: 294 -> 444 diagrams
      Grandmaster Preparation (fine) page-box crop: +1 diagram, but mean minConf
                                     0.929 -> 0.916 and low-confidence boards
                                     87 -> 103

    The box crop rescues a clipped thumbnail; the thumbnail is tighter when the
    detector's box swept in caption or margin. So try the box first and accept it
    when it is clearly right, otherwise read the thumbnail too and keep whichever
    scores better. Ranking is (legal, minConf) - a legal position always beats an
    illegal one, because an illegal one is DISCARDED further down and the diagram
    disappears from the book with no trace.

    The second pass only runs on boards the first pass read poorly, so a clean
    book costs nothing extra.
    """
    # cv2 / numpy are DEFERRED imports that live inside ingest() (they are heavy
    # and the module is imported on every /book/status poll). A module-level
    # helper cannot see those locals — without these two lines every crop here
    # fails with "name 'cv2' is not defined", the helper returns None, and the
    # book ingests ZERO diagrams while logging only a warning.
    import cv2
    import numpy as np

    def _grey(c):
        # Books print diagrams in colour (Dvoretsky runs chapters in blue) and on
        # a blue board the classifier calls the outline white king a black bishop.
        return cv2.cvtColor(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)

    def _from_box():
        if not (box and len(box) >= 4):
            return None
        bx1, by1, bx2, by2 = [int(v) for v in box[:4]]
        ph, pw = img.shape[:2]
        bx1, by1 = max(0, bx1), max(0, by1)
        bx2, by2 = min(pw, bx2), min(ph, by2)
        if bx2 - bx1 <= 32 or by2 - by1 <= 32:
            return None
        c = img[by1:by2, bx1:bx2]
        return c if c.size else None

    def _from_thumb():
        if not cb:
            return None
        buf = np.frombuffer(__import__("base64").b64decode(cb), dtype=np.uint8)
        c = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        return c if c is not None and c.size else None

    def _score(r):
        if not r:
            return None
        legal = 1 if _legal(r.get("fen", "")) else 0
        mn = _conf_detail(r).get("minConf")
        return (legal, float(mn) if isinstance(mn, (int, float)) else 0.0)

    best, best_score = None, None
    for name, make in (("box", _from_box), ("thumb", _from_thumb)):
        try:
            crop = make()
        except Exception as e:
            log.warning("book %s page %d %s crop failed: %s", book_id, page_no, name, e)
            continue
        if crop is None:
            continue
        try:
            r = classify_image(_grey(crop), warped=_grey(crop))
        except Exception as e:
            log.warning("book %s page %d %s classify failed: %s", book_id, page_no, name, e)
            continue
        sc = _score(r)
        if sc is None:
            continue
        if best_score is None or sc > best_score:
            best, best_score = r, sc
        # Clearly right: legal and every square confident. No second pass.
        if sc[0] == 1 and sc[1] >= 0.95:
            break
    return best



# Re-read a board only when the first read is this unsure. Set BOOK_HIRES_BELOW=0
# to turn the second look off entirely (useful as the control arm of an A/B).
# Reject a detection whose box is not square enough to be a chessboard. Env-tunable
# so it can be widened or switched off (0 disables) without editing code.
_MAX_ASPECT = float(os.environ.get("BOOK_MAX_ASPECT", "1.15")) or 1e9
_HIRES_BELOW = float(os.environ.get("BOOK_HIRES_BELOW", "0.50"))
_HIRES_FACTOR = int(os.environ.get("BOOK_HIRES_FACTOR", "2"))   # 150 dpi -> 300 dpi


def _hires_reread(doc, page_no, box, dpi, classify_image, first, book_id, cache):
    """Re-read one unsure board from a higher-resolution render of the same page.

    At 150 dpi a small-format diagram gives the classifier about 29 px per square,
    and under a halftone screen it starts reading the screen itself as a piece.
    Page 7 of Winning Chess Manoeuvres is stored with a white pawn on a3 that is
    not on the page; of eight single-square disagreements inspected by eye on
    2026-09-19, seven were the 150 dpi read inventing a piece on an empty square.

    Only the CLASSIFIER gets more pixels. The detector keeps its 150 dpi page and
    its box — it is already at median confidence 1.000, and enlarging its input is
    what made the 2026-09-18 whole-page experiment regress.

    Measured over 878 diagrams, 150 dpi vs 300 dpi on the same boxes:

        band                 illegal      mean conf
        confident >=0.95     0 -> 2       0.999 -> 0.998     <- blanket re-read HURTS
        mid 0.50-0.95        0 -> 1       0.973 -> 0.983
        doubtful <0.50      12 -> 9       0.923 -> 0.969     <- the whole gain is here

    Blanket 300 dpi is a wash (12 -> 12 illegal overall). Re-reading only below
    0.50 touches 12% of diagrams, takes illegal 12 -> 9, and cannot regress the
    confident band because it never looks at it.
    """
    if not (box and len(box) >= 4):
        return first
    try:
        img = cache.get(page_no)
        if img is None:
            # fitz, cv2 and numpy are all imported inside the functions that use
            # them rather than at module scope, so none of them are visible here.
            import fitz
            import cv2
            import numpy as np
            pix = doc[page_no].get_pixmap(
                matrix=fitz.Matrix(dpi * _HIRES_FACTOR / 72, dpi * _HIRES_FACTOR / 72))
            a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            if pix.n == 4:
                a = cv2.cvtColor(a, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                a = cv2.cvtColor(a, cv2.COLOR_RGB2BGR)
            img = cache[page_no] = a
        big_box = [v * _HIRES_FACTOR for v in box[:4]]
        # Same crop path and same best-of-two as the first read; only the pixels differ.
        r = _read_best_crop(classify_image, img, big_box, None, book_id, page_no)
    except Exception as e:
        log.warning("book %s page %d hi-res re-read failed: %s", book_id, page_no, e)
        return first
    if not r:
        return first
    # Keep the new read only if it is a legal position AND less unsure than the old
    # one. Ranking is (legal, minConf), the same rule _read_best_crop uses.
    new_ok = 1 if _legal(r.get("fen", "")) else 0
    old_ok = 1 if _legal((first or {}).get("fen", "")) else 0
    new_mc = _conf_detail(r).get("minConf")
    old_mc = _conf_detail(first or {}).get("minConf")
    if new_ok < old_ok:
        return first
    if new_ok > old_ok:
        return r
    if isinstance(new_mc, (int, float)) and isinstance(old_mc, (int, float)):
        return r if new_mc > old_mc else first
    return first


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
            # Holds at most THIS page's hi-res render, shared by however many of its
            # boards need a second look. Scoped to the page on purpose: a 300 dpi A4
            # page is ~26 MB, so keeping them across a 400-page book would be ~10 GB.
            hires_cache: dict[int, Any] = {}
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
                # A board needs EITHER a thumbnail or a usable box. This used to
                # demand the thumbnail, which silently dropped any board the
                # detector had located but handed back without one -- the same
                # way the clipped-thumbnail bug dropped 150 Mammoth diagrams, and
                # just as invisibly. _read_best_crop() below uses whichever of the
                # two is present, and the better-scoring one when both are.
                if not cb and not (box and len(box) >= 4):
                    continue
                # A chessboard is square. The detector also fires on things that
                # merely LOOK gridded -- MCO-15's opening tables, an "EXPLANATORY
                # NOTE" heading, a drop-cap letter T -- and those crops then get
                # read as positions and stored as garbage nobody can trace back.
                # Measured over 5,227 known-good boards (conf >= 0.95 and legal),
                # the WORST aspect ratio is 1.093; the junk sits at p95 = 3.51 and
                # runs to 5.11. On 700 library detections this one test takes
                # illegal reads from 12.1% to 3.6% while discarding 9% of boxes,
                # none of them real. 1.15 leaves headroom over the observed 1.093.
                if box and len(box) >= 4:
                    _bw, _bh = box[2] - box[0], box[3] - box[1]
                    if _bw > 0 and _bh > 0 and max(_bw, _bh) / min(_bw, _bh) > _MAX_ASPECT:
                        continue
                r = _read_best_crop(classify_image, img, box, cb, book_id, i)
                if r is None:
                    continue
                # Unsure reads get one more look at twice the resolution. Confident
                # ones are left alone on purpose — see _hires_reread for the numbers.
                _mc = _conf_detail(r).get("minConf")
                if isinstance(_mc, (int, float)) and _mc < _HIRES_BELOW:
                    r = _hires_reread(doc, i, box, dpi, classify_image, r, book_id, hires_cache)
                fen = (r or {}).get("fen", "")
                # The detector already said there is a board here, so the bar is
                # "possible", not "complete". _legal() would discard every kingless
                # pawn-structure diagram the book prints -- see _plausible().
                if not _plausible(fen):
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


# ONE book renders at a time, globally — across every coach, not per coach.
#
# 2026-09-18: a coach uploaded 16 books in one go. start() spawned an unbounded
# thread for each, so ELEVEN rendered concurrently and drove this 8-core box to
# load 24 — the same box that serves live Dream Meet classes. Nothing was harmed
# only because no class was scheduled that evening. Rendering a book slower costs
# a coach minutes; a stuttering live class costs a lesson.
#
# Everyone else waits in the "queued" state the reader already displays, and is
# told WHERE they are in the queue and roughly how long it will be — a coach who
# can see "3rd, about 25 minutes" does not re-upload, which is how we ended up
# with two renders of the same Sicilian.
_INGEST_SLOTS = threading.Semaphore(int(os.environ.get("BOOK_INGEST_CONCURRENCY", "1")))
_QUEUE_LOCK = threading.Lock()
_WAITING: list[str] = []          # book_ids waiting, in arrival order
_ACTIVE: str | None = None        # the one being rendered
_OWNED: set[str] = set()          # every book a thread in THIS process is handling

# Seconds per page, measured. Books average ~250 pages and the observed rate on
# this box is ~8 pages/min with 11 running; alone it is far quicker. Refined from
# real finishes below, so the estimate improves as books complete.
_SEC_PER_PAGE_DEFAULT = 1.6
_recent_rates: list[float] = []


def _sec_per_page() -> float:
    if not _recent_rates:
        return _SEC_PER_PAGE_DEFAULT
    return sum(_recent_rates) / len(_recent_rates)


def _pdf_pages(pdf_path: str) -> int:
    """Page count without rendering anything — needed to estimate the wait."""
    try:
        import pymupdf  # noqa
        with pymupdf.open(pdf_path) as d:
            return d.page_count
    except Exception:
        try:
            import fitz
            with fitz.open(pdf_path) as d:
                return d.page_count
        except Exception:
            return 0


def _publish_queue() -> None:
    """Stamp every waiting book with its place in line and an ETA."""
    rate = _sec_per_page()
    ahead_pages = 0
    if _ACTIVE:
        st = read_status(_ACTIVE)
        ahead_pages += max(0, int(st.get("pages") or 0) - int(st.get("done") or 0))
    for pos, bid in enumerate(_WAITING, start=1):
        st = read_status(bid)
        eta = int(ahead_pages * rate)
        _write_status(bid, state="queued", queuePosition=pos,
                      etaSeconds=eta, etaReadyAt=time.strftime(
                          "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + eta)))
        ahead_pages += int(st.get("pages") or 0)


def _ingest_when_free(book_id: str, pdf_path: str, classify_image, detect_boards) -> None:
    global _ACTIVE
    with _QUEUE_LOCK:
        _OWNED.add(book_id)
        _WAITING.append(book_id)
        _publish_queue()
    with _INGEST_SLOTS:
        with _QUEUE_LOCK:
            if book_id in _WAITING:
                _WAITING.remove(book_id)
            _ACTIVE = book_id
            _write_status(book_id, queuePosition=0, etaSeconds=0)
            _publish_queue()
        began = time.time()
        try:
            ingest(book_id, pdf_path, classify_image, detect_boards)
        finally:
            with _QUEUE_LOCK:
                _ACTIVE = None
                _OWNED.discard(book_id)
                done = int(read_status(book_id).get("done") or 0)
                if done > 5:
                    _recent_rates.append((time.time() - began) / done)
                    del _recent_rates[:-10]          # keep the last 10 books
                _publish_queue()


def owns(book_id: str) -> bool:
    """Is a thread in THIS process queued for or rendering this book?

    The file's "queued"/"rendering" is not proof of that: the queue is in memory,
    so after a restart the file still says so while nobody is working. Callers
    that want to know whether to start a read must ask this, not the file."""
    with _QUEUE_LOCK:
        return book_id in _OWNED


def stranded() -> list[tuple[str, str]]:
    """Books whose status.json says queued/rendering but which nobody here owns.

    The queue lives in memory, so a restart (deploy, crash, reboot) used to leave
    such books "queued" for ever with nothing to pick them up — a coach saw "0%"
    on a shelf that never moved (Guna Chess, 18 Sep 2026, TKT-251). Also catches
    books the API stamped "queued" itself because this service was unreachable
    at upload time. Returns (book_id, pdf_path) for each; the caller re-starts them."""
    try:
        ids = sorted(os.listdir(ROOT))
    except OSError:
        return []
    with _QUEUE_LOCK:
        owned = set(_OWNED)
    out: list[tuple[str, str]] = []
    for bid in ids:
        if bid in owned or bid.startswith("_"):
            continue
        if read_status(bid).get("state") not in ("queued", "rendering"):
            continue
        pdf = os.path.join(_book_dir(bid), "book.pdf")
        if os.path.isfile(pdf):
            out.append((bid, pdf))
    return out


def start(book_id: str, pdf_path: str, classify_image, detect_boards) -> None:
    # Claimed before anything is written, so a sweep running at the same moment
    # cannot also start it.
    with _QUEUE_LOCK:
        _OWNED.add(book_id)
    # Page count up front (cheap — opens the PDF, renders nothing) so a queued
    # book can be given a real ETA instead of a shrug.
    _write_status(book_id, state="queued", done=0, diagrams=0,
                  pages=_pdf_pages(pdf_path))
    threading.Thread(target=_ingest_when_free, daemon=True,
                     args=(book_id, pdf_path, classify_image, detect_boards)).start()
