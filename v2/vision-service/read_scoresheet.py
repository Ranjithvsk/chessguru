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
import argparse, json, math, sys
from pathlib import Path
import torch
from PIL import Image
from transformers import VisionEncoderDecoderModel, ViTImageProcessor, RobertaTokenizerFast
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scoresheet_beam as sb

K = 3


def load(model_dir: str, device: str):
    ip = ViTImageProcessor.from_pretrained(model_dir)
    tok = RobertaTokenizerFast.from_pretrained(model_dir)
    mdl = VisionEncoderDecoderModel.from_pretrained(model_dir).eval().to(device)
    return ip, tok, mdl


def read_cells(paths: list[Path], ip, tok, mdl, device: str, batch: int = 16) -> list[sb.Cell]:
    cells = []
    for s in range(0, len(paths), batch):
        chunk = paths[s:s + batch]
        ims = [Image.open(p).convert("RGB") for p in chunk]
        pv = ip(images=ims, return_tensors="pt").pixel_values.to(device)
        with torch.inference_mode():
            gen = mdl.generate(pv, num_beams=4, num_return_sequences=K, max_new_tokens=12,
                               output_scores=True, return_dict_in_generate=True)
        texts = tok.batch_decode(gen.sequences, skip_special_tokens=True)
        scores = gen.sequences_scores.tolist()
        for i, p in enumerate(chunk):
            cands = []
            for j in range(K):
                t = texts[i * K + j].strip().replace(" ", "")
                if t and t not in [c[0] for c in cands]:
                    cands.append((t, math.exp(scores[i * K + j])))
            cells.append(sb.Cell(p.name, cands or [("", 0.0)]))
    return cells


def to_pgn(cells: list[sb.Cell]) -> str:
    out = []
    for i, c in enumerate(cells):
        if i % 2 == 0: out.append(f"{i // 2 + 1}.")
        tag = "" if c.status == "verified" else (" {?}" if c.status in ("guess", "inferred") else (" {??}" if c.status == "unknown" else ""))
        out.append((c.san or "--") + tag)
    return " ".join(out)


def list_cells(arg: str) -> list[Path]:
    p = Path(arg)
    if p.is_dir():
        return sorted(q for q in p.iterdir() if q.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"))
    return [Path(l.strip()) for l in open(p) if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir"); ap.add_argument("cells", nargs="?")
    ap.add_argument("--pair", nargs=2, metavar=("COPY_A", "COPY_B"))
    ap.add_argument("--json"); ap.add_argument("--pgn"); ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    a = ap.parse_args()
    ip, tok, mdl = load(a.model_dir, a.device)
    if a.pair:
        ca = sb.read_sheet(read_cells(list_cells(a.pair[0]), ip, tok, mdl, a.device))
        cb = sb.read_sheet(read_cells(list_cells(a.pair[1]), ip, tok, mdl, a.device))
        cells = sb.merge_two_sheets(ca, cb)
    else:
        cells = sb.read_sheet(read_cells(list_cells(a.cells), ip, tok, mdl, a.device))
    pgn = to_pgn(cells)
    summary = {s: sum(c.status == s for c in cells) for s in ("verified", "agreed", "guess", "inferred", "unknown")}
    print(pgn); print(json.dumps(summary), file=sys.stderr)
    if a.pgn: Path(a.pgn).write_text(pgn + "\n")
    if a.json:
        Path(a.json).write_text(json.dumps([{"id": c.id, "ink": sb.clean(c.raw), "san": c.san, "status": c.status,
                                             "confidence": round(c.confidence, 3), "candidates": c.cands, "inferred": c.inferred} for c in cells], indent=1))


if __name__ == "__main__":
    main()
