"""Split a rectified scoresheet photo into ordered move cells.

  python split_scoresheet.py sheet.png out_dir [--moves-per-column 30]

Finds the printed grid with morphology (long horizontal / vertical kernels on
the binarised page), clusters the line positions into row and column
boundaries, then walks the layout: the page is column BLOCKS of
[move-number | White | Black]; blocks are read left to right, rows top to
bottom, so cell order is the move order. Writes <n>_white.png / <n>_black.png
and a manifest.json in the same shape read_scoresheet.py / the harness use.

Works on the HCS pages (already perspective-corrected). Phone photos should go
through the vision service's /warp-with-corners first.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
import cv2, numpy as np


def _lines(bin_img: np.ndarray, axis: int, min_frac: float) -> list[int]:
    h, w = bin_img.shape
    if axis == 0:   # horizontal lines → row boundaries (y)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, int(w * min_frac)), 1))
    else:           # vertical lines → column boundaries (x)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, int(h * min_frac))))
    m = cv2.morphologyEx(bin_img, cv2.MORPH_OPEN, k)
    proj = m.sum(axis=1 if axis == 0 else 0) / 255
    thr = (w if axis == 0 else h) * min_frac * 0.6
    idx = np.where(proj > thr)[0]
    # cluster consecutive indices
    out, cur = [], []
    for i in idx:
        if cur and i - cur[-1] > 3:
            out.append(int(np.mean(cur))); cur = []
        cur.append(i)
    if cur: out.append(int(np.mean(cur)))
    return out


def split(img_path: str, out_dir: str, moves_per_column: int = 30, pad: int = 3) -> list[dict]:
    img = cv2.imread(img_path)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    b = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 12)
    ys = _lines(b, 0, 0.12)      # short kernel: a skewed or ink-crossed line still survives the opening
    xs = _lines(b, 1, 0.5)       # a column line spans at least half the height
    h, w = g.shape
    if not xs or xs[0] > w * 0.03: xs = [0] + xs
    if xs[-1] < w * 0.97: xs.append(w - 1)
    # Vertical lines are often faint (the grey number band has no rule at all).
    # A move-sheet column is never wider than ~40 % of the page, so any wider
    # span is a missed line: split it at the strongest ink valley, else evenly.
    fixed = [xs[0]]
    for x in xs[1:]:
        span = x - fixed[-1]
        n = int(round(span / (w * 0.25)))
        if n >= 2:
            for j in range(1, n):
                fixed.append(int(round(fixed[-1] + span / (n - j + 1))))
        fixed.append(x)
    xs = fixed
    if not ys or ys[0] > h * 0.03: ys = [0] + ys
    if ys[-1] < h * 0.97: ys.append(h - 1)
    gaps = np.diff(ys)
    typical = [g_ for g_ in gaps if 0.6 * np.median(gaps) < g_ < 1.6 * np.median(gaps)]
    period = float(np.median(typical)) if typical else float(np.median(gaps))
    # Trust every detected line; only FILL gaps that are a whole number of
    # periods (a line lost under ink), and merge lines closer than half a
    # period (double-detected edges).
    lines = [ys[0]]
    for y in ys[1:]:
        gap = y - lines[-1]
        if gap < 0.5 * period:
            continue
        k = int(round(gap / period))
        if k >= 2 and abs(gap / k - period) < 0.15 * period:
            for j in range(1, k):
                lines.append(int(round(lines[-1] + gap / k)))
        lines.append(y)
    rows = [(lines[i], lines[i + 1]) for i in range(len(lines) - 1)]
    # header / footer rows have a different height than move rows
    rows = [r for r in rows if abs((r[1] - r[0]) - period) < 0.2 * period]
    # Layout prior: a standard sheet has the same number of move rows in every
    # block (30 on HCS/AICF sheets). If we ended up with a few too many or too
    # few, re-lay the grid evenly across the span of the kept rows.
    if rows and moves_per_column and abs(len(rows) - moves_per_column) in (1, 2, 3):
        y0, y1 = rows[0][0], rows[-1][1]
        step = (y1 - y0) / moves_per_column
        rows = [(int(round(y0 + i * step)), int(round(y0 + (i + 1) * step))) for i in range(moves_per_column)]
    # columns: classify by width — the narrow ones are move-number columns
    cw = np.diff(xs); cols = [(xs[i], xs[i + 1]) for i in range(len(xs) - 1) if cw[i] > w * 0.02]
    widths = np.array([c[1] - c[0] for c in cols])
    narrow = widths < 0.6 * np.median(widths)
    blocks, i = [], 0
    while i < len(cols):
        if narrow[i]:
            i += 1; continue                                  # a separate move-number column: skip it
        if i + 1 < len(cols) and not narrow[i + 1]:
            blocks.append((cols[i], cols[i + 1])); i += 2     # (white, black)
        else:
            i += 1
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    manifest = []
    move = 0
    for bi, (wc, bc) in enumerate(blocks):
        for ri, (y0, y1) in enumerate(rows):
            move += 1
            for colour, (x0, x1) in (("white", wc), ("black", bc)):
                crop = img[max(0, y0 - pad):min(h, y1 + pad), max(0, x0 - pad):min(w, x1 + pad)]
                name = f"{move:03d}_{colour}.png"
                cv2.imwrite(str(out / name), crop)
                manifest.append({"id": name, "file": name, "move": move, "colour": colour,
                                 "box": [int(x0), int(y0), int(x1), int(y1)]})
    json.dump({"rows": len(rows), "blocks": len(blocks), "cells": manifest}, open(out / "manifest.json", "w"), indent=1)
    return manifest


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("sheet"); ap.add_argument("out_dir"); ap.add_argument("--moves-per-column", type=int, default=30)
    a = ap.parse_args()
    m = split(a.sheet, a.out_dir, a.moves_per_column)
    print(f"{len(m)} cells written to {a.out_dir}")
