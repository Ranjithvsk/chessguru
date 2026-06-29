#!/usr/bin/env python3
# study-factory/reseed_pawns.py — give each pawn-drill puzzle a PER-POSITION rating via the
# draw-aware Maia playout (so a tricky 1-pawn can out-rate an easy 4-pawn). Incremental + robust.
import sys, time
from pymongo import MongoClient
import generate as G


def main():
    col = MongoClient("mongodb://127.0.0.1:27017")["chessguru"]["study_puzzles"]
    docs = list(col.find({"type": {"$in": list(G.PAWN_TYPES)}}))
    print("[reseed] %d pawn puzzles" % len(docs), flush=True)
    sf = G.Eng(G.SF)
    sf.ready()
    engs = {}
    for net in G.MAIA:
        b = G.band_of(net)
        e = G.Eng(G.LC0, ["--weights=" + net, "--backend=blas"])
        e.ready()
        engs[b] = e
    done = 0
    for d in docs:
        try:
            result = d.get("result", "win")
            band = None
            for bnd in sorted(engs):
                if G._achieves(engs[bnd], sf, d["fen"], result):
                    band = bnd
                    break
            rating = G.pawn_maia_rating(d["type"], d.get("pawns", 1), result, band)
            col.update_one({"_id": d["_id"]},
                           {"$set": {"rating": rating, "rd": 350, "maiaBand": band, "seedMethod": "maia-playout"}})
            done += 1
            if done % 10 == 0:
                print("[reseed] %d/%d" % (done, len(docs)), flush=True)
        except Exception as ex:
            print("[reseed] err %s: %s" % (d.get("_id"), ex), file=sys.stderr, flush=True)
    for e in engs.values():
        e.close()
    sf.close()
    print("[reseed] DONE %d puzzles re-seeded" % done, flush=True)


if __name__ == "__main__":
    main()
