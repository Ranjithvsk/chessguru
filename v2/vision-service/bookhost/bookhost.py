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
import os
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = r"G:\My Drive\Chess"
STORE = r"F:\chessguru-books"          # F: has the space (888 GB free)
PORT = 8791
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
        if "_duplicates" in dirpath:
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
            return self._send(200, {"queue": load(QUEUE, [])})
        if p == "/books":
            out = []
            for d in sorted(os.listdir(STORE)):
                full = os.path.join(STORE, d)
                if not os.path.isdir(full):
                    continue
                meta = load(os.path.join(full, "meta.json"), {})
                st = load(os.path.join(full, "status.json"), {})
                out.append({"id": d, "title": meta.get("title", d),
                            "pages": st.get("pages", 0), "done": st.get("done", 0),
                            "diagrams": st.get("diagrams", 0), "state": st.get("state", "unknown")})
            return self._send(200, {"books": out})
        m = re.match(r"^/book/([^/]+)/(diagrams|status|meta)$", p)
        if m:
            return self._send(200, load(os.path.join(book_dir(unquote(m.group(1))),
                                                     m.group(2) + ".json"), {}))
        m = re.match(r"^/book/([^/]+)/page/(\d+)$", p)
        if m:
            f = os.path.join(book_dir(unquote(m.group(1))), "pages",
                             "p%04d.jpg" % int(m.group(2)))
            if not os.path.exists(f):
                return self._send(404, {"ok": False})
            with open(f, "rb") as fh:
                return self._send(200, fh.read(), "image/jpeg")
        self._send(404, {"ok": False})

    def do_POST(self):
        p = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}
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
    threading.Thread(target=worker, daemon=True).start()
    print("bookhost on 127.0.0.1:%d, store %s" % (PORT, STORE), flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
