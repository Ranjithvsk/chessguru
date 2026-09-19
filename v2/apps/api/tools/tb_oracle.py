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

# ---- advice on the student's move (owner 2026-09-19: "advise the mistake … give reason") -------
FILES = "abcdefgh"
def cheb(a, b): return max(abs(chess.square_file(a) - chess.square_file(b)), abs(chess.square_rank(a) - chess.square_rank(b)))
def edge_dist(sq): f, r = chess.square_file(sq), chess.square_rank(sq); return min(f, 7 - f, r, 7 - r)
def box(b, us):
    """Squares the lone king (not `us`) keeps once our rook/queen's rank and file fence it in."""
    them = not us; ek = b.king(them)
    heavy = [sq for sq, p in b.piece_map().items() if p.color == us and p.piece_type in (chess.ROOK, chess.QUEEN)]
    if ek is None or not heavy: return 64
    best = 64
    for h in heavy:
        hf, hr, kf, kr = chess.square_file(h), chess.square_rank(h), chess.square_file(ek), chess.square_rank(ek)
        if hf == kf or hr == kr: continue           # king on the piece's line: no fence
        files = hf if kf < hf else 7 - hf
        ranks = hr if kr < hr else 7 - hr
        best = min(best, files * ranks)
    return best
def hangs(b, us):
    them = not us; ek = b.king(them)
    for sq, p in b.piece_map().items():
        if p.color == us and p.piece_type != chess.KING and ek is not None and cheb(sq, ek) == 1 and not b.is_attacked_by(us, sq): return True
    return False
def opposition(b, us):
    """We hold the opposition: kings on one file/rank with one square between and THEM to move."""
    ok, ek = b.king(us), b.king(not us)
    if ok is None or ek is None or b.turn == us: return False
    df, dr = abs(chess.square_file(ok) - chess.square_file(ek)), abs(chess.square_rank(ok) - chess.square_rank(ek))
    return (df == 0 and dr == 2) or (dr == 0 and df == 2)
def outcome_key(b, us):
    """(class, tiebreak) for a position with THEM to move, from OUR side: higher is better."""
    if b.is_checkmate(): return (3, 0)
    if b.is_stalemate() or b.is_insufficient_material(): return (2, 0)
    wdl = -tb.probe_wdl(b); dtz = tb.probe_dtz(b)
    return (3, -abs(dtz)) if wdl > 0 else (2, 0) if wdl == 0 else (1, abs(dtz))
def line_from(b, plies=3):
    out = []; c = b.copy()
    for _ in range(plies):
        if c.is_game_over() or len(c.piece_map()) > 5: break
        r = defend(c.fen())
        if not r.get("ok"): break
        mv = chess.Move.from_uci(r["move"]); out.append(c.san(mv)); c.push(mv)
    return out
def advise(fen, uci):
    b = chess.Board(fen)
    if len(b.piece_map()) > 5 or b.castling_rights: return {"ok": False, "reason": "not-in-tablebase"}
    try: mv = chess.Move.from_uci(uci)
    except ValueError: return {"ok": False, "reason": "bad-move"}
    if mv not in b.legal_moves: return {"ok": False, "reason": "illegal"}
    us = b.turn
    try: before_wdl = tb.probe_wdl(b); before_dtz = tb.probe_dtz(b)
    except (KeyError, chess.syzygy.MissingTableError): return {"ok": False, "reason": "not-in-tablebase"}
    keys = {}
    for m in b.legal_moves:
        b.push(m)
        try: keys[m] = outcome_key(b, us)
        except (KeyError, chess.syzygy.MissingTableError): keys[m] = (0, 0)
        b.pop()
    best = max(keys, key=lambda m: keys[m]); kb, kp = keys[best], keys[mv]
    def mate_moves(key): return (abs(key[1]) + 1) // 2 if key[0] == 3 and key[1] != 0 else (0 if key == (3, 0) else None)
    mate_best, mate_played = mate_moves(kb), mate_moves(kp)     # moves still needed AFTER the move (0 = the move mates)
    lost = (mate_played - mate_best) if (mate_best is not None and mate_played is not None) else None
    # In words we count from BEFORE the move, the way players say it: "mate in 1" = this move mates.
    total_best = mate_best + 1 if mate_best is not None else None
    total_played = mate_played + 1 if mate_played is not None else None
    if kp == kb or (kp[0] == kb[0] == 3 and lost == 0): verdict = "best"
    elif kp[0] < kb[0]: verdict = "blunder"
    elif lost is not None and lost >= 3: verdict = "mistake"
    else: verdict = "inaccuracy"
    # ---- why (rule-based, from concrete features of the two resulting positions) ----
    pb = b.copy(); pb.push(best); pp = b.copy(); pp.push(mv)
    san_b, san_p = b.san(best), b.san(mv)
    pawnless = all(p.piece_type != chess.PAWN for p in b.piece_map().values())
    why = None
    if verdict != "best":
        if pp.is_stalemate(): why = f"Stalemate — after {san_p} the king has no legal move and the game is drawn. Always leave it a square while your king comes closer."
        elif hangs(pp, us) and kp[0] < 3: why = f"After {san_p} your piece stands next to the enemy king with nothing guarding it — it can simply be taken. Keep it a knight's-move away or covered by your king."
        elif pawnless and box(pp, us) > box(pb, us): why = f"{san_b} fences the king into {box(pb, us)} squares; after {san_p} it still roams {box(pp, us)}. Cut the king off with the rook first, then bring your king."
        elif pawnless and edge_dist(pp.king(not us)) > edge_dist(pb.king(not us)): why = f"{san_p} lets the king walk back toward the centre; {san_b} keeps it on the edge."
        elif pawnless and b.piece_at(mv.from_square).piece_type == chess.KING and b.piece_at(best.from_square).piece_type == chess.KING and cheb(pb.king(us), pb.king(not us)) < cheb(pp.king(us), pp.king(not us)):
            why = f"Bring your king the short way: {san_b} puts the kings {cheb(pb.king(us), pb.king(not us))} apart, {san_p} leaves them {cheb(pp.king(us), pp.king(not us))}."
        elif pawnless and b.piece_at(mv.from_square).piece_type != chess.KING and b.piece_at(best.from_square).piece_type == chess.KING:
            why = f"The box is already tight — this rook move only passes the turn. Use it to bring your king: {san_b}."
        elif not pawnless and opposition(pb, us) and not opposition(pp, us): why = f"{san_b} takes the opposition (kings two squares apart, the other side to move); {san_p} gives it up."
        elif not pawnless and b.piece_at(mv.from_square).piece_type == chess.PAWN and b.piece_at(best.from_square).piece_type == chess.KING: why = f"Pushed the pawn too early — the king must lead: {san_b}."
        if why is None:
            if kp[0] < kb[0]: why = f"{san_p} throws the win away — {san_b} still wins" + (f" (mate in {total_best})" if total_best else "") + "."
            elif lost: why = f"{san_p} gives {lost} {'tempo' if lost == 1 else 'tempi'} away: mate in {total_best} was there with {san_b}, now it is mate in {total_played}."
    return {"ok": True, "verdict": verdict, "move": san_p, "best": san_b, "bestUci": best.uci(), "lostTempi": lost,
            "mateBefore": (abs(before_dtz) + 1) // 2 if before_wdl > 0 and pawnless else None,
            "mateWithBest": total_best, "mateWithPlayed": total_played, "mateAfterBest": mate_best, "mateAfterPlayed": mate_played,
            "resultBefore": "win" if before_wdl > 0 else "draw" if before_wdl == 0 else "loss",
            "resultAfter": "win" if kp[0] == 3 else "draw" if kp[0] == 2 else "loss",
            "why": why, "bestLine": [san_b] + line_from(pb, 2)}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health": body = {"ok": True, "tables": TB_DIR}
        elif u.path == "/defend":
            fen = (parse_qs(u.query).get("fen") or [""])[0]
            try: body = defend(fen)
            except Exception as e: body = {"ok": False, "reason": f"bad-fen: {e}"}
        elif u.path == "/advise":
            q = parse_qs(u.query); fen = (q.get("fen") or [""])[0]; mv = (q.get("move") or [""])[0]
            try: body = advise(fen, mv)
            except Exception as e: body = {"ok": False, "reason": f"bad-input: {e}"}
        else: self.send_response(404); self.end_headers(); return
        out = json.dumps(body).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

if __name__ == "__main__":
    if len(sys.argv) > 2: print(json.dumps(advise(sys.argv[1], sys.argv[2]))); sys.exit(0)
    if len(sys.argv) > 1: print(json.dumps(defend(sys.argv[1]))); sys.exit(0)
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
