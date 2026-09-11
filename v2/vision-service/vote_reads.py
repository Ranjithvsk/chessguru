"""Checkpoint / reader ensemble by weighted vote on the top answer.

  python vote_reads.py out.json reads_a.json[:weight] reads_b.json[:weight] ...

For every cell, each reader casts its weight for its top candidate; the
result lists candidates by total vote (ties broken by the first reader's
order), then appends each reader's remaining candidates. The beam downstream
sees the consensus first and the alternatives after it.
"""
import json, sys, collections
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from scoresheet_beam import clean
out_path, specs = sys.argv[1], sys.argv[2:]
readers = []
for sp in specs:
    path, _, w = sp.partition(":")
    readers.append((json.load(open(path)), float(w or 1.0)))
keys = readers[0][0].keys()
out = {}
agree = 0
for k in keys:
    votes = collections.OrderedDict(); rest = []
    for reads, w in readers:
        cands = reads.get(k, [])
        if not cands: continue
        top = clean(str(cands[0][0]))
        votes[top] = votes.get(top, 0.0) + w
        rest += [clean(str(c[0])) for c in cands[1:]]
    ranked = sorted(votes.items(), key=lambda kv: -kv[1])
    if ranked and len(votes) == 1: agree += 1
    seen, merged = set(), []
    for t, v in ranked:
        if t and t not in seen: merged.append([t, round(v / sum(w for _, w in readers), 3)]); seen.add(t)
    for t in rest:
        if t and t not in seen: merged.append([t, 0.1]); seen.add(t)
    out[k] = merged or [["", 0.0]]
json.dump(out, open(out_path, "w"))
print(f"voted {len(out)} cells; all readers agreed on {agree/len(out):.1%}")
