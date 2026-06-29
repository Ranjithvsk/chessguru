#!/usr/bin/env python3
# study-factory/service.py — continuous background filler for chessguru.study_puzzles (PM2: study-factory).
# Keeps every bucket (each mate type, and each pawn type x pawn-count) stocked to a target. TABLEBASE-ONLY
# (no engines => light + can not OOM); seeds are curated+dtm / curated-pawns, Glicko calibrates from play.
# Resumable: it reads live DB counts each cycle, so a restart just continues. Polite to Lichess (throttled).
import sys, time, os
from pymongo import MongoClient, ASCENDING
import generate as G   # reuse the factory generators (import is side-effect-free; main() is __main__-guarded)

MATE_TARGET = int(os.environ.get("STUDY_MATE_TARGET", "60"))   # per mate type
PAWN_TARGET = int(os.environ.get("STUDY_PAWN_TARGET", "25"))   # per (pawn type, pawn count)
BATCH       = int(os.environ.get("STUDY_BATCH", "4"))          # puzzles per cycle
THROTTLE    = float(os.environ.get("STUDY_THROTTLE", "12"))    # seconds between cycles
IDLE        = float(os.environ.get("STUDY_IDLE", "300"))       # sleep when everything is stocked


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def neediest(col):
    b = []
    for t in G.TYPES:
        b.append(("mate", t, None, col.count_documents({"type": t}), MATE_TARGET))
    for t in G.PAWN_TYPES:
        for pawns in (1, 2, 3, 4):
            b.append(("pawn", t, pawns, col.count_documents({"type": t, "pawns": pawns}), PAWN_TARGET))
    below = [x for x in b if x[3] < x[4]]
    if not below:
        return None
    below.sort(key=lambda x: x[3] - x[4])   # biggest deficit first
    return below[0]


def fill_one(col, bucket):
    mode, t, pawns, _cur, _tgt = bucket
    made = 0
    for _ in range(BATCH * 4):
        if made >= BATCH:
            break
        if mode == "mate":
            c = G.gen_candidate(t)
            if not c:
                continue
            doc = {
                "type": c["type"], "fen": c["fen"], "result": c["result"], "dtm": c["dtm"],
                "solution": c["solution"], "rating": G.seed_rating(c["type"], c["dtm"], "skip"),
                "rd": 350, "vol": 0.06, "nb": 0, "seedMethod": "curated+dtm", "maiaBand": None, "createdAt": now(),
            }
        else:
            c = G.gen_pawn_candidate(t, pawns)
            if not c:
                continue
            doc = {**c, "rd": 350, "vol": 0.06, "nb": 0, "createdAt": now()}
        try:
            col.update_one({"fen": doc["fen"]}, {"$setOnInsert": doc}, upsert=True)
            made += 1
        except Exception as e:
            print("[study-factory] mongo: " + str(e), file=sys.stderr, flush=True)
    return made


def main():
    cli = MongoClient(os.environ.get("STUDY_MONGO", "mongodb://127.0.0.1:27017"))
    col = cli["chessguru"]["study_puzzles"]
    col.create_index([("type", ASCENDING), ("rating", ASCENDING)])
    col.create_index([("type", ASCENDING), ("pawns", ASCENDING), ("rating", ASCENDING)])
    try:
        col.create_index([("fen", ASCENDING)], unique=True)
    except Exception:
        pass
    print("[study-factory] up. mate_target=%d pawn_target=%d batch=%d throttle=%ss"
          % (MATE_TARGET, PAWN_TARGET, BATCH, THROTTLE), flush=True)
    while True:
        try:
            b = neediest(col)
            if b is None:
                print("[study-factory] all buckets stocked; idle %ss" % IDLE, flush=True)
                time.sleep(IDLE)
                continue
            made = fill_one(col, b)
            tag = b[1] + (("/" + str(b[2]) + "p") if b[2] else "")
            print("[study-factory] %s: %d->%d/%d (+%d)" % (tag, b[3], b[3] + made, b[4], made), flush=True)
        except Exception as e:
            print("[study-factory] cycle error: " + str(e), file=sys.stderr, flush=True)
        time.sleep(THROTTLE)


if __name__ == "__main__":
    main()
