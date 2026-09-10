"""Drop cached page images for books that can re-render them from the PDF.

Only touches a book whose meta records a source PDF that OPENS and reports the
right number of pages. A book that cannot re-render must keep its images, or
deleting them turns a readable book into a broken one.
"""
import io, json, os, shutil, sys

import fitz

STORE = r"F:\chessguru-books"
APPLY = "--apply" in sys.argv

freed = kept = 0
for d in sorted(os.listdir(STORE)):
    full = os.path.join(STORE, d)
    pages = os.path.join(full, "pages")
    held = os.path.join(full, "pages_held")
    for cand in (pages, held):
        if not os.path.isdir(cand):
            continue
        meta = json.load(io.open(os.path.join(full, "meta.json"), encoding="utf8")) \
            if os.path.exists(os.path.join(full, "meta.json")) else {}
        src = meta.get("pdf")
        st = os.path.join(full, "status.json")
        want = json.load(io.open(st, encoding="utf8")).get("pages", 0) if os.path.exists(st) else 0
        ok = False
        if src and os.path.exists(src):
            try:
                ok = len(fitz.open(src)) >= want > 0
            except Exception:
                ok = False
        size = sum(os.path.getsize(os.path.join(cand, f))
                   for f in os.listdir(cand) if os.path.isfile(os.path.join(cand, f)))
        if not ok:
            kept += size
            print("  KEEPING %s (cannot re-render)" % d[:46])
            continue
        freed += size
        if APPLY:
            shutil.rmtree(cand, ignore_errors=True)

print()
print("%s %.1f GB, keeping %.2f GB that cannot be re-rendered"
      % ("freed" if APPLY else "would free", freed / 1e9, kept / 1e9))
if not APPLY:
    print("DRY RUN — pass --apply")
