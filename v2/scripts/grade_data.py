# For every position in the lesson, work out what BOTH sides should play.
#
# The student is asked for a good move for White and a good move for Black, so
# each position is analysed twice: as it stands, and with the other side to move.
# For each side we record
#   best   — the engine's move
#   ok     — every other move that keeps the same result (win stays a win,
#            draw stays a draw). These earn partial credit: the student has not
#            thrown the position away, they just have not found the point.
# Anything outside those two sets changes the result and earns nothing.

import chess, chess.engine, json, re, sys

SF = "/home/ubuntu/engines/stockfish"
CORPUS = "/home/dreamworld/chessguru/v2/apps/web/src/lib/triangulationCorpus.ts"
MOVE_MS, SIDE_MS = 700, 1500

src = open(CORPUS).read()
entries = []
for m in re.finditer(r'\{\s*\n\s*id: "([^"]+)",[\s\S]*?fen: "([^"]+)",', src):
    entries.append((m.group(1), m.group(2)))
print(f"{len(entries)} positions", flush=True)

def verdict(score):
    """win / draw / loss from the point of view of the side that just moved's opponent."""
    if score.is_mate():
        return "win" if score.mate() > 0 else "loss"
    cp = score.score() or 0
    if cp >= 150: return "win"
    if cp <= -150: return "loss"
    return "draw"

out = {}
with chess.engine.SimpleEngine.popen_uci(SF) as eng:
    eng.configure({"Threads": 2, "Hash": 128})
    for pid, fen in entries:
        base = chess.Board(fen)
        rec = {}
        for side, label in ((chess.WHITE, "white"), (chess.BLACK, "black")):
            b = base.copy(stack=False)
            if b.turn != side:
                b.turn = side
                b.ep_square = None
                if not b.is_valid():
                    rec[label] = None
                    continue
            if b.is_game_over():
                rec[label] = None
                continue
            info = eng.analyse(b, chess.engine.Limit(time=SIDE_MS/1000))
            best_pov = info["score"].pov(side)
            best_res = verdict(best_pov)
            moves = list(b.legal_moves)
            scored = []
            for mv in moves:
                b.push(mv)
                if b.is_game_over():
                    if b.is_checkmate():
                        s = chess.engine.Mate(0)      # mover delivered mate
                        res = "win"
                    else:
                        res = "draw"
                else:
                    i2 = eng.analyse(b, chess.engine.Limit(time=MOVE_MS/1000))
                    res = verdict(i2["score"].pov(side))
                b.pop()
                scored.append((mv, res))
            bestmv = info["pv"][0]
            ok = [b.uci(mv) for mv, res in scored if res == best_res and b.uci(mv) != b.uci(bestmv)]
            rec[label] = {
                "bestUci": b.uci(bestmv),
                "bestSan": b.san(bestmv),
                "result": best_res,
                "okUci": ok,
                "legalCount": len(moves),
            }
            print(f"  {pid:8} {label:5} best {b.san(bestmv):6} {best_res:5} "
                  f"({len(ok)} other moves hold it, of {len(moves)})", flush=True)
        out[pid] = rec
json.dump(out, open("grade-data.json", "w"), indent=1)
print("written grade-data.json")
