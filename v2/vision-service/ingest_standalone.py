"""Ingest a book into the reader WITHOUT restarting the vision service.

The service holds an older book_ingest in memory and restarting it during class
hours would interrupt a live scan, so this talks to the service over HTTP like
any other client and writes the same files the reader expects.

Also does what the in-service version could not: splits each spread at the
gutter, which found diagrams on pages the whole frame missed, and maps the
half-page boxes back into PAGE coordinates so the reader's hotspots land right.
"""
import base64, json, os, shutil, subprocess, sys, time
import cv2

SRC = sys.argv[1] if len(sys.argv) > 1 else "/opt/chessguru-vision/books/pandolfini-pages"
BOOK_ID = sys.argv[2] if len(sys.argv) > 2 else "pandolfini-deep-blue"
TITLE = sys.argv[3] if len(sys.argv) > 3 else "Kasparov and Deep Blue (Pandolfini)"
STORE = "/var/lib/chessguru/user-books"
S = "/tmp/claude-1001/-home-dreamworld/ea849402-689f-4cad-afcf-f082be9a7d8a/scratchpad"

sys.path.insert(0, "/opt/chessguru-vision")
import dream_ocr as d

dest = os.path.join(STORE, BOOK_ID)
os.makedirs(os.path.join(dest, "pages"), exist_ok=True)


def _hand_to_api_user() -> None:
    """The API writes corrections back into this directory and runs as `ubuntu`.
    Ingesting as anyone else leaves a book the reader can OPEN but never SAVE to
    — the coach sees "Save failed" with no clue why, and the real error is an
    EACCES buried in the API log. Hand ownership over at the end of every run."""
    import subprocess
    subprocess.run(["sudo", "-n", "chown", "-R", "ubuntu:ubuntu", dest],
                   capture_output=True)


def post(payload, tag):
    f = f"{S}/_ing_{tag}.json"
    open(f, "w").write(json.dumps(payload))
    o = subprocess.run(["curl", "-s", "-m", "180", "-X", "POST",
        "http://127.0.0.1:5100/classify", "-H", "Content-Type: application/json",
        "--data-binary", f"@{f}"], capture_output=True, text=True).stdout
    try:
        return json.loads(o)
    except Exception:
        return {}


def status(**kw):
    p = os.path.join(dest, "status.json")
    cur = {}
    if os.path.exists(p):
        try:
            cur = json.load(open(p))
        except Exception:
            cur = {}
    cur.update(kw)
    json.dump(cur, open(p, "w"))


pages = sorted(f for f in os.listdir(SRC) if f.lower().endswith((".jpg", ".png")))
json.dump({"title": TITLE, "owner": None}, open(os.path.join(dest, "meta.json"), "w"))
status(state="reading", pages=len(pages), done=0, diagrams=0)
print("ingesting %d pages -> %s" % (len(pages), dest), flush=True)

diagrams, moves, texts = [], [], []
t0 = time.time()
engines = {e.name: e for e in d.available_engines()}
use = [n for n in ("tesseract",) if n in engines]   # light: this box serves live users

for i, fn in enumerate(pages):
    src = os.path.join(SRC, fn)
    out = os.path.join(dest, "pages", "p%04d.jpg" % i)
    if not os.path.exists(out):
        shutil.copyfile(src, out)
    img = cv2.imread(out)
    if img is None:
        status(done=i + 1)
        continue
    h, w = img.shape[:2]
    page_fens = []
    # (view image, x-offset) so a half-page box maps back to the page
    views = [(img, 0)]
    if w >= h * 1.25:
        views += [(img[:, : w // 2], 0), (img[:, w // 2:], w // 2)]
    # The SAME diagram is found in more than one view, and the readings differ.
    # Measured on Pandolfini diagram 10: from the whole spread the classifier
    # returned a position with three phantom pieces and a queen of the wrong
    # colour; from the half page — where the board is twice the size — it
    # returned exactly what the coach later corrected it to, by hand, square for
    # square. Same model, same page, different resolution.
    #
    # So candidates are collected first and de-duplicated by POSITION, keeping
    # the one whose board is largest in pixels. De-duplicating by FEN (what this
    # did before) treats two readings of one diagram as two diagrams and keeps
    # whichever arrived first, which is the whole-spread one.
    found = []          # (page-space box, fen, conf, area)
    for view, dx in views:
        ok, buf = cv2.imencode(".jpg", view, [cv2.IMWRITE_JPEG_QUALITY, 92])
        r = post({"image_base64": base64.b64encode(buf).decode()}, "v")
        for c in r.get("candidates", []):
            cb = c.get("boardPngBase64")
            if not cb:
                continue
            rr = post({"image_base64": cb, "warped_board_base64": cb}, "c")
            fen = (rr.get("fen") or "").split(" ")[0]
            if not (fen.count("K") == 1 and fen.count("k") == 1):
                continue
            if any(x["page"] == i and x["fen"] == fen for x in diagrams):
                continue
            box = c.get("box") or []
            bbox = [round(box[0] + dx), round(box[1]),
                    round(box[2] + dx), round(box[3])] if len(box) >= 4 else None
            area = ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) if bbox else 0
            found.append((bbox, fen, (rr.get("meta") or {}).get("avgConfidence"), area))

    def overlaps(a, b) -> bool:
        """Same physical diagram? Generous, because the two views crop it
        slightly differently — centres within half a board width is plenty."""
        if not a or not b:
            return False
        acx, acy = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
        bcx, bcy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        tol = max(40, min(a[2] - a[0], b[2] - b[0]) * 0.5)
        return abs(acx - bcx) < tol and abs(acy - bcy) < tol

    # Biggest board first, then keep a candidate only if it is not the same
    # diagram as one already kept.
    kept: list = []
    for bbox, fen, conf, area in sorted(found, key=lambda t: -t[3]):
        if any(overlaps(bbox, k[0]) for k in kept):
            continue
        kept.append((bbox, fen, conf, area))
    for bbox, fen, conf, _area in kept:
        page_fens.append(fen)
        diagrams.append({"page": i, "bbox": bbox, "fen": fen, "conf": conf})
    if use:
        try:
            per = {n: engines[n].run(img) for n in use}
            toks = d.consensus(per, {n: engines[n].weight for n in per})
            toks, _ = d.strip_board_labels(toks)
            toks, _ = d.rejoin_hyphens(toks)
            toks, chosen, nver = d.choose_start(toks, page_fens)
            texts.append({"page": i, "text": " ".join(t.text for t in toks),
                          "verified": nver})
            for t in toks:
                if t.kind == "move" and t.verified:
                    moves.append({"page": i, "san": t.text,
                                  "printed": t.original or t.text})
            d.export_training_pairs(img, toks, os.path.join(dest, "proven-labels"),
                                    source="%s_p%04d" % (BOOK_ID, i))
        except Exception as e:
            print("  page %d text failed: %s" % (i, str(e)[:80]), flush=True)
    status(done=i + 1, diagrams=len(diagrams), moves=len(moves))
    if i % 10 == 0 or i == len(pages) - 1:
        print("  page %3d/%d  %d diagrams  %d proved moves" % (
            i + 1, len(pages), len(diagrams), len(moves)), flush=True)

json.dump(diagrams, open(os.path.join(dest, "diagrams.json"), "w"))
json.dump(texts, open(os.path.join(dest, "text.json"), "w"))
json.dump(moves, open(os.path.join(dest, "moves.json"), "w"))
status(state="done", diagrams=len(diagrams), moves=len(moves),
       seconds=round(time.time() - t0, 1))
print("\nDONE: %d pages, %d diagrams, %d proved moves, %.0fs" % (
    len(pages), len(diagrams), len(moves), time.time() - t0), flush=True)
_hand_to_api_user()
print("reader: /books/read/%s" % BOOK_ID, flush=True)
