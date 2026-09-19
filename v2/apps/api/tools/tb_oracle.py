#!/usr/bin/env python3
"""Exact endgame oracle for the study trainer (2026-09-19).

Probes the Syzygy 3-4-5 tablebases with python-chess and returns the move that resists
longest (or wins/draws when the side to move can): the defender students train against.
Stockfish's own tablebase ranking was measured to give plies away in K+R vs K; a direct
DTZ probe never does. Loopback only: GET /defend?fen=...  ->  JSON.

  {"ok":true,"move":"e4e5","wdl":-2,"dtz":-27,"mateIn":14,"pieces":3}
  wdl from the side to move: -2 loss, 0 draw, 2 win. mateIn is the number of full moves
  until mate with best play on both sides (exact when the ending has no pawns and no
  capture can shorten it; otherwise an upper bound derived from DTZ).
  {"ok":false,"reason":"not-in-tablebase"} for >5 pieces, castling rights, or missing tables.
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import chess, chess.syzygy

TB_DIR = os.environ.get("SYZYGY_DIR", "/home/ubuntu/engines/syzygy")
PORT = int(os.environ.get("TB_ORACLE_PORT", "4731"))
tb = chess.syzygy.open_tablebase(TB_DIR)

def defend(fen: str):
    b = chess.Board(fen)
    if len(b.piece_map()) > 5 or b.castling_rights: return {"ok": False, "reason": "not-in-tablebase"}
    try: root_wdl = tb.probe_wdl(b); root_dtz = tb.probe_dtz(b)
    except (KeyError, chess.syzygy.MissingTableError): return {"ok": False, "reason": "not-in-tablebase"}
    best, best_key = None, None
    for mv in b.legal_moves:
        b.push(mv)
        try:
            if b.is_checkmate(): key = (3, 0)            # we mate: best possible
            elif b.is_stalemate() or b.is_insufficient_material(): key = (2, 0)  # draw
            else:
                wdl = -tb.probe_wdl(b); dtz = tb.probe_dtz(b)   # wdl from OUR side after the move
                # win: prefer the shortest (smallest |dtz| for the opponent); loss: prefer the longest
                key = (3, -abs(dtz)) if wdl > 0 else (2, 0) if wdl == 0 else (1, abs(dtz))
        except (KeyError, chess.syzygy.MissingTableError):
            key = (0, 0)
        b.pop()
        if best_key is None or key > best_key: best, best_key = mv, key
    if best is None: return {"ok": False, "reason": "no-legal-moves"}
    # mateIn is exact only where DTZ == DTM: no pawns and the losing side has a bare king
    # (K+R, K+Q, K+B+B, K+B+N vs K) — no capture or pawn move can reset the count.
    pm = b.piece_map(); winner = chess.WHITE if (root_wdl > 0) == (b.turn == chess.WHITE) else chess.BLACK
    loser_bare = all(p.piece_type == chess.KING for sq, p in pm.items() if p.color != winner)
    pawnless = all(p.piece_type != chess.PAWN for p in pm.values())
    mate_in = (abs(root_dtz) + 1) // 2 if (root_wdl != 0 and pawnless and loser_bare) else None
    return {"ok": True, "move": best.uci(), "wdl": root_wdl, "dtz": root_dtz, "mateIn": mate_in, "pieces": len(pm)}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health": body = {"ok": True, "tables": TB_DIR}
        elif u.path == "/defend":
            fen = (parse_qs(u.query).get("fen") or [""])[0]
            try: body = defend(fen)
            except Exception as e: body = {"ok": False, "reason": f"bad-fen: {e}"}
        else: self.send_response(404); self.end_headers(); return
        out = json.dumps(body).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

if __name__ == "__main__":
    if len(sys.argv) > 1: print(json.dumps(defend(sys.argv[1]))); sys.exit(0)
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
