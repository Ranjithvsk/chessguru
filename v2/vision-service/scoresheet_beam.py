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
import itertools, math, re
from dataclasses import dataclass, field
import chess

# Pen-stroke confusions MEASURED on the fine-tuned reader's held-out misreads
# (run3, single-character substitutions, truth→read): d↔g 7, 3↔5 7, 4↔7 6,
# d↔a 6, b↔B/h 5, c↔e 4, f↔e 4, B↔R 4, c↔g 4, g↔a/f/e 3, 2↔7 3, 4↔1 3, 3↔2 3.
FILE_ALT = {"a": "adgo", "b": "bh6", "c": "cegd", "d": "dagc", "e": "ecfg", "f": "feg", "g": "gdaef9", "h": "hbn"}
RANK_ALT = {"1": "147l", "2": "273", "3": "3527", "4": "4719", "5": "536", "6": "6b0", "7": "7421", "8": "83"}
PIECE_ALT = {"K": "KBR", "Q": "QO0", "R": "RBK", "B": "BRK8", "N": "NM"}


def _symmetrise(table: dict) -> dict:
    """Confusions run both ways: if d is read as g, g is read as d. The measured
    table only lists truth→read, so close it under reversal (and add every
    reverse key, e.g. 'o' → 'a', which a raw ink read may contain)."""
    out = {k: set(v) for k, v in table.items()}
    for k, v in table.items():
        for ch in v:
            out.setdefault(ch, set()).add(ch); out[ch].add(k)
    return {k: "".join(sorted(v)) for k, v in out.items()}


FILE_ALT, RANK_ALT, PIECE_ALT = _symmetrise(FILE_ALT), _symmetrise(RANK_ALT), _symmetrise(PIECE_ALT)
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


def read_sheet(cells: list[Cell], beam: int = 12, override: bool = False) -> list[Cell]:
    """Annotate (and, only if `override`, correct) a sheet's reads.

    Measured on 1,675 held-out HCS cells with the fine-tuned reader: letting
    the beam REPLACE ink reads cost ~1 point at move level (89.5 → 88.6),
    because a legal alternative on an uncertain board is fiction more often
    than the reader is wrong. So by default the ink read stays the answer and
    the beam contributes STATUS only: verified / agreed / guess / inferred /
    unknown. `override=True` restores the older behaviour for experiments."""
    cells = _read_sheet(cells, beam)
    if not override:
        for c in cells:
            ink = clean(c.raw)
            if SAN_RE.match(ink) and c.san != ink:
                c.inferred = c.san or c.inferred
                c.san = ink
                if c.status == "verified": c.status = "guess"; c.confidence = 0.5
    return cells


def _read_sheet(cells: list[Cell], beam: int = 12) -> list[Cell]:
    # path = (board, cost, history, anchor) — anchor counts consecutive reader-legal
    # moves since the last unknown; a line that just lost the thread must earn
    # trust back before anything on it can be called verified.
    paths: list[tuple[chess.Board, float, list[tuple[str, bool, bool]], int]] = [(chess.Board(), 0.0, [], 99)]
    ci = -1
    while ci + 1 < len(cells):
        ci += 1
        c = cells[ci]
        c.raw = c.cands[0][0] if c.cands else ""
        # a line whose history is already past this cell (a 2-cell bridge) just carries over
        carry = [p for p in paths if len(p[2]) > ci]
        if carry and len(carry) == len(paths):
            continue
        # candidate pool: reader K-best, then confusion edits of each, with costs
        # Two pools. Anchored lines (the board is trusted) may use 2nd/3rd
        # candidates and handwriting edits — legality is real evidence there.
        # Adrift lines (just after an unknown) may NOT: on a wrong board a
        # "legal alternative" is fiction, and measured on HCS this trap turned
        # correct raw reads into wrong legal moves (41 % vs 54 % raw).
        # Costs come from the reader's own probabilities. A confident top read
        # that is illegal is almost always the PLAYER's error (30 of 40 HCS
        # sheets contain one), so alternatives must get expensive as p_top
        # rises, and "unknown — keep the ink" must become the cheap move.
        # Rank-based costs. TrOCR's beam scores are length-normalised log-probs
        # and every alternative comes back near 1.0, so they cannot price the
        # candidates; the ORDER can. Unknown (keep the ink) sits between the
        # 2nd candidate and an edit: a confident illegal read is most often the
        # player's error, and only a clearly plausible alternative may override it.
        unk_cost = 5.0
        RANK_COST = {0: 0.0, 1: 3.5, 2: 4.5}
        def make_pool(full: bool) -> dict[str, float]:
            pool: dict[str, float] = {}
            for k, (t, pk) in enumerate(c.cands[:3] if full else c.cands[:1]):
                t = clean(t)
                if not t: continue
                pool.setdefault(t, RANK_COST[k])
                if full:
                    for e in edits(t): pool.setdefault(e, RANK_COST[k] + 6.0)
            return pool
        pool_full, pool_raw = make_pool(True), make_pool(False)
        nxt = []
        for board, cost, hist, anchor in paths:
            pool = pool_full if anchor >= 4 else pool_raw
            legal = []
            for t, ccost in pool.items():
                try: mv = board.parse_san(t)
                except Exception: continue
                legal.append((board.san(mv), mv, ccost, ccost < 3.0))          # from the reader, not an edit
            for san, mv, ccost, from_reader in legal:
                b2 = board.copy(stack=False); b2.push(mv)
                unique = len(legal) == 1 and from_reader and anchor >= 4
                # trust grows only on top reads that were legal as written; any
                # override (2nd candidate, edit) resets it so a wrong fix cannot
                # drag a confident-looking line across the rest of the sheet.
                nxt.append((b2, cost + ccost, hist + [(san, unique, from_reader)], anchor + 1 if ccost == 0.0 else 0))
            # unknown: keep the board, pay for it.
            nxt.append((board, cost + unk_cost, hist + [("", False, False)], 0))
            # RESYNC. A frozen board strands every later cell (42 % of held-out
            # cells sat adrift). So when nothing fits, look for the one legal
            # move — or two — after which the next few raw reads are all legal
            # again. Those reads are the evidence; the bridge itself is only
            # ever `inferred`, and the line restarts with low trust.
            if not legal and anchor >= 0:
                ink_edits = set(edits(clean(c.raw))) if c.raw else set()
                bridges = _resync(board, cells, ci, confirm=3)
                for bridge_hist, b2 in bridges:
                    first = bridge_hist[0][0][1:]
                    matches_ink = first in ink_edits or (SAN_RE.match(clean(c.raw) or "") and first == clean(c.raw))
                    # an ink-compatible bridge is cheap; an arbitrary one among several is dear
                    extra = 0.5 if matches_ink else (1.0 if len(bridges) == 1 else 3.0)
                    tag = "?" if matches_ink or len(bridges) == 1 else "??"
                    bh = [(tag + h[0][1:], h[1], h[2]) for h in bridge_hist]
                    nxt.append((b2, cost + unk_cost + extra * len(bh), hist + bh, 1))
        nxt += [p for p in paths if len(p[2]) > ci]          # lines already past this cell
        nxt.sort(key=lambda p: p[1]); paths = nxt[:beam]
    best_cost = paths[0][1]
    votes: dict[int, set[str]] = {}
    for _b, cost, hist, _a in paths:
        if cost > best_cost + _VOTE_MARGIN: continue
        for i, (san, _u, _r) in enumerate(hist): votes.setdefault(i, set()).add(san)
    for i, (san, unique, from_reader) in enumerate(paths[0][2]):
        c = cells[i]; agreed = len(votes.get(i, ())) == 1
        if san.startswith("??"):
            # an arbitrary bridge among several: the board moved on, but this
            # cell is a hole for the coach, not a transcription
            c.inferred = san[2:]; ink = clean(c.raw)
            c.san = ink if SAN_RE.match(ink) else ""
            c.status, c.confidence = "unknown", 0.0
        elif san.startswith("?"):
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


def _raw_texts(cells: list[Cell], i: int) -> list[str]:
    return [clean(t) for t, _ in cells[i].cands[:2]] if 0 <= i < len(cells) else []


def _confirms(board: chess.Board, cells: list[Cell], start: int, n: int) -> bool:
    """Do the next n raw reads all parse as legal, one after another?"""
    b = board.copy(stack=False)
    for j in range(start, min(start + n, len(cells))):
        ok = False
        for t in _raw_texts(cells, j):
            try:
                b.push(b.parse_san(t)); ok = True; break
            except Exception:
                pass
        if not ok:
            return False
    return True


_RESYNC_CACHE: dict = {}


def _resync(board: chess.Board, cells: list[Cell], i: int, confirm: int = 3) -> list[tuple[list, chess.Board]]:
    key = (board.fen(), i, id(cells))
    if key in _RESYNC_CACHE:
        return [(h, b.copy(stack=False)) for h, b in _RESYNC_CACHE[key]]
    res = _resync_uncached(board, cells, i, confirm)
    if len(_RESYNC_CACHE) > 50000: _RESYNC_CACHE.clear()
    _RESYNC_CACHE[key] = res
    return [(h, b.copy(stack=False)) for h, b in res]


def _resync_uncached(board: chess.Board, cells: list[Cell], i: int, confirm: int = 3) -> list[tuple[list, chess.Board]]:
    """Bridges of one or two legal moves over unreadable cells i (and i+1) such
    that the following `confirm` reads are legal. Returns (history, board)."""
    out = []
    if i + confirm >= len(cells) + 1:
        return out
    for x in board.legal_moves:
        b1 = board.copy(stack=False); sx = board.san(x); b1.push(x)
        if _confirms(b1, cells, i + 1, confirm):
            out.append(([("?" + sx, False, False)], b1))
    if not out and i + 1 < len(cells) and any(SAN_RE.match(t) for t in _raw_texts(cells, i + 2)):
        for x in board.legal_moves:
            b1 = board.copy(stack=False); sx = board.san(x); b1.push(x)
            for y in b1.legal_moves:
                b2 = b1.copy(stack=False); sy = b1.san(y); b2.push(y)
                if _confirms(b2, cells, i + 2, confirm):
                    out.append(([("?" + sx, False, False), ("?" + sy, False, False)], b2))
        if len(out) > 3:          # too ambiguous to be worth anything
            out = []
    return out[:3]


def _parses(board: chess.Board, t: str) -> bool:
    try: board.parse_san(t); return True
    except Exception: return False


def merge_two_sheets(a: list[Cell], b: list[Cell]) -> list[Cell]:
    """Both players wrote the same game. Agreement raises confidence; a verified
    copy beats an unverified one; otherwise keep the better-supported reading
    (status rank, then reader probability) but downgrade it to a guess so the
    coach's eye lands on it. Never answer with nothing — an empty cell was
    measured to cost 37 points against simply keeping the stronger read."""
    rank = {"verified": 3, "agreed": 2, "guess": 1, "inferred": 1, "unknown": 0}
    out = []
    for x, y in itertools.zip_longest(a, b):
        if x is None: out.append(y); continue
        if y is None: out.append(x); continue
        if x.san == y.san:
            best = x if rank[x.status] >= rank[y.status] else y
            z = Cell(best.id, best.cands, best.san, best.status, best.confidence, best.raw, best.inferred)
            if z.status in ("guess", "inferred", "agreed") and x.san:   # two independent hands agree
                z.status, z.confidence = "agreed", max(z.confidence, 0.85)
            out.append(z); continue
        px, py = rank[x.status], rank[y.status]
        if px != py:
            w = x if px > py else y
        else:
            cx = x.cands[0][1] if x.cands else 0.0; cy = y.cands[0][1] if y.cands else 0.0
            w = x if cx >= cy else y
        z = Cell(w.id, w.cands, w.san, "guess" if w.status != "verified" else "verified", min(w.confidence, 0.5) if w.status != "verified" else 1.0, w.raw, w.inferred)
        out.append(z)
    return out
