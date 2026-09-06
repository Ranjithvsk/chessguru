#!/usr/bin/env python3
"""Measure whether Maia-3's SelfElo knob corresponds to real playing strength.

Maia is trained to PREDICT the moves of a player rated X, which is not the same
as PLAYING at strength X -- Maia-1's playing strength was known to be compressed
relative to its target band. Since bot games are rated and the bot is disguised,
a compressed ladder silently distorts real student ratings. This harness is the
gate on rated go-live (PROJECT_MASTER/plans/human-like-bot-opponent.md).

Round-robins SelfElo levels against each other and fits an implied rating to each
from the results, so the NOMINAL gap can be compared against the ACHIEVED gap.

One engine process plays both sides, swapping SelfElo/OppoElo each ply -- which
also exercises OppoElo the way production will (Maia conditions on opponent
strength). No clock: this measures move choice, not time handling.

  play:      maia_calibration.py play --shard N --shards M --out results.jsonl
  summarize: maia_calibration.py summarize results.jsonl
"""
import argparse, itertools, json, os, subprocess, sys, time
from collections import defaultdict

import chess

BIN = "/home/dreamworld/opt/maia3/.venv/bin/maia3-uci"
MODEL = "maia3-5m"
LADDER = [800, 1100, 1400, 1700, 2000]
GAMES_PER_PAIR = 30
PLY_CAP = 300  # Maia never resigns; lost positions get played out forever


class Engine:
    def __init__(self):
        env = dict(os.environ, OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")
        self.p = subprocess.Popen(
            [BIN, "--model", MODEL, "--device", "cpu", "--no-use-amp"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            text=True, bufsize=1, env=env,
        )
        self._send("uci"); self._until("uciok")
        self._send("setoption name MultiPV value 1")
        self._send("setoption name Temperature value 1.0")
        self._send("setoption name TopP value 1.0")
        self._send("isready"); self._until("readyok")
        self.elos = (None, None)

    def _send(self, c):
        self.p.stdin.write(c + "\n"); self.p.stdin.flush()

    def _until(self, tok):
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError("engine died")
            if line.startswith(tok):
                return line.strip()

    def move(self, board, self_elo, oppo_elo):
        if self.elos != (self_elo, oppo_elo):
            self._send(f"setoption name SelfElo value {self_elo}")
            self._send(f"setoption name OppoElo value {oppo_elo}")
            self.elos = (self_elo, oppo_elo)
        moves = " ".join(m.uci() for m in board.move_stack)
        self._send(f"position startpos{' moves ' + moves if moves else ''}")
        self._send("go")
        best = self._until("bestmove").split()[1]
        return None if best == "(none)" else chess.Move.from_uci(best)

    def close(self):
        try:
            self._send("quit"); self.p.wait(timeout=10)
        except Exception:
            self.p.kill()


def play_game(eng, white_elo, black_elo):
    board = chess.Board()
    while not board.is_game_over(claim_draw=True) and board.ply() < PLY_CAP:
        stm = board.turn
        mine, theirs = (white_elo, black_elo) if stm == chess.WHITE else (black_elo, white_elo)
        mv = eng.move(board, mine, theirs)
        if mv is None or mv not in board.legal_moves:
            return "*", board.ply(), "illegal" if mv else "none"
        board.push(mv)
    if board.ply() >= PLY_CAP:
        return "1/2-1/2", board.ply(), "plycap"
    return board.result(claim_draw=True), board.ply(), "natural"


def cmd_play(args):
    pairs = list(itertools.combinations(LADDER, 2))
    mine = [p for i, p in enumerate(pairs) if i % args.shards == args.shard]
    eng = Engine()
    t0 = time.time()
    with open(args.out, "a", buffering=1) as fh:
        for a, b in mine:
            for g in range(GAMES_PER_PAIR):
                # alternate colours so any first-move advantage cancels
                w, bl = (a, b) if g % 2 == 0 else (b, a)
                res, ply, how = play_game(eng, w, bl)
                fh.write(json.dumps({
                    "white": w, "black": bl, "result": res,
                    "ply": ply, "end": how,
                }) + "\n")
            print(f"[shard {args.shard}] {a} vs {b} done "
                  f"({time.time()-t0:.0f}s)", file=sys.stderr, flush=True)
    eng.close()


def cmd_summarize(args):
    rows = [json.loads(l) for l in open(args.results) if l.strip()]
    rows = [r for r in rows if r["result"] != "*"]
    # score[a][b] = points a scored against b, over n games
    pts = defaultdict(float); n = defaultdict(int)
    for r in rows:
        w, b, res = r["white"], r["black"], r["result"]
        s = 1.0 if res == "1-0" else 0.0 if res == "0-1" else 0.5
        pts[(w, b)] += s; n[(w, b)] += 1
        pts[(b, w)] += 1 - s; n[(b, w)] += 1

    caps = sum(1 for r in rows if r["end"] == "plycap")
    draws = sum(1 for r in rows if r["result"] == "1/2-1/2")
    print(f"\n{len(rows)} games | draws {draws} ({draws/len(rows):.0%}) | "
          f"hit ply cap {caps} ({caps/len(rows):.0%}) | "
          f"avg {sum(r['ply'] for r in rows)/len(rows):.0f} ply\n")

    print("Pairwise: nominal gap vs achieved gap")
    print(f"{'pairing':<16}{'games':>6}{'score':>8}{'nominal':>9}{'achieved':>10}{'ratio':>8}")
    import math
    for a, b in itertools.combinations(LADDER, 2):
        g = n[(b, a)]
        if not g:
            continue
        s = pts[(b, a)] / g  # score of the STRONGER setting
        s = min(max(s, 0.5 / (g + 1)), 1 - 0.5 / (g + 1))  # avoid inf at 0/1
        achieved = -400 * math.log10(1 / s - 1)
        nominal = b - a
        print(f"{a} v {b:<11}{g:>6}{s:>8.2f}{nominal:>9}{achieved:>10.0f}"
              f"{achieved/nominal:>8.2f}")

    # least-squares implied ratings, anchored so the ladder mean is preserved
    import numpy as np
    idx = {e: i for i, e in enumerate(LADDER)}
    A, y = [], []
    for (a, b), g in n.items():
        if g == 0 or a >= b:
            continue
        s = pts[(a, b)] / g
        s = min(max(s, 0.5 / (g + 1)), 1 - 0.5 / (g + 1))
        row = [0.0] * len(LADDER)
        row[idx[a]] = 1.0; row[idx[b]] = -1.0
        A.append(row); y.append(-400 * math.log10(1 / s - 1))
    A.append([1.0] * len(LADDER)); y.append(float(sum(LADDER)))
    sol, *_ = np.linalg.lstsq(np.array(A), np.array(y), rcond=None)

    print("\nImplied playing strength (ladder mean anchored to nominal mean)")
    print(f"{'SelfElo':>8}{'implied':>10}{'delta':>8}")
    for e in LADDER:
        v = sol[idx[e]]
        print(f"{e:>8}{v:>10.0f}{v - e:>+8.0f}")
    span_nom = LADDER[-1] - LADDER[0]
    span_act = sol[idx[LADDER[-1]]] - sol[idx[LADDER[0]]]
    print(f"\nladder span: nominal {span_nom} -> achieved {span_act:.0f} "
          f"({span_act/span_nom:.2f}x)")
    if span_act / span_nom < 0.8:
        print("COMPRESSED: SelfElo gaps understate real strength gaps. "
              "Do NOT map SelfElo directly to student rating for rated play.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("play")
    p1.add_argument("--shard", type=int, default=0)
    p1.add_argument("--shards", type=int, default=1)
    p1.add_argument("--out", required=True)
    p1.set_defaults(fn=cmd_play)
    p2 = sub.add_parser("summarize")
    p2.add_argument("results")
    p2.set_defaults(fn=cmd_summarize)
    a = ap.parse_args()
    a.fn(a)
