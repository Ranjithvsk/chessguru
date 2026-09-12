"""Production reader: ordered move-cell images → PGN with per-move confidence.

  python read_scoresheet.py <model_dir> <cells_dir_or_list> [--json out.json] [--pgn out.pgn]
  python read_scoresheet.py <model_dir> --pair <white_copy_dir> <black_copy_dir>   # both players' sheets

Cells are read in filename order (or the order given in a .txt list, one path
per line). Output per cell: ink reading, decided SAN, status
(verified | agreed | guess | inferred | unknown) and confidence. Verified means
the legality beam proved it; anything else is for the coach to glance at.

The model is the fine-tuned TrOCR from hcs_trocr_finetune.py. CPU is fine:
~0.3 s per cell greedy, so a 60-move sheet reads in under a minute.
"""
from __future__ import annotations
import argparse, json, math, re, sys
from pathlib import Path
import torch
from PIL import Image
import os as _os, sys as _sys
_sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from cellprep import tight_crop, has_ink
TIGHT = _os.environ.get("TIGHT", "0") == "1"
from transformers import VisionEncoderDecoderModel, ViTImageProcessor, RobertaTokenizerFast
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scoresheet_beam as sb

K = 3


def load(model_dir: str, device: str):
    ip = ViTImageProcessor.from_pretrained(model_dir)
    tok = RobertaTokenizerFast.from_pretrained(model_dir)
    mdl = VisionEncoderDecoderModel.from_pretrained(model_dir).eval().to(device)
    return ip, tok, mdl


def trim_blank_tail(paths: list[Path]) -> list[Path]:
    """Drop the run of empty cells after the last written move (a 60-move sheet
    of a 31-move game has 58 blank cells). Blanks INSIDE the game are kept and
    come back as unknown, which is what a coach should see."""
    last = -1
    for i, p in enumerate(paths):
        if has_ink(Image.open(p)):
            last = i
    return paths[: last + 1]


def read_cells(paths: list[Path], ip, tok, mdl, device: str, batch: int = 16, fast: bool = False) -> list[sb.Cell]:
    """fast=True decodes greedily with one candidate: ~8× quicker on CPU. The
    beam is annotate-only, so the extra candidates buy little in production."""
    paths = trim_blank_tail(paths)
    cells = []
    k = 1 if fast else K
    for s in range(0, len(paths), batch):
        chunk = paths[s:s + batch]
        ims = [Image.open(p).convert("RGB") for p in chunk]
        blank = [not has_ink(im) for im in ims]
        if TIGHT: ims = [tight_crop(im) for im in ims]
        pv = ip(images=ims, return_tensors="pt").pixel_values.to(device)
        with torch.inference_mode():
            gen = mdl.generate(pv, num_beams=1 if fast else 4, num_return_sequences=k, max_new_tokens=12,
                               output_scores=True, return_dict_in_generate=True)
        texts = tok.batch_decode(gen.sequences, skip_special_tokens=True)
        ss = getattr(gen, "sequences_scores", None)          # greedy decoding has none
        scores = ss.tolist() if ss is not None else [0.0] * len(texts)
        for i, p in enumerate(chunk):
            cands = []
            for j in range(k):
                t = texts[i * k + j].strip().replace(" ", "")
                if t and t not in [c[0] for c in cands]:
                    cands.append((t, math.exp(scores[i * k + j]) if scores[i * k + j] else 0.9))
            cells.append(sb.Cell(p.name, [("", 0.0)] if blank[i] else (cands or [("", 0.0)])))
    return cells


def to_pgn(cells: list[sb.Cell]) -> str:
    out = []
    for i, c in enumerate(cells):
        if i % 2 == 0: out.append(f"{i // 2 + 1}.")
        tag = "" if c.status == "verified" else (" {?}" if c.status in ("guess", "inferred") else (" {??}" if c.status == "unknown" else ""))
        out.append((c.san or "--") + tag)
    return " ".join(out)


def _cell_key(q: Path):
    """Move order, not alphabetical: 001_white before 001_black (plain sort put
    'black' first and shifted the whole game by one ply)."""
    m = re.match(r"(\d+)[_-]?(white|black|w|b)?", q.stem, re.I)
    if not m:
        return (10**9, q.name)
    colour = (m.group(2) or "w").lower()[0]
    return (int(m.group(1)), 0 if colour == "w" else 1, q.name)


def list_cells(arg: str) -> list[Path]:
    p = Path(arg)
    if p.is_dir():
        return sorted((q for q in p.iterdir() if q.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")), key=_cell_key)
    return [Path(l.strip()) for l in open(p) if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir"); ap.add_argument("cells", nargs="?")
    ap.add_argument("--pair", nargs=2, metavar=("COPY_A", "COPY_B"))
    ap.add_argument("--json"); ap.add_argument("--pgn"); ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--fast", action="store_true", help="greedy decoding, one candidate (CPU default)")
    a = ap.parse_args()
    ip, tok, mdl = load(a.model_dir, a.device)
    fast = a.fast or a.device == "cpu"
    if a.pair:
        ca = sb.read_sheet(read_cells(list_cells(a.pair[0]), ip, tok, mdl, a.device, fast=fast))
        cb = sb.read_sheet(read_cells(list_cells(a.pair[1]), ip, tok, mdl, a.device, fast=fast))
        cells = sb.merge_two_sheets(ca, cb)
        if a.json:
            for tag, cc in (("copyA", ca), ("copyB", cb)):
                Path(a.json.replace(".json", f".{tag}.json")).write_text(json.dumps([{"id": c.id, "ink": sb.clean(c.raw), "san": c.san, "status": c.status, "candidates": c.cands} for c in cc]))
    else:
        cells = sb.read_sheet(read_cells(list_cells(a.cells), ip, tok, mdl, a.device, fast=fast))
    pgn = to_pgn(cells)
    summary = {s: sum(c.status == s for c in cells) for s in ("verified", "agreed", "guess", "inferred", "unknown")}
    print(pgn); print(json.dumps(summary), file=sys.stderr)
    if a.pgn: Path(a.pgn).write_text(pgn + "\n")
    if a.json:
        Path(a.json).write_text(json.dumps([{"id": c.id, "ink": sb.clean(c.raw), "san": c.san, "status": c.status,
                                             "confidence": round(c.confidence, 3), "candidates": c.cands, "inferred": c.inferred} for c in cells], indent=1))


if __name__ == "__main__":
    main()
