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
import json, sys, time, math
from pathlib import Path
from PIL import Image
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor

MODEL = "Qwen/Qwen3-VL-4B-Instruct"
STRIP_N = 10
PROMPT = (
    "This image is a vertical strip of {n} handwritten chess score-sheet boxes, "
    "one move per box, top to bottom. Transcribe each box as chess notation exactly "
    "as written (examples: e4, Nf3, Bxc6, O-O, Qh4+, exd5, R1e2, a8=Q). "
    "Write exactly {n} lines, one per box, in order. If a box is empty write '-'. "
    "Do not explain, do not number the lines, do not correct the moves."
)


def stack(paths: list[Path], width: int = 960, pad: int = 6) -> Image.Image:
    ims = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        h = int(im.height * width / im.width)
        ims.append(im.resize((width, h)))
    H = sum(i.height for i in ims) + pad * (len(ims) + 1)
    out = Image.new("RGB", (width + 2 * pad, H), (255, 255, 255))
    y = pad
    for i, im in enumerate(ims):
        out.paste(im, (pad, y))
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
            gen = mdl.generate(**inputs, do_sample=False, max_new_tokens=16 * len(chunk) + 8,
                               return_dict_in_generate=True, output_scores=True)
        seq = gen.sequences[0, inputs["input_ids"].shape[1]:]
        text = proc.decode(seq, skip_special_tokens=True)
        # per-token probabilities → per-line mean, split on newline tokens
        probs = []
        for step, tok in zip(gen.scores, seq.tolist()):
            probs.append(float(torch.softmax(step[0].float(), -1)[tok]))
        pieces = proc.tokenizer.convert_ids_to_tokens(seq.tolist())
        lines, cur, cur_p = [], "", []
        for tk, pr, tid in zip(pieces, probs, seq.tolist()):
            frag = proc.tokenizer.decode([tid])
            if "\n" in frag:
                lines.append((cur.strip(), sum(cur_p) / len(cur_p) if cur_p else 0.0))
                cur, cur_p = "", []
            else:
                cur += frag; cur_p.append(pr)
        if cur.strip():
            lines.append((cur.strip(), sum(cur_p) / len(cur_p) if cur_p else 0.0))
        if len(lines) != len(chunk):
            # model miscounted: fall back to raw split, pad/truncate, mark low confidence
            raw = [l.strip() for l in text.splitlines() if l.strip()]
            lines = [(raw[i] if i < len(raw) else "", 0.2) for i in range(len(chunk))]
        for it, (txt, conf) in zip(chunk, lines):
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
