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
import html as html_mod
import logging
import os
import shutil
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

# The dash is not decoration. Real books write LONG ALGEBRAIC — Pandolfini prints
# "Qe8-d8", "d2-d3", "c2-c4" — and without the optional [-] here those tokens
# produced no candidates at all and were invisible to the constraint pass. That
# was 6 of 87 moves on eight real scanned spreads, about 7% of the book, silently
# unreadable. python-chess parses the long form natively, so only the gate was
# ever wrong.
SAN_RE = re.compile(
    r"^(?:O-O-O|0-0-0|O-O|0-0)[+#]?$|"
    r"^[KQRBN]?[a-h]?[1-8]?[-x]?[a-h][1-8](?:=[QRBN])?[+#]?$"
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
    box: list[float] | None = None     # [x1,y1,x2,y2] on the page, when known

    def copy(self) -> "Token":
        """A fresh Token for a trial replay — the constraint pass mutates."""
        return Token(**dict(self.__dict__))


@dataclass
class Engine:
    name: str
    # image -> [(word, conf)] or [(word, conf, [x1,y1,x2,y2])]. The box is
    # optional because a vision-language model emits free text with no
    # geometry at all, but the engines that CAN report it are what make
    # proven moves traceable back to their pixels.
    run: Callable[[Any], list[Any]]
    weight: float = 1.0


# ── Engines ────────────────────────────────────────────────────────────────
def tesseract_engine() -> Engine | None:
    try:
        import pytesseract
    except Exception:
        return None
    # pytesseract is only a WRAPPER. Without the tesseract binary it imports
    # perfectly and then throws on every page. Seen for real: a Windows box with
    # the Python package and no binary reported Tesseract as an available engine.
    try:
        pytesseract.get_tesseract_version()
    except Exception:
        log.info("pytesseract present but the tesseract binary is not; skipping")
        return None

    def run(img):
        import pytesseract
        from pytesseract import Output
        d = pytesseract.image_to_data(img, output_type=Output.DICT)
        out = []
        for i in range(len(d["text"])):
            t = (d["text"][i] or "").strip()
            if not t:
                continue
            try:
                c = float(d["conf"][i]) / 100.0
            except Exception:
                c = 0.0
            x, y = d["left"][i], d["top"][i]
            out.append((t, max(0.0, c), [x, y, x + d["width"][i], y + d["height"][i]]))
        return out

    # 1.0: perfect on clean prose in 1.1s, but hallucinates text off DIAGRAMS
    # (53 words where 40 are printed), so never the spine on a chess page.
    return Engine("tesseract", run, weight=1.0)


def _wc(item) -> tuple[str, float]:
    """Word and confidence, whether the engine reported a box or not."""
    return (item[0], item[1])


def _bx(item):
    return item[2] if len(item) > 2 else None


# Loaded models are expensive (Surya pulls ~1 GB of weights) so they are built
# once, on first use, and kept. Nothing here loads at import time — the live
# scanner imports this module and must not pay for models it will never call.
_MODELS: dict[str, Any] = {}


def _downscale(img, max_side: int):
    """Cap the long edge. A VLM's cost scales with the number of image tokens,
    and a two-page book scan is large: Qwen took 337s on a 1755px spread against
    37s for GOT-OCR. Nothing else here cares about size."""
    import numpy as np
    if not hasattr(img, "shape") or max_side <= 0:
        return img
    h, w = img.shape[:2]
    if max(h, w) <= max_side:
        return img
    import cv2
    sc = max_side / float(max(h, w))
    return cv2.resize(img, (int(w * sc), int(h * sc)), interpolation=cv2.INTER_AREA)


def _pil(img):
    """Engines want a PIL RGB image; our pipeline passes OpenCV BGR arrays."""
    from PIL import Image
    if hasattr(img, "shape"):
        arr = img
        if getattr(arr, "ndim", 0) == 3 and arr.shape[2] == 3:
            arr = arr[:, :, ::-1]
        return Image.fromarray(arr.astype("uint8"))
    return img


def _ensure_llama_server() -> None:
    """Put a llama-server binary on PATH for Surya 0.22+.

    Surya moved its recognition model to a llama.cpp backend and shells out to
    `llama-server`. Without it, it does not fail loudly — it falls back to
    looking for Docker, fails that too, and returns ZERO WORDS from an engine
    that reported itself available.

    Searches several places because the binary is named differently and lives
    elsewhere on each machine: Windows wants `llama-server.exe`, and the Linux
    build unpacks into a versioned subdirectory. CHESSGURU_LLAMA_DIR overrides.
    """
    import glob
    if shutil.which("llama-server") or shutil.which("llama-server.exe"):
        return
    here = os.path.dirname(os.path.abspath(__file__))
    roots = [os.environ.get("CHESSGURU_LLAMA_DIR"),
             os.path.join(here, "llama"),
             "E:\\llama", "C:\\llama", "/opt/chessguru-vision/llama"]
    pats = []
    for r in [r for r in roots if r]:
        for name in ("llama-server", "llama-server.exe"):
            pats += [os.path.join(r, name), os.path.join(r, "*", name),
                     os.path.join(r, "*", "*", name)]
    for pat in pats:
        for cand in glob.glob(pat):
            dirn = os.path.dirname(cand)
            os.environ["PATH"] = dirn + os.pathsep + os.environ.get("PATH", "")
            # The Linux build loads its shared objects from beside itself.
            os.environ["LD_LIBRARY_PATH"] = (
                dirn + os.pathsep + os.environ.get("LD_LIBRARY_PATH", ""))
            # Two settings decide whether Surya uses this binary at all, and
            # both must be right BEFORE surya.settings is imported.
            #
            # SURYA_INFERENCE_BACKEND unset means Surya chooses, and on Windows
            # it chose vLLM-in-Docker, then failed with "docker binary not
            # found" — while a perfectly good llama-server sat on PATH.
            # LLAMA_CPP_BINARY defaults to the extension-less name, which
            # Windows will not execute. Point it at the actual file.
            os.environ.setdefault("SURYA_INFERENCE_BACKEND", "llamacpp")
            os.environ.setdefault("LLAMA_CPP_BINARY", cand)
            log.info("surya backend=llamacpp binary=%s", cand)
            return
    log.warning("llama-server not found; Surya 0.22+ will return nothing. "
                "Set CHESSGURU_LLAMA_DIR or drop the binary in %s",
                os.path.join(here, "llama"))


def surya_engine() -> Engine | None:
    """Surya — transformer OCR, strongest of the four on unusual layouts."""
    # BEFORE the import: surya.settings reads these at module load and freezes
    # them, so setting them later in run() would have no effect at all.
    _ensure_llama_server()
    try:
        import surya.recognition  # noqa: F401
    except Exception:
        return None

    def run(img):
        if "surya" not in _MODELS:
            _ensure_llama_server()
            from surya.detection import DetectionPredictor
            from surya.recognition import RecognitionPredictor
            try:
                # 0.16 split the shared vision backbone into its own object and
                # expected it injected. 0.22 dropped that module entirely and
                # takes an optional inference manager instead. Both shapes are
                # tried because the package rewrites this every few releases.
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
            # 0.16 shape: flat text_lines, each carrying .text
            for line in getattr(page, "text_lines", None) or []:
                conf = float(getattr(line, "confidence", 0.0) or 0.0)
                for w in (getattr(line, "text", "") or "").split():
                    out.append((w, conf))
            # 0.22 shape: layout blocks carrying .html, in reading order. Richer
            # than before, since each block also has a semantic label
            # (PageHeader, Text, Figure) — but the TEXT MOVED, and a reader that
            # only knew text_lines returned nothing at all against a server that
            # was working perfectly. Nothing raised; it just went quiet.
            blocks = getattr(page, "blocks", None) or []
            for b in sorted(blocks, key=lambda b: getattr(b, "reading_order", 0)):
                if getattr(b, "skipped", False) or getattr(b, "error", False):
                    continue
                conf = float(getattr(b, "confidence", 0.0) or 0.0)
                text = re.sub(r"<[^>]+>", " ", getattr(b, "html", "") or "")
                bb = getattr(b, "bbox", None)
                bb = [float(v) for v in bb] if bb else None
                for w in html_mod.unescape(text).split():
                    out.append((w, conf, bb))
        return out

    # 1.1: strongest on hard input, but MEASURED slightly behind Paddle on clean
    # typeset pages (97.5% vs 100%) and 4x the cost. Not the default spine.
    return Engine("surya", run, weight=1.1)


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
            ph, pw = page.get("dimensions", (arr.shape[0], arr.shape[1]))
            for blk in page.get("blocks", []):
                for line in blk.get("lines", []):
                    for w in line.get("words", []):
                        t = (w.get("value") or "").strip()
                        if not t:
                            continue
                        g = w.get("geometry")
                        box = None
                        if g:
                            # docTR reports geometry as fractions of the page.
                            (x0, y0), (x1, y1) = g[0], g[1]
                            box = [x0 * pw, y0 * ph, x1 * pw, y1 * ph]
                        out.append((t, float(w.get("confidence") or 0.0), box))
        return out

    # 0.9: MEASURED weakest on pages carrying diagrams (60% on page 20).
    return Engine("doctr", run, weight=0.9)


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
            # `a or b` on a numpy array raises "truth value of an array with
            # more than one element is ambiguous" — Paddle returns arrays here,
            # so the fallback has to be written out explicitly.
            boxes = d.get("rec_boxes")
            if boxes is None or len(boxes) == 0:
                boxes = d.get("rec_polys")
            if boxes is None:
                boxes = []
            for i, (t, sc) in enumerate(zip(texts, scores)):
                bb = None
                if i < len(boxes):
                    try:
                        pts = np.array(boxes[i], dtype=float).reshape(-1, 2)
                        bb = [float(pts[:, 0].min()), float(pts[:, 1].min()),
                              float(pts[:, 0].max()), float(pts[:, 1].max())]
                    except Exception:
                        bb = None
                # Paddle recognises a whole LINE, so every word in it shares the
                # line's box. Coarser than per-word, still enough to crop back to.
                for w in str(t).split():
                    out.append((w, float(sc), bb))
        return out

    # 1.4: MEASURED best of the four — 100% on both a prose page and a
    # four-diagram page, at a quarter of Surya's runtime.
    return Engine("paddle", run, weight=1.4)


# ── GPU engines (vision-language models) ───────────────────────────────────
# These are a different KIND of reader. The four classical engines detect text
# regions and recognise glyphs; a VLM looks at the whole page and writes out what
# it sees, which means it can be TOLD what it is looking at. On a chess page that
# matters: "keep figurine glyphs, transcribe moves exactly" is an instruction no
# classical engine can accept.
#
# They need a GPU. On a CPU-only box these return None and nothing changes.

def _cuda_ok() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _free_vram_for(name: str) -> None:
    """Keep one large model resident at a time.

    The card here is 10 GB. GOT-OCR is ~1.5 GB and Qwen3-VL-4B is ~8 GB, so both
    together do not fit. Whichever is not being used is dropped rather than
    letting the allocator fail halfway through a book.
    """
    import gc
    for other in ("gotocr", "qwen"):
        if other != name and other in _MODELS:
            del _MODELS[other]
            gc.collect()
            try:
                import torch
                torch.cuda.empty_cache()
            except Exception:
                pass


def _mean_token_confidence(model, out) -> float:
    """A real confidence from the model's own token probabilities.

    A VLM has no per-word confidence to report, and inventing one would defeat
    the point of reporting confidence at all. The mean probability of the tokens
    it actually chose is a genuine signal, so that is what is used.
    """
    try:
        import torch
        scores = getattr(out, "scores", None)
        if not scores:
            return 0.9
        ps = []
        for step in scores:
            pr = torch.softmax(step[0].float(), dim=-1)
            ps.append(float(pr.max()))
        return sum(ps) / len(ps) if ps else 0.9
    except Exception:
        return 0.9


def gotocr_engine() -> Engine | None:
    """GOT-OCR 2.0 (716M) — small, purpose-built for OCR, fits any GPU."""
    if not _cuda_ok():
        return None
    try:
        import transformers  # noqa: F401
    except Exception:
        return None

    def run(img):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor
        _free_vram_for("gotocr")
        if "gotocr" not in _MODELS:
            mid = "stepfun-ai/GOT-OCR-2.0-hf"
            proc = AutoProcessor.from_pretrained(mid)
            mdl = AutoModelForImageTextToText.from_pretrained(
                mid, dtype=torch.bfloat16, device_map={"": "cuda:0"})
            _MODELS["gotocr"] = (proc, mdl.eval())
        proc, mdl = _MODELS["gotocr"]
        inputs = proc(_pil(img), return_tensors="pt").to("cuda")
        with torch.inference_mode():
            out = mdl.generate(**inputs, do_sample=False, max_new_tokens=4096,
                               tokenizer=proc.tokenizer, stop_strings="<|im_end|>",
                               return_dict_in_generate=True, output_scores=True)
        seq = out.sequences[0, inputs["input_ids"].shape[1]:]
        text = proc.decode(seq, skip_special_tokens=True)
        conf = _mean_token_confidence(mdl, out)
        return [(w, conf) for w in text.split() if w.strip()]

    return Engine("gotocr", run, weight=1.2)


CHESS_PAGE_PROMPT = (
    "Transcribe every piece of text on this page exactly as printed, in reading "
    "order. This is a page from a chess book. Keep chess move notation exactly as "
    "written, including figurine piece symbols. Do not solve, explain, translate "
    "or summarise anything. Do not describe the diagrams. Output plain text only."
)


def qwen_engine(model_id: str = "Qwen/Qwen3-VL-4B-Instruct",
                max_side: int = 1400) -> Engine | None:
    """Qwen3-VL — the only engine here that can be told what it is reading.

    4B is the largest of the current line that fits 10 GB on an Ampere card; the
    8B FP8 build needs Ada or newer for native FP8, and 8B in bf16 wants ~16 GB.
    """
    if not _cuda_ok():
        return None
    try:
        import transformers  # noqa: F401
    except Exception:
        return None

    def run(img):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor
        _free_vram_for("qwen")
        if "qwen" not in _MODELS:
            proc = AutoProcessor.from_pretrained(model_id)
            # Pin to the card. device_map="auto" let accelerate reserve headroom
            # and offload layers to CPU — "Some parameters are on the meta device"
            # — which turned a 45s page into 660s. The 4B weights are ~6 GB and
            # fit 10 GB with room for activations, so keep them all on the GPU.
            mdl = AutoModelForImageTextToText.from_pretrained(
                model_id, dtype=torch.bfloat16, device_map={"": "cuda:0"})
            _MODELS["qwen"] = (proc, mdl.eval())
        proc, mdl = _MODELS["qwen"]
        msgs = [{"role": "user", "content": [
            {"type": "image", "image": _pil(_downscale(img, max_side))},
            {"type": "text", "text": CHESS_PAGE_PROMPT}]}]
        inputs = proc.apply_chat_template(
            msgs, tokenize=True, add_generation_prompt=True,
            return_dict=True, return_tensors="pt").to(mdl.device)
        with torch.inference_mode():
            out = mdl.generate(**inputs, do_sample=False, max_new_tokens=2048,
                               return_dict_in_generate=True, output_scores=True)
        seq = out.sequences[0, inputs["input_ids"].shape[1]:]
        text = proc.decode(seq, skip_special_tokens=True)
        conf = _mean_token_confidence(mdl, out)
        return [(w, conf) for w in text.split() if w.strip()]

    return Engine("qwen", run, weight=1.3)


def available_engines() -> list[Engine]:
    """Every engine we can actually run right now.

    All four return the same [(word, confidence)] shape, so the consensus and
    chess passes below neither know nor care which ones ran. An engine whose
    package is not installed simply returns None here — which is why the live
    scanner, whose venv has only Tesseract, imports this module safely.
    """
    got = [e for e in (tesseract_engine(), doctr_engine(),
                       paddle_engine(), surya_engine(),
                       gotocr_engine(), qwen_engine()) if e]
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

    def _conf(seq):
        return [_wc(x)[1] for x in seq]

    def quality(n: str) -> tuple[float, float]:
        """Declared weight FIRST, self-reported confidence only as a tiebreak.

        Two things had to be learned the hard way here.

        Total confidence mass is wrong: it rewards whichever engine wrote the
        most words, and on a chess page the most verbose engine is the one
        hallucinating text off the DIAGRAM. Tesseract reads a board as
        'Vi, Wi, Wi, Ui "O86 @ U27)' and so won the spine with 55 words to
        Surya's 40, dragging all of it into the merged page.

        Mean confidence is wrong too, and more subtly. Confidence is NOT
        comparable across engines — each one's number means something different,
        and Surya reports ~1.00 on everything it emits. That is overconfidence,
        not accuracy. Measured against a page transcribed by eye, adding Surya to
        Paddle made the result WORSE, 100% to 97.5%, purely because Surya seized
        the spine. So the spine is chosen by a weight WE set from measurement,
        and the engine's own opinion of itself only breaks ties."""
        cs = _conf(live[n])
        return (weights.get(n, 1.0), sum(cs) / len(cs))

    spine_name = max(live, key=quality)
    spine = live[spine_name]
    spine_words = [_wc(x)[0] for x in spine]
    spine_boxes = [_bx(x) for x in spine]

    # votes[i][word] -> accumulated weight, and who said it
    votes: list[dict[str, float]] = [
        {_wc(x)[0]: max(_wc(x)[1], 0.05) * weights.get(spine_name, 1.0)} for x in spine
    ]
    said: list[dict[str, str]] = [{spine_name: _wc(x)[0]} for x in spine]

    for name, seq in live.items():
        if name == spine_name:
            continue
        other_words = [_wc(x)[0] for x in seq]
        sm = difflib.SequenceMatcher(a=spine_words, b=other_words, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal" or (tag == "replace" and (i2 - i1) == (j2 - j1)):
                for k in range(i2 - i1):
                    w, c = _wc(seq[j1 + k])
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
                         engines=dict(said[idx]),
                         box=spine_boxes[idx] if idx < len(spine_boxes) else None))
    return out


# ── Page cleanup, before the chess pass sees anything ──────────────────────
# Two kinds of junk on a real book page look exactly like chess moves to any
# grammar, and both were found by transcribing real scans rather than by
# reasoning about them.

# Both directions: a board prints files left-to-right and ranks top-to-bottom,
# and the strips below/right of it read the other way.
_LADDERS = ("abcdefgh", "hgfedcba", "12345678", "87654321")


def strip_board_labels(tokens: list[Token], min_run: int = 4) -> tuple[list[Token], int]:
    """Drop the a-h / 1-8 coordinate strips printed around a diagram.

    Every diagram in a chess book is ringed with file and rank labels, and OCR
    reads them as text sitting right beside the move list. A lone "e4" off a
    board's border is indistinguishable from the move e4 — except that border
    labels arrive as a RUN of CONSECUTIVE single characters climbing a ladder,
    which prose never does. Isolated letters and digits are left alone, so
    "weakens the light squares e6 and g6" survives intact.

    The runs also merge: a diagram's files and ranks come back as one stretch
    like "abcdefgh87654321", matching no single ladder, so ladder SEGMENTS are
    found inside the run rather than testing the run whole.
    """
    keep = [True] * len(tokens)
    n = len(tokens)
    i = 0
    while i < n:
        if len(tokens[i].text.strip()) != 1:
            i += 1
            continue
        j = i
        while j < n and len(tokens[j].text.strip()) == 1:
            j += 1
        run = "".join(t.text.strip().lower() for t in tokens[i:j])
        k = 0
        while k < len(run):
            best = 0
            for lad in _LADDERS:
                m = 0
                while k + m < len(run) and run[k:k + m + 1] in lad:
                    m += 1
                best = max(best, m)
            if best >= min_run:
                for x in range(i + k, i + k + best):
                    keep[x] = False
                k += best
            else:
                k += 1
        i = j
    out = [t for t, kp in zip(tokens, keep) if kp]
    return out, len(tokens) - len(out)


def rejoin_hyphens(tokens: list[Token]) -> tuple[list[Token], int]:
    """Put back words the typesetter broke across a line.

    This book splits "cru-" / "cial" and "pub-" / "lished" across lines and even
    across PAGES. Left alone both halves are wrong, and a fragment like "f-" can
    also be mistaken for the start of a move.

    A trailing hyphen only rejoins when the next token is lowercase, so genuine
    long algebraic ("Qe8-d8") and real hyphenated words are never merged.
    """
    out: list[Token] = []
    merged = 0
    i = 0
    while i < len(tokens):
        t = tokens[i]
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        if (t.text.endswith("-") and len(t.text) > 1 and nxt
                and nxt.text[:1].islower() and not _LONG_ALG.match(t.text[:-1])):
            j = t.copy()
            j.original = t.text + " " + nxt.text
            j.text = t.text[:-1] + nxt.text
            j.confidence = min(t.confidence, nxt.confidence)
            out.append(j)
            merged += 1
            i += 2
            continue
        out.append(t)
        i += 1
    return out, merged


# ── Chess constraint pass ──────────────────────────────────────────────────
# Cost of guessing a piece with no glyph evidence at all. Deliberately above
# any combination of table-backed repairs (max 1 + 2) so the two never tie.
_BRUTE = 5

# Cost of ignoring a token rather than playing it. Above a clean move (0) and a
# glyph repair (1), below a brute-force guess (5).
_SKIP = 2

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


# What a correctly-read move looks like: a piece move CARRIES its piece letter,
# and a pawn move is a file (optionally taking) then a rank. Deliberately
# stricter than SAN_RE, which is a net cast wide to catch garbled input — SAN_RE
# happily matches "8b5", which is not something a book ever prints.
_STRICT_SAN = re.compile(
    r"^(?:O-O-O|O-O|0-0-0|0-0)[+#]?$"
    r"|^[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?$"
    r"|^[a-h](?:x[a-h])?[1-8](?:=[QRBN])?[+#]?$"
)


_LONG_ALG = re.compile(r"^([KQRBN]?)([a-h][1-8])[-x]?([a-h][1-8])(?:=[QRBN])?$")


def _notation_agrees(book: str, std: str) -> bool:
    """Does the book's spelling tell the same story as the board's?

    In a CORRECT position the printed move and the move the board plays agree on
    everything that matters: the piece, the destination, whether it captures, and
    whether a disambiguating file was needed. When they disagree — the page says
    "Ne3" and the board insists on "Nxe3", or the page says "Nbc3" and the board
    needs no disambiguation — either the book is wrong or OUR POSITION IS. The
    second is far likelier, so it is treated as evidence against certainty.

    The CHECK MARKER counts. It looked like mere annotation, and forgiving it left
    exactly 10 wrong moves still claiming certainty out of 2,377 — every one of
    them identical to the truth but for a "+". A board that thinks a move gives
    check when the book says it does not has diverged, however small the symptom.
    Requiring the markers to agree cost 10 of 1,603 certainty claims and took
    false certainty to zero.

    Differences that are purely typographic ARE forgiven: zeroes for capital O in
    castling, and long algebraic, which is a different way of writing the same
    move rather than a different claim about the board.
    """
    if book.rstrip("#").endswith("+") != std.rstrip("#").endswith("+"):
        return False
    b = book.rstrip("+#").replace("0", "O")
    t = std.rstrip("+#").replace("0", "O")
    if b == t:
        return True
    m = _LONG_ALG.match(book.rstrip("+#"))
    if m:                                    # "Qe8-d8" vs "Qd8", "d2-d3" vs "d3"
        piece, _src, dst = m.groups()
        return t == piece + dst or t.endswith(dst)
    return False


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
            # A line may always SKIP a token. Real pages are not a move list:
            # a book prints moves in a table and then MENTIONS them again in
            # prose, often in long algebraic, so the same move appears twice and
            # out of order. Measured on one spread, "c4" and "c2-c4" are one move
            # printed twice, and replaying every token as consecutive play proved
            # NOTHING on that page. Skipping costs more than playing a clean move
            # (_SKIP > 0), so a line only ignores a token when playing it will not
            # fit — which is exactly what a repeated prose mention looks like.
            nxt.append((board, cost + _SKIP, hist))
            legal = []
            for c, ccost in cands:
                try:
                    board.parse_san(c)
                    legal.append((c, ccost))
                except Exception:
                    pass
            for c, ccost in legal:
                b2 = board.copy(stack=False)
                # Record STANDARD san, not the book's spelling. A page may print
                # "Qe8-d8"; everything downstream — the board, the reader, the
                # training capture — wants "Qd8". The book's own text is kept in
                # `original` when it differs.
                mv = board.parse_san(c)
                std = board.san(mv)
                b2.push(mv)
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
                        and ccost < _BRUTE and _notation_agrees(c, std))
                nxt.append((b2, cost + ccost, hist + [(i, std, sure)]))
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
        # Repair what is BROKEN; do not rewrite what is already fine unless the
        # rewrite is proved. Measured on a real scanned spread, an unguarded pass
        # took move recovery DOWN from 78% to 73% — it was overwriting moves OCR
        # had read correctly with legal-but-wrong alternatives from a line that
        # had drifted. A clean move stands unless we can prove a better one.
        clean = bool(_STRICT_SAN.match(t.text.strip()))
        if san != t.text and (unique or not clean):
            t.original = t.text
            t.text = san
        t.kind = "move"
        agreed = len(votes.get(idx, ())) == 1
        t.verified = unique and agreed
        t.confidence = 1.0 if t.verified else (0.8 if agreed else 0.5)
    return tokens


def page_views(img, wide_ratio: float = 1.25):
    """The page, and — if it is a two-page SPREAD — each half as well.

    A scanned book is usually photographed two pages at a time, which leaves any
    one diagram filling a small fraction of the frame. That is precisely what the
    board extractor is worst at: measured on eight real spreads it found NO legal
    diagram on four of them, and splitting at the gutter recovered a diagram on
    every page that had failed.

    Worth stating plainly, because it cost a night to learn the hard way: a
    40,000-composite retrain aimed at exactly this failure moved nothing, and
    slicing the image in half fixes it for free. Framing beat training.

    Only landscape images are split, so a single portrait page is left alone.
    """
    views = [img]
    try:
        h, w = img.shape[:2]
    except Exception:
        return views
    if w >= h * wide_ratio:
        views.append(img[:, : w // 2])
        views.append(img[:, w // 2:])
    return views


def _count_verified(tokens: list[Token]) -> int:
    return sum(1 for t in tokens if t.kind == "move" and t.verified)


def choose_start(tokens: list[Token], candidate_fens: list[str],
                 beam: int = 10) -> tuple[list[Token], str | None, int]:
    """Let the MOVES pick which diagram they belong to.

    A book page carries diagrams and move text together, and the constraint pass
    needs to know which position the moves start from. Associating them by
    layout would need bounding boxes the engines discard, so instead every
    candidate position from the page is tried and the one that legally explains
    the most moves wins.

    This is stronger than picking by position on the page, because it also
    survives a MISREAD diagram: a FEN with a piece in the wrong place will not
    make the printed moves legal, so it loses to one that does. The diagram and
    the move text check each other.
    """
    # A scan yields a BOARD, not a game state: nothing in a diagram says whose
    # turn it is, and books print "WHITE TO MOVE" as prose we may not have read.
    # So each candidate is tried both ways and the moves settle it, exactly as
    # they settle which diagram it was.
    expanded: list[str] = []
    for f in [f for f in candidate_fens if f]:
        parts = f.strip().split()
        if len(parts) >= 6:
            expanded.append(f.strip())
        else:
            expanded += [parts[0] + " w - - 0 1", parts[0] + " b - - 0 1"]

    best: tuple[list[Token], str | None, int] = (tokens, None, -1)
    for fen in expanded:
        trial = apply_chess_constraints([t.copy() for t in tokens], fen, beam)
        n = _count_verified(trial)
        if n > best[2]:
            best = (trial, fen, n)
    return best


def export_training_pairs(img, tokens: list[Token], out_dir: str,
                          source: str = "", pad: int = 3) -> int:
    """Save every PROVED move as a labelled crop. This is the training loop.

    A verified move is not a guess. It was uniquely legal in the position, agreed
    across every surviving line of the beam, matched OCR's own cheapest reading,
    and agreed on capture, disambiguation and check. So the pair (this patch of
    paper, this text) is CERTAIN, and it cost nothing to produce — no annotator,
    no review, just a chess book.

    That is what makes this improvable rather than fixed. The engines are other
    people's pre-trained models, and the constraint pass is rules rather than
    weights, so neither learns on its own. But every book run through it yields
    proven labels of exactly the thing general OCR is worst at: chess notation in
    a book's own font. Those labels are what a fine-tune would need.

    Deliberately exports ONLY verified moves. Unverified text is where the errors
    live, and training on it would teach the mistakes back in.
    """
    import json as _json
    import cv2
    os.makedirs(out_dir, exist_ok=True)
    manifest = os.path.join(out_dir, "labels.jsonl")
    h, w = img.shape[:2]
    n = 0
    with open(manifest, "a", encoding="utf8") as mf:
        for i, t in enumerate(tokens):
            if not (t.kind == "move" and t.verified and t.box):
                continue
            x1, y1, x2, y2 = [int(round(v)) for v in t.box]
            x1 = max(0, x1 - pad); y1 = max(0, y1 - pad)
            x2 = min(w, x2 + pad); y2 = min(h, y2 + pad)
            if x2 - x1 < 4 or y2 - y1 < 4:
                continue
            name = "%s_%04d.png" % (re.sub(r"\W+", "_", source or "page"), i)
            cv2.imwrite(os.path.join(out_dir, name), img[y1:y2, x1:x2])
            mf.write(_json.dumps({
                "image": name,
                "text": t.text,                 # the PROVEN standard SAN
                "printed": t.original or t.text,  # what the book actually shows
                "source": source,
                "box": [x1, y1, x2, y2],
            }) + "\n")
            n += 1
    return n


def read_page(img, start_fen: str | None = None,
              candidate_fens: list[str] | None = None,
              classify_board: Callable[[Any], str | None] | None = None,
              detect_boards: Callable[[Any], list[Any]] | None = None) -> dict[str, Any]:
    """Full pipeline for one page image.

    `classify_board` and `detect_boards` are INJECTED rather than imported, so
    this module never depends on the vision service and stays testable on its
    own — the same arrangement book_ingest.py uses.

    Supply either a known `start_fen`, a list of `candidate_fens`, or the two
    callables and the page's own diagrams become the candidates. With none of
    these the chess constraint pass cannot run and this degrades to ordinary
    ensemble OCR, which is exactly what it did everywhere before this existed.
    """
    engines = available_engines()
    per = {}
    for e in engines:
        try:
            per[e.name] = e.run(img)
        except Exception as ex:
            log.warning("engine %s failed: %s", e.name, ex)

    toks = consensus(per, {e.name: e.weight for e in engines})
    # Clean the page BEFORE the chess pass, so a diagram's own border labels
    # cannot be mistaken for moves and broken words are whole again.
    toks, dropped_labels = strip_board_labels(toks)
    toks, rejoined = rejoin_hyphens(toks)

    # Where does the position come from?
    cands = list(candidate_fens or [])
    if start_fen:
        cands.insert(0, start_fen)
    if not cands and detect_boards and classify_board:
        # Look at the whole page AND each half of a spread. Duplicates are
        # harmless — the moves pick which position they belong to anyway.
        for view in page_views(img):
            try:
                for c in detect_boards(view) or []:
                    try:
                        fen = classify_board(c)
                        if fen and fen not in cands:
                            cands.append(fen)
                    except Exception as ex:
                        log.warning("board classify failed: %s", ex)
            except Exception as ex:
                log.warning("board detect failed: %s", ex)

    chosen = None
    if cands:
        toks, chosen, _ = choose_start(toks, cands)
    elif start_fen:
        toks = apply_chess_constraints(toks, start_fen)

    moves = [t for t in toks if t.kind == "move"]
    return {
        "engines": list(per),
        "tokens": [t.__dict__ for t in toks],
        "text": " ".join(t.text for t in toks),
        "moves": [t.text for t in moves],
        "movesVerified": sum(1 for t in moves if t.verified),
        "movesTotal": len(moves),
        "startFen": chosen,
        "startFenCandidates": len(cands),
        "boardLabelsDropped": dropped_labels,
        "hyphensRejoined": rejoined,
        # Stated plainly so a caller cannot mistake plain OCR for the real thing.
        "chessConstraintsRan": bool(cands),
    }
