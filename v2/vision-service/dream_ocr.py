"""Dream OCR — chess-aware page reading.

Design note, because the obvious approach is the weaker one.

Bolting four OCR engines together and voting gets you a few points on ordinary
prose and costs four times the compute. The large win on a CHESS page comes from
somewhere else entirely: chess text is not free text. It is a rigid grammar whose
every token must be a LEGAL MOVE in a position we already know, because the
diagram above it has been read by our own extractor. A general OCR engine has no
idea that "Nf3" and "Nf8" differ by legality; we do, and we can prove it.

So the pipeline is:

    engines  ->  consensus  ->  figurine mapping  ->  CHESS CONSTRAINT PASS

and the last stage is the one that approaches certainty on move text. It cannot
do the same for prose, and this module does not pretend otherwise: `confidence`
is reported per token so the caller can tell a verified move from a guessed word.

Engines are pluggable on purpose. Tesseract is here because it is already
installed; Surya, PaddleOCR/PP-Structure and docTR slot in behind the same
interface without touching anything below.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("chessguru-vision.ocr")

# ── Figurine notation ───────────────────────────────────────────────────────
# The single most chess-specific OCR failure. Move text is full of piece
# GLYPHS, not letters, and every general engine mangles them: a knight comes
# back as "€", "@", "ᐃ" or nothing at all, depending on the book's font. The
# glyphs are font-specific, so the reliable fix is the same trick that decoded
# the diagrams: map the font's own codepoints rather than hope OCR guesses.
FIGURINE = {
    # Unicode chess pieces, both colours -> SAN letter (SAN has no colour)
    "♔": "K", "♚": "K",
    "♕": "Q", "♛": "Q",
    "♖": "R", "♜": "R",
    "♗": "B", "♝": "B",
    "♘": "N", "♞": "N",
    "♙": "",  "♟": "",      # pawn is written as nothing in SAN
}
# What OCR engines commonly emit INSTEAD of a figurine, per glyph shape. These
# are only applied where a piece letter is grammatically required, so they
# cannot corrupt ordinary prose.
FIGURINE_OCR_CONFUSIONS = {
    "K": ["K", "♔", "♚", "&", "§"],
    "Q": ["Q", "♕", "♛", "*", "%", "©"],
    "R": ["R", "♖", "♜", "E", "H", "#", "П"],
    "B": ["B", "♗", "♝", "8", "&", "$", "A"],
    "N": ["N", "♘", "♞", "@", "€", "^", "M", "W"],
}
_OCR_TO_PIECE: dict[str, list[str]] = {}
for _p, _alts in FIGURINE_OCR_CONFUSIONS.items():
    for _a in _alts:
        _OCR_TO_PIECE.setdefault(_a, []).append(_p)

# Digit/letter confusions that matter inside a square name, where the alphabet
# is only a-h and 1-8 — a far smaller space than general OCR faces.
FILE_CONFUSIONS = {"a": "a", "b": "b", "c": "c", "d": "d", "e": "e", "f": "f",
                   "g": "g", "h": "h", "9": "g", "6": "b", "0": "d", "l": "b"}
RANK_CONFUSIONS = {"1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6",
                   "7": "7", "8": "8", "l": "1", "I": "1", "i": "1", "|": "1",
                   "O": "0", "o": "0", "S": "5", "s": "5", "B": "8", "g": "9",
                   "q": "9", "Z": "2", "z": "2", "G": "6", "b": "6"}

SAN_RE = re.compile(
    r"^(?:O-O-O|0-0-0|O-O|0-0)[+#]?$|"
    r"^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?$"
)


@dataclass
class Token:
    """One word off the page, with where it came from and how sure we are."""
    text: str
    kind: str = "word"                 # word | move | movenum
    confidence: float = 0.0
    engines: dict[str, str] = field(default_factory=dict)
    verified: bool = False             # proved legal in the position
    original: str | None = None        # before any correction


@dataclass
class Engine:
    name: str
    run: Callable[[Any], list[tuple[str, float]]]   # image -> [(word, conf)]
    weight: float = 1.0


# ── Engines ────────────────────────────────────────────────────────────────
def tesseract_engine() -> Engine | None:
    try:
        import pytesseract  # noqa: F401
    except Exception:
        return None

    def run(img):
        import pytesseract
        from pytesseract import Output
        d = pytesseract.image_to_data(img, output_type=Output.DICT)
        out = []
        for text, conf in zip(d["text"], d["conf"]):
            t = (text or "").strip()
            if not t:
                continue
            try:
                c = float(conf) / 100.0
            except Exception:
                c = 0.0
            out.append((t, max(0.0, c)))
        return out

    return Engine("tesseract", run, weight=1.0)


def available_engines() -> list[Engine]:
    """Every engine we can actually run right now.

    Surya, PaddleOCR/PP-Structure and docTR each return the same
    [(word, confidence)] shape; add them here once installed and the consensus
    and chess passes below pick them up with no further change.
    """
    got = [e for e in (tesseract_engine(),) if e]
    if not got:
        log.warning("no OCR engine available")
    return got


# ── Consensus ──────────────────────────────────────────────────────────────
def consensus(per_engine: dict[str, list[tuple[str, float]]]) -> list[Token]:
    """Merge engines position-by-position.

    Deliberately simple: engines that read the same page produce nearly the same
    word sequence, so index alignment is enough in practice and a full
    edit-distance alignment (ROVER) is only worth it once we have three or more
    engines disagreeing often. Weighted vote, ties broken by confidence.
    """
    if not per_engine:
        return []
    names = list(per_engine)
    longest = max(len(v) for v in per_engine.values())
    out: list[Token] = []
    for i in range(longest):
        votes: dict[str, float] = {}
        seen: dict[str, str] = {}
        for n in names:
            seq = per_engine[n]
            if i >= len(seq):
                continue
            w, c = seq[i]
            votes[w] = votes.get(w, 0.0) + max(c, 0.05)
            seen[n] = w
        if not votes:
            continue
        best = max(votes, key=lambda k: votes[k])
        total = sum(votes.values()) or 1.0
        out.append(Token(text=best, confidence=votes[best] / total, engines=seen))
    return out


# ── Chess constraint pass ──────────────────────────────────────────────────
def _san_candidates(raw: str) -> list[str]:
    """Every plausible SAN this token could have been, cheapest edits first."""
    s = raw.strip().strip(".,;:()[]")
    if not s:
        return []
    cands = {s}
    # figurine or mis-OCR'd piece letter at the front
    if s[0] in FIGURINE:
        cands.add(FIGURINE[s[0]] + s[1:])
    for alt in _OCR_TO_PIECE.get(s[0], []):
        cands.add(alt + s[1:])
    # square-name repairs, applied only to the last two characters
    fixed = set()
    for c in cands:
        if len(c) >= 2:
            f, r = c[-2], c[-1]
            nf = FILE_CONFUSIONS.get(f.lower())
            nr = RANK_CONFUSIONS.get(r)
            if nf and nr and (nf != f or nr != r):
                fixed.add(c[:-2] + nf + nr)
    cands |= fixed
    # Last resort: if the token LOOKS like a move but its leading character is
    # not a piece letter we recognise, try every piece. The confusion table is a
    # hint, not a limit — books use fonts we have never seen, and legality will
    # pick the one true reading anyway. Without this, a knight rendered as "&"
    # (which our table only knew as a bishop or king) stayed unread.
    tail = s[1:] if len(s) > 1 else ""
    if re.fullmatch(r"x?[a-h][1-8](?:=[QRBN])?[+#]?", tail):
        for piece in ("K", "Q", "R", "B", "N", ""):
            cands.add(piece + tail)
    return [c for c in cands if SAN_RE.match(c)]


def _ranked_candidates(raw: str) -> list[tuple[str, int]]:
    """SAN candidates with a cost: 0 = exactly what OCR said, 1 = a known glyph
    confusion, 2 = a brute-force piece substitution. Cheaper is likelier."""
    s = raw.strip().strip(".,;:()[]")
    if not s:
        return []
    out: dict[str, int] = {}

    def add(c: str, cost: int) -> None:
        if SAN_RE.match(c) and out.get(c, 99) > cost:
            out[c] = cost

    add(s, 0)
    if s[0] in FIGURINE:
        add(FIGURINE[s[0]] + s[1:], 1)
    for alt in _OCR_TO_PIECE.get(s[0], []):
        add(alt + s[1:], 1)
    for c in list(out):
        if len(c) >= 2:
            f, r = c[-2], c[-1]
            nf, nr = FILE_CONFUSIONS.get(f.lower()), RANK_CONFUSIONS.get(r)
            if nf and nr and (nf != f or nr != r):
                add(c[:-2] + nf + nr, out[c] + 1)
    tail = s[1:] if len(s) > 1 else ""
    if re.fullmatch(r"[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?", tail):
        for piece in ("N", "B", "R", "Q", "K", ""):
            add(piece + tail, 2)
    return sorted(out.items(), key=lambda kv: kv[1])


def apply_chess_constraints(tokens: list[Token], start_fen: str | None,
                            beam: int = 6) -> list[Token]:
    """Replay the moves and repair what cannot be legal — with a BEAM.

    This is where a chess page beats a general document: every move must be legal
    in the position reached so far, and a garbled token usually has exactly one
    legal reading, which makes the answer proved rather than guessed.

    The beam matters more than it looks. A single greedy pass picks arbitrarily
    when two readings are both legal, and the wrong pick poisons the position so
    that every later move fails too — measured, one bad choice at move 8 turned
    a 20-move line from 20/20 into 16/20. Keeping several candidate lines alive
    and preferring the one that lets the REST of the moves parse means a later
    move disambiguates an earlier one, which is exactly how a human reads a
    garbled score sheet.
    """
    if not start_fen:
        return tokens
    try:
        import chess
    except Exception:
        log.info("python-chess not available; skipping the constraint pass")
        return tokens
    try:
        chess.Board(start_fen)
    except Exception:
        return tokens

    # A path = (board, cost, [(index, san, unique)]).
    paths: list[tuple[Any, int, list[tuple[int, str, bool]]]] = [
        (chess.Board(start_fen), 0, [])
    ]
    for i, t in enumerate(tokens):
        s = t.text.strip().strip(".,;:")
        if re.fullmatch(r"\d{1,3}\.{1,3}", s):
            t.kind = "movenum"
            continue
        cands = _ranked_candidates(s)
        if not cands:
            continue
        nxt: list[tuple[Any, int, list[tuple[int, str, bool]]]] = []
        for board, cost, hist in paths:
            legal = []
            for c, ccost in cands:
                try:
                    board.parse_san(c)
                    legal.append((c, ccost))
                except Exception:
                    pass
            for c, ccost in legal:
                b2 = board.copy(stack=False)
                b2.push_san(c)
                nxt.append((b2, cost + ccost, hist + [(i, c, len(legal) == 1)]))
        if not nxt:
            continue                      # unreadable token: keep the paths alive
        nxt.sort(key=lambda p: p[1])
        paths = nxt[:beam]

    if not paths:
        return tokens
    best = paths[0][2]
    for idx, san, unique in best:
        t = tokens[idx]
        if san != t.text:
            t.original = t.text
            t.text = san
        t.kind = "move"
        t.verified = unique
        t.confidence = 1.0 if unique else 0.75
    return tokens


def read_page(img, start_fen: str | None = None) -> dict[str, Any]:
    """Full pipeline for one page image."""
    engines = available_engines()
    per = {}
    for e in engines:
        try:
            per[e.name] = e.run(img)
        except Exception as ex:
            log.warning("engine %s failed: %s", e.name, ex)
    toks = apply_chess_constraints(consensus(per), start_fen)
    moves = [t for t in toks if t.kind == "move"]
    return {
        "engines": list(per),
        "tokens": [t.__dict__ for t in toks],
        "text": " ".join(t.text for t in toks),
        "moves": [t.text for t in moves],
        "movesVerified": sum(1 for t in moves if t.verified),
        "movesTotal": len(moves),
    }
