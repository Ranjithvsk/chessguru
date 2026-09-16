# Build the answer key for the triangulation chapter.
#
# The student answers on the board, not in a text box: they play their move and
# the reply they expect, and the notation panel records it. So the key has to
# cover a LINE, not a single move —
#
#   mover    what the side to move should play: the engine's move, plus every
#            other move that reaches the same result (partial credit)
#   replies  for EVERY legal move the student might play, what the opponent's
#            best answer then is, and which answers hold the same result
#
# Precomputing the reply for every first move is what lets the second ply be
# marked honestly: a student who plays a second-best first move is then judged
# on the defence to THAT move, not to the engine's.

import chess, chess.engine, json, re, sys

SF = "/home/ubuntu/engines/stockfish"
CORPUS = "/home/dreamworld/chessguru/v2/apps/web/src/lib/triangulationCorpus.ts"
BEST_MS, MOVE_MS = 1200, 500

src = open(CORPUS).read()
entries = [(m.group(1), m.group(2)) for m in
           re.finditer(r'\{\s*\n\s*id: "([^"]+)",[\s\S]*?fen: "([^"]+)",', src)]
print(f"{len(entries)} positions", flush=True)

def verdict(pov):
    if pov.is_mate():
        return "win" if pov.mate() > 0 else "loss"
    cp = pov.score() or 0
    return "win" if cp >= 150 else "loss" if cp <= -150 else "draw"

def side_key(board, eng, ms_best, ms_move):
    """Best move for whoever is to move, plus everything that holds the result."""
    side = board.turn
    info = eng.analyse(board, chess.engine.Limit(time=ms_best/1000))
    best = info["pv"][0]
    best_res = verdict(info["score"].pov(side))
    ok = []
    for mv in board.legal_moves:
        if mv == best:
            continue
        board.push(mv)
        if board.is_game_over():
            res = "win" if board.is_checkmate() else "draw"
        else:
            res = verdict(eng.analyse(board, chess.engine.Limit(time=ms_move/1000))["score"].pov(side))
        board.pop()
        if res == best_res:
            ok.append(mv.uci())
    return {"bestUci": best.uci(), "bestSan": board.san(best), "result": best_res, "okUci": ok}

out = {}
with chess.engine.SimpleEngine.popen_uci(SF) as eng:
    eng.configure({"Threads": 2, "Hash": 192})
    for pid, fen in entries:
        board = chess.Board(fen)
        mover = side_key(board, eng, BEST_MS, MOVE_MS)
        replies = {}
        for mv in list(board.legal_moves):
            board.push(mv)
            if board.is_game_over() or not any(True for _ in board.legal_moves):
                board.pop(); continue
            replies[mv.uci()] = side_key(board, eng, MOVE_MS, MOVE_MS)
            board.pop()
        out[pid] = {"turn": "white" if board.turn == chess.WHITE else "black",
                    "mover": mover, "replies": replies}
        print(f"  {pid:8} {out[pid]['turn']:5} plays {mover['bestSan']:6} ({mover['result']}), "
              f"{len(mover['okUci'])} hold it · replies mapped for {len(replies)} moves", flush=True)
json.dump(out, open("grade-data.json", "w"), indent=1)
print("written")
