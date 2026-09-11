"""Position-free chess prior over SAN tokens, for choosing between a reader's
candidates when the legality beam has lost the board.

Build:  python san_prior.py build <out.json> [n_games]   (pulls games from the local masters DB API)
Use:    from san_prior import SanPrior; SanPrior(path).logp(prev_san, san)

Counts unigrams and bigrams over consecutive plies (so colour alternation is
implicit), with add-k smoothing and a back-off to the unigram. Check/mate
marks and capture x are stripped: the reader's spelling of those is exactly
what we do not want the prior to judge.
"""
from __future__ import annotations
import json, math, re, sys, time, collections
import urllib.request

API = "http://127.0.0.1:8790"; TOKEN = "cg_v_2026_c9r7"


def strip(san: str) -> str:
    s = re.sub(r"[+#!?]+$", "", san).replace("x", "")
    return "O-O-O" if s.startswith("O-O-O") else ("O-O" if s.startswith("O-O") else s)


def build(out: str, n_games: int = 120000, page: int = 500):
    import chess
    uni = collections.Counter(); bi = collections.Counter(); games = 0; plies = 0; t0 = time.time()
    skip = 0
    while games < n_games:
        req = urllib.request.Request(f"{API}/games?limit={page}&skip={skip}", headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            items = json.load(urllib.request.urlopen(req, timeout=120)).get("items", [])
        except Exception as ex:                       # a slow page must not lose the counts so far
            print(f"fetch failed at skip {skip}: {ex}; stopping with what we have", flush=True); break
        if not items: break
        skip += len(items)
        for g in items:
            if g.get("movesFormat") != "uci" or not g.get("moves"): continue
            b = chess.Board(); prev = "<s>"; ok = True
            for u in g["moves"].split()[:120]:
                try:
                    mv = chess.Move.from_uci(u); san = strip(b.san(mv)); b.push(mv)
                except Exception:
                    ok = False; break
                uni[san] += 1; bi[(prev, san)] += 1; prev = san; plies += 1
            games += 1
        if games % 5000 < page: print(f"{games} games, {plies} plies, {time.time()-t0:.0f}s", flush=True)
    json.dump({"games": games, "plies": plies, "uni": uni, "bi": {f"{a}|{b_}": c for (a, b_), c in bi.items()}}, open(out, "w"))
    print(f"prior: {games} games, {plies} plies, {len(uni)} unigrams, {len(bi)} bigrams → {out}")


class SanPrior:
    def __init__(self, path: str, k: float = 0.5):
        d = json.load(open(path)); self.uni = d["uni"]; self.bi = d["bi"]; self.N = sum(self.uni.values()); self.V = len(self.uni); self.k = k
        self.prev_tot = collections.Counter()
        for key, c in self.bi.items(): self.prev_tot[key.split("|")[0]] += c

    def logp(self, prev: str, san: str) -> float:
        s = strip(san); p = strip(prev) if prev else "<s>"
        c_bi = self.bi.get(f"{p}|{s}", 0); c_prev = self.prev_tot.get(p, 0)
        p_uni = (self.uni.get(s, 0) + self.k) / (self.N + self.k * (self.V + 1))
        if c_prev == 0: return math.log(p_uni)
        lam = c_prev / (c_prev + 50.0)                      # trust the bigram more when the context is common
        return math.log(lam * (c_bi + self.k * p_uni * 20) / (c_prev + self.k * 20) + (1 - lam) * p_uni)


if __name__ == "__main__":
    if sys.argv[1] == "build": build(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 120000)
