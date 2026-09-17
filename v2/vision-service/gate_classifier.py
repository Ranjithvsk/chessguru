#!/usr/bin/env python
"""Decide whether a freshly trained classifier is allowed to go live.

The nightly retrain used to promote whatever `best.pt` came back from Vinayaka,
checking only that the file copied. "Best" there means best on its own synthetic
validation split, which is not the same thing as better on real work — and
between 10 and 16 September 2026 that shipped a model a night until square
accuracy on photographs had fallen 94.37% -> 93.09% and, far worse, printed book
diagrams that used to read as legal positions 95% of the time read at 33%.
Diagrams that fail to read are dropped silently from a book, so this was invisible
until an academy reported boards they could not click.

So the candidate is measured on BOTH kinds of work before it is allowed in:

  photographs    square accuracy over the labelled Tandberg test set
  book diagrams  how many printed diagrams read as a LEGAL position

The second is the one that matters here: the photo score moved barely a point
while the book score collapsed. A gate that only looked at photographs would have
waved every one of those models through.

The candidate is served on a scratch port, so the live service is never given a
model that has not passed.

    gate_classifier.py /tmp/cls-nightly-best.pt        # exit 0 = promote

Exit 0 promote, 1 reject, 2 could not measure (also do not promote).
"""
import json, os, subprocess, sys, time, urllib.request, base64, glob

LIVE = "http://127.0.0.1:5100"
SCRATCH_PORT = 5102
SCRATCH = f"http://127.0.0.1:{SCRATCH_PORT}"
ROOT = "/opt/chessguru-vision"
VENV = f"{ROOT}/.venv/bin"
# A model may lose this much to noise and still be promoted; anything more is
# treated as a regression.
PHOTO_TOLERANCE = 0.30      # percentage points of square accuracy
BOOK_TOLERANCE  = 2.0       # percentage points of diagrams reading legally

BOOK_PAGES = (
    [f"/var/lib/chessguru/user-books/testbook1/pages/p{p:04d}.jpg" for p in range(0, 12)] +
    [f"/var/lib/chessguru/user-books/endgame-manual-dvoretsky-mark/pages/p{p:04d}.jpg"
     for p in range(19, 31)]
)

def log(m): print(m, flush=True)

def wait_healthy(base, timeout=300):
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(base + "/health", timeout=5).read()
            return True
        except Exception:
            time.sleep(5)
    return False

def photo_accuracy(base):
    env = dict(os.environ, CHECK_URL=base + "/classify")
    r = subprocess.run([f"{VENV}/python", f"{ROOT}/accuracy_check.py"],
                       capture_output=True, text=True, env=env, timeout=3600)
    for line in r.stdout.splitlines():
        if "square accuracy" in line:
            return float(line.split()[-1].rstrip("%"))
    log(r.stdout[-400:] or r.stderr[-400:])
    return None

def book_legal_pct(base):
    """Share of detected printed diagrams that read as a legal position."""
    import cv2
    from ultralytics import YOLO
    m = YOLO(f"{ROOT}/mit-weights/chessguru-board-seg.pt")
    boards = ok = 0
    for path in BOOK_PAGES:
        img = cv2.imread(path)
        if img is None:
            continue
        res = m.predict(img, imgsz=640, conf=0.75, verbose=False)[0]
        if res.boxes is None:
            continue
        for i in range(len(res.boxes)):
            x1, y1, x2, y2 = [int(v) for v in res.boxes.xyxy[i]]
            crop = img[max(0, y1):y2, max(0, x1):x2]
            b64 = base64.b64encode(cv2.imencode(".png", crop)[1].tobytes()).decode()
            req = urllib.request.Request(base + "/classify",
                data=json.dumps({"image_base64": b64, "warped_board_base64": b64}).encode(),
                headers={"content-type": "application/json"})
            boards += 1
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    fen = json.load(r).get("fen", "")
            except Exception:
                continue
            parts = fen.split()
            b = parts[0] if parts else ""
            if b.count("K") == 1 and b.count("k") == 1:
                ok += 1
    return (100.0 * ok / boards) if boards else None, boards

def main():
    if len(sys.argv) < 2:
        log("usage: gate_classifier.py <candidate.pt>"); return 2
    cand = sys.argv[1]
    if not os.path.exists(cand):
        log(f"candidate not found: {cand}"); return 2

    # Serve the candidate on a scratch port; the live service is untouched.
    cand_pt = f"{ROOT}/mit-weights/chessguru-cls-candidate.pt"
    subprocess.run(["sudo", "cp", cand, cand_pt], check=True)
    svc = f"{ROOT}/service_candidate.py"
    src = open(f"{ROOT}/service.py").read().replace(
        '_MIT_CLASSIFIER = "/opt/chessguru-vision/mit-weights/chessguru-cls.pt"',
        f'_MIT_CLASSIFIER = "{cand_pt}"')
    subprocess.run(["sudo", "tee", svc], input=src, capture_output=True, text=True, check=True)

    proc = subprocess.Popen(
        ["sudo", "-u", "ubuntu", f"{VENV}/uvicorn", "service_candidate:app",
         "--host", "127.0.0.1", "--port", str(SCRATCH_PORT)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        if not wait_healthy(SCRATCH):
            log("candidate service never became healthy — NOT promoting"); return 2

        log("measuring the candidate and the model in use, on the same work")
        c_photo = photo_accuracy(SCRATCH)
        l_photo = photo_accuracy(LIVE)
        c_book, n1 = book_legal_pct(SCRATCH)
        l_book, n2 = book_legal_pct(LIVE)
        if None in (c_photo, l_photo, c_book, l_book):
            log("could not measure both models — NOT promoting"); return 2

        log(f"  photographs   in use {l_photo:5.2f}%   candidate {c_photo:5.2f}%")
        log(f"  book diagrams in use {l_book:5.1f}%   candidate {c_book:5.1f}%   ({n1} boards)")

        verdict = []
        if c_photo < l_photo - PHOTO_TOLERANCE:
            verdict.append(f"photo accuracy drops {l_photo - c_photo:.2f} points")
        if c_book < l_book - BOOK_TOLERANCE:
            verdict.append(f"book diagrams drop {l_book - c_book:.1f} points")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        record = {"at": stamp, "candidate": cand,
                  "photo": {"live": l_photo, "candidate": c_photo},
                  "book": {"live": l_book, "candidate": c_book, "boards": n1},
                  "promoted": not verdict, "why": verdict}
        with open(f"{ROOT}/classifier-gate-history.jsonl", "a") as f:
            f.write(json.dumps(record) + "\n")
        if verdict:
            log("REJECTED: " + "; ".join(verdict))
            return 1
        log("PASSED — safe to promote")
        return 0
    finally:
        proc.terminate()
        try: proc.wait(timeout=30)
        except Exception: proc.kill()

if __name__ == "__main__":
    sys.exit(main())
