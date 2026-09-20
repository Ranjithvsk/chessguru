"""Book host for Vinayaka: catalogue the owner's Drive, queue books, serve pages.

WHY HERE. The books live on this machine's G: drive and so does the GPU, so
rendering and reading a book belongs here. The Linux box stays free to serve
classes and scans.

SECURITY. Binds 127.0.0.1 ONLY and is reached through the existing reverse SSH
tunnel, exactly like chessdb-api-tunnel. It performs NO authentication and must
never be exposed directly — the ChessGuru API in front of it is where the user's
session is checked and where ownership is enforced. These are copyrighted books
someone owns a copy of; nothing here may be reachable without going through that.

Deliberately one worker, one book at a time. Ingest is CPU/GPU heavy and this
machine also trains models; a queue that hammers it helps nobody.
"""
from __future__ import annotations

import json
import gzip
import io
import os
import re
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

# France port (2026-09-19): the same host, reading PDFs from a local mirror of the owner's Drive
# "Chess" folder and the store copied from Vinayaka. Paths come from the environment; the
# book meta files still carry Vinayaka's Windows paths, which localize() maps onto ROOT.
ROOT = os.environ.get("BOOKHOST_ROOT", "/srv/data/chess-library")
WIN_ROOT = "G:\\My Drive\\Chess"
STORE = os.environ.get("BOOKHOST_STORE", "/srv/data/chessguru-books")
PORT = int(os.environ.get("BOOKHOST_PORT", "8791"))

DRIVE_REMOTE = os.environ.get("BOOKHOST_DRIVE_REMOTE", "gdrive:Chess")   # rclone remote of the owner's Chess folder

# B2 is now the library's home (2026-09-19). /srv/data hit 100% with the borg and pgBackRest
# repos on it, and 42 GB of that was chess-library-flat: 3,841 PDFs that ROOT only ever
# pointed at through symlinks. The corpus moved to Backblaze, ROOT became a CACHE, and this
# box keeps only what people are actually reading.
#
# The bucket is flat (one directory, no tree) while ROOT is structured, so a lookup is by
# BASENAME. The manifest maps lowercase basename -> the exact object name, because B2 is
# case-sensitive and link-library.py matched case-insensitively: without it a reader asking
# for "Endgame Manual.pdf" misses an object stored as "endgame manual.pdf".
B2_REMOTE = os.environ.get("BOOKHOST_B2_REMOTE", "b2books:dreamworld-books/chess-library-flat")
MANIFEST = os.environ.get("BOOKHOST_MANIFEST", "/srv/data/bookhost/flat-manifest.json")
CACHE_CAP = int(os.environ.get("BOOKHOST_CACHE_GB", "8")) * 1024**3
_fetch_lock = threading.Lock()

def _manifest() -> dict:
    try:
        with open(MANIFEST, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}

def fetch_from_b2(local_path: str) -> bool:
    """Pull one PDF from the B2 library into ROOT. Returns True if it is now on disk."""
    if not B2_REMOTE or not local_path.startswith(ROOT + os.sep):
        return False
    obj = _manifest().get(os.path.basename(local_path).lower())
    if not obj:
        return False
    try:
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        rc = subprocess.run(["rclone", "copyto", B2_REMOTE + "/" + obj, local_path,
                             "--retries", "3", "--low-level-retries", "5"],
                            capture_output=True, timeout=300)
        # A ZERO-BYTE result is a miss, not a hit. 42 of the 3,841 books arrived truncated
        # in an interrupted copy run, and an empty file satisfies os.path.exists(), so the
        # Drive fallback would never fire and those books stayed broken forever. Treat empty
        # as absent and let the next source try. (All 42 were restored from the Storage Box
        # archive on 2026-09-19, which had intact copies.)
        if rc.returncode == 0 and os.path.exists(local_path):
            if os.path.getsize(local_path) > 0:
                return True
            try:
                os.remove(local_path)
            except OSError:
                pass
        return False
    except Exception:
        return False

def trim_cache(keep: str = "") -> None:
    """Keep ROOT under CACHE_CAP, dropping least-recently-read books first.

    `keep` is the book that was fetched a moment ago and is about to be opened: it must
    never be the one evicted. On 2026-09-20 every book outside the cache 404'd: rclone
    stamps a fetched file with the object's ORIGINAL mtime/atime (August), the walk below
    then saw it as the least-recently-read file in the cache and deleted it 2 s after
    downloading it. ensure_local() also touches the file for the same reason.

    Without this the cache simply grows back to the 42 GB we just moved off. Only real
    files are candidates -- never symlinks, which are the catalogue's own structure -- and
    a book open right now survives deletion anyway, because Linux keeps the inode alive
    until the last reader closes it.
    """
    try:
        files = []
        total = 0
        for dirpath, _dirs, names in os.walk(ROOT):
            for n in names:
                fp = os.path.join(dirpath, n)
                if os.path.islink(fp) or (keep and os.path.samefile(fp, keep) if os.path.exists(keep) else False):
                    continue
                try:
                    st = os.stat(fp)
                except OSError:
                    continue
                files.append((st.st_atime, st.st_size, fp))
                total += st.st_size
        if total <= CACHE_CAP:
            return
        files.sort()                       # oldest access first
        for _atime, size, fp in files:
            if total <= CACHE_CAP:
                break
            try:
                os.remove(fp)
                total -= size
            except OSError:
                pass
    except Exception:
        pass

def ensure_local(local_path: str) -> bool:
    """Get this PDF onto disk, from wherever it lives. B2 first, the owner's Drive second."""
    if not local_path:
        return False
    with _fetch_lock:
        if os.path.exists(local_path):
            return True
        # A DANGLING symlink must go first. It points into the deleted flat library, and
        # rclone would happily write THROUGH it -- recreating the file at the old 42 GB
        # location instead of in the cache, silently refilling the disk we just emptied.
        if os.path.islink(local_path):
            try:
                os.unlink(local_path)
            except OSError:
                pass
        ok = fetch_from_b2(local_path) or fetch_from_drive(local_path)
        if ok:
            try:
                os.utime(local_path, None)      # "read just now", whatever rclone stamped on it
            except OSError:
                pass
    if ok:
        trim_cache(keep=local_path)
    return ok

def fetch_from_drive(local_path: str) -> bool:
    """Mirror one PDF from the owner's Drive into ROOT (same relative path). Serialised so a
    burst of readers cannot start the same download twice; ~10-30 s for a typical book."""
    if not DRIVE_REMOTE or not local_path.startswith(ROOT + os.sep):
        return False
    rel = os.path.relpath(local_path, ROOT)
    with _fetch_lock:
        if os.path.exists(local_path):
            return True
        try:
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            rc = subprocess.run(["rclone", "copyto", DRIVE_REMOTE + "/" + rel, local_path, "--tpslimit", "4"],
                                capture_output=True, timeout=180)
            return rc.returncode == 0 and os.path.exists(local_path)
        except Exception:
            return False

def localize(path: str) -> str:
    """A Vinayaka path (G:\\My Drive\\Chess\\...) → the same file under ROOT."""
    if not path:
        return path
    if os.path.exists(path):
        return path
    p = path.replace("\\", "/")
    marker = "My Drive/Chess/"
    i = p.find(marker)
    if i >= 0:
        return os.path.join(ROOT, p[i + len(marker):])
    return path
CATALOGUE = os.path.join(STORE, "catalogue.json")

import organise            # clean titles, authors, shelves


def shelved(cat: list) -> list:
    """Catalogue as a LIBRARY, not a directory listing.

    Collapses copies of the same book into one entry. The dump has 4101
    files but far fewer books — the same title arrives from three sites
    under three names, and a shelf that lists it three times is a worse
    shelf. The copies are kept on the entry so nothing is hidden, and
    NOTHING is deleted from the owner's Drive.
    """
    seen = {}
    for b in cat:
        o = organise.organise(b)
        k = (o["sort"], (o.get("author") or "").lower())
        cur = seen.get(k)
        if cur is None:
            o["copies"] = 1
            o["alts"] = []
            seen[k] = o
            continue
        cur["copies"] += 1
        cur["alts"].append({"id": o["id"], "mb": o["mb"],
                             "folder": o["folder"]})
        # Prefer the biggest file: among scans of one book the larger is
        # almost always the better scan, and a bad scan is what makes the
        # OCR pass fail.
        if o["mb"] > cur["mb"]:
            alts = cur["alts"]; copies = cur["copies"]
            o["alts"] = alts; o["copies"] = copies
            seen[k] = o
    out = list(seen.values())
    out.sort(key=lambda x: (x["shelf"], x["sort"]))
    return out

QUEUE = os.path.join(STORE, "queue.json")
# Uploaded books live inside the owner's Chess folder, so Drive backs them up
# like everything else and the catalogue picks them up on the next refresh.
UPLOADS = os.path.join(ROOT, "_uploads")


def find_existing(title: str, mb: float):
    """Do we already have this book?

    Checks what has been READ first, then the library, because the useful
    answer to "I already have this" is the processed book with its positions,
    not another copy of the PDF. Matching is on the cleaned title, so the same
    book uploaded under a dump-site filename still matches.
    """
    want = organise.organise({"title": title, "path": "", "folder": ".", "mb": mb})["sort"]
    if not want:
        return None
    for d in sorted(os.listdir(STORE)):
        full = os.path.join(STORE, d)
        if not os.path.isdir(full):
            continue
        meta = load(os.path.join(full, "meta.json"), {})
        t = meta.get("title")
        if not t:
            continue
        if organise.organise({"title": t, "path": "", "folder": ".", "mb": 0})["sort"] == want:
            st = load(os.path.join(full, "status.json"), {})
            return {"where": "read", "id": d, "title": t,
                    "pages": st.get("pages", 0), "diagrams": st.get("diagrams", 0),
                    "state": st.get("state", "unknown")}
    for b in (load(CATALOGUE, None) or []):
        if organise.organise(b)["sort"] == want:
            return {"where": "library", "id": b["id"], "title": organise.organise(b)["title"],
                    "mb": b["mb"], "pages": 0, "diagrams": 0, "state": "not read yet"}
    return None


# Stop reading books before the drive fills. Reading the whole library
# is a multi-day unattended job at ~0.19 MB per page, and a full disk
# would not just stop ingest — it would break the books already read,
# the corrections written beside them, and anything else on F:.
MIN_FREE_GB = 50

# How many books to read at once.
#
# One-at-a-time was the safe first choice, but it leaves this machine idle:
# measured mid-run at 44% CPU of 32 threads, 5% GPU and 19.5 GB RAM free. A
# book spends most of its life rendering pages and pulling text, which is CPU
# work, with short GPU bursts for board detection — so several books can run
# together without contending for the card.
#
# Measured: 1 worker = 68 books/hour, 3 = ~140. Each worker loads its own copy
# of the detection and
# classifier models (~0.4 GB of VRAM each), and the live class scanner shares
# this GPU — so the ceiling is the card and the Drive mount both books are
# read through, not the CPU.
WORKERS = int(os.environ.get("BOOKHOST_WORKERS", "15"))

# --- Dream PDF: pages come from the PDF, not from a second copy of the book ---
#
# Ingest used to leave every page behind as a JPEG. That is ~3.2x the PDF in
# images — about 127 GB across this library — to store a book we already have.
# PyMuPDF renders a page in ~88ms, which is fast enough to do when a reader
# actually turns to it, so the pages are rendered on demand instead.
#
# Documents are kept OPEN between requests: opening an 854-page PDF costs far
# more than rendering one page from an already-open one, and a reader turning
# pages would otherwise pay that cost on every single page.
_docs = {}                       # book id -> (fitz.Document, last used)
_docs_lock = threading.Lock()
MAX_OPEN_DOCS = 8


def _open_doc(bid: str):
    import fitz
    with _docs_lock:
        hit = _docs.get(bid)
        if hit:
            _docs[bid] = (hit[0], time.time())
            return hit[0]
    meta = load(os.path.join(book_dir(bid), "meta.json"), {})
    path = localize(meta.get("pdf"))
    if path and not os.path.exists(path):
        ensure_local(path)              # not cached yet (or a symlink into the old flat library): pull it
    if not path or not os.path.exists(path):
        return None
    doc = fitz.open(path)
    with _docs_lock:
        # Cheap LRU. Chess PDFs are large and a handful open at once is plenty
        # for one reader; letting this grow unbounded would exhaust memory on a
        # box that is also running the GPU pipeline.
        while len(_docs) >= MAX_OPEN_DOCS:
            oldest = min(_docs, key=lambda k: _docs[k][1])
            try:
                _docs.pop(oldest)[0].close()
            except Exception:
                pass
        _docs[bid] = (doc, time.time())
    return doc


def text_index(bid: str) -> list:
    """Every page's text, built once and cached gzipped beside the book.

    Extraction runs at ~3.8ms a page — 3.2s for an 854-page book — and the
    index gzips to 0.29 MB. That is worth paying once so a search is a string
    scan instead of re-reading the PDF, and it is nothing beside the 163 MB of
    page images this book used to leave behind.
    """
    path = os.path.join(book_dir(bid), "text.json.gz")
    if os.path.exists(path):
        try:
            with gzip.open(path, "rt", encoding="utf8") as fh:
                return json.load(fh)
        except Exception:
            pass                      # a truncated index rebuilds rather than throws
    doc = _open_doc(bid)
    if doc is None:
        return []
    pages = [doc[i].get_text("text") for i in range(len(doc))]
    try:
        with gzip.open(path, "wt", encoding="utf8") as fh:
            json.dump(pages, fh)
    except Exception:
        pass                          # searchable even if it cannot be cached
    return pages


def contents(bid: str) -> list:
    """The book's own table of contents, when the PDF carries one."""
    doc = _open_doc(bid)
    if doc is None:
        return []
    out = []
    for entry in (doc.get_toc() or []):
        try:
            level, title, page = entry[0], entry[1], entry[2]
        except Exception:
            continue
        # get_toc numbers pages from 1; everything else here is 0-based.
        out.append({"level": int(level), "title": str(title).strip(),
                    "page": max(0, int(page) - 1)})
    return out


def search_book(bid: str, q: str, limit: int = 200) -> list:
    needle = q.strip().lower()
    if len(needle) < 2:
        return []
    hits = []
    for i, text in enumerate(text_index(bid)):
        low = text.lower()
        start = low.find(needle)
        while start >= 0 and len(hits) < limit:
            # A snippet with the match in the middle, so a result is readable
            # without opening the page.
            a, b = max(0, start - 60), min(len(text), start + len(needle) + 60)
            hits.append({"page": i,
                         "snippet": " ".join(text[a:b].split()),
                         "at": start - a})
            start = low.find(needle, start + len(needle))
        if len(hits) >= limit:
            break
    return hits


def page_sizes(bid: str):
    """[[w, h], ...] for every page, in the pixel space of render_page (150 dpi)."""
    import fitz
    doc = _open_doc(bid)
    if doc is None:
        raise FileNotFoundError(bid)
    mat = fitz.Matrix(150 / 72, 150 / 72)
    out = []
    for i in range(len(doc)):
        ir = (doc[i].rect * mat).irect
        out.append([ir.width, ir.height])
    return out


def render_page(bid: str, n: int):
    """One page as JPEG bytes, from the cached file if ingest left one, else
    straight from the PDF."""
    cached = os.path.join(book_dir(bid), "pages", "p%04d.jpg" % n)
    if os.path.exists(cached):
        with open(cached, "rb") as fh:
            return fh.read()
    import fitz
    doc = _open_doc(bid)
    if doc is None or n < 0 or n >= len(doc):
        return None
    mat = fitz.Matrix(150 / 72, 150 / 72)      # the DPI the positions were found at
    return doc[n].get_pixmap(matrix=mat).tobytes("jpeg", jpg_quality=82)


def free_gb() -> float:
    try:
        return shutil.disk_usage(STORE).free / (1024 ** 3)
    except Exception:
        return 999.0


os.makedirs(STORE, exist_ok=True)
_lock = threading.Lock()


def slug(path: str) -> str:
    base = os.path.splitext(os.path.basename(path))[0]
    s = re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-").lower()
    return (s[:60] or "book")


def scan_catalogue() -> list:
    """Every PDF in the owner's chess folder. Cached — walking 5,000 files over
    a Drive mount is slow, and the shelf must not wait on it."""
    out = []
    for dirpath, _dirs, files in os.walk(ROOT):
        if "Untitled folder" in dirpath:      # the owner's invoices, not books
            continue
        # Duplicates moved out for review still sit inside the chess folder,
        # so without this the next scan would put every one of them straight
        # back on the shelf.
        if "_duplicates" in dirpath or "_chessguru-backup" in dirpath:
            continue
        for fn in files:
            if not fn.lower().endswith(".pdf"):
                continue
            full = os.path.join(dirpath, fn)
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            out.append({
                "id": slug(full),
                "title": os.path.splitext(fn)[0],
                "folder": os.path.relpath(dirpath, ROOT),
                "path": full,
                "mb": round(size / 1e6, 1),
            })
    out.sort(key=lambda b: (b["folder"], b["title"]))
    return out


def load(path, default):
    try:
        with open(path, encoding="utf8") as f:
            return json.load(f)
    except Exception:
        return default


def save(path, data):
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def book_dir(bid: str) -> str:
    return os.path.join(STORE, re.sub(r"[^A-Za-z0-9._-]", "", bid))


def worker():
    """One book at a time, forever."""
    while True:
        try:
            with _lock:
                q = load(QUEUE, [])
                nxt = next((x for x in q if x.get("state") == "queued"), None)
                if nxt:
                    nxt["state"] = "working"
                    nxt["startedAt"] = time.time()
                    save(QUEUE, q)
            if not nxt:
                time.sleep(5)
                continue
            if free_gb() < MIN_FREE_GB:
                # Put it back and wait. Better a queue that stalls visibly than
                # a disk that fills silently and corrupts what is already there.
                with _lock:
                    q = load(QUEUE, [])
                    for x in q:
                        if x["id"] == nxt["id"] and x.get("state") == "working":
                            x["state"] = "queued"
                            x["error"] = "paused: only %.0f GB free" % free_gb()
                    save(QUEUE, q)
                time.sleep(300)
                continue
            rc = subprocess.run(
                [os.path.join(os.path.dirname(__file__), "..", "ocr-gpu", "Scripts", "python.exe")
                 if False else r"E:\ocr-gpu\Scripts\python.exe",
                 r"E:\dreamocr\ingest_book.py", nxt["path"], nxt["id"], nxt["title"]],
                capture_output=True, text=True, timeout=7200)
            with _lock:
                q = load(QUEUE, [])
                for x in q:
                    if x["id"] == nxt["id"]:
                        x["state"] = "done" if rc.returncode == 0 else "error"
                        x["finishedAt"] = time.time()
                        if rc.returncode != 0:
                            x["error"] = (rc.stderr or "")[-400:]
                save(QUEUE, q)
        except Exception as e:                       # never let the worker die
            with _lock:
                q = load(QUEUE, [])
                for x in q:
                    if x.get("state") == "working":
                        x["state"] = "error"
                        x["error"] = str(e)[:400]
                save(QUEUE, q)
            time.sleep(5)


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):                      # quiet
        pass

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/health":
            return self._send(200, {"ok": True, "service": "bookhost"})
        if p == "/catalogue":
            cat = load(CATALOGUE, None)
            if cat is None:
                cat = scan_catalogue()
                save(CATALOGUE, cat)
            books = shelved(cat)
            shelves = {}
            for b in books:
                shelves[b["shelf"]] = shelves.get(b["shelf"], 0) + 1
            return self._send(200, {"books": books, "shelves": shelves,
                                    "files": len(cat), "titles": len(books)})
        if p == "/catalogue/refresh":
            cat = scan_catalogue()
            save(CATALOGUE, cat)
            return self._send(200, {"books": len(cat)})
        if p == "/queue":
            return self._send(200, {"queue": load(QUEUE, []),
                                    "freeGb": round(free_gb(), 1)})
        if p == "/books":
            out = []
            for d in sorted(os.listdir(STORE)):
                full = os.path.join(STORE, d)
                if not os.path.isdir(full):
                    continue
                meta = load(os.path.join(full, "meta.json"), {})
                st = load(os.path.join(full, "status.json"), {})
                out.append({"id": d, "title": meta.get("title", d),
                            "owner": meta.get("owner"),
                            "coverPage": meta.get("coverPage", 0),
                            "pages": st.get("pages", 0), "done": st.get("done", 0),
                            "diagrams": st.get("diagrams", 0), "state": st.get("state", "unknown")})
            return self._send(200, {"books": out})
        m = re.match(r"^/book/([^/]+)/analysis$", p)
        if m:
            return self._send(200, load(os.path.join(book_dir(unquote(m.group(1))),
                                                     "analysis.json"), {}))

        m = re.match(r"^/book/([^/]+)/(diagrams|status|meta)$", p)
        if m:
            return self._send(200, load(os.path.join(book_dir(unquote(m.group(1))),
                                                     m.group(2) + ".json"), {}))
        m = re.match(r"^/book/([^/]+)/toc$", p)
        if m:
            try:
                return self._send(200, {"toc": contents(unquote(m.group(1)))})
            except Exception:
                return self._send(200, {"toc": []})
        m = re.match(r"^/book/([^/]+)/search$", p)
        if m:
            qs = parse_qs(urlparse(self.path).query)
            q = (qs.get("q") or [""])[0]
            try:
                return self._send(200, {"hits": search_book(unquote(m.group(1)), q)})
            except Exception:
                return self._send(200, {"hits": []})

        # Pixel size of every page AS render_page would produce it, without rendering:
        # (page.rect * matrix).irect is exactly the pixmap's bbox (checked on 48 pages of
        # two books, 0 mismatches). The reader draws diagram hotspots in this pixel space,
        # and since pages are served as sized variants it can no longer read the space
        # off the image it received (owner 2026-09-20: hotspots off on phones).
        m = re.match(r"^/book/([^/]+)/pagesizes$", p)
        if m:
            try:
                return self._send(200, {"sizes": page_sizes(unquote(m.group(1)))})
            except Exception:
                return self._send(404, {"ok": False})

        m = re.match(r"^/book/([^/]+)/page/(\d+)$", p)
        if m:
            try:
                data = render_page(unquote(m.group(1)), int(m.group(2)))
            except Exception:
                data = None
            if data is None:
                return self._send(404, {"ok": False})
            return self._send(200, data, "image/jpeg")
        self._send(404, {"ok": False})

    def do_POST(self):
        p = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)

        if p == "/library/upload":
            # A coach's own PDF. Saved into the owner's Chess folder so Drive
            # backs it up with the rest, then queued like any other book.
            qs = parse_qs(urlparse(self.path).query)
            title = (qs.get("title") or [""])[0].strip() or "Untitled"
            if n <= 0 or n > 400 * 1024 * 1024:
                return self._send(400, {"ok": False, "error": "bad size"})
            data = self.rfile.read(n)
            if not data.startswith(b"%PDF"):
                # Refuse anything that is not a PDF before it reaches the
                # pipeline — a mislabelled file would just fail 15 minutes later.
                return self._send(400, {"ok": False, "error": "not a PDF"})
            safe = re.sub(r"[^A-Za-z0-9 ._-]+", " ", title)[:120].strip() or "Untitled"
            os.makedirs(UPLOADS, exist_ok=True)
            dest = os.path.join(UPLOADS, safe + ".pdf")
            i = 2
            while os.path.exists(dest):
                dest = os.path.join(UPLOADS, "%s (%d).pdf" % (safe, i)); i += 1
            with open(dest, "wb") as fh:
                fh.write(data)
            bid = slug(dest)
            with _lock:
                q = load(QUEUE, [])
                if not any(x["id"] == bid and x.get("state") in ("queued", "working") for x in q):
                    q.append({"id": bid, "title": title, "path": dest,
                              "state": "queued", "queuedAt": time.time()})
                    save(QUEUE, q)
                # Keep the catalogue in step so the uploaded book shows up in
                # the library immediately rather than after the next refresh.
                cat = load(CATALOGUE, None)
                if cat is not None:
                    cat.append({"id": bid, "title": title,
                                "folder": os.path.relpath(UPLOADS, ROOT),
                                "path": dest, "mb": round(len(data) / 1e6, 1)})
                    save(CATALOGUE, cat)
            return self._send(200, {"ok": True, "id": bid, "title": title,
                                    "mb": round(len(data) / 1e6, 1), "queued": True})

        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}
        if p == "/library/match":
            hit = find_existing(body.get("title") or "", float(body.get("mb") or 0))
            return self._send(200, {"match": hit})

        m = re.match(r"^/book/([^/]+)/analysis/([^/]+)$", p)
        if m:
            # Lines a coach worked out on a position, kept BESIDE the book so
            # they survive a browser, a device and a re-ingest. Keyed by the
            # diagram's stable page+centre key, not its index, because a
            # de-duplication pass renumbers diagrams and index-keyed notes end
            # up attached to the wrong board.
            bid, key = unquote(m.group(1)), unquote(m.group(2))
            d = book_dir(bid)
            path = os.path.join(d, "analysis.json")
            with _lock:
                cur = load(path, {})
                tree = body.get("tree")
                if not tree:
                    cur.pop(key, None)          # empty tree = clear the note
                else:
                    cur[key] = {"tree": tree,
                                "startFen": body.get("startFen") or "",
                                "by": body.get("by"),
                                "at": time.time()}
                save(path, cur)
            return self._send(200, {"ok": True, "key": key, "saved": bool(body.get("tree"))})

        m = re.match(r"^/book/([^/]+)/cover$", p)
        if m:
            # Which page to show on the shelf. Page 0 is usually the cover, but
            # not always — one scan opens on a nearly blank half-title, another
            # on a two-page spread — so the owner gets to choose.
            bid = unquote(m.group(1))
            d = book_dir(bid)
            meta = load(os.path.join(d, "meta.json"), {})
            try:
                page = int(body.get("page"))
            except (TypeError, ValueError):
                return self._send(400, {"ok": False, "error": "page must be a number"})
            if page < 0 or page > 9999:
                return self._send(400, {"ok": False, "error": "page out of range"})
            meta["coverPage"] = page
            with _lock:
                save(os.path.join(d, "meta.json"), meta)
            return self._send(200, {"ok": True, "coverPage": page})

        m = re.match(r"^/book/([^/]+)/diagram/(\d+)$", p)
        if m:
            bid, idx = unquote(m.group(1)), int(m.group(2)) - 1
            d = book_dir(bid)
            dg = load(os.path.join(d, "diagrams.json"), [])
            if not (0 <= idx < len(dg)):
                return self._send(404, {"ok": False, "error": "diagram not found"})
            action = body.get("action") or "correct"
            fen = (body.get("fen") or "").strip()
            before = dg[idx]
            was = before.get("fen", "")
            if action == "reject":
                dg.pop(idx)
            else:
                before = dict(before)
                before["fen"] = fen
                before["conf"] = 1
                before["corrected"] = (action == "correct")
                dg[idx] = before
            with _lock:
                save(os.path.join(d, "diagrams.json"), dg)
                # Keep the ORIGINAL beside the fix: a wrong read paired with a
                # human correction is the example worth training on.
                with io.open(os.path.join(d, "corrections.jsonl"), "a",
                             encoding="utf8") as fh:
                    fh.write(json.dumps({
                        "action": action, "n": idx + 1,
                        "page": (dg[idx] if action != "reject" and idx < len(dg)
                                 else {}).get("page"),
                        "was": was, "now": None if action == "reject" else fen,
                        "by": body.get("by"), "at": time.time()}) + "\n")
            return self._send(200, {"ok": True, "action": action,
                                    "n": idx + 1, "was": was,
                                    "now": None if action == "reject" else fen})

        if p == "/queue":
            want = body.get("ids") or []
            cat = load(CATALOGUE, None) or scan_catalogue()
            bypath = {b["id"]: b for b in cat}
            with _lock:
                q = load(QUEUE, [])
                have = {x["id"] for x in q if x.get("state") in ("queued", "working")}
                added = 0
                for bid in want:
                    b = bypath.get(bid)
                    if not b or bid in have:
                        continue
                    q.append({"id": bid,
                              # The cleaned name, so the queue reads like the
                              # shelf does — not "Emailing pdfcoffee.com_...".
                              "title": organise.organise(b)["title"],
                              "path": b["path"],
                              "state": "queued", "queuedAt": time.time()})
                    added += 1
                save(QUEUE, q)
            # Return the QUEUE ITSELF, the same shape GET /queue gives. This
            # used to return a count under the same key, so a caller that
            # rendered the response got a number where it expected a list and
            # simply showed nothing.
            return self._send(200, {"ok": True, "added": added, "queue": q})
        self._send(404, {"ok": False})


if __name__ == "__main__":
    # A restart kills the child process mid-book, leaving its queue entry stuck
    # on "working" — and the worker only ever picks up "queued", so the whole
    # queue would stall behind it.
    _q = load(QUEUE, [])
    _requeued = 0
    for _x in _q:
        if _x.get("state") == "working":
            _x["state"] = "queued"
            _requeued += 1
    if _requeued:
        save(QUEUE, _q)
        print("requeued %d book(s) interrupted by a restart" % _requeued, flush=True)
    # Each worker picks its next book under the same lock, and the pick marks it
    # "working" before the lock is released, so two workers can never take the
    # same book.
    # France: ingest (GPU diagram extraction) stays on Vinayaka; BOOKHOST_WORKERS=0 serves only.
    for _i in range(max(0, WORKERS)):
        threading.Thread(target=worker, daemon=True).start()
    print("started %d ingest worker(s)" % max(0, WORKERS), flush=True)
    print("bookhost on 127.0.0.1:%d, store %s" % (PORT, STORE), flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
