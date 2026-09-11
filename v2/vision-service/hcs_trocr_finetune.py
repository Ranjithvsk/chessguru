"""Phase B: fine-tune TrOCR on HCS handwritten move cells. Runs on Vinayaka.

  python hcs_trocr_finetune.py <data_dir> <out_dir> [epochs]

<data_dir> holds cells/ and train_labels.tsv (file<TAB>san). Writes its own
log (out_dir/train.log) because a detached Windows process has no stdout worth
trusting, and saves the best checkpoint by validation exact-match to
out_dir/best. Plain PyTorch loop on purpose: transformers 5 broke
TrOCRProcessor for this checkpoint, so the processor is assembled from
ViTImageProcessor + RobertaTokenizerFast exactly as the CPU reader does.
"""
from __future__ import annotations
import sys, time, random, math, json
from pathlib import Path
import torch
from torch.utils.data import Dataset, DataLoader
from PIL import Image, ImageOps
from torchvision import transforms as T
from transformers import VisionEncoderDecoderModel, ViTImageProcessor, RobertaTokenizerFast

import os
MODEL = "microsoft/trocr-base-handwritten"
INIT = os.environ.get("TROCR_INIT", MODEL)          # continue from a checkpoint dir for stage-2 runs
BATCH = int(__import__("os").environ.get("BATCH", "12"))   # 24 filled the 10 GB card and thrashed at 5 s/step
LR = float(os.environ.get("LR", "4e-5"))
LABEL_SMOOTH = float(os.environ.get("LABEL_SMOOTH", "0.0"))
VAL_FRAC = 0.05
MAXLEN = 12


class Cells(Dataset):
    """Cells → 384×384 tensors. The HF ViTImageProcessor does the same resize
    (bilinear) + normalise (mean .5 / std .5) but in per-image Python; with one
    loader worker that starved the GPU to 6 s/step on run 1. torchvision does
    it in C and the DataLoader fans it out over workers."""
    def __init__(self, rows, root, train):
        self.rows, self.root, self.train = rows, Path(root), train
        base = [T.Resize((384, 384), interpolation=T.InterpolationMode.BILINEAR), T.ToTensor(), T.Normalize([0.5] * 3, [0.5] * 3)]
        strong = os.environ.get("AUG", "1") == "2"
        aug = [T.RandomAffine(degrees=4 if strong else 2, translate=(0.03, 0.08) if strong else (0.02, 0.06), scale=(0.85, 1.1) if strong else (0.9, 1.05), shear=5 if strong else 3, fill=255),
               T.ColorJitter(brightness=0.35 if strong else 0.25, contrast=0.35 if strong else 0.25),
               T.RandomApply([T.GaussianBlur(3, sigma=(0.1, 1.0))], p=0.3 if strong else 0.0)] if train else []
        self.tf = T.Compose(aug + base)

    def __len__(self): return len(self.rows)

    def __getitem__(self, i):
        f, san = self.rows[i]
        im = Image.open(self.root / "cells" / f).convert("RGB")
        return self.tf(im), san


def collate(b):
    return torch.stack([x[0] for x in b]), [x[1] for x in b]


def main(data_dir: str, out_dir: str, epochs: int = 8):
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    log = open(out / "train.log", "a", buffering=1)
    def say(*a):
        msg = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a); print(msg, flush=True); log.write(msg + "\n")
    rows = [l.rstrip("\n").split("\t") for l in open(Path(data_dir) / "train_labels.tsv", encoding="utf-8") if "\t" in l]
    random.seed(3); random.shuffle(rows)
    nval = int(len(rows) * VAL_FRAC); val, train = rows[:nval], rows[nval:]
    say(f"train {len(train)} val {len(val)} epochs {epochs} batch {BATCH} lr {LR}")
    ip = ViTImageProcessor.from_pretrained(MODEL); tok = RobertaTokenizerFast.from_pretrained(MODEL)
    mdl = VisionEncoderDecoderModel.from_pretrained(INIT)
    say(f"init from {INIT}  label_smooth {LABEL_SMOOTH}")
    mdl.config.decoder_start_token_id = tok.cls_token_id
    mdl.config.pad_token_id = tok.pad_token_id
    mdl.config.eos_token_id = tok.sep_token_id
    mdl.generation_config.max_new_tokens = MAXLEN
    dev = torch.device("cuda"); mdl.to(dev)
    dl = DataLoader(Cells(train, data_dir, True), batch_size=BATCH, shuffle=True, num_workers=6,
                    persistent_workers=True, pin_memory=True, collate_fn=collate)
    vdl = DataLoader(Cells(val, data_dir, False), batch_size=48, shuffle=False, num_workers=4, collate_fn=collate)
    def encode(sans):
        ids = tok(sans, max_length=MAXLEN, padding="max_length", truncation=True, return_tensors="pt").input_ids
        ids[ids == tok.pad_token_id] = -100
        return ids
    opt = torch.optim.AdamW(mdl.parameters(), lr=LR, weight_decay=0.01)
    steps = epochs * len(dl); warm = int(0.05 * steps)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / max(1, warm)) * max(0.0, (steps - s) / max(1, steps - warm)))
    scaler = torch.amp.GradScaler("cuda")
    best = -1.0; step = 0

    def evaluate():
        mdl.eval(); ok = n = 0; cer_num = cer_den = 0
        with torch.inference_mode():
            for pv, sans in vdl:
                gen = mdl.generate(pv.to(dev), num_beams=3, max_new_tokens=MAXLEN)
                preds = [p.strip().replace(" ", "") for p in tok.batch_decode(gen, skip_special_tokens=True)]
                for p, s in zip(preds, sans):
                    n += 1; ok += (p == s)
                    # char error rate via Levenshtein
                    a, b = p, s; d = list(range(len(b) + 1))
                    for i, ca in enumerate(a, 1):
                        prev, d[0] = d[0], i
                        for j, cb in enumerate(b, 1):
                            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
                    cer_num += d[len(b)]; cer_den += max(1, len(b))
        mdl.train(); return ok / max(1, n), cer_num / max(1, cer_den), preds[:6], sans[:6]

    mdl.train()
    for ep in range(1, epochs + 1):
        t0 = time.time(); tot = 0.0
        for pv, sans in dl:
            labels = encode(sans)
            with torch.autocast("cuda", dtype=torch.float16):
                if LABEL_SMOOTH > 0:
                    out_ = mdl(pixel_values=pv.to(dev, non_blocking=True), labels=labels.to(dev))
                    logits = out_.logits.float()
                    loss = torch.nn.functional.cross_entropy(logits.view(-1, logits.size(-1)), labels.to(dev).view(-1),
                                                             ignore_index=-100, label_smoothing=LABEL_SMOOTH)
                else:
                    loss = mdl(pixel_values=pv.to(dev, non_blocking=True), labels=labels.to(dev)).loss
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward(); scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(mdl.parameters(), 1.0)
            scaler.step(opt); scaler.update(); sched.step(); step += 1
            tot += loss.item()
            if step % 50 == 0: say(f"ep {ep} step {step}/{steps} loss {tot/((step-1)%len(dl)+1):.4f}")
        acc, cer, p6, s6 = evaluate()
        say(f"== epoch {ep} done in {time.time()-t0:.0f}s  train-loss {tot/len(dl):.4f}  val exact {acc:.1%}  val CER {cer:.3f}  sample {list(zip(s6, p6))}")
        if acc > best:
            best = acc; mdl.save_pretrained(out / "best"); ip.save_pretrained(out / "best"); tok.save_pretrained(out / "best")
            json.dump({"epoch": ep, "val_exact": acc, "val_cer": cer}, open(out / "best" / "metrics.json", "w"))
            say(f"   saved best -> {out/'best'}")
    say(f"DONE best val exact {best:.1%}")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], int(a[2]) if len(a) > 2 else 8)
