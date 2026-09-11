"""Scoresheet-specific legality beam: K-best OCR candidates × handwriting
confusions × chess legality, with an honest "unknown" when nothing fits.

Why not just dream_ocr.apply_chess_constraints?  That pass was built for
PRINTED pages: one reading per token, a figurine confusion table, and pages
where tokens may be prose. A scoresheet is different in four ways this module
uses: (1) every cell is a move, in order, from the initial position; (2) the
reader gives SEVERAL candidates per cell with probabilities; (3) the ink
confusions are pen-stroke ones (e/c, g/9, b/6, a/o, 4/5/6…); (4) players write
illegal moves, so the beam must be allowed to say "unknown" and carry on from
the coach's fix rather than invent a legal game.

Per cell the beam considers, cheapest first:
  cost 0   reader's top candidate
  cost 1-2 reader's 2nd/3rd candidate
  cost 3-5 a handwriting-confusion edit of any candidate
  cost 6   "unknown" — keep the ink text, do NOT advance the board.
           The next cell is then tried against the SAME board plus a
           one-ply lookahead: if it is legal after some legal move X, we
           accept X as the unknown's most likely identity but mark it
           `inferred`, never `verified`.

A move is `verified` only if every surviving competitive line agrees AND it
was the only legal candidate at that point AND it came from the reader (not
brute-forced). Mirrors the discipline in dream_ocr, kept here for scoresheets.
"""
from __future__ import annotations
import itertools, re
from dataclasses import dataclass, field
import chess

# Pen-stroke confusions seen in HCS reads (eval_scoresheet misread list).
FILE_ALT = {"a": "aod", "b": "bh6", "c": "ce", "d": "dao", "e": "ec", "f": "ft", "g": "g9q", "h": "hbn"}
RANK_ALT = {"1": "17l", "2": "27z", "3": "35", "4": "459", "5": "563", "6": "6b04", "7": "712", "8": "83"}
PIECE_ALT = {"K": "KRk", "Q": "QOD0", "R": "RKB", "B": "BR8", "N": "NMH"}
SAN_RE = re.compile(r"^(?:O-O-O|O-O)[+#]?$|^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?$")


def clean(s: str) -> str:
    s = re.sub(r"<\|[^|]*\|>", "", s).strip()
    s = re.sub(r"^\d{1,3}\.{0,3}\s+(?=[KQRBNa-hO0])", "", s)
    s = re.sub(r"^\d{1,3}\.{1,3}\s*(?=[KQRBNa-hO0])", "", s)
    s = s.replace(" ", "").replace("×", "x").replace(":", "x").replace("–", "-").replace("—", "-")
    if re.fullmatch(r"[0O]-[0O](-[0O])?[+#!?]*", s):
        s = s.replace("0", "O")
    s = re.sub(r"[!?]+$", "", s)
    return re.sub(r"^[kqrn](?=[a-h1-8x])", lambda m: m.group(0).upper(), s)


def edits(tok: str) -> list[str]:
    """All single-character handwriting confusions of a move-shaped token."""
    out = set()
    core = re.sub(r"[+#]+$", "", tok)
    for i, ch in enumerate(core):
        alts = ""
        if ch in FILE_ALT: alts += FILE_ALT[ch]
        if ch in RANK_ALT: alts += RANK_ALT[ch]
        if ch in PIECE_ALT: alts += PIECE_ALT[ch]
        if ch.lower() in FILE_ALT and ch.isupper(): alts += ch.lower()      # "E4" → e4
        for a in set(alts) - {ch}:
            out.add(core[:i] + a + core[i + 1:])
    # a dropped or added piece letter
    if core and core[0] in "KQRBN": out.add(core[1:])
    if core and core[0] in "abcdefgh":
        for p in "KQRBN": out.add(p + core)
    return [o for o in out if SAN_RE.match(o)]


@dataclass
class Cell:
    id: str
    cands: list[tuple[str, float]]          # (text, prob) best first
    san: str = ""                           # decided move, "" = unknown
    status: str = "unknown"                 # verified | agreed | inferred | unknown
    confidence: float = 0.0
    raw: str = ""
    inferred: str = ""                       # legal move the beam bridged with, when the ink itself did not parse


_SKIP = 6
_VOTE_MARGIN = 2


def read_sheet(cells: list[Cell], beam: int = 12) -> list[Cell]:
    # path = (board, cost, history, anchor) — anchor counts consecutive reader-legal
    # moves since the last unknown; a line that just lost the thread must earn
    # trust back before anything on it can be called verified.
    paths: list[tuple[chess.Board, int, list[tuple[str, bool, bool]], int]] = [(chess.Board(), 0, [], 99)]
    for ci, c in enumerate(cells):
        c.raw = c.cands[0][0] if c.cands else ""
        # candidate pool: reader K-best, then confusion edits of each, with costs
        # Two pools. Anchored lines (the board is trusted) may use 2nd/3rd
        # candidates and handwriting edits — legality is real evidence there.
        # Adrift lines (just after an unknown) may NOT: on a wrong board a
        # "legal alternative" is fiction, and measured on HCS this trap turned
        # correct raw reads into wrong legal moves (41 % vs 54 % raw).
        def make_pool(full: bool) -> dict[str, int]:
            pool: dict[str, int] = {}
            for k, (t, p) in enumerate(c.cands[:3] if full else c.cands[:1]):
                t = clean(t)
                if not t: continue
                pool.setdefault(t, k)                      # 0,1,2
                if full:
                    for e in edits(t): pool.setdefault(e, k + 3)   # never ties a reader candidate inside the vote margin
            return pool
        pool_full, pool_raw = make_pool(True), make_pool(False)
        nxt = []
        for board, cost, hist, anchor in paths:
            pool = pool_full if anchor >= 4 else pool_raw
            legal = []
            for t, ccost in pool.items():
                try: mv = board.parse_san(t)
                except Exception: continue
                legal.append((board.san(mv), mv, ccost, ccost < 3))
            for san, mv, ccost, from_reader in legal:
                b2 = board.copy(stack=False); b2.push(mv)
                unique = len(legal) == 1 and from_reader and anchor >= 4
                nxt.append((b2, cost + ccost, hist + [(san, unique, from_reader)], anchor + 1 if from_reader else 0))
            # unknown: keep the board, pay for it. One-ply lookahead happens
            # implicitly: the next cell is parsed against this same board only
            # if it is legal there; otherwise we try every legal move here as a
            # bridge (cost _SKIP+1) so a single unreadable cell does not sink
            # the rest of the sheet.
            nxt.append((board, cost + _SKIP, hist + [("", False, False)], 0))
            if ci + 1 < len(cells) and anchor >= 4:
                nxt_texts = [clean(t) for t, _ in cells[ci + 1].cands[:2]]
                for bridge in board.legal_moves:
                    b2 = board.copy(stack=False); b2.push(bridge)
                    if any(_parses(b2, t) for t in nxt_texts):
                        nxt.append((b2, cost + _SKIP + 1, hist + [("?" + board.san(bridge), False, False)], 0))
        nxt.sort(key=lambda p: p[1]); paths = nxt[:beam]
    best_cost = paths[0][1]
    votes: dict[int, set[str]] = {}
    for _b, cost, hist, _a in paths:
        if cost > best_cost + _VOTE_MARGIN: continue
        for i, (san, _u, _r) in enumerate(hist): votes.setdefault(i, set()).add(san)
    for i, (san, unique, from_reader) in enumerate(paths[0][2]):
        c = cells[i]; agreed = len(votes.get(i, ())) == 1
        if san.startswith("?"):
            # keep the INK as the answer; the bridge is a hint for the coach, not
            # a transcription. Replacing ink with a bridge was 36 damaged reads.
            c.inferred = san[1:]
            ink = clean(c.raw)
            c.san = ink if SAN_RE.match(ink) else san[1:]
            c.status, c.confidence = "inferred", 0.4
        elif san:
            c.san = san
            c.status = "verified" if (unique and agreed) else ("agreed" if agreed else "guess")
            c.confidence = 1.0 if c.status == "verified" else (0.8 if agreed else 0.5)
        else:
            # nothing legal fitted: keep what the ink says, flagged, so the coach
            # sees the player's move rather than a hole — and MRA is judged on
            # the ink, which is what HCS truth is.
            c.san, c.status, c.confidence = clean(c.raw), "unknown", 0.0
    return cells


def _parses(board: chess.Board, t: str) -> bool:
    try: board.parse_san(t); return True
    except Exception: return False


def merge_two_sheets(a: list[Cell], b: list[Cell]) -> list[Cell]:
    """Both players wrote the same game: where one copy is verified and the
    other is not, take the verified one; where they disagree and neither is
    verified, mark unknown so a coach looks."""
    out = []
    for x, y in itertools.zip_longest(a, b):
        if x is None: out.append(y); continue
        if y is None: out.append(x); continue
        rank = {"verified": 3, "agreed": 2, "guess": 1, "inferred": 1, "unknown": 0}
        if x.san == y.san: 
            best = x if rank[x.status] >= rank[y.status] else y; out.append(best); continue
        px, py = rank[x.status], rank[y.status]
        if px >= 3 and py < 3: out.append(x)
        elif py >= 3 and px < 3: out.append(y)
        else:
            z = Cell(x.id, x.cands, "", "unknown", 0.0, x.raw); out.append(z)
    return out
