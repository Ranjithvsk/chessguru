#!/usr/bin/env python
"""Regression harness for the scan pipeline: accuracy AND latency, together.

Run this before and after ANY change to service.py or to what the client uploads.
Speed work on this pipeline has broken accuracy before (2026-09-17: shrinking the
upload to 1600px JPEG q85 cost ~4 points of square accuracy, because the extractor
detects at imgsz=640 but CROPS FROM THE FULL-RESOLUTION IMAGE -- that crop is what
the classifier actually reads).

It drives the LIVE service on :5100, so it measures the real pipeline end to end --
extractor, rotation autopick, chess-rules validation -- not a reimplementation of it.

    python accuracy_check.py                 # all labelled boards
    python accuracy_check.py 10              # first 10, for a quick loop
    python accuracy_check.py 10 before.json  # ...and save, to diff against later
    python accuracy_check.py --diff a.json b.json

A change is good if square accuracy does not drop and p50 latency does.
"""
import base64, glob, json, os, statistics, sys, time, urllib.request

ROOT = "/opt/chessguru-vision/tandberg/data/test"
# The live service by default; CHECK_URL points the same harness at a candidate
# model served on a scratch port, so a new model can be measured without the
# live one being given it first.
URL = os.environ.get("CHECK_URL", "http://127.0.0.1:5100/classify")


def expand(board_fen):
    """FEN board field -> 64 chars, a8..h1, '.' for empty."""
    out = []
    for rank in board_fen.strip().split("/"):
        row = []
        for ch in rank:
            row += ["."] * int(ch) if ch.isdigit() else [ch]
        out += (row + ["."] * 8)[:8]
    return (out + ["."] * 64)[:64]


def classify(path):
    b64 = base64.b64encode(open(path, "rb").read()).decode()
    req = urllib.request.Request(
        URL, data=json.dumps({"image_base64": b64}).encode(),
        headers={"Content-Type": "application/json"})
    t = time.time()
    try:
        j = json.loads(urllib.request.urlopen(req, timeout=300).read())
        return (j.get("fen") or "").split(" ")[0], (time.time() - t) * 1000
    except Exception:
        return None, (time.time() - t) * 1000


def run(limit=None):
    files = sorted(glob.glob(f"{ROOT}/*/raw/*.JPG"))[:limit]
    right = total = exact = failed = 0
    lost = ghost = 0
    lat, per_board = [], []
    for f in files:
        gtp = f.replace("/raw/", "/ground_truth/").rsplit(".", 1)[0] + ".txt"
        if not os.path.exists(gtp):
            continue
        gt = expand(open(gtp).read())
        fen, ms = classify(f)
        lat.append(ms)
        if not fen:
            failed += 1; total += 64
            per_board.append({"file": os.path.basename(f), "acc": 0.0, "ms": ms})
            continue
        got = expand(fen)
        r = sum(1 for a, b in zip(gt, got) if a == b)
        lost += sum(1 for a, b in zip(gt, got) if a != "." and b == ".")
        ghost += sum(1 for a, b in zip(gt, got) if a == "." and b != ".")
        right += r; total += 64; exact += (r == 64)
        per_board.append({"file": os.path.basename(f), "acc": 100.0 * r / 64, "ms": ms, "fen": fen})
    lat.sort()
    return {
        "boards": len(per_board),
        "square_accuracy": round(100.0 * right / total, 2) if total else 0,
        "exact_boards": exact,
        "failed": failed,
        "pieces_read_as_empty": lost,
        "empties_read_as_piece": ghost,
        "p50_ms": round(statistics.median(lat)) if lat else 0,
        "p90_ms": round(lat[int(len(lat) * 0.9)]) if lat else 0,
        "per_board": per_board,
    }


def show(r, label=""):
    print(f"    {label}{r['boards']} boards")
    print(f"      square accuracy      {r['square_accuracy']:.2f}%")
    print(f"      exact boards         {r['exact_boards']}/{r['boards']}")
    print(f"      pieces read as empty {r['pieces_read_as_empty']}")
    print(f"      empties read as piece {r['empties_read_as_piece']}")
    print(f"      failed outright      {r['failed']}")
    print(f"      latency p50 / p90    {r['p50_ms']} / {r['p90_ms']} ms")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--diff":
        a, b = (json.load(open(p)) for p in sys.argv[2:4])
        show(a, "BEFORE  "); print(); show(b, "AFTER   "); print()
        da = b["square_accuracy"] - a["square_accuracy"]
        dl = b["p50_ms"] - a["p50_ms"]
        print(f"      accuracy {da:+.2f} points, p50 latency {dl:+d} ms")
        print("      VERDICT:", "ship it" if da >= -0.2 and dl < 0 else
              "NO -- accuracy regressed" if da < -0.2 else "no speed gain")
        sys.exit(0)
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    out = sys.argv[2] if len(sys.argv) > 2 else None
    res = run(limit)
    show(res)
    if out:
        json.dump(res, open(out, "w"), indent=1)
        print(f"      saved -> {out}")
