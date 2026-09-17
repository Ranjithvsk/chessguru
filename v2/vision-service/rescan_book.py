#!/usr/bin/env python
"""Re-classify an already-ingested book's diagrams in place.

Cheaper than a full re-ingest (minutes vs ~30) because the page renders and the
board boxes are already on disk — only the classification is redone, through the
CURRENT pipeline. Written for the Mammoth book, whose diagrams print the a-h/1-8
coordinates INSIDE the board frame: the crop kept the label strip, the 8x8 split
landed between squares and every piece shifted a file (mean minConf 0.069, 294 of
294 diagrams flagged). Fixed in service._classify; this repairs what was stored.

    python rescan_book.py <book-id> [--dry-run]

Backs up diagrams.json before writing. Keeps a diagram's existing reading when the
re-run is LESS confident, so a rescan can never make a book worse.
"""
import base64, json, os, sys, time, urllib.request
import cv2

STORE = "/var/lib/chessguru/user-books"
URL = "http://127.0.0.1:5100/classify"


def enc(img):
    ok, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf).decode()


def classify(crop):
    grey = cv2.cvtColor(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    b64 = enc(grey)
    req = urllib.request.Request(
        URL, data=json.dumps({"image_base64": b64, "warped_board_base64": b64}).encode(),
        headers={"Content-Type": "application/json"})
    j = json.loads(urllib.request.urlopen(req, timeout=240).read())
    sq = [c.get("confidence", 1.0) for row in (j.get("squares") or []) for c in row]
    return {
        "fen": (j.get("fen") or "").split(" ")[0],
        "conf": (j.get("meta") or {}).get("avgConfidence"),
        "minConf": round(float(min(sq)), 4) if sq else None,
        "squaresBelow": int(sum(1 for c in sq if c < 0.70)) if sq else None,
    }


def main(book_id, dry=False):
    d = os.path.join(STORE, book_id)
    dj = os.path.join(d, "diagrams.json")
    dia = json.load(open(dj))
    t0, better, worse, same, page, img = time.time(), 0, 0, 0, None, None
    for i, x in enumerate(dia):
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
        try:
            r = classify(crop)
        except Exception:
            continue
        old = x.get("minConf")
        # Never regress: keep the stored reading if the re-run is less sure.
        if old is not None and r["minConf"] is not None and r["minConf"] <= old:
            worse += 1 if r["minConf"] < old else 0
            same += 1 if r["minConf"] == old else 0
            continue
        x.update({k: v for k, v in r.items() if v is not None})
        better += 1
        if (i + 1) % 60 == 0:
            print(f"    ...{i+1}/{len(dia)}  {time.time()-t0:.0f}s", flush=True)
    print(f"\n    {book_id}: improved {better}, unchanged {same}, kept-old {worse}  ({time.time()-t0:.0f}s)")
    if dry:
        print("    (dry run, nothing written)"); return
    bak = dj + ".bak-before-rescan"
    if not os.path.exists(bak):
        json.dump(json.load(open(dj)), open(bak, "w"))
    json.dump(dia, open(dj, "w"))
    print(f"    written (backup: {os.path.basename(bak)})")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0], "--dry-run" in sys.argv)
