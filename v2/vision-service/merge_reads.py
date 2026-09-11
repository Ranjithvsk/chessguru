"""Ensemble by candidate union: append a second reader's top answers to the
first reader's K-best list (deduplicated, as lower-ranked candidates) so the
legality beam can choose between two independent readers.

  python merge_reads.py primary.json secondary.json out.json
"""
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
out = {}
for k, cands in a.items():
    seen = [str(c[0]).replace(" ", "") for c in cands]
    merged = [list(c) for c in cands]
    for c in b.get(k, [])[:1]:
        t = str(c[0]).replace(" ", "")
        if t and t not in seen:
            merged.append([t, float(c[1])]); seen.append(t)
    out[k] = merged
json.dump(out, open(sys.argv[3], "w"))
print("merged", len(out), "cells")
