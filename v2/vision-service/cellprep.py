"""Ink-tight cropping for move cells, shared by training and inference.

A scoresheet cell is ~5.5:1 wide and the handwriting sits in its left third;
TrOCR squashes the whole cell into a 384×384 square, so most of the model's
pixels went to empty paper. Crop to the handwriting's horizontal extent (with
margin) before resizing. Full height is kept — descenders and the row rules
matter. The printed move number, when it sits in its own band at the far
left, is dropped: it is not ink the reader should spend pixels on.
"""
from __future__ import annotations
import numpy as np
from PIL import Image


def _spans(mask: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return []
    spans, s, prev = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - prev > min_gap:
            spans.append((s, prev)); s = i
        prev = i
    spans.append((s, prev))
    return spans


def tight_crop(im: Image.Image, margin: float = 0.06, min_width_frac: float = 0.35) -> Image.Image:
    g = np.asarray(im.convert("L"), dtype=np.float32)
    h, w = g.shape
    core = g[int(h * 0.15): int(h * 0.85), int(w * 0.02): int(w * 0.98)]     # drop rules and borders
    paper = np.percentile(core, 60)
    dark = core < paper - max(35.0, 0.25 * paper)                              # clearly darker than the paper
    ink_cols = dark.sum(axis=0) >= 2
    spans = _spans(ink_cols, min_gap=int(w * 0.06))
    spans = [(a + int(w * 0.02), b + int(w * 0.02)) for a, b in spans if b - a >= 4]
    if not spans:
        return im
    # a printed move-number band: first span inside the leftmost 18 %, clear of the rest
    if len(spans) > 1 and spans[0][1] < w * 0.18 and spans[1][0] - spans[0][1] > w * 0.04:
        spans = spans[1:]
    # the handwriting is the widest span (merging neighbours closer than 6 %)
    x0, x1 = min(a for a, _ in spans), max(b for _, b in spans)
    pad = int(w * margin)
    x0, x1 = max(0, x0 - pad), min(w, x1 + pad)
    if x1 - x0 < w * min_width_frac:
        need = int(w * min_width_frac) - (x1 - x0)
        x0 = max(0, x0 - need // 2); x1 = min(w, x0 + int(w * min_width_frac))
    return im.crop((x0, 0, x1, h))
