import os, sys
flat = "/srv/data/chess-library-flat"; root = "/srv/data/chess-library"
have = {f.lower(): f for f in os.listdir(flat)}
made = skipped = missing = 0
for rel in open("/srv/data/bookhost/needed-pdfs.txt", encoding="utf-8"):
    rel = rel.rstrip("\n")
    if not rel: continue
    dst = os.path.join(root, rel); base = os.path.basename(rel).lower()
    if os.path.exists(dst): skipped += 1; continue
    src = have.get(base)
    if not src: missing += 1; continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.symlink(os.path.join(flat, src), dst); made += 1
print(f"symlinks made {made}, already present {skipped}, no local copy {missing}")
