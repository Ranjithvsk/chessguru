"""Read handwritten scoresheet move cells with Qwen3-VL on the GPU box.

Runs on Vinayaka (E:\\ocr-gpu venv). Input is a manifest France writes:
  [{"id": "001_0_10_white.png", "file": "cells/001_0_10_white.png"}, ...]
in the order the moves were played. Cells are stacked STRIP_N at a time into one
tall image and the model is asked for one line per cell, which is ~STRIP_N times
fewer generate() calls than one cell per call and gives the model the same
row-context a human reader has. Output is candidates per cell, not one answer,
because the legality beam downstream wants alternatives:
  {"001_0_10_white.png": [["Qg6", 0.93]], ...}

Confidence is the mean token probability of the line the model chose (a VLM
has no per-character confidence; see 20-dream-ocr.md). Nothing here knows chess
— that is deliberate, the constraint pass on France owns legality.
"""
from __future__ import annotations
import json, re, sys, time, math
from pathlib import Path
from PIL import Image
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor

MODEL = "Qwen/Qwen3-VL-4B-Instruct"
STRIP_N = 10
PROMPT = (
    "This image is a vertical strip of {n} handwritten chess score-sheet boxes. "
    "Each row has a printed label on the left (01, 02, ...). For every row write "
    "one line in the form  label: move  — the handwritten move in that row, "
    "transcribed exactly as chess notation (examples: e4, Nf3, Bxc6, O-O, Qh4+, "
    "exd5, R1e2, a8=Q). If a row is empty write  label: -  . Write exactly {n} "
    "lines, nothing else, and never add move numbers or explanations."
)


def stack(paths: list[Path], width: int = 960, pad: int = 8, label_w: int = 110) -> Image.Image:
    """Stack cells vertically with a printed row label in a left margin.

    The label is what keeps the model honest: without it, one skipped cell in
    a strip shifted every later line by one (sheet 014 scored 3 % raw for that
    reason alone) and blanks were padded blind. With "01".."10" printed on the
    strip and echoed in the answer, every line is anchored to its cell.
    """
    from PIL import ImageDraw, ImageFont
    try:
        font = ImageFont.truetype("arial.ttf", 64)
    except Exception:
        font = ImageFont.load_default()
    ims = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        h = int(im.height * width / im.width)
        ims.append(im.resize((width, h)))
    H = sum(i.height for i in ims) + pad * (len(ims) + 1)
    out = Image.new("RGB", (label_w + width + 2 * pad, H), (255, 255, 255))
    draw = ImageDraw.Draw(out)
    y = pad
    for i, im in enumerate(ims):
        out.paste(im, (label_w + pad, y))
        draw.rectangle([0, y, label_w - 6, y + im.height], outline=(0, 0, 0), width=3)
        draw.text((12, y + im.height // 2 - 32), f"{i+1:02d}", fill=(0, 0, 0), font=font)
        y += im.height + pad
    return out


def main(manifest: str, cells_root: str, out_path: str, limit: int | None = None):
    items = json.load(open(manifest))
    if limit:
        items = items[:limit]
    proc = AutoProcessor.from_pretrained(MODEL)
    mdl = AutoModelForImageTextToText.from_pretrained(
        MODEL, dtype=torch.bfloat16, device_map={"": "cuda:0"}).eval()
    out: dict[str, list] = {}
    if Path(out_path).exists():
        out = json.load(open(out_path))          # resumable
    todo = [it for it in items if it["id"] not in out]
    print(f"{len(items)} cells, {len(todo)} to do", flush=True)
    t0 = time.time()
    for s in range(0, len(todo), STRIP_N):
        chunk = todo[s:s + STRIP_N]
        img = stack([Path(cells_root) / it["file"] for it in chunk])
        msgs = [{"role": "user", "content": [
            {"type": "image", "image": img},
            {"type": "text", "text": PROMPT.format(n=len(chunk))}]}]
        inputs = proc.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True,
                                          return_dict=True, return_tensors="pt").to(mdl.device)
        with torch.inference_mode():
            gen = mdl.generate(**inputs, do_sample=False, max_new_tokens=9 * len(chunk) + 6,   # "01: Nbd7+" is ~7 tokens; a tight cap stops rambling
                               return_dict_in_generate=True, output_scores=True)
        seq = gen.sequences[0, inputs["input_ids"].shape[1]:]
        text = proc.decode(seq, skip_special_tokens=True)
        text = text.replace("<|im_end|>", "")
        # per-token probabilities → per-line mean, split on newline tokens
        probs = []
        for step, tok in zip(gen.scores, seq.tolist()):
            probs.append(float(torch.softmax(step[0].float(), -1)[tok]))
        pieces = proc.tokenizer.convert_ids_to_tokens(seq.tolist())
        lines, cur, cur_p = [], "", []
        for tk, pr, tid in zip(pieces, probs, seq.tolist()):
            frag = proc.tokenizer.decode([tid])
            if frag.startswith("<|") and frag.endswith("|>"):
                continue                      # <|im_end|> etc. are not ink
            if "\n" in frag:
                lines.append((cur.strip(), sum(cur_p) / len(cur_p) if cur_p else 0.0))
                cur, cur_p = "", []
            else:
                cur += frag; cur_p.append(pr)
        if cur.strip():
            lines.append((cur.strip(), sum(cur_p) / len(cur_p) if cur_p else 0.0))
        # Anchor every answer line to its printed label; a missing label is an
        # honest blank rather than a shifted neighbour.
        by_label: dict[int, tuple[str, float]] = {}
        for txt, conf in lines:
            m = re.match(r"^\s*(\d{1,2})\s*[:.)\-]\s*(.*)$", txt)
            if m:
                k = int(m.group(1)); v = m.group(2).strip()
                if 1 <= k <= len(chunk) and k not in by_label:
                    by_label[k] = ("" if v in ("-", "—", "") else v, conf)
        for k, it in enumerate(chunk, start=1):
            txt, conf = by_label.get(k, ("", 0.0))
            out[it["id"]] = [[txt, round(conf, 4)]]
        if (s // STRIP_N) % 10 == 0:
            done = s + len(chunk)
            print(f"{done}/{len(todo)}  {(time.time()-t0)/max(done,1):.2f}s/cell  last: {[l[0] for l in lines][:5]}", flush=True)
            json.dump(out, open(out_path, "w"), indent=0)
    json.dump(out, open(out_path, "w"), indent=0)
    print("done", len(out), "cells in", round(time.time() - t0), "s", flush=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], a[2], int(a[3]) if len(a) > 3 else None)
