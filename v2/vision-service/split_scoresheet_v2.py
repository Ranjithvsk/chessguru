"""Split a PHONE PHOTO of a printed scoresheet into move cells.

Built on the owner's first real photo (2026-09-12): an Indian tournament sheet
— magenta grid on white, green ink, blocks of [No | White | Black] × 3 with 20
rows each, a header row inside the grid, photographed at an angle with a fold
and a phone lying on the corner. The HCS-page splitter failed on it outright.

Approach:
  1. The grid is coloured. Mask the magenta/red ink by hue, close it into lines.
  2. The move table is the largest quadrilateral of that mask → perspective warp.
  3. In the warped table, rows/columns are the peaks of the mask's projections.
  4. Columns classify by width: narrow = move-number column, wide = move cells;
     blocks are [narrow, wide, wide]. Rows: the first is the printed header.
  5. Cells are emitted block-major (block 1 rows, then block 2 …) = move order.
  6. Each crop is converted with the RED channel: magenta rules vanish, green
     ink goes near-black — the reader was trained on pencil/black on white.

  python split_scoresheet_v2.py photo.jpg out_dir [--rows-per-block 20]
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
import cv2, numpy as np


def grid_mask(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    # magenta/red/pink rules: hue near 0/180 (OpenCV 0-179), some saturation, not dark
    m = ((h >= 150) | (h <= 12)) & (s >= 50) & (v >= 70)
    m = m.astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    return m


def table_quad(mask: np.ndarray):
    """Outer quadrilateral of the grid: largest connected magenta structure."""
    big = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25)))
    cnts, _ = cv2.findContours(big, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.1 * mask.shape[0] * mask.shape[1]:
        return None
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    for eps in (0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)
    # fall back to the min-area rectangle
    return cv2.boxPoints(cv2.minAreaRect(hull)).astype(np.float32)


def order_quad(q: np.ndarray) -> np.ndarray:
    s = q.sum(axis=1); d = np.diff(q, axis=1).ravel()
    return np.array([q[np.argmin(s)], q[np.argmin(d)], q[np.argmax(s)], q[np.argmax(d)]], dtype=np.float32)  # tl, tr, br, bl


def warp(bgr: np.ndarray, quad: np.ndarray, width: int = 2000):
    q = order_quad(quad)
    w = int(max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[2] - q[3])))
    h = int(max(np.linalg.norm(q[3] - q[0]), np.linalg.norm(q[2] - q[1])))
    scale = width / max(1, w); W, H = width, int(h * scale)
    M = cv2.getPerspectiveTransform(q, np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], dtype=np.float32))
    return cv2.warpPerspective(bgr, M, (W, H))


def peaks(profile: np.ndarray, min_gap: int, thr_frac: float = 0.35) -> list[int]:
    thr = profile.max() * thr_frac
    idx = np.where(profile > thr)[0]
    out, cur = [], []
    for i in idx:
        if cur and i - cur[-1] > 2:
            out.append(int(np.mean(cur))); cur = []
        cur.append(i)
    if cur: out.append(int(np.mean(cur)))
    merged = []
    for p in out:
        if merged and p - merged[-1] < min_gap: merged[-1] = (merged[-1] + p) // 2
        else: merged.append(p)
    return merged


def to_reader_gray(cell_bgr: np.ndarray) -> np.ndarray:
    """Red channel: magenta rules → white, green ink → dark. Then stretch."""
    r = cell_bgr[..., 2].astype(np.float32)
    lo, hi = np.percentile(r, 2), np.percentile(r, 85)
    g = np.clip((r - lo) / max(1.0, hi - lo), 0, 1) * 255
    return g.astype(np.uint8)


def strip_rows(mask: np.ndarray, xa: int, xb: int, min_gap: int) -> list[int]:
    """Row-rule y positions inside a narrow, ink-free vertical strip."""
    strip = mask[:, xa:xb]
    k = max(10, min(40, (xb - xa) // 2))
    hl = cv2.morphologyEx(strip, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, 1)))
    return peaks(hl.sum(axis=1), min_gap=min_gap, thr_frac=0.2)


def _fill(ys: list[int]) -> tuple[list[int], float]:
    gaps = np.diff(ys); typical = [g for g in gaps if 0.6 * np.median(gaps) < g < 1.6 * np.median(gaps)]
    period = float(np.median(typical)) if typical else float(np.median(gaps))
    out = [ys[0]]
    for y in ys[1:]:
        gap = y - out[-1]
        if gap < 0.5 * period: continue
        k = int(round(gap / period))
        if k >= 2 and abs(gap / k - period) < 0.25 * period:
            for j in range(1, k): out.append(int(round(out[-1] + gap / k)))
        out.append(y)
    return out, period


def block_rules(mask: np.ndarray, nx0: int, nx1: int, bx1: int, rows_per_block: int, right_strip: tuple[int, int] | None = None):
    """Rules of one block as (y_at_left, y_at_right) pairs, top→bottom.

    Handwriting breaks the rules inside the move cells, so the rule positions
    are read where nothing is written: the move-number column on the left
    (nx0..nx1) and a thin strip at the block's right edge. Each rule is the
    straight line between its two anchors, which follows a fold or a tilt
    without any global angle."""
    h = mask.shape[0]; min_gap = int(h * 0.022)
    # the printed move numbers are magenta too and sit in the middle of their
    # column; their strokes pulled the anchors half a row off. Read the rules in
    # the blank margin between the digits and the column's right rule.
    nw = nx1 - nx0
    left = strip_rows(mask, int(nx1 - 0.30 * nw), int(nx1 - 0.08 * nw), min_gap)
    # right anchor: the NEXT block's number column when there is one (same rules,
    # never written on); the block's own right margin is a fallback, and a long
    # black move (Nxd3, Qb6) running into it was mis-anchoring rows.
    if right_strip:
        rw = right_strip[1] - right_strip[0]
        ra, rb = int(right_strip[0] + 0.08 * rw), int(right_strip[0] + 0.30 * rw)      # left margin of the next number column
    else:
        ra, rb = max(nx1, bx1 - 45), bx1 - 3
    right = strip_rows(mask, ra, rb, min_gap)
    if len(left) < 3: return []
    left, period = _fill(left)
    if len(right) >= 3: right, _ = _fill(right)
    # Pair left and right anchors through the sheet's tilt, not by nearest y:
    # across ~700 px a 3° tilt moves a rule half a row, and nearest-match
    # then grabbed the neighbouring rule on one side (cells came out as
    # diagonals holding two rows). The tilt is the median offset over all
    # nearest pairs; each left anchor then takes the right anchor closest to
    # y + tilt, or y + tilt itself when none is near.
    pairs = []
    if right:
        offs = [min(right, key=lambda r: abs(r - y)) - y for y in left]
        offs = [o for o in offs if abs(o) < 0.6 * period]
        tilt = float(np.median(offs)) if offs else 0.0
        for y in left:
            cand = [r for r in right if abs(r - (y + tilt)) < 0.3 * period]
            pairs.append((y, min(cand, key=lambda r: abs(r - (y + tilt))) if cand else y + tilt))
    else:
        pairs = [(y, y) for y in left]
    rows = [(pairs[i], pairs[i + 1]) for i in range(len(pairs) - 1) if abs((pairs[i + 1][0] - pairs[i][0]) - period) < 0.3 * period]
    if len(rows) >= rows_per_block + 1: rows = rows[1:rows_per_block + 1]     # header row first
    return rows[:rows_per_block], (nx0 + nx1) / 2, (ra + rb) / 2, period


def split(photo: str, out_dir: str, rows_per_block: int = 20) -> dict:
    bgr = cv2.imread(photo)
    if bgr is None:
        raise SystemExit("cannot read image")
    mask = grid_mask(bgr)
    quad = table_quad(mask)
    if quad is None:
        raise SystemExit("no coloured grid found")
    tab = warp(bgr, quad)
    tm = grid_mask(tab)
    H, W = tm.shape
    vl = cv2.morphologyEx(tm, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, H // 12)))
    xs = peaks(vl.sum(axis=0), min_gap=int(W * 0.03), thr_frac=0.2)
    if not xs or xs[0] > W * 0.03: xs = [0] + xs
    if xs[-1] < W * 0.97: xs.append(W - 1)
    cols = [(xs[i], xs[i + 1]) for i in range(len(xs) - 1) if xs[i + 1] - xs[i] > W * 0.03]
    widths = np.array([b - a for a, b in cols]); med = np.median(widths)
    narrow = widths < 0.6 * med
    blocks, i = [], 0
    while i < len(cols):
        if narrow[i] and i + 2 < len(cols) and not narrow[i + 1] and not narrow[i + 2]:
            blocks.append((cols[i + 1], cols[i + 2], cols[i])); i += 3          # (white, black, number column)
        elif not narrow[i] and i + 1 < len(cols) and not narrow[i + 1]:
            blocks.append((cols[i], cols[i + 1], (cols[i][0], cols[i][0] + 40))); i += 2   # no number column: anchor on the cell's left margin
        else:
            i += 1
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out / "_table.jpg"), tab, [cv2.IMWRITE_JPEG_QUALITY, 80])
    cells = []; move = 0; pad = 3; debug = tab.copy(); nrows = []
    for bi, (wc, bc, nc) in enumerate(blocks):
        bx1 = int(bc[1])
        nxt = blocks[bi + 1][2] if bi + 1 < len(blocks) else None
        rs = (int(nxt[0]) + 3, int(nxt[1]) - 3) if nxt and int(nxt[1]) - int(nxt[0]) > 20 else None
        res = block_rules(tm, int(nc[0]), int(nc[1]), bx1, rows_per_block, rs)
        if not res: nrows.append(0); continue
        rows, xl, xr, period = res; nrows.append(len(rows))
        # Three clean vertical strips per block give three independent row
        # lists: the number-column margin, the white cell's right margin and
        # the black cell's right margin (moves are written from the left, so
        # the last 30 px of a cell are almost always blank). Rows are matched
        # ACROSS strips by order after gap-filling, not by height — the paper
        # bows and the global warp can be a whole row off at one side.
        def strip_list(xa, xb):
            ys = strip_rows(tm, int(xa), int(xb), int(H * 0.022))
            if len(ys) < 3: return None
            ys, _ = _fill(ys); return ys
        def aligned(base, other):
            """Pair each base row with `other` by order, anchored on the row whose
            heights agree best (handles a list that starts one rule earlier)."""
            if not other: return None
            best, best_err = 0, 1e18
            for shift in range(-2, 3):
                err = n = 0
                for i, y in enumerate(base):
                    j = i + shift
                    if 0 <= j < len(other): err += abs(other[j] - y); n += 1
                if n >= 3 and err / n < best_err: best_err, best = err / n, shift
            return [other[i + best] if 0 <= i + best < len(other) else None for i in range(len(base))]
        # The number column sits on the sheet's curled edge and its rules land
        # half a row off the move cells after the warp. Anchor every cell on ITS
        # OWN margins: the first and last ~20 px inside the cell, which the
        # handwriting almost never reaches. The number column only supplies the
        # row count / period and the header offset.
        wx0, wx1 = int(wc[0]), int(wc[1]); kx0, kx1 = int(bc[0]), int(bc[1])
        base_n = len(rows) + 1
        wl = strip_list(wx0 + 8, wx0 + 26); wr = strip_list(wx1 - 30, wx1 - 10)
        kl = strip_list(kx0 + 8, kx0 + 26); kr = strip_list(kx1 - 30, kx1 - 10)
        ref = wl or wr or kl or kr
        if ref is None:
            continue
        # header: drop leading rules until the run has base_n entries
        if len(ref) > base_n: ref = ref[len(ref) - base_n:] if len(ref) - base_n <= 2 else ref[1:base_n + 1]
        wl_a, wr_a, kl_a, kr_a = (aligned(ref, x) for x in (wl, wr, kl, kr))
        def at(lst, i, fallback):
            return lst[i] if lst and i < len(lst) and lst[i] is not None and abs(lst[i] - fallback) < 0.6 * period else fallback
        nrows[-1] = len(ref) - 1
        for ri in range(len(ref) - 1):
            move += 1
            r_t, r_b = ref[ri], ref[ri + 1]
            wlt, wlb = at(wl_a, ri, r_t), at(wl_a, ri + 1, r_b)
            wrt, wrb = at(wr_a, ri, wlt), at(wr_a, ri + 1, wlb)
            klt, klb = at(kl_a, ri, wrt), at(kl_a, ri + 1, wrb)
            krt, krb = at(kr_a, ri, klt), at(kr_a, ri + 1, klb)
            for colour, (x0, x1, a_t, a_b, b_t, b_b) in (("white", (wx0, wx1, wlt, wlb, wrt, wrb)), ("black", (kx0, kx1, klt, klb, krt, krb))):
                src = np.array([[x0 + pad, a_t + pad], [x1 - pad, b_t + pad], [x1 - pad, b_b - pad], [x0 + pad, a_b - pad]], dtype=np.float32)
                yt = lambda x, a=a_t, b=b_t: a + (b - a) * (x - x0) / max(1, x1 - x0)
                yb = lambda x, a=a_b, b=b_b: a + (b - a) * (x - x0) / max(1, x1 - x0)
                cw = x1 - x0 - 2 * pad; ch = int(max(8, (yb(x0) + yb(x1) - yt(x0) - yt(x1)) / 2 - 2 * pad))
                M = cv2.getPerspectiveTransform(src, np.array([[0, 0], [cw - 1, 0], [cw - 1, ch - 1], [0, ch - 1]], dtype=np.float32))
                crop = cv2.warpPerspective(tab, M, (cw, ch))
                name = f"{move:03d}_{colour}.png"
                cv2.imwrite(str(out / name), to_reader_gray(crop))
                cells.append({"id": name, "file": name, "move": move, "colour": colour, "block": bi})
                cv2.polylines(debug, [src.astype(np.int32)], True, (0, 200, 0), 2)
    cv2.imwrite(str(out / "_debug.jpg"), cv2.resize(debug, None, fx=0.4, fy=0.4), [cv2.IMWRITE_JPEG_QUALITY, 80])
    info = {"rows": nrows, "blocks": len(blocks), "cols": len(cols), "cells": cells, "table_size": [W, H]}
    json.dump(info, open(out / "manifest.json", "w"), indent=1)
    return info


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("photo"); ap.add_argument("out_dir"); ap.add_argument("--rows-per-block", type=int, default=20)
    a = ap.parse_args(); info = split(a.photo, a.out_dir, a.rows_per_block)
    print(f"rows {info['rows']} blocks {info['blocks']} cols {info['cols']} → {len(info['cells'])} cells in {a.out_dir}")
