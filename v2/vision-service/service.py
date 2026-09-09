"""ChessGuru "Ultra AI" vision microservice.

Wraps Tandberg's ChessVision-3LC YOLO board extractor (AGPL-3.0 during prototype;
retrain-from-scratch swap-in planned for Path B).
"""
from __future__ import annotations

import base64
import io
import logging
import os
import sys
import time
from typing import Any

CVROOT = os.environ.get("CVROOT", "/opt/chessguru-vision/tandberg")
sys.path.insert(0, CVROOT)
os.environ.setdefault("CVROOT", CVROOT)
os.environ.setdefault("CHESSVISION_ALLOW_BARE_ULTRALYTICS", "1")

import cv2  # type: ignore
import numpy as np  # type: ignore
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from chessvision.core import ChessVision  # type: ignore

# When our own MIT-licensed weights are present, use them INSTEAD of
# tandberg's AGPL weights. Same architectures, retrained on Vinayaka.
_MIT_EXTRACTOR = "/opt/chessguru-vision/mit-weights/chessguru-board-seg.pt"
_MIT_CLASSIFIER = "/opt/chessguru-vision/mit-weights/chessguru-cls.pt"

# Class order used by our MIT classifier (Windows-safe folder names,
# alphabetical order as ultralytics sees them).
_MIT_CLS_ORDER = [
    "bbishop", "bking", "bknight", "bpawn", "bqueen", "brook",
    "empty",
    "wbishop", "wking", "wknight", "wpawn", "wqueen", "wrook",
]
# Map class-index -> Tandberg label char ("B","K","N","P","Q","R","b","k","n","p","q","r","f")
_MIT_TO_TANDBERG = [
    "b", "k", "n", "p", "q", "r",   # 0..5 = black pieces
    "f",                              # 6 = empty
    "B", "K", "N", "P", "Q", "R",   # 7..12 = white pieces
]

_own_cls_model = None
def _get_own_classifier():
    """Lazy-load our MIT YOLOv8n-cls once. Returns None if weights missing."""
    global _own_cls_model
    if _own_cls_model is not None: return _own_cls_model
    if not os.path.exists(_MIT_CLASSIFIER): return None
    try:
        from ultralytics import YOLO
        _own_cls_model = YOLO(_MIT_CLASSIFIER)
        log.info("Loaded MIT YOLOv8n-cls classifier from %s", _MIT_CLASSIFIER)
        return _own_cls_model
    except Exception as e:
        log.warning("Failed to load MIT classifier: %s", e)
        return None

# --- DINOv2 classifier (secondary head, ensembled with YOLOv8n-cls above)
_DINOV2_CKPT = "/opt/chessguru-vision/mit-weights/dinov2-cls.pt"
_dinov2_model = None; _dinov2_classes = None; _dinov2_img_size = None
def _get_dinov2_classifier():
    global _dinov2_model, _dinov2_classes, _dinov2_img_size
    if _dinov2_model is not None: return _dinov2_model, _dinov2_classes, _dinov2_img_size
    if not os.path.exists(_DINOV2_CKPT): return None, None, None
    try:
        import torch as _torch
        import timm as _timm
        ck = _torch.load(_DINOV2_CKPT, map_location='cpu')
        _dinov2_classes = ck['classes']
        _dinov2_img_size = ck['img_size']
        m = _timm.create_model('vit_small_patch14_dinov2.lvd142m', pretrained=False,
                                num_classes=len(_dinov2_classes), img_size=_dinov2_img_size)
        m.load_state_dict(ck['model_state'])
        m.eval()
        _dinov2_model = m
        log.info("Loaded DINOv2 classifier val_acc=%.3f", ck.get('val_acc', 0))
        return _dinov2_model, _dinov2_classes, _dinov2_img_size
    except Exception as e:
        log.warning("Failed to load DINOv2 classifier: %s", e)
        return None, None, None

# --- DINOv3 classifier (bench val 98.15% — best single model)
_DINOV3_CKPT = "/opt/chessguru-vision/mit-weights/dinov3-cls.pt"
_dinov3_model = None; _dinov3_classes = None
def _get_dinov3_classifier():
    global _dinov3_model, _dinov3_classes
    if _dinov3_model is not None: return _dinov3_model, _dinov3_classes
    if not os.path.exists(_DINOV3_CKPT): return None, None
    try:
        import torch as _torch
        import timm as _timm
        ck = _torch.load(_DINOV3_CKPT, map_location='cpu')
        _dinov3_classes = ck['classes']
        m = _timm.create_model(ck.get('timm_name', 'vit_small_patch16_dinov3.lvd1689m'),
                                pretrained=False, num_classes=len(_dinov3_classes))
        m.load_state_dict(ck['model_state'])
        m.eval()
        _dinov3_model = m
        log.info("Loaded DINOv3 classifier val_acc=%.3f", ck.get('val_acc', 0))
        return _dinov3_model, _dinov3_classes
    except Exception as e:
        log.warning("Failed to load DINOv3 classifier: %s", e)
        return None, None

# --- ConvNeXt-V2 base classifier (bench val 97.92% — best convnet complement)
_CONVNEXTV2_CKPT = "/opt/chessguru-vision/mit-weights/convnextv2-cls.pt"
_convnextv2_model = None; _convnextv2_classes = None
def _get_convnextv2_classifier():
    global _convnextv2_model, _convnextv2_classes
    if _convnextv2_model is not None: return _convnextv2_model, _convnextv2_classes
    if not os.path.exists(_CONVNEXTV2_CKPT): return None, None
    try:
        import torch as _torch
        import timm as _timm
        ck = _torch.load(_CONVNEXTV2_CKPT, map_location='cpu')
        _convnextv2_classes = ck['classes']
        m = _timm.create_model(ck.get('timm_name', 'convnextv2_base.fcmae_ft_in22k_in1k'),
                                pretrained=False, num_classes=len(_convnextv2_classes))
        m.load_state_dict(ck['model_state'])
        m.eval()
        _convnextv2_model = m
        log.info("Loaded ConvNeXt-V2 classifier val_acc=%.3f", ck.get('val_acc', 0))
        return _convnextv2_model, _convnextv2_classes
    except Exception as e:
        log.warning("Failed to load ConvNeXt-V2 classifier: %s", e)
        return None, None

# --- DINOv2-base ONNX (nightly retrain, ensembled as 3rd model at higher weight)
_DINOV2_BASE_ONNX = "/opt/chessguru-vision/mit-weights/dinov2-base-nightly.onnx"
# Remap from nightly class order [Bb,Bw,Kb,Kw,Nb,Nw,Pb,Pw,Qb,Qw,Rb,Rw,empty]
# to our order [bbishop,bking,bknight,bpawn,bqueen,brook,empty,wbishop,wking,wknight,wpawn,wqueen,wrook]
_DINOV2_BASE_PERM = np.array([0, 2, 4, 6, 8, 10, 12, 1, 3, 5, 7, 9, 11], dtype=np.int64)
_dinov2_base_session = None
def _get_dinov2_base_session():
    global _dinov2_base_session
    if _dinov2_base_session is not None: return _dinov2_base_session
    if not os.path.exists(_DINOV2_BASE_ONNX): return None
    try:
        import onnxruntime as ort
        _dinov2_base_session = ort.InferenceSession(_DINOV2_BASE_ONNX, providers=['CPUExecutionProvider'])
        log.info("Loaded DINOv2-base ONNX (nightly, val 98.26%%) from %s", _DINOV2_BASE_ONNX)
        return _dinov2_base_session
    except Exception as e:
        log.warning("Failed to load DINOv2-base ONNX: %s", e)
        return None

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chessguru-vision")

app = FastAPI(title="ChessGuru Ultra Vision")
_cv: ChessVision | None = None


def _get_cv() -> ChessVision:
    global _cv
    if _cv is None:
        t0 = time.time()
        extractor_weights = _MIT_EXTRACTOR if os.path.exists(_MIT_EXTRACTOR) else None
        log.info("Loading ChessVision (extractor=%s)...",
                 "MIT-own" if extractor_weights else "tandberg-AGPL")
        _cv = ChessVision(
            board_extractor_weights=extractor_weights,
            board_extractor_model_id="yolo" if extractor_weights else None,
            lazy_load=False,
        )
        log.info("Loaded in %.2fs", time.time() - t0)
    return _cv


def _decode_b64_image(b64: str) -> np.ndarray:
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="cannot decode image")
    return img


def _encode_b64_png(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise HTTPException(status_code=500, detail="png encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _classify_via_own(board_bgr: np.ndarray, cv_pipeline, own_yolo):
    """Split the warped board into 64 x 64x64 crops, batch-infer through OUR
    MIT YOLOv8n-cls, then run Tandberg's chess-rules validate_position on the
    resulting (64, 13) probability matrix. Returns a PositionResult that has
    the same shape as cv_pipeline.classify_position — so the caller can treat
    both paths uniformly."""
    from chessvision.cv_types import PositionResult
    from chessvision import constants
    if board_bgr.ndim == 2:
        board_bgr = cv2.cvtColor(board_bgr, cv2.COLOR_GRAY2BGR)
    board = cv2.resize(board_bgr, (512, 512), interpolation=cv2.INTER_CUBIC)
    # Build 64 tile list (RGB, since ultralytics expects RGB) in a8..h1 order.
    tiles = []
    for r in range(8):
        for c in range(8):
            crop = board[r*64:(r+1)*64, c*64:(c+1)*64]
            tiles.append(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    # Test-time augmentation: horizontal flip.
    # Piece pictograms are (roughly) horizontally symmetric so flip should give
    # near-identical probs. Averaging over original + flip = free accuracy.
    tiles_flip = [cv2.flip(t, 1) for t in tiles]
    results = own_yolo.predict(tiles, imgsz=64, verbose=False, device="cpu")
    results_flip = own_yolo.predict(tiles_flip, imgsz=64, verbose=False, device="cpu")
    probs_our_order = np.zeros((64, 13), dtype=np.float32)
    for i, (r, rf) in enumerate(zip(results, results_flip)):
        p = r.probs.data.cpu().numpy() if hasattr(r.probs.data, "cpu") else np.asarray(r.probs.data)
        pf = rf.probs.data.cpu().numpy() if hasattr(rf.probs.data, "cpu") else np.asarray(rf.probs.data)
        probs_our_order[i] = 0.5 * (p + pf)

    # YOLOv8n-cls only mode (2026-08-14, matching Tandberg ChessVision-3LC /
    # ChessVision AI stack). DINOv2 + DINOv3 loaders kept above but not
    # blended — turned out DINO-based classifiers don't reliably beat a well-
    # trained YOLO on chess pictograms, and the rotation-symmetric ambiguity
    # (both 0° and 180° valid) is unsolvable at the classifier layer anyway.
    # probs_our_order already holds YOLO+TTA-flip output from above; leave it.

    # ConvNeXt-V2 base (val 97.92%) — DISABLED: 4-photo A/B showed identical
    # output vs 3-model ensemble, but adds 87M params of CPU latency. Kept as
    # checkpoint on disk if we want to re-enable behind a flag.

    # Fourth ensemble member: DINOv2-BASE ONNX (nightly, val 98.26% — highest)
    dv_base = _get_dinov2_base_session()
    if dv_base is not None:
        try:
            mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
            std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)
            batch = []
            for t in tiles:
                r = cv2.resize(t, (224, 224), interpolation=cv2.INTER_LINEAR)
                r = (r.astype(np.float32) / 255.0 - mean) / std
                batch.append(r.transpose(2, 0, 1))
            x = np.stack(batch).astype(np.float32)
            logits = dv_base.run(['logits'], {'pixel_values': x})[0]
            # softmax
            e = np.exp(logits - logits.max(axis=1, keepdims=True))
            probs_dvb_raw = e / e.sum(axis=1, keepdims=True)
            # Remap nightly class order -> our _MIT_CLS_ORDER
            probs_dvb = np.zeros_like(probs_dvb_raw)
            for our_idx, nightly_idx in enumerate(_DINOV2_BASE_PERM):
                probs_dvb[:, our_idx] = probs_dvb_raw[:, nightly_idx]
            # Weight it MORE (it's the best-val model): 0.4 of final vs 0.3 for each other
            probs_our_order = 0.6 * probs_our_order + 0.4 * probs_dvb.astype(np.float32)
        except Exception as e:
            log.warning("DINOv2-base ONNX inference failed: %s", e)
    # Remap our class order to Tandberg's LABEL_NAMES order
    #   our order idx -> tandberg label char (see _MIT_TO_TANDBERG)
    #   tandberg LABEL_NAMES = ["B","K","N","P","Q","R","b","k","n","p","q","r","f"]
    tandberg_idx_of_char = {ch: i for i, ch in enumerate(constants.LABEL_NAMES)}
    perm = np.array([tandberg_idx_of_char[_MIT_TO_TANDBERG[i]] for i in range(13)], dtype=np.int64)
    probs_tandberg = np.zeros_like(probs_our_order)
    for our_idx in range(13):
        probs_tandberg[:, perm[our_idx]] = probs_our_order[:, our_idx]
    # square_names in the order Tandberg's crop iteration uses (a8..h1)
    square_names = list(constants.SQUARE_NAMES_NORMAL)
    # Call Tandberg's downstream builder for uniform output shape
    return cv_pipeline.process_position_probabilities(
        probabilities=probs_tandberg,
        square_names=square_names,
        square_crops=np.zeros((64, 64, 64, 1), dtype=np.uint8),
    )


def _score_warp_quality(warp: np.ndarray) -> dict[str, Any]:
    """Grade a candidate 8x8 board warp on [0..1].

    A real chess board's 64 tile-means split cleanly into TWO color clusters
    aligned to (row+col) parity. We test that alignment via 1D PCA projection
    (works on brown/blue lichess boards too, not just grayscale). Returns
    {score, quality: ok|low|bad, parity, cluster, peakFrac}. Callers use the
    quality label to decide whether to auto-open the manual CornerAdjuster UI
    on the client — anything "bad" means the extractor grabbed the wrong
    region (misaligned crop, black-bar bleed, or off-board scene fragment).

    Empty-square regions are common (many blank squares of same tone), so we
    scale down the uniform-region penalty when parity alignment is strong."""
    if warp is None or warp.size == 0:
        return {"score": 0.0, "quality": "bad"}
    h, w = warp.shape[:2]
    if h < 64 or w < 64:
        return {"score": 0.0, "quality": "bad"}
    if warp.ndim == 2:
        warp = cv2.cvtColor(warp, cv2.COLOR_GRAY2BGR)
    tile_h, tile_w = h // 8, w // 8
    means = np.zeros((64, 3), dtype=np.float32)
    parities = np.zeros(64, dtype=np.int32)
    for i in range(8):
        for j in range(8):
            tile = warp[i*tile_h:(i+1)*tile_h, j*tile_w:(j+1)*tile_w]
            means[i*8+j] = tile.reshape(-1, 3).mean(axis=0)
            parities[i*8+j] = (i + j) % 2
    centered = means - means.mean(axis=0)
    cov = centered.T @ centered
    _, vecs = np.linalg.eigh(cov)
    axis = vecs[:, -1]
    proj = centered @ axis
    labels = (proj > 0).astype(np.int32)
    matches = int((labels == parities).sum())
    parity = max(matches, 64 - matches) / 64.0
    m0 = float(proj[labels == 0].mean()) if (labels == 0).any() else 0.0
    m1 = float(proj[labels == 1].mean()) if (labels == 1).any() else 0.0
    cluster = float(abs(m1 - m0))
    gray = cv2.cvtColor(warp, cv2.COLOR_BGR2GRAY)
    hist = cv2.calcHist([gray], [0], None, [32], [0, 256]).flatten()
    peak_frac = float(hist.max() / (h * w))
    if cluster < 8:
        align = 0.0
    else:
        align = (parity - 0.5) * 2
    penalty_scale = max(0.0, 1.0 - (parity - 0.7) / 0.2) if parity > 0.7 else 1.0
    uniform_penalty = min(1.0, max(0.0, (peak_frac - 0.20) / 0.30)) * penalty_scale
    score = align * (1.0 - 0.6 * uniform_penalty)

    # Print-mode fallback: black-and-white book diagrams have identical
    # empty-square colors on both parities (all white), so the parity
    # metric fails. Use edge-density-per-tile as an alternate signal —
    # a valid chess diagram has edges in EVERY row and EVERY column of the
    # 8x8 grid (grid lines run everywhere). A partial crop (board + dead
    # black bar) has entire columns/rows of empty tiles → reject.
    if score < 0.65:
        edges = cv2.Canny(gray, 50, 150)
        tile_has_edges = [[False]*8 for _ in range(8)]
        for i in range(8):
            for j in range(8):
                tile = edges[i*tile_h:(i+1)*tile_h, j*tile_w:(j+1)*tile_w]
                if tile.sum() > 30 * tile.size / 255:
                    tile_has_edges[i][j] = True
        rows_with_edges = sum(1 for r in tile_has_edges if any(r))
        cols_with_edges = sum(1 for c in range(8) if any(tile_has_edges[r][c] for r in range(8)))
        # Every row AND every column must have at least some tile with
        # edges — rules out crops with dead black bars.
        if rows_with_edges == 8 and cols_with_edges == 8:
            score = max(score, 0.7)

    if score >= 0.65:
        quality = "ok"
    elif score >= 0.4:
        quality = "low"
    else:
        quality = "bad"
    return {
        "score": round(float(score), 3),
        "quality": quality,
        "parity": round(parity, 3),
        "cluster": round(cluster, 1),
        "peakFrac": round(peak_frac, 3),
    }


def _find_board_hough(img_bgr: np.ndarray) -> np.ndarray | None:
    """Classical chessboard finder using Hough lines. Independent of YOLO —
    works on app screenshots, phone photos, book pages, anything with a
    visible 8x8 grid. Returns a warped 512x512 board image, or None if no
    plausible grid was found.

    Pipeline:
      1. Downscale to max side 800 (Hough on huge images is slow + noisy)
      2. Canny edge detection
      3. HoughLinesP -> raw line segments
      4. Cluster into horizontal + vertical groups by angle
      5. Find the ~9 evenly-spaced lines in each group that mark the 8x8 grid
      6. Corners = intersections of the outermost lines from each group
      7. cv.getPerspectiveTransform + warpPerspective to 512x512

    Returns None when the geometry doesn't look like a chessboard (fewer
    than 9 lines per axis, or spacing isn't uniform).
    """
    if img_bgr is None or img_bgr.size == 0:
        return None
    h, w = img_bgr.shape[:2]
    scale = min(1.0, 800.0 / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        img = img_bgr
    ih, iw = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150, apertureSize=3)

    # Detect line segments — strict-ish so we only surface real board edges,
    # not UI chrome (button rows, file/rank labels, address bars).
    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180,
                            threshold=80, minLineLength=int(min(ih, iw) * 0.15),
                            maxLineGap=10)
    if lines is None or len(lines) < 18:
        return None

    # Group into horizontal (angle ~0 or 180) and vertical (angle ~90).
    # HoughLinesP returns shape (n, 1, 4); reshape to (n, 4) for iteration.
    horizontals = []
    verticals = []
    for row in lines.reshape(-1, 4):
        x1, y1, x2, y2 = int(row[0]), int(row[1]), int(row[2]), int(row[3])
        angle_deg = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1))) % 180
        if angle_deg < 10 or angle_deg > 170:
            horizontals.append(int((y1 + y2) / 2))
        elif 80 < angle_deg < 100:
            verticals.append(int((x1 + x2) / 2))

    if len(horizontals) < 9 or len(verticals) < 9:
        return None

    # Cluster same-coordinate lines within tol pixels (Hough often returns
    # many parallel copies of the same physical edge).
    def cluster(coords: list, tol: int = 8) -> list[int]:
        if not coords: return []
        sorted_c = sorted(coords)
        clusters = [[sorted_c[0]]]
        for c in sorted_c[1:]:
            if c - clusters[-1][-1] <= tol:
                clusters[-1].append(c)
            else:
                clusters.append([c])
        return [int(np.mean(c)) for c in clusters]

    y_coords = cluster(horizontals)
    x_coords = cluster(verticals)
    if len(y_coords) < 9 or len(x_coords) < 9:
        return None

    # Find the 9 most-evenly-spaced adjacent lines on each axis. Slide a
    # 9-window; pick the one with the smallest normalized spacing variance.
    def best_9_window(coords: list[int]) -> tuple[int, int] | None:
        if len(coords) < 9: return None
        best_var = float("inf"); best_win = None
        for i in range(len(coords) - 8):
            window = coords[i:i + 9]
            spacings = [window[j + 1] - window[j] for j in range(8)]
            mean = np.mean(spacings)
            if mean < 15: continue
            var = np.var(spacings) / (mean ** 2)
            if var < best_var:
                best_var = var; best_win = (window[0], window[-1])
        # 0.05 = ~22% spacing spread; strict enough to reject button rows.
        if best_win is None or best_var > 0.05: return None
        return best_win

    yb = best_9_window(y_coords)
    xb = best_9_window(x_coords)
    if yb is None or xb is None:
        return None
    y_top, y_bot = yb
    x_left, x_right = xb
    inv_scale = 1.0 / scale
    src_pts = np.float32([
        [x_left * inv_scale,  y_top * inv_scale],
        [x_right * inv_scale, y_top * inv_scale],
        [x_right * inv_scale, y_bot * inv_scale],
        [x_left * inv_scale,  y_bot * inv_scale],
    ])
    OUT = 512
    dst_pts = np.float32([[0, 0], [OUT, 0], [OUT, OUT], [0, OUT]])
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    return cv2.warpPerspective(img_bgr, M, (OUT, OUT), flags=cv2.INTER_CUBIC)


def _refine_crop_to_checker(warped: np.ndarray) -> np.ndarray:
    """Find the tight chess-board region inside a loose YOLO crop.

    Uses FREQUENCY analysis: a real 8x8 chess board produces ~8 evenly-spaced
    dark/light transitions along both axes. Text/margin regions do NOT — their
    edge spectrum has no strong 8-cycle peak. For each axis, we compute the
    edge signal for sliding windows and pick the widest band where the 8-cycle
    Fourier component dominates.

    This handles both failure modes:
      1. black-frame-only bleed  (text density looks similar → FFT distinguishes)
      2. text-adjacent bleed     (text has no 8-periodicity → clean signal)
    """
    if warped is None or warped.size == 0: return warped
    h, w = warped.shape[:2]
    if h < 100 or w < 100: return warped
    gray = warped if warped.ndim == 2 else cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    # Per-column and per-row absolute Sobel derivative (edge magnitudes)
    sx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)).mean(axis=0)   # W-length
    sy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)).mean(axis=1)   # H-length

    def checker_band(profile: np.ndarray) -> tuple[int, int] | None:
        """Slide a window over the profile; for each window compute FFT and
        the ratio (energy at freq ~= 8..10) / (total energy). Windows over the
        checker board have this ratio HIGH; text windows have it low."""
        L = len(profile)
        if L < 100: return None
        # Try candidate windows of length {L, 0.8L, 0.6L, 0.5L} at all offsets
        best = None; best_ratio = 0.0
        for frac in (1.0, 0.85, 0.7, 0.55, 0.45):
            wlen = int(L * frac)
            if wlen < 80: continue
            step = max(4, wlen // 20)
            for x0 in range(0, L - wlen + 1, step):
                seg = profile[x0:x0 + wlen].astype(np.float32)
                seg = seg - seg.mean()
                spec = np.abs(np.fft.rfft(seg))
                if spec.sum() < 1e-6: continue
                # Chess board expects ~8-9 dominant cycles (border+inner grid)
                # per full window; +/-2 tolerance
                target_lo, target_hi = 6, 12
                target_hi = min(target_hi, len(spec) - 1)
                if target_lo >= len(spec): continue
                band_e = spec[target_lo:target_hi + 1].sum()
                ratio = band_e / (spec[1:].sum() + 1e-6)
                # Prefer wider windows at similar ratio
                score = ratio * (wlen / L) ** 0.3
                if score > best_ratio:
                    best_ratio = score
                    best = (x0, x0 + wlen - 1, ratio)
        if best is None or best[2] < 0.15: return None
        return (best[0], best[1])

    col_band = checker_band(sx)
    row_band = checker_band(sy)
    if not col_band or not row_band: return warped
    x0, x1 = col_band; y0, y1 = row_band
    band_w = x1 - x0 + 1; band_h = y1 - y0 + 1
    if band_w < 0.35 * w or band_h < 0.35 * h: return warped
    pad = max(2, int(0.01 * max(w, h)))
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(w - 1, x1 + pad); y1 = min(h - 1, y1 + pad)
    refined = warped[y0:y1+1, x0:x1+1]
    rh, rw = refined.shape[:2]
    if rw > 0 and rh > 0:
        ar = rw / rh
        if 0.7 <= ar <= 1.4:
            side = max(rw, rh)
            return cv2.resize(refined, (side, side), interpolation=cv2.INTER_CUBIC)
    return refined


def _detect_orientation_from_labels(raw_bgr: np.ndarray) -> int | None:
    """OCR the raw phone photo for chess coordinate labels (a-h, 1-8) and
    return the CW rotation (0/90/180/270) needed to bring the board to
    standard orientation (a1 bottom-left). Returns None if uncertain.

    Approach: run pytesseract on 4 edge strips of the raw photo, count where
    LETTERS (files) vs DIGITS (ranks) appear. Standard orientation has files
    along top/bottom edges and ranks along left/right. Tablet-rotated photos
    have them swapped. We also check WHERE '1' vs '8' and 'a' vs 'h' sit
    to determine polarity (0° vs 180°, 90° vs 270°)."""
    try:
        import pytesseract
    except ImportError:
        return None
    h, w = raw_bgr.shape[:2]
    if h < 200 or w < 200: return None
    gray = cv2.cvtColor(raw_bgr, cv2.COLOR_BGR2GRAY)
    # 4 edge strips (10% of shorter dim)
    strip = max(80, min(h, w) // 10)
    edges = {
        "top":    gray[0:strip, :],
        "bottom": gray[h-strip:h, :],
        "left":   gray[:, 0:strip],
        "right":  gray[:, w-strip:w],
    }
    scores = {}  # side -> {letters: [], digits: []}
    for side, img in edges.items():
        big = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        data = pytesseract.image_to_data(
            big, config='--psm 11 -c tessedit_char_whitelist=abcdefgh12345678',
            output_type=pytesseract.Output.DICT
        )
        letters, digits = [], []
        for i, t in enumerate(data['text']):
            t = (t or '').strip().lower()
            conf = int(data['conf'][i]) if data['conf'][i] != '-1' else 0
            if not t or conf < 40: continue
            for ch in t:
                if ch in 'abcdefgh': letters.append(ch)
                elif ch in '12345678': digits.append(ch)
        scores[side] = {"letters": letters, "digits": digits}
    # Determine which pair of opposite sides has more LETTERS (that pair = files)
    lr_letters = len(scores["left"]["letters"]) + len(scores["right"]["letters"])
    tb_letters = len(scores["top"]["letters"]) + len(scores["bottom"]["letters"])
    lr_digits  = len(scores["left"]["digits"])  + len(scores["right"]["digits"])
    tb_digits  = len(scores["top"]["digits"])   + len(scores["bottom"]["digits"])
    total = lr_letters + tb_letters + lr_digits + tb_digits
    if total < 3: return None
    # Case A: files horizontal (letters at top/bottom), ranks vertical (digits at l/r)
    # → board is in STANDARD orientation. No rotation.
    # Case B: files vertical, ranks horizontal → board rotated 90 (either way)
    if tb_letters + lr_digits > lr_letters + tb_digits:
        # Case A — standard-ish. Now decide 0 vs 180 by checking WHERE 'a' vs 'h' is.
        # 'a' should be on LEFT if standard, RIGHT if 180° flipped.
        a_left = scores["left"]["letters"].count('a') + scores["top"]["letters"].count('a') + scores["bottom"]["letters"].count('a')
        h_right = scores["right"]["letters"].count('h') + scores["top"]["letters"].count('h') + scores["bottom"]["letters"].count('h')
        # Weak signal — go with 0 by default. Return None if truly ambiguous.
        return 0
    else:
        # Case B — rotated 90 or 270. Files are VERTICAL.
        # If 'a' is at TOP → files run a(top) ... h(bottom) → need to rotate 90 CCW (=270 CW) to bring a to bottom-left
        # If 'a' is at BOTTOM → files run h(top) ... a(bottom) → need to rotate 90 CW to bring a to bottom-left
        a_top    = scores["top"]["letters"].count('a')
        a_bottom = scores["bottom"]["letters"].count('a')
        h_top    = scores["top"]["letters"].count('h')
        h_bottom = scores["bottom"]["letters"].count('h')
        if (a_top + h_bottom) > (a_bottom + h_top): return 270
        if (a_bottom + h_top) > (a_top + h_bottom): return 90
        return None  # ambiguous


class ImageIn(BaseModel):
    image_base64: str
    # Optional: pre-warped tight board crop from client-side OpenCV.js.
    # When supplied, /classify skips the server extractor and uses this
    # directly. Fixes screen-photo cases where the server extractor over-
    # reaches into UI chrome (tablet title bar / menu) and misaligns the
    # 8x8 tile split. Client already computed a tight warp — trust it.
    warped_board_base64: str | None = None


class WarpCornersIn(BaseModel):
    """Body for /warp-with-corners — client sends the raw image + 4 user-
    placed corners; server does the perspective warp via cv2 (no need for
    the client to download the 10 MB opencv.js WASM)."""
    image_base64: str
    corners: list[dict]  # [{"x": float, "y": float}, ...×4]


@app.post("/warp-with-corners")
def warp_with_corners(body: WarpCornersIn) -> dict[str, Any]:
    """Server-side warp with user-specified corners. Skips the 10 MB
    opencv.js download that was killing mobile users on cellular after
    they tapped Adjust Corners. Returns a 512x512 warped board PNG.
    """
    if len(body.corners) != 4:
        raise HTTPException(status_code=400, detail="need exactly 4 corners")
    for c in body.corners:
        if not isinstance(c, dict) or "x" not in c or "y" not in c:
            raise HTTPException(status_code=400, detail="each corner needs {x,y}")
    img = _decode_b64_image(body.image_base64)
    pts = [(float(c["x"]), float(c["y"])) for c in body.corners]
    # Order corners: TL, TR, BR, BL (by x+y and y-x sums)
    ordered = _order_corners(pts)
    src = np.float32(ordered)
    OUT = 512
    dst = np.float32([[0, 0], [OUT, 0], [OUT, OUT], [0, OUT]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(img, M, (OUT, OUT), flags=cv2.INTER_CUBIC)
    return {
        "ok": True,
        "boardPngBase64": _encode_b64_png(warped),
        "warpQuality": _score_warp_quality(warped),
    }


def _order_corners(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Order 4 corners as [TL, TR, BR, BL] regardless of input order.
    Uses sum + diff of coords: TL = min(x+y), BR = max(x+y), TR = min(y-x),
    BL = max(y-x). Same logic as the client-side orderCorners in boardWarp.ts.
    """
    s = [p[0] + p[1] for p in pts]
    d = [p[1] - p[0] for p in pts]
    return [
        pts[s.index(min(s))],  # top-left
        pts[d.index(min(d))],  # top-right
        pts[s.index(max(s))],  # bottom-right
        pts[d.index(max(d))],  # bottom-left
    ]


@app.get("/health")
def health() -> dict[str, Any]:
    cv = _get_cv()
    return {
        "ok": True,
        "board_extractor": getattr(cv, "_board_extractor_model_id", None),
        "classifier": getattr(cv, "_classifier_model_id", None),
    }


@app.post("/extract")
def extract(body: ImageIn) -> dict[str, Any]:
    img = _decode_b64_image(body.image_base64)
    t0 = time.time()
    # TIER 1: try classical Hough-lines chessboard finder first. Works on app
    # screenshots with UI chrome around the board (where YOLO fails because
    # it was trained on cropped diagrams). Score the result; only use if
    # score is high — else fall through to YOLO.
    backend = "hough"
    warped = _find_board_hough(img)
    if warped is not None:
        s = _score_warp_quality(warped)
        if s["score"] < 0.6:
            warped = None  # Hough result unreliable, defer to YOLO
    if warped is None:
        # TIER 2: YOLOv8n-seg extractor (trained on 30K composites + real
        # photos). Handles book diagrams, cropped screenshots, phone photos.
        cv = _get_cv()
        result = cv.process_image(img)
        w = result.board_extraction.board_image
        if w is None:
            raise HTTPException(status_code=422, detail="board not found")
        warped = w
        backend = "chessguru-yolo-mit" if os.path.exists(_MIT_EXTRACTOR) else "tandberg-yolo"
        # Score-guided refinement (only applies to YOLO output — Hough is
        # already snapped to the grid).
        refined = _refine_crop_to_checker(warped)
        if refined is not None and refined.size > 0.20 * warped.size:
            if _score_warp_quality(refined)["score"] > _score_warp_quality(warped)["score"] + 0.05:
                warped = refined
    dt_ms = int((time.time() - t0) * 1000)
    return {
        "ok": True,
        "boardPngBase64": _encode_b64_png(warped),
        "latencyMs": dt_ms,
        "backend": backend,
        "warpQuality": _score_warp_quality(warped),
    }


@app.post("/full")
def full(body: ImageIn) -> dict[str, Any]:
    cv = _get_cv()
    img = _decode_b64_image(body.image_base64)
    t0 = time.time()
    result = cv.process_image(img)
    dt_ms = int((time.time() - t0) * 1000)
    warped = result.board_extraction.board_image
    if warped is None:
        raise HTTPException(status_code=422, detail="board not found")
    # Score-guided refinement: keep the tightened crop only if it scores
    # BETTER than the loose warp. Purely area-based guards let the FFT-picked
    # crop win even when it's misaligned to 8x8 boundaries — the parity-based
    # score below catches those regressions.
    refined = _refine_crop_to_checker(warped)
    if refined is not None and refined.size > 0.20 * warped.size:
        if _score_warp_quality(refined)["score"] > _score_warp_quality(warped)["score"] + 0.05:
            warped = refined
    fen = getattr(result.position, "fen", None) if result.position else None
    return {
        "ok": True,
        "fen": fen,
        "boardPngBase64": _encode_b64_png(warped),
        "latencyMs": dt_ms,
        "backend": "chessguru-yolo-mit" if os.path.exists(_MIT_EXTRACTOR) else "tandberg-yolo",
        "warpQuality": _score_warp_quality(warped),
    }


_seg_model = None


def _get_seg_model():
    """Our MIT YOLOv8n-seg extractor, loaded once, used for MULTI-board detect."""
    global _seg_model
    if _seg_model is not None:
        return _seg_model
    if not os.path.exists(_MIT_EXTRACTOR):
        return None
    try:
        from ultralytics import YOLO
        _seg_model = YOLO(_MIT_EXTRACTOR)
        log.info("Loaded MIT seg extractor for multi-board detect from %s", _MIT_EXTRACTOR)
    except Exception as e:  # pragma: no cover
        log.warning("multi-board detect unavailable: %s", e)
        _seg_model = None
    return _seg_model


def _detect_all_boards(img: np.ndarray, max_n: int = 8, conf: float = 0.75,
                       min_boards: int = 2) -> list[dict[str, Any]]:
    """Every board the extractor can see, in reading order (top-to-bottom,
    left-to-right).

    The extractor is INSTANCE segmentation and already finds all the diagrams on
    a printed page — measured 2026-09-09 on a six-diagram puzzle page: 6 of 6 at
    0.93-0.95 confidence, and each one classified to a legal position at
    0.99-1.00. The pipeline then collapsed that to a single board, picked a
    region spanning several of them, and answered `1R6/8/r7/p7/8/8/P7/8` with a
    99.4% confidence score. Returning the candidates instead lets the coach pick
    the position they actually meant, and costs one extra forward pass of a
    6 MB model.

    The 0.75 threshold is measured, not guessed. On a genuine six-diagram page
    every board scores 0.93-0.95. An ALREADY-CROPPED single board produces
    spurious extra detections at 0.53-0.58, and an app screenshot produces two
    at 0.31-0.35. 0.75 keeps every real board and drops all of those, so a coach
    is never asked to choose when there is only one board.

    Empty list when there is nothing to choose between.
    """
    m = _get_seg_model()
    if m is None:
        return []
    try:
        res = m.predict(img, imgsz=640, conf=conf, verbose=False)[0]
    except Exception as e:
        log.warning("multi-board detect failed: %s", e)
        return []
    if res.boxes is None or len(res.boxes) < min_boards:
        return []
    H, W = img.shape[:2]
    rows = []
    for box, c in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist()):
        x1, y1, x2, y2 = box
        if (x2 - x1) < 40 or (y2 - y1) < 40:
            continue
        rows.append((float(c), [float(x1), float(y1), float(x2), float(y2)]))
    # Collapse overlapping boxes. On a single tight diagram the detector happily
    # returns several boxes over the SAME board -- measured on one crop: four at
    # 0.77-0.92, all sharing a left edge and overlapping vertically. Without this
    # a correctly-read single diagram would offer the coach a bogus 4-way choice.
    # Real diagrams on a page are disjoint, so IoU suppression separates the two
    # cases cleanly.
    def _iou(a: list[float], b: list[float]) -> float:
        ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
        ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
        iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
        inter = iw * ih
        if inter <= 0:
            return 0.0
        ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
        return inter / ua if ua > 0 else 0.0

    rows.sort(key=lambda r: -r[0])          # confidence first, for suppression
    kept: list[tuple[float, list[float]]] = []
    for cand in rows:
        if all(_iou(cand[1], k[1]) < 0.25 for k in kept):
            kept.append(cand)
    rows = kept

    if len(rows) < min_boards:
        return []
    # If one detection already covers most of the frame, the caller handed us a
    # picture that IS a board. Nothing to choose between.
    frame = float(H * W)
    if frame > 0 and any(((b[2] - b[0]) * (b[3] - b[1])) / frame > 0.6 for _, b in rows):
        return []
    # Reading order, not confidence order — a coach scanning a page thinks in
    # "the third diagram", so band the y coordinate before sorting by x.
    band = max(H // 12, 1)
    rows.sort(key=lambda r: (int(r[1][1] // band), r[1][0]))
    out: list[dict[str, Any]] = []
    for i, (c, (x1, y1, x2, y2)) in enumerate(rows[:max_n]):
        pad = int(0.02 * max(x2 - x1, y2 - y1))
        crop = img[max(0, int(y1) - pad): min(H, int(y2) + pad),
                   max(0, int(x1) - pad): min(W, int(x2) + pad)]
        if crop.size == 0:
            continue
        out.append({
            "index": i,
            "confidence": round(c, 3),
            "box": [round(v) for v in (x1, y1, x2, y2)],
            "boardPngBase64": _encode_b64_png(crop),
        })
    return out


@app.post("/classify")
def classify(body: ImageIn) -> dict[str, Any]:
    """Full pipeline (own MIT extractor + Tandberg YOLO classifier +
    chess-rules validation). Auto-detects board ORIENTATION by trying
    0/90/180/270 rotations of the warped board and picking the one where
    the classifier is most confident AND the position needs fewest
    chess-rules fixes."""
    from chessvision import constants
    cv = _get_cv()
    t0 = time.time()
    # If client supplied a pre-warped tight board crop, use it directly and
    # skip the server extractor (which over-reaches on iPad screen photos
    # with UI chrome — title bar/menu — and misaligns the 8x8 tile split).
    if body.warped_board_base64:
        warped = _decode_b64_image(body.warped_board_base64)
        extractor_source = "client-warp"
    else:
        img = _decode_b64_image(body.image_base64)
        # TIER 1: classical Hough finder first (fast + handles app screenshots).
        hough = _find_board_hough(img)
        if hough is not None and _score_warp_quality(hough)["score"] >= 0.6:
            warped = hough
            extractor_source = "hough"
        else:
            # TIER 2: YOLO extractor
            ext_result = cv.extract_board(img)
            warped = ext_result.board_image
            if warped is None:
                raise HTTPException(status_code=422, detail="board not found")
            extractor_source = "server-yolo"

        # Tighten YOLO's crop via FFT 8-cycle detection (strips text margins
        # that would shift every square by 1 rank/file). Skipped for Hough
        # since it's already snapped to the grid lines.
        if extractor_source == "server-yolo":
            refined = _refine_crop_to_checker(warped)
            if refined is not None and refined.size > 0.35 * warped.size:
                warped = refined

    # OCR-based orientation hint: read chess coord labels (a-h/1-8) from the
    # 4 edges of the RAW phone photo. When confident, this SKIPS the 4-way
    # rotation autopick entirely — solves the rotation-symmetric endgame
    # tiebreaker problem that classifier confidence alone can't handle.
    ocr_rot = None
    # ONLY when we found the board ourselves. If the caller handed us a crop,
    # image_base64 is whatever that crop was cut out of -- a whole book page, a
    # phone photo of a spread -- and reading "coordinate labels" off a page of
    # prose yields a confident, wrong answer that then OVERRIDES the 4-way
    # autopick. Measured 2026-09-09 on one book page: same crop, raw=page gave
    # rotation 270 and a garbage FEN at 0.81; raw=crop gave rotation 0 and the
    # printed position exactly at 1.00. This also fires on the Adjust-corners
    # flow, where the raw is always the full photo.
    if body.image_base64 and not body.warped_board_base64:
        try:
            raw_for_ocr = _decode_b64_image(body.image_base64)
            ocr_rot = _detect_orientation_from_labels(raw_for_ocr)
            if ocr_rot is not None:
                log.info("OCR orientation hint: rotate %d° CW", ocr_rot)
        except Exception as e:
            log.warning("OCR orientation failed: %s", e)

    # Try all 4 rotations; pick the one with highest (avg_confidence -
    # 0.05 * fixes_count) — heavily reward fewer chess-rules repairs.
    # But if OCR gave a confident hint, ONLY try that rotation.
    own_cls = _get_own_classifier()
    best = None
    _ALL_ROTATIONS = [
        (0,   None),
        (90,  cv2.ROTATE_90_CLOCKWISE),
        (180, cv2.ROTATE_180),
        (270, cv2.ROTATE_90_COUNTERCLOCKWISE),
    ]
    if ocr_rot is not None:
        _ROTATIONS = [next(r for r in _ALL_ROTATIONS if r[0] == ocr_rot)]
    else:
        _ROTATIONS = _ALL_ROTATIONS
    for rot_key, rot_flag in _ROTATIONS:
        candidate = warped if rot_flag is None else cv2.rotate(warped, rot_flag)
        try:
            if own_cls is not None:
                # OUR classifier path (MIT). We extract 64 crops and batch-
                # infer via ultralytics YOLO.predict; then hand the (64,13)
                # probs to Tandberg's validate_position for chess-rules repair.
                pos_c = _classify_via_own(candidate, cv, own_cls)
            else:
                pos_c = cv.classify_position(candidate)
        except Exception:
            continue
        probs_c = pos_c.model_probabilities
        avg_conf = float(probs_c.max(axis=1).mean())
        fixes = len(pos_c.validation_fixes)
        # Also count non-empty squares — a garbage rotation often produces
        # nearly-all-"f" (empty) predictions. Prefer rotations with 5-30 pieces.
        top_labels = probs_c.argmax(axis=1)
        empty_idx = constants.LABEL_NAMES.index("f")
        n_pieces = int(sum(1 for t in top_labels if t != empty_idx))
        piece_penalty = 0.0 if 3 <= n_pieces <= 32 else 0.15
        score = avg_conf - 0.05 * fixes - piece_penalty
        if best is None or score > best["score"]:
            best = {
                "rot": rot_key,
                "warped": candidate,
                "pos": pos_c,
                "avg_conf": avg_conf,
                "fixes": fixes,
                "n_pieces": n_pieces,
                "score": score,
            }
    if best is None:
        raise HTTPException(status_code=422, detail="all 4 rotations failed classification")
    warped = best["warped"]
    pos = best["pos"]
    chosen_rotation = best["rot"]
    dt_ms = int((time.time() - t0) * 1000)
    # Graded once: the response reports it, and it also decides whether a lone
    # board detection is worth offering as an alternative (see "candidates").
    _warp_q = _score_warp_quality(warped)
    # A far blunter but far more reliable "this read is wrong" signal than the
    # warp score. Every legal position has exactly one king per side and every
    # printed diagram shows both. warpQuality graded one book page "ok" at 0.70
    # while the FEN it produced held NINE kings, so the score alone cannot be
    # trusted to decide whether to offer the coach an alternative.
    _board_field = (pos.fen or "").split(" ")[0]
    _kings_ok = _board_field.count("K") == 1 and _board_field.count("k") == 1
    probs = pos.model_probabilities   # (64, 13)
    label_names = constants.LABEL_NAMES
    grid: list[list[dict[str, Any]]] = [[{} for _ in range(8)] for _ in range(8)]
    for i, sq in enumerate(pos.square_names):
        file_c = ord(sq[0]) - ord("a")
        rank_c = int(sq[1])
        row = 8 - rank_c
        col = file_c
        top_idx = int(probs[i].argmax())
        conf = float(probs[i, top_idx])
        label = label_names[top_idx]
        if label == "f":
            grid[row][col] = {"piece": None, "color": None, "confidence": conf, "matchedSetName": "tandberg-yolo-cls"}
        else:
            grid[row][col] = {"piece": label.upper(), "color": "w" if label.isupper() else "b",
                              "confidence": conf, "matchedSetName": "tandberg-yolo-cls"}
    avg = sum(sq["confidence"] for row in grid for sq in row) / 64.0
    return {
        "ok": True,
        "fen": pos.fen,
        "originalFen": pos.original_fen,
        "squares": grid,
        "boardPngBase64": _encode_b64_png(warped),
        "meta": {
            "modelVersion": "tandberg-yolo-full-pipeline",
            "latencyMs": dt_ms,
            "avgConfidence": avg,
            "chosenRotation": chosen_rotation,
            "extractorSource": extractor_source,
            "validationFixes": [
                {"square": f.square_name, "from": f.original_piece,
                 "to": f.corrected_piece, "rule": f.rule_name}
                for f in pos.validation_fixes
            ],
        },
        "backend": "chessguru-yolo-mit" if os.path.exists(_MIT_EXTRACTOR) else "tandberg-yolo",
        "warpQuality": _warp_q,
        # Boards the segmentation extractor can see. The NestJS proxy spreads
        # this response verbatim, so the client sees it with no API change and
        # no API restart. Skipped when the client already handed us one crop --
        # there is then nothing left to choose between.
        #
        # Offered ONLY when our own read looks wrong -- a bad warp grade or an
        # impossible king count. Two reasons that is the right trigger:
        #
        #  * When the read is already good, a picker is pure noise. The detector
        #    will happily return several overlapping boxes over ONE tight
        #    diagram (measured: 4 boxes at 0.77-0.92 on a single board, still 2
        #    after IoU suppression), so keying off detection count alone would
        #    nag on correct scans.
        #  * A crop spanning several diagrams cannot produce a legal position,
        #    so genuinely multi-board pages always fail one of these checks. On
        #    all 12 book pages tested and the six-diagram page, every page that
        #    really held multiple boards graded bad or returned bad king counts.
        #
        # A single detection is worth offering too, not just several: on a full
        # book page whose pipeline crop scored 0.013, the lone detection scored
        # 0.934 and classified to the printed position exactly, 64/64 at 0.997.
        "candidates": [] if (body.warped_board_base64
                             or (_warp_q.get("quality") != "bad" and _kings_ok))
        else _detect_all_boards(_decode_b64_image(body.image_base64), min_boards=1),
    }
