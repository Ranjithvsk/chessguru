#!/usr/bin/env python3
# study-reseed.py — continuously upgrade STUDY puzzles (chessguru.study_puzzles ONLY) to a
# PER-POSITION Maia-playout seed rating. Mates use the convert-the-mate playout; pawn drills use
# the draw-aware playout. Skips puzzles already Maia-seeded. Engines opened once; PM2-resumable.
import sys, time, os
from pymongo import MongoClient
import generate as G

BATCH = int(os.environ.get("RESEED_BATCH", "12"))
IDLE = float(os.environ.get("RESEED_IDLE", "300"))
DONE = ["maia-playout", "curated+dtm+maia", "maia-playout-failed"]   # already per-position / skip
PENDING = {"seedMethod": {"$nin": DONE}}


def open_engines():
    sf = G.Eng(G.SF)
    sf.ready()
    engs = {}
    for net in G.MAIA:
        b = G.band_of(net)
        e = G.Eng(G.LC0, ["--weights=" + net, "--backend=blas"])
        e.ready()
        engs[b] = e
    return sf, engs


def reseed_doc(sf, engs, d):
    t = d["type"]
    if t in G.TYPES:                       # mate drill: lowest band that converts the mate
        band = None
        for bnd in sorted(engs):
            if G._converts(engs[bnd], sf, d["fen"]):
                band = bnd
                break
        return G.seed_rating(t, d.get("dtm", 0), band), band
    # pawn drill: lowest band that wins the win / holds the draw
    result = d.get("result", "win")
    band = None
    for bnd in sorted(engs):
        if G._achieves(engs[bnd], sf, d["fen"], result):
            band = bnd
            break
    return G.pawn_maia_rating(t, d.get("pawns", 1), result, band), band


def main():
    col = MongoClient("mongodb://127.0.0.1:27017")["chessguru"]["study_puzzles"]
    sf, engs = open_engines()
    print("[study-reseed] up. %d maia bands + SF; pending=%d" % (len(engs), col.count_documents(PENDING)), flush=True)
    while True:
        try:
            batch = list(col.find(PENDING).limit(BATCH))
            if not batch:
                print("[study-reseed] all study puzzles Maia-seeded; idle %ss" % IDLE, flush=True)
                time.sleep(IDLE)
                continue
            for d in batch:
                try:
                    rating, band = reseed_doc(sf, engs, d)
                    col.update_one({"_id": d["_id"]},
                                   {"$set": {"rating": rating, "rd": 350, "maiaBand": band, "seedMethod": "maia-playout"}})
                except Exception as ex:
                    print("[study-reseed] doc err %s: %s" % (d.get("_id"), ex), file=sys.stderr, flush=True)
                    col.update_one({"_id": d["_id"]}, {"$set": {"seedMethod": "maia-playout-failed"}})
            print("[study-reseed] +%d upgraded; remaining=%d" % (len(batch), col.count_documents(PENDING)), flush=True)
        except Exception as e:
            print("[study-reseed] cycle err: %s" % e, file=sys.stderr, flush=True)
            time.sleep(10)


if __name__ == "__main__":
    main()
