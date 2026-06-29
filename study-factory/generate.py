#!/usr/bin/env python3
# study-factory/generate.py — generate RATED endgame study puzzles into Mongo (chessguru.study_puzzles).
# Per puzzle: random legal position -> Lichess 7-piece tablebase (win/draw/loss + dtm + solution)
#   -> seed rating (curated base + dtm + Maia "lowest band that keeps the win" probe) at HIGH RD
#   -> store in Mongo. Glicko self-calibrates from real solves later. See PROJECT_MASTER/knowledge/13.
import sys, os, time, json, argparse, urllib.request, urllib.parse, random, glob, subprocess, re
import chess
from pymongo import MongoClient, ASCENDING

LC0  = "/home/ubuntu/engines/lc0"
SF   = "/home/ubuntu/engines/stockfish18"
MAIA = sorted(glob.glob("/home/ubuntu/engines/maia/maia-*.pb.gz"))   # 1100,1300,1500,1700,1900
TB_API = "https://tablebase.lichess.ovh/standard?fen="
FILES = "abcdefgh"
WINNING = {"loss", "blessed-loss"}          # move category (opp-to-move) that means WE are still winning

# Mate drills (P1). pieces = white attackers besides the king. base = curated seed Elo, dtm0 = typical mate len (plies).
TYPES = {
  "two-rook-mate":      {"pieces": ["R","R"], "base": 600,  "dtm0": 14},
  "queen-mate":         {"pieces": ["Q"],     "base": 800,  "dtm0": 18},
  "rook-mate":          {"pieces": ["R"],     "base": 1100, "dtm0": 30},
  "two-bishop-mate":    {"pieces": ["B","B"], "base": 1500, "dtm0": 36},
  "bishop-knight-mate": {"pieces": ["B","N"], "base": 2000, "dtm0": 60},
}

def rsq(): return random.choice(FILES) + str(random.randint(1,8))
def adjacent(a,b): return abs(ord(a[0])-ord(b[0]))<=1 and abs(int(a[1:])-int(b[1:]))<=1
def sqcolor(s): return (ord(s[0])-97 + int(s[1:])) % 2

def to_fen(place, turn):
    rows=[]
    for r in range(8,0,-1):
        row=""; empty=0
        for f in range(8):
            p=place.get(FILES[f]+str(r))
            if p:
                if empty: row+=str(empty); empty=0
                row+=p
            else: empty+=1
        if empty: row+=str(empty)
        rows.append(row)
    return "/".join(rows)+" "+turn+" - - 0 1"

def random_mate_fen(pieces):
    for _ in range(6000):
        used=set(); wk=rsq(); used.add(wk); bk=rsq()
        if bk in used or adjacent(wk,bk): continue
        used.add(bk); place={wk:"K", bk:"k"}
        two_b = pieces.count("B")>=2; bcol=set(); ok=True
        for p in pieces:
            sqr=""; t=0
            while True:
                sqr=rsq(); t+=1
                if (sqr not in used and not (p=="B" and two_b and sqcolor(sqr) in bcol)) or t>=80: break
            if sqr in used: ok=False; break
            used.add(sqr); place[sqr]=p
            if p=="B": bcol.add(sqcolor(sqr))
        if not ok: continue
        fen=to_fen(place,"w")
        try: b=chess.Board(fen)
        except Exception: continue
        if (not b.is_valid()) or b.is_check() or b.is_game_over(): continue
        return fen
    return None

_tb_cache={}
def tb_lookup(fen):
    if fen in _tb_cache: return _tb_cache[fen]
    url=TB_API+urllib.parse.quote(fen)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                d=json.load(r); _tb_cache[fen]=d; return d
        except Exception:
            time.sleep(1.5*(attempt+1))
    return None

class Eng:
    def __init__(s,b,a=()): s.p=subprocess.Popen([b,*a],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1)
    def cmd(s,x): s.p.stdin.write(x+"\n"); s.p.stdin.flush()
    def until(s,pred):
        for line in s.p.stdout:
            if pred(line): return line
        return ""
    def ready(s): s.cmd("uci"); s.until(lambda l:l.startswith("uciok")); s.cmd("isready"); s.until(lambda l:l.startswith("readyok"))
    def bestmove(s,fen):
        s.cmd("position fen "+fen); s.cmd("go nodes 1")
        l=s.until(lambda x:x.startswith("bestmove"))
        return l.split()[1] if l else None
    def bestmove_mt(s,fen,ms=60):
        s.cmd("position fen "+fen); s.cmd("go movetime "+str(ms))
        l=s.until(lambda x:x.startswith("bestmove"))
        return l.split()[1] if l else None
    def close(s):
        try: s.cmd("quit"); s.p.wait(timeout=3)
        except Exception:
            try: s.p.kill()
            except Exception: pass

def band_of(net): return int(re.search(r"maia-(\d+)", net).group(1))

def _converts(maia, sf, fen, cap=110):
    b=chess.Board(fen)                       # white to move = the player (a maia band); black = Stockfish
    for _ in range(cap):
        if b.is_checkmate(): return b.turn==chess.BLACK          # black mated -> the player converted
        if b.is_stalemate() or b.is_insufficient_material() or b.is_fifty_moves(): return False
        mv = maia.bestmove(b.fen()) if b.turn==chess.WHITE else sf.bestmove_mt(b.fen())
        if not mv: return False
        try: b.push_uci(mv)
        except Exception: return False
    return False

def maia_probe(positions):
    # Multi-ply playout: player = maia(band), defender = Stockfish. The LOWEST band that converts the
    # whole mate within the 50-move rule = the human level that can actually solve it. "skip" if engines fail.
    if not MAIA: return {i:"skip" for i,_,_ in positions}
    result={i:None for i,_,_ in positions}
    try:
        sf=Eng(SF); sf.ready()
        engs={}
        for net in MAIA:
            band=band_of(net); e=Eng(LC0,[f"--weights={net}","--backend=blas"]); e.ready(); engs[band]=e
        for i,fen,_ in positions:
            for band in sorted(engs):
                if _converts(engs[band], sf, fen): result[i]=band; break
        for e in engs.values(): e.close()
        sf.close()
    except Exception as ex:
        print(f"[playout] failed: {ex}", file=sys.stderr)
        return {i:"skip" for i,_,_ in positions}
    return result

def seed_rating(t, dtm, maia_band):
    cfg=TYPES[t]; r=cfg["base"]
    r += max(-200, min(200, int((abs(dtm)-cfg["dtm0"])*6)))   # within-type dtm nudge
    if maia_band == "skip":
        pass
    elif maia_band is None:           # ran but no band converts -> hard, but proportional to the type
        r += 250
    elif maia_band > r+150:           # position meaningfully harder than the type baseline -> raise toward it
        r=int(round((r+maia_band)/2))
    return max(400, min(2600, r))

def gen_candidate(t):
    fen=random_mate_fen(TYPES[t]["pieces"])
    if not fen: return None
    d=tb_lookup(fen); time.sleep(0.7)            # polite to Lichess
    if not d or d.get("category")!="win": return None   # mate drills must be a forced win
    moves=d.get("moves",[])
    winmoves={m["uci"] for m in moves if m.get("category") in WINNING}
    sol=moves[0]["uci"] if moves else None
    return {"type":t,"fen":fen,"result":"win","dtm":abs(d.get("dtm") or 0),
            "solution":([sol] if sol else []), "_winmoves":winmoves}

# ---- Pawn drills (Queen/Rook vs Pawns) — result can be WIN or DRAW (cursed-win/blessed-loss => practical draw).
PAWN_TYPES = {
  "stop-the-pawn":  {"piece": "Q", "base": 1000},   # study id (King+Queen vs King+Pawns)
  "rook-stop-pawn": {"piece": "R", "base": 1300},   # study id (King+Rook  vs King+Pawns)
}

def random_vskp_fen(piece, pawns):
    # Port of StudyTrainer randomVsKP: white K + piece vs black K + N pawns on ranks 2-4 (racing to promote).
    for _ in range(5000):
        wk=rsq(); wp=rsq(); bk=rsq(); used={wk,wp,bk}
        if len(used)!=3 or adjacent(wk,bk): continue
        place={wk:"K", wp:piece, bk:"k"}
        files=list(FILES); random.shuffle(files); placed=0
        for f in files:
            if placed>=pawns: break
            sq=f+str(2+random.randint(0,2))
            if sq in used: continue
            used.add(sq); place[sq]="p"; placed+=1
        if placed<pawns: continue
        fen=to_fen(place,"w")
        try: b=chess.Board(fen)
        except Exception: continue
        if (not b.is_valid()) or b.is_check() or b.is_game_over(): continue
        return fen
    return None

def pawn_seed_rating(t, pawns, result, dtm):
    r = PAWN_TYPES[t]["base"] + (pawns-1)*150
    if result=="draw": r += 80                                   # recognising/securing a draw is its own skill
    else: r += max(-100, min(150, int((abs(dtm)-20)*4)))
    return max(500, min(2600, r))

def gen_pawn_candidate(t, pawns):
    fen=random_vskp_fen(PAWN_TYPES[t]["piece"], pawns)
    if not fen: return None
    d=tb_lookup(fen); time.sleep(0.7)
    if not d: return None
    cat=d.get("category")
    if cat not in ("win","draw","cursed-win","blessed-loss"): return None   # skip losses (player can't do anything)
    result = "win" if cat=="win" else "draw"                                # cursed-win/blessed-loss => practical draw (50-move)
    moves=d.get("moves",[]); sol=moves[0]["uci"] if moves else None
    dtm=abs(d.get("dtm") or 0)
    return {"type":t,"fen":fen,"result":result,"dtm":dtm,"solution":([sol] if sol else []),
            "pawns":pawns,"rating":pawn_seed_rating(t,pawns,result,dtm),"seedMethod":"curated-pawns","maiaBand":None}

def run_pawns(col, types, per, now):
    from pymongo import ASCENDING as ASC
    col.create_index([("type",ASC),("pawns",ASC),("rating",ASC)])
    ins=0
    for t in types:
        for pawns in (1,2,3,4):
            n=0
            for _ in range(per*5):
                if n>=per: break
                c=gen_pawn_candidate(t, pawns)
                if not c: continue
                doc={**c, "rd":350, "vol":0.06, "nb":0, "createdAt":now}
                try: col.update_one({"fen":c["fen"]}, {"$setOnInsert":doc}, upsert=True); ins+=1; n+=1
                except Exception as e: print(f"[mongo] {e}", file=sys.stderr)
            print(f"[pawns] {t} {pawns}-pawn: {n}", file=sys.stderr)
    print(f"[done] upserted {ins} pawn puzzles into chessguru.study_puzzles")

def _achieves(maia, sf, fen, result, cap=90):
    # Draw-aware playout: player(white)=maia(band) vs Stockfish(black). WIN position => success iff maia
    # checkmates; DRAW position => success iff the game reaches a draw (maia does not get mated/lose). The
    # lowest band that succeeds = the human level that can solve THIS position (not just its pawn count).
    b=chess.Board(fen)
    for _ in range(cap):
        if b.is_checkmate(): return b.turn==chess.BLACK                 # black mated => player won
        if b.is_stalemate() or b.is_insufficient_material() or b.is_fifty_moves() or b.is_repetition(3):
            return result=="draw"                                       # a draw outcome: success iff a theoretical draw
        mv = maia.bestmove(b.fen()) if b.turn==chess.WHITE else sf.bestmove_mt(b.fen())
        if not mv: return False
        try: b.push_uci(mv)
        except Exception: return False
    return result=="draw"                                              # ran out: held (draw) / didn't convert (win=fail)

def pawn_maia_rating(t, pawns, result, band):
    base = PAWN_TYPES[t]["base"] + (pawns-1)*120
    if band is None: return min(2600, base + (320 if result=="win" else 200))   # no band succeeds => very hard
    r = int(round(0.45*base + 0.55*band))                              # blend the type/pawn floor with the human level
    if result=="draw": r += 40
    return max(500, min(2600, r))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=10, help="puzzles per type")
    ap.add_argument("--types", default=",".join(TYPES), help="comma list of study types")
    ap.add_argument("--no-maia", action="store_true", help="skip the maia probe (faster; curated+dtm seed)")
    ap.add_argument("--mode", default="mate", choices=["mate","pawns"])
    ap.add_argument("--mongo", default="mongodb://127.0.0.1:27017")
    a=ap.parse_args()
    allkeys = set(TYPES) | set(PAWN_TYPES)
    types=[t.strip() for t in a.types.split(",") if t.strip() in allkeys]

    cli=MongoClient(a.mongo); col=cli["chessguru"]["study_puzzles"]
    col.create_index([("type",ASCENDING),("rating",ASCENDING)])
    col.create_index([("fen",ASCENDING)], unique=True)
    now=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if a.mode=="pawns":
        pt=[t for t in types if t in PAWN_TYPES] or list(PAWN_TYPES)
        run_pawns(col, pt, a.count, now); return

    cands=[]
    for t in types:
        n=0
        for _ in range(a.count*4):
            if n>=a.count: break
            c=gen_candidate(t)
            if c: cands.append(c); n+=1
        print(f"[gen] {t}: {n} positions", file=sys.stderr)

    probe={i:"skip" for i in range(len(cands))}
    if not a.no_maia:
        probe=maia_probe([(i,c["fen"],c["_winmoves"]) for i,c in enumerate(cands)])

    ins=0; now=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for i,c in enumerate(cands):
        mb=probe.get(i,"skip")
        rating=seed_rating(c["type"], c["dtm"], mb)
        doc={"type":c["type"], "fen":c["fen"], "result":c["result"], "dtm":c["dtm"],
             "solution":c["solution"], "rating":rating, "rd":350, "vol":0.06, "nb":0,
             "seedMethod":("curated+dtm" if (a.no_maia or mb=="skip") else "curated+dtm+maia"),
             "maiaBand":(None if mb in ("skip",None) else mb), "createdAt":now}
        try:
            col.update_one({"fen":c["fen"]}, {"$setOnInsert":doc}, upsert=True); ins+=1
        except Exception as ex:
            print(f"[mongo] {ex}", file=sys.stderr)
    print(f"[done] upserted {ins} puzzles into chessguru.study_puzzles")

if __name__=="__main__": main()
