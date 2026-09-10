"""Move duplicate copies out of the chess library into a review folder.

MOVES, never deletes. Every file keeps its original folder structure under
_duplicates, and a manifest records exactly where each one came from, so the
whole operation can be undone with the same file.

The copy that STAYS is the largest of each group: among several scans of one
book the bigger file is almost always the better scan, and a poor scan is
exactly what makes the reading pass fail.

  --apply   actually move (default is a dry run that changes nothing)
  --undo    put everything in the manifest back where it came from
"""
from __future__ import annotations

import collections
import csv
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import organise

ROOT = r"G:\My Drive\Chess"
DEST = os.path.join(ROOT, "_duplicates")
MANIFEST = r"F:\chessguru-books\duplicates-manifest.csv"


def scan() -> list:
    out = []
    for dirpath, _dirs, files in os.walk(ROOT):
        if "Untitled folder" in dirpath or "_duplicates" in dirpath:
            continue
        for fn in files:
            if not fn.lower().endswith(".pdf"):
                continue
            full = os.path.join(dirpath, fn)
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            out.append({"title": os.path.splitext(fn)[0], "path": full,
                        "folder": os.path.relpath(dirpath, ROOT),
                        "mb": round(size / 1e6, 1)})
    return out


def plan() -> list:
    books = [organise.organise(b) for b in scan()]
    groups = collections.defaultdict(list)
    for b in books:
        groups[(b["sort"], (b.get("author") or "").lower())].append(b)

    moves, skipped = [], []
    for _k, v in groups.items():
        if len(v) < 2:
            continue
        # Largest first: that one stays put.
        v.sort(key=lambda x: (-x["mb"], x["path"]))
        keep = v[0]
        for other in v[1:]:
            # A short title is weak evidence. "Chess.pdf" appears twice at
            # 3.5 MB and 44.1 MB — two DIFFERENT books that happen to share a
            # generic filename, and treating them as copies would have taken a
            # book out of the library. Require the sizes to be close before
            # trusting a one- or two-word title.
            words = len(keep["sort"].split())
            small, large = sorted((other["mb"], keep["mb"]))
            ratio = (large / small) if small > 0.01 else 999
            if words <= 3 and ratio > 1.5:
                skipped.append((keep, other, "generic title, sizes differ"))
                continue
            # A small file is a stub or a failed download ONLY when it does not
            # match its twin. Two 0.3 MB files of the same title are the same
            # file twice, and the size guard must not veto that.
            if small < 0.5 and ratio > 1.02:
                skipped.append((keep, other, "one file is tiny (likely broken)"))
                continue
            # Same size to 0.05 MB means the same file under another name.
            # A different size means a different scan of the same book — worth
            # keeping apart so the owner can look before anything is dropped.
            kind = "identical" if abs(other["mb"] - keep["mb"]) < 0.05 else "probable"
            rel = other["folder"] if other["folder"] != "." else ""
            dest_dir = os.path.join(DEST, kind, rel)
            moves.append({"kind": kind, "title": keep["title"],
                          "keep_path": keep["path"], "from": other["path"],
                          "to": os.path.join(dest_dir, os.path.basename(other["path"])),
                          "mb": other["mb"]})
    return moves, skipped


def unique(path: str) -> str:
    """Two folders can hold different files with the same name; the second must
    not silently overwrite the first inside the review folder."""
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    n = 2
    while os.path.exists("%s (%d)%s" % (stem, n, ext)):
        n += 1
    return "%s (%d)%s" % (stem, n, ext)


def do_move(moves: list) -> None:
    rows, moved, failed = [], 0, 0
    for m in moves:
        # Never move a file whose keeper has gone missing — that would leave
        # the library with no copy of the book at all.
        if not os.path.exists(m["keep_path"]) or not os.path.exists(m["from"]):
            failed += 1
            continue
        os.makedirs(os.path.dirname(m["to"]), exist_ok=True)
        dest = unique(m["to"])
        try:
            os.rename(m["from"], dest)      # same drive: metadata only, no re-upload
        except OSError:
            try:
                shutil.move(m["from"], dest)
            except Exception as e:
                print("  FAILED %s: %s" % (m["from"], e))
                failed += 1
                continue
        rows.append({"kind": m["kind"], "title": m["title"], "mb": m["mb"],
                     "moved_to": dest, "original": m["from"],
                     "kept": m["keep_path"]})
        moved += 1
        if moved % 100 == 0:
            print("   moved %d" % moved, flush=True)

    mode = "a" if os.path.exists(MANIFEST) else "w"
    with open(MANIFEST, mode, newline="", encoding="utf8") as fh:
        w = csv.DictWriter(fh, ["kind", "title", "mb", "moved_to", "original", "kept"])
        if mode == "w":
            w.writeheader()
        w.writerows(rows)
    print("moved %d, skipped %d, manifest %s" % (moved, failed, MANIFEST))


def undo() -> None:
    if not os.path.exists(MANIFEST):
        print("no manifest — nothing to undo")
        return
    back = 0
    for r in list(csv.DictReader(open(MANIFEST, encoding="utf8")))[::-1]:
        if not os.path.exists(r["moved_to"]) or os.path.exists(r["original"]):
            continue
        os.makedirs(os.path.dirname(r["original"]), exist_ok=True)
        os.rename(r["moved_to"], r["original"])
        back += 1
    print("restored %d files" % back)


if __name__ == "__main__":
    if "--undo" in sys.argv:
        undo()
        raise SystemExit

    moves, skipped = plan()
    if skipped:
        print("NOT touching %d look-alikes that are probably different books:" % len(skipped))
        for keep, other, why in skipped[:8]:
            print("   %-28s %5.1f MB vs %5.1f MB  (%s)"
                  % (keep["title"][:28], keep["mb"], other["mb"], why))
        print()
    by = collections.Counter(m["kind"] for m in moves)
    gb = lambda k: sum(m["mb"] for m in moves if m["kind"] == k) / 1000
    print("would move %d files" % len(moves))
    for k in ("identical", "probable"):
        print("   %-10s %4d files  %6.2f GB" % (k, by[k], gb(k)))
    if "--apply" not in sys.argv:
        print("\nDRY RUN — nothing moved. Pass --apply to do it.")
        for m in moves[:5]:
            print("   %s\n      -> %s" % (m["from"], m["to"]))
        raise SystemExit
    print("\nmoving into %s" % DEST, flush=True)
    do_move(moves)
