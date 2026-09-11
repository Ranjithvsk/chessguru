"""CPU fallback reader for scoresheet cells: TrOCR (handwritten) on France.

Same manifest in, same reads.json out as hcs_qwen_read.py, so eval_scoresheet.py
does not care which one produced it. Unlike the VLM this is a real seq2seq OCR
model, so beam search gives us several candidates per cell with scores — which
is what the legality pass downstream wants. Runs in /opt/chessguru-vision/.venv-ocr.
"""
from __future__ import annotations
import json, sys, time, math
from pathlib import Path
import torch
from PIL import Image
from transformers import VisionEncoderDecoderModel, ViTImageProcessor, RobertaTokenizerFast

MODEL = "microsoft/trocr-base-handwritten"
BATCH = 16
K = 3


def main(manifest: str, cells_root: str, out_path: str, limit: int | None = None):
    items = json.load(open(manifest))
    if limit:
        items = items[:limit]
    torch.set_num_threads(max(1, torch.get_num_threads() - 1))
    # transformers 5 cannot build TrOCRProcessor for this checkpoint (its
    # tokenizer_config says RobertaTokenizer and the slow→fast conversion path is
    # gone), so assemble the two halves ourselves.
    ip = ViTImageProcessor.from_pretrained(MODEL)
    tok = RobertaTokenizerFast.from_pretrained(MODEL)
    # Chess-constrained decoding. Zero-shot, this model's language prior drags
    # every cell toward an English word ("subjections.", "13March") because that
    # is what it was trained to expect. A move box can only ever hold a handful
    # of characters, so restrict the decoder to BPE tokens made ONLY of those
    # characters (plus EOS). The encoder still reads the ink; we just stop the
    # decoder from hallucinating vocabulary a scoresheet cannot contain.
    ALLOWED = set("KQRBNabcdefgh12345678xX+#=O0-")
    vocab = tok.get_vocab()
    allowed_ids = [i for t_, i in vocab.items()
                   if t_ and all(ch in ALLOWED for ch in t_.replace("\u0120", ""))] + [tok.eos_token_id]
    allowed_ids = sorted(set(allowed_ids))
    print(f"chess-constrained decoding: {len(allowed_ids)} of {len(vocab)} tokens allowed", flush=True)
    allow = lambda batch_id, input_ids: allowed_ids
    mdl = VisionEncoderDecoderModel.from_pretrained(MODEL).eval()
    out: dict[str, list] = json.load(open(out_path)) if Path(out_path).exists() else {}
    todo = [it for it in items if it["id"] not in out]
    print(f"{len(items)} cells, {len(todo)} to do", flush=True)
    t0 = time.time()
    for s in range(0, len(todo), BATCH):
        chunk = todo[s:s + BATCH]
        ims = [Image.open(Path(cells_root) / it["file"]).convert("RGB") for it in chunk]
        pv = ip(images=ims, return_tensors="pt").pixel_values
        with torch.inference_mode():
            gen = mdl.generate(pv, num_beams=4, num_return_sequences=K, max_new_tokens=10,
                               prefix_allowed_tokens_fn=allow,
                               output_scores=True, return_dict_in_generate=True)
        texts = tok.batch_decode(gen.sequences, skip_special_tokens=True)
        scores = gen.sequences_scores.tolist()          # length-normalised log-probs
        for i, it in enumerate(chunk):
            cands = []
            for j in range(K):
                t = texts[i * K + j].strip().replace(" ", "")
                p = math.exp(scores[i * K + j])
                if t and t not in [c[0] for c in cands]:
                    cands.append([t, round(p, 4)])
            out[it["id"]] = cands or [["", 0.0]]
        done = s + len(chunk)
        if (s // BATCH) % 5 == 0:
            print(f"{done}/{len(todo)}  {(time.time()-t0)/done:.2f}s/cell  last: {[out[it['id']][0][0] for it in chunk[:6]]}", flush=True)
            json.dump(out, open(out_path, "w"))
    json.dump(out, open(out_path, "w"))
    print("done", len(out), "cells in", round(time.time() - t0), "s", flush=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], a[2], int(a[3]) if len(a) > 3 else None)
