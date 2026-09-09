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

import difflib
import logging
import os
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
# A rank is 1-8 and NOTHING else, so a confusion that lands on 0 or 9 is dead
# weight — it can never form a legal square. Every value here is in range.
RANK_CONFUSIONS = {"1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6",
                   "7": "7", "8": "8", "l": "1", "I": "1", "i": "1", "|": "1",
                   "!": "1", "S": "5", "s": "5", "B": "8", "&": "8", "Z": "2",
                   "z": "2", "G": "6", "b": "6", "T": "7", "?": "7", "A": "4",
                   "q": "4", "E": "3", "O": "8", "o": "8"}

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


# Loaded models are expensive (Surya pulls ~1 GB of weights) so they are built
# once, on first use, and kept. Nothing here loads at import time — the live
# scanner imports this module and must not pay for models it will never call.
_MODELS: dict[str, Any] = {}


def _pil(img):
    """Engines want a PIL RGB image; our pipeline passes OpenCV BGR arrays."""
    from PIL import Image
    if hasattr(img, "shape"):
        arr = img
        if getattr(arr, "ndim", 0) == 3 and arr.shape[2] == 3:
            arr = arr[:, :, ::-1]
        return Image.fromarray(arr.astype("uint8"))
    return img


def surya_engine() -> Engine | None:
    """Surya — transformer OCR, strongest of the four on unusual layouts."""
    try:
        import surya.recognition  # noqa: F401
    except Exception:
        return None

    def run(img):
        if "surya" not in _MODELS:
            from surya.detection import DetectionPredictor
            from surya.recognition import RecognitionPredictor
            try:
                # 0.16+ splits the shared vision backbone into its own object
                # and expects it injected; older builds construct it themselves.
                from surya.foundation import FoundationPredictor
                rec_p = RecognitionPredictor(FoundationPredictor())
            except Exception:
                rec_p = RecognitionPredictor()
            _MODELS["surya"] = (rec_p, DetectionPredictor())
        rec, det = _MODELS["surya"]
        page_img = _pil(img)
        pages = None
        errs = []
        # Surya's call signature has changed repeatedly across releases, so try
        # the known shapes rather than pin a version we would have to chase.
        for attempt in (lambda: rec([page_img], det_predictor=det),
                        lambda: rec([page_img]),
                        lambda: rec([page_img], full_page=True)):
            try:
                pages = attempt()
                break
            except Exception as ex:
                errs.append(str(ex)[:120])
        if pages is None:
            log.warning("surya produced nothing: %s", "; ".join(errs))
        out = []
        for page in pages or []:
            for line in getattr(page, "text_lines", None) or []:
                conf = float(getattr(line, "confidence", 0.0) or 0.0)
                for w in (getattr(line, "text", "") or "").split():
                    out.append((w, conf))
        return out

    return Engine("surya", run, weight=1.3)


def doctr_engine() -> Engine | None:
    """docTR — word-level boxes and per-word confidence, which suits voting."""
    try:
        import doctr  # noqa: F401
    except Exception:
        return None

    def run(img):
        import numpy as np
        if "doctr" not in _MODELS:
            from doctr.models import ocr_predictor
            _MODELS["doctr"] = ocr_predictor(pretrained=True)
        model = _MODELS["doctr"]
        arr = np.array(_pil(img))
        res = model([np.ascontiguousarray(arr)])
        out = []
        for page in res.export().get("pages", []):
            for blk in page.get("blocks", []):
                for line in blk.get("lines", []):
                    for w in line.get("words", []):
                        t = (w.get("value") or "").strip()
                        if t:
                            out.append((t, float(w.get("confidence") or 0.0)))
        return out

    return Engine("doctr", run, weight=1.2)


def paddle_engine() -> Engine | None:
    """PaddleOCR / PP-Structure — fastest here, and the layout model is the one
    worth having when a page mixes diagrams, columns and tables."""
    try:
        import paddleocr  # noqa: F401
    except Exception:
        return None

    def run(img):
        import numpy as np
        if "paddle" not in _MODELS:
            # oneDNN is Paddle's default CPU backend and it dies on this box
            # with "ConvertPirAttribute2RuntimeAttribute not support" the moment
            # text detection runs. Turning it off costs a little speed and makes
            # the engine work at all.
            os.environ.setdefault("FLAGS_use_mkldnn", "0")
            from paddleocr import PaddleOCR
            try:
                _MODELS["paddle"] = PaddleOCR(lang="en", enable_mkldnn=False)
            except TypeError:
                _MODELS["paddle"] = PaddleOCR(lang="en")
        ocr = _MODELS["paddle"]
        arr = np.array(_pil(img))[:, :, ::-1]        # back to BGR for paddle
        res = None
        errs = []
        for attempt in (lambda: ocr.predict(arr), lambda: ocr.ocr(arr)):
            try:
                res = attempt()
                break
            except Exception as ex:
                errs.append(str(ex)[:120])
        if res is None:
            # An engine that fails silently is worse than one that is absent:
            # the page still reads, just worse, and nobody ever finds out.
            log.warning("paddle produced nothing: %s", "; ".join(errs))
        out = []
        for page in res or []:
            d = page
            if not isinstance(d, dict):
                d = getattr(page, "json", None) or getattr(page, "res", None) or {}
                if isinstance(d, dict) and "res" in d:
                    d = d["res"]
            if not isinstance(d, dict):
                continue
            texts = d.get("rec_texts") or []
            scores = d.get("rec_scores") or []
            for t, sc in zip(texts, scores):
                for w in str(t).split():
                    out.append((w, float(sc)))
        return out

    return Engine("paddle", run, weight=1.2)


def available_engines() -> list[Engine]:
    """Every engine we can actually run right now.

    All four return the same [(word, confidence)] shape, so the consensus and
    chess passes below neither know nor care which ones ran. An engine whose
    package is not installed simply returns None here — which is why the live
    scanner, whose venv has only Tesseract, imports this module safely.
    """
    got = [e for e in (tesseract_engine(), doctr_engine(),
                       paddle_engine(), surya_engine()) if e]
    if not got:
        log.warning("no OCR engine available")
    return got


# ── Consensus ──────────────────────────────────────────────────────────────
def consensus(per_engine: dict[str, list[tuple[str, float]]],
              weights: dict[str, float] | None = None) -> list[Token]:
    """Merge engines by ALIGNING their word sequences, not by index.

    The first version voted position-by-position on the assumption that engines
    reading the same page produce nearly the same sequence. Measuring four
    engines on one book page killed that assumption outright: they returned 55,
    40, 41 and 40 words, and not in the same order — Surya put the page number
    before the running head, docTR dropped it, Paddle inserted a stray glyph
    from the diagram. Voting on index 3 of four sequences like that compares
    words from different parts of the page and produces confident nonsense.

    So: take the engine carrying the most confidence mass as the spine, align
    each other engine to it with a longest-matching-block diff, and vote only
    where the alignment actually pairs words up. Insertions and deletions are
    left alone rather than forced into a slot they do not belong in.
    """
    if not per_engine:
        return []
    weights = weights or {}
    live = {n: v for n, v in per_engine.items() if v}
    if not live:
        return []

    def quality(n: str) -> float:
        """MEAN confidence, not total. Total rewards whichever engine wrote the
        most words, and on a chess page the most verbose engine is the one
        hallucinating text off the DIAGRAM — Tesseract reads a board as
        'Vi, Wi, Wi, Ui "O86 @ U27)'. Picking it as the spine drags that noise
        into the merged page. Mean confidence picks the cleanest reader."""
        seq = live[n]
        return (sum(c for _, c in seq) / len(seq)) * weights.get(n, 1.0)

    spine_name = max(live, key=quality)
    spine = live[spine_name]
    spine_words = [w for w, _ in spine]

    # votes[i][word] -> accumulated weight, and who said it
    votes: list[dict[str, float]] = [
        {w: max(c, 0.05) * weights.get(spine_name, 1.0)} for w, c in spine
    ]
    said: list[dict[str, str]] = [{spine_name: w} for w, _ in spine]

    for name, seq in live.items():
        if name == spine_name:
            continue
        other_words = [w for w, _ in seq]
        sm = difflib.SequenceMatcher(a=spine_words, b=other_words, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal" or (tag == "replace" and (i2 - i1) == (j2 - j1)):
                for k in range(i2 - i1):
                    w, c = seq[j1 + k]
                    idx = i1 + k
                    votes[idx][w] = (votes[idx].get(w, 0.0)
                                     + max(c, 0.05) * weights.get(name, 1.0))
                    said[idx][name] = w
            # insert / delete / ragged replace: no honest pairing exists, skip

    out: list[Token] = []
    for idx, v in enumerate(votes):
        if not v:
            continue
        best = max(v, key=lambda k: v[k])
        total = sum(v.values()) or 1.0
        out.append(Token(text=best, confidence=v[best] / total,
                         engines=dict(said[idx])))
    return out


# ── Chess constraint pass ──────────────────────────────────────────────────
# Cost of guessing a piece with no glyph evidence at all. Deliberately above
# any combination of table-backed repairs (max 1 + 2) so the two never tie.
_BRUTE = 5

_CASTLE_RE = re.compile(r"^[O0oQD°]\-[O0oQD°](\-[O0oQD°])?[+#]?$")


def _square_variants(body: str) -> list[tuple[str, int]]:
    """Repair the destination square of a move body, with a cost.

    Everything after the piece letter ends in a square, and a square is drawn
    from an eight-by-eight alphabet — a far smaller space than general OCR
    faces, which is why a confusion table works here and would not work on
    prose. Any check, mate or promotion marker is set aside first so the last
    two characters really are the square.
    """
    out = [(body, 0)]
    core, suf = body, ""
    m = re.search(r"[+#]+$", core)
    if m:
        core, suf = core[:m.start()], core[m.start():]
    promo = ""
    m = re.search(r"=(.)$", core)
    if m:
        promo, core = core[m.start():], core[:m.start()]
    if len(core) >= 2:
        f, r = core[-2], core[-1]
        nf = FILE_CONFUSIONS.get(f) or FILE_CONFUSIONS.get(f.lower())
        nr = RANK_CONFUSIONS.get(r)
        if nf and nr:
            cost = int(nf != f) + int(nr != r)
            if cost:
                out.append((core[:-2] + nf + nr + promo + suf, cost))
    return out


def _ranked_candidates(raw: str) -> list[tuple[str, int]]:
    """Every plausible reading of one token, cheapest first.

    Cost is edit plausibility: 0 = exactly what OCR said, 1 = a known glyph
    confusion, 2 = two such repairs, 5 = a brute-force piece substitution for a
    glyph no table knows. Legality decides between them later; cost only decides
    what to try first. The brute-force tier sits at 5 rather than 3 so it can
    never tie with a table-backed reading — a tie there would hide the fact that
    the glyph contributed no evidence whatsoever.

    The piece glyph and the square are repaired INDEPENDENTLY and then combined.
    An earlier version only repaired the square of a reading that was already
    valid SAN, which meant a token like "NfE" — a mangled rank, the commonest
    corruption there is — produced no candidates at all and was left untouched.
    """
    s = raw.strip().strip(".,;:()[]!?’'\"")
    if not s:
        return []
    out: dict[str, int] = {}

    def add(c: str, cost: int) -> None:
        if SAN_RE.match(c) and out.get(c, 99) > cost:
            out[c] = cost

    if _CASTLE_RE.match(s):
        add("O-O-O" if s.count("-") == 2 else "O-O", 0 if s[0] == "O" else 1)
        return sorted(out.items(), key=lambda kv: kv[1])

    # (piece letter, rest of the token, cost) — the ways the first glyph reads.
    heads: list[tuple[str, str, int]] = [("", s, 0)]      # pawn move, or already fine
    if s[0] in "KQRBN":
        heads.append((s[0], s[1:], 0))
    if s[0] in FIGURINE:
        heads.append((FIGURINE[s[0]], s[1:], 1))
    for alt in _OCR_TO_PIECE.get(s[0], []):
        heads.append((alt, s[1:], 1))
    # A glyph no table knows. Books use fonts we have never seen, so the table
    # is a hint and not a limit: try every piece and let legality settle it.
    if len(s) > 1 and not s[0].isalnum():
        for piece in ("N", "B", "R", "Q", "K"):
            heads.append((piece, s[1:], _BRUTE))

    for piece, body, pcost in heads:
        for fixed, bcost in _square_variants(body):
            add(piece + fixed, pcost + bcost)
    return sorted(out.items(), key=lambda kv: kv[1])


def apply_chess_constraints(tokens: list[Token], start_fen: str | None,
                            beam: int = 10) -> list[Token]:
    """Replay the moves and repair what cannot be legal — with a BEAM.

    This is where a chess page beats a general document: every move must be legal
    in the position reached so far, and a garbled token often has exactly one
    legal reading, which makes the answer proved rather than guessed.

    Two things were learned by measuring rather than by reasoning:

    1. A single greedy pass picks arbitrarily when two readings are both legal,
       and the wrong pick poisons the position so every later move fails too.
       Keeping several lines alive lets a LATER move disambiguate an EARLIER one,
       which is how a human reads a smudged score sheet.

    2. "Exactly one legal reading" is NOT proof. It is only proof *given the
       moves before it*, and if those are wrong the whole claim is worthless.
       Measured over 2,377 tokens, judging uniqueness inside one line marked 130
       moves certain that were wrong. Certainty is therefore only claimed when
       every surviving line agrees on the token AND it was uniquely legal — a
       token the alternatives could not talk us out of.
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

    # A path = (board, cost, [(index, san, uniquely-legal-here)]).
    paths: list[tuple[Any, int, list[tuple[int, str, bool]]]] = [
        (chess.Board(start_fen), 0, [])
    ]
    for i, t in enumerate(tokens):
        raw = t.text.strip()
        # Test BEFORE stripping punctuation. The trailing dot is the only thing
        # separating the move number "12." from anything else, and stripping it
        # first meant no token was ever labelled a move number.
        if re.fullmatch(r"\d{1,3}\.{1,3}", raw):
            t.kind = "movenum"
            continue
        s = raw.strip(".,;:")
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
                # Certainty needs the reading to ALSO be OCR's most plausible
                # one. Being driven off the cheapest candidate means legality
                # overruled the glyph, and that is exactly what happens when the
                # line has already diverged and the position is wrong — 10 of
                # the 12 surviving false-certain tokens looked like this.
                # ...and it must carry some glyph evidence. A brute-force read
                # means the glyph said nothing and legality chose alone, which
                # is only proof if the position is right — and that is the one
                # thing we cannot check from inside the line.
                sure = (len(legal) == 1 and ccost == cands[0][1]
                        and ccost < _BRUTE)
                nxt.append((b2, cost + ccost, hist + [(i, c, sure)]))
        if not nxt:
            continue                      # unreadable token: keep the lines alive
        nxt.sort(key=lambda p: p[1])
        paths = nxt[:beam]

    if not paths:
        return tokens

    # What did the surviving lines disagree about? Disagreement is the honest
    # signal that we guessed, however cheap the guess looked.
    votes: dict[int, set[str]] = {}
    for _b, _c, hist in paths:
        for idx, san, _u in hist:
            votes.setdefault(idx, set()).add(san)

    for idx, san, unique in paths[0][2]:
        t = tokens[idx]
        if san != t.text:
            t.original = t.text
            t.text = san
        t.kind = "move"
        agreed = len(votes.get(idx, ())) == 1
        t.verified = unique and agreed
        t.confidence = 1.0 if t.verified else (0.8 if agreed else 0.5)
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
    # The weights on each Engine were doing nothing until this passed them.
    toks = apply_chess_constraints(
        consensus(per, {e.name: e.weight for e in engines}), start_fen)
    moves = [t for t in toks if t.kind == "move"]
    return {
        "engines": list(per),
        "tokens": [t.__dict__ for t in toks],
        "text": " ".join(t.text for t in toks),
        "moves": [t.text for t in moves],
        "movesVerified": sum(1 for t in moves if t.verified),
        "movesTotal": len(moves),
    }
