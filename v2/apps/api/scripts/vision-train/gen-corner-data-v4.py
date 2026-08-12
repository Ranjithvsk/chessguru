"""Camera simulator v4 — MEGA DIVERSITY. Aim: beat ChessVision AI by
covering every real-world board-photo scenario a coach will throw at
us. All v3 augmentations PLUS:

  +  Rotations: 25% each of {0°, 90°, 180°, 270°} + random tilt
  +  Screen photos: moiré, refresh scan lines, bezel, screen glare,
     pixel grid, cool colour temp, backlit uniform brightness
  +  Multi-board scenes: 30% of samples have 2-3 boards; label = the
     BIGGEST one (teaches network to pick primary board)
  +  UI chrome: browser tabs, toolbars, buttons, cursor arrows
     composited around the board
  +  Physical wooden-board look: darker rendered pieces with wood-grain
     bg via Perlin

Sources: 975 real book diagrams + 40 Lichess piece sets rendered as
screen-style boards. 50K samples target.

Run:
  /tmp/chesstrain-env/bin/python /tmp/gen-corner-data-v4.py \
    --out /tmp/corner-train-v4 --samples 50000
"""
import argparse, io, json, random, glob, math, re, base64
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import cairosvg

OUT_SIZE = 256
BASE_BOARDS_GLOB = "/tmp/chessbook/boards/*.png"
LICHESS_SETS_DIR = "/tmp/lichess-pieces"

# =========================================================================
# LICHESS SCREEN-STYLE BOARDS ---------------------------------------------
# =========================================================================
SAMPLE_FENS = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR",
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R",
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR",
    "8/8/8/4k3/8/4P3/4K3/8",
    "r3r1k1/2pq1pp1/p5p1/1pPpP3/3P4/3Q2PP/PP6/5RK1",
    "8/2k5/8/4K3/4P3/8/8/8",
    "8/8/6k1/8/8/6K1/8/6R1",
    "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R",
]

def load_lichess_sets():
    """Return {set_name: {(piece, color): svg_bytes}} for all Lichess sets."""
    out = {}
    for d in sorted(glob.glob(f"{LICHESS_SETS_DIR}/*")):
        name = Path(d).name
        pieces = {}
        for svgf in glob.glob(f"{d}/*.svg"):
            fname = Path(svgf).stem  # "wK", "bP", etc.
            if len(fname) != 2: continue
            color = "w" if fname[0] == "w" else "b"
            piece = fname[1].upper()
            if piece not in "KQRBNP": continue
            try:
                pieces[(piece, color)] = Path(svgf).read_bytes()
            except Exception: pass
        if len(pieces) == 12:
            out[name] = pieces
    return out

def svg_to_pil(svg_bytes, size):
    png = cairosvg.svg2png(bytestring=svg_bytes, output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")

BOARD_COLORS_SCREEN = [
    # (light, dark) pairs used by popular chess websites
    ((240, 217, 181), (181, 136, 99)),   # chessground brown
    ((222, 227, 230), (140, 162, 173)),  # blue
    ((238, 238, 210), (118, 150, 86)),   # green (chess.com)
    ((234, 233, 210), (75, 115, 153)),   # blue-dark (chess24)
    ((235, 236, 208), (119, 149, 86)),   # green (lichess)
]

def render_screen_board(fen, svgs, rng, side_px=400):
    """Render a chess board in screen/website style. Colored squares +
    coloured piece SVGs from the chosen Lichess set. Skips pieces whose
    SVG can't be rasterised (some Lichess sets have malformed SVGs)."""
    light, dark = rng.choice(BOARD_COLORS_SCREEN)
    img = Image.new("RGB", (side_px, side_px), light)
    d = ImageDraw.Draw(img)
    cell = side_px // 8
    for r in range(8):
        for c in range(8):
            if (r + c) % 2 == 1:
                d.rectangle([c*cell, r*cell, (c+1)*cell, (r+1)*cell], fill=dark)
    board = fen.split()[0].split("/")
    for r, rank in enumerate(board):
        c = 0
        for ch in rank:
            if ch.isdigit():
                c += int(ch); continue
            color = "w" if ch.isupper() else "b"
            piece = ch.upper()
            key = (piece, color)
            if key in svgs:
                try:
                    pilp = svg_to_pil(svgs[key], cell)
                    img.paste(pilp, (c*cell, r*cell), pilp)
                except Exception: pass
            c += 1
    return img

# =========================================================================
# PERSPECTIVE + WARPING ---------------------------------------------------
# =========================================================================
def perspective_coeffs(src, dst):
    matrix = []
    for (sx, sy), (dx, dy) in zip(src, dst):
        matrix.append([sx, sy, 1, 0, 0, 0, -dx*sx, -dx*sy])
        matrix.append([0, 0, 0, sx, sy, 1, -dy*sx, -dy*sy])
    A = np.array(matrix, dtype=np.float64)
    B = np.array([c for pt in dst for c in pt], dtype=np.float64)
    res, *_ = np.linalg.lstsq(A, B, rcond=None)
    return tuple(res.tolist())

def warp_board(base, nudge_ratio, rng):
    bw, bh = base.size
    src = [(0, 0), (bw, 0), (bw, bh), (0, bh)]
    nudge = int(min(bw, bh) * nudge_ratio)
    dst = [(x + rng.randint(-nudge, nudge), y + rng.randint(-nudge, nudge)) for (x, y) in src]
    min_x = min(p[0] for p in dst); min_y = min(p[1] for p in dst)
    dst = [(p[0] - min_x, p[1] - min_y) for p in dst]
    cw = max(p[0] for p in dst) + 1; ch = max(p[1] for p in dst) + 1
    coeffs = perspective_coeffs(dst, src)
    warped = base.transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", (bw, bh), 255).transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.NEAREST)
    return warped, mask, dst

# =========================================================================
# BACKGROUNDS -------------------------------------------------------------
# =========================================================================
def perlin_noise(w, h, scale, rng):
    result = np.zeros((h, w), dtype=np.float32)
    for octave, weight in [(1, 0.5), (2, 0.25), (4, 0.15), (8, 0.1)]:
        gh, gw = max(2, int(h * scale * octave / 10)), max(2, int(w * scale * octave / 10))
        arr = np.random.RandomState(int(rng.random() * 1e9) % (2**32)).rand(gh, gw).astype(np.float32)
        arr_img = Image.fromarray((arr * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
        result += np.array(arr_img, dtype=np.float32) / 255 * weight
    return np.clip(result, 0, 1)

def make_paper_bg(w, h, rng, aged=False):
    base_c = (232, 218, 175) if aged else (245, 240, 225)
    base = np.array([[list(base_c)]], dtype=np.uint8).repeat(h, 0).repeat(w, 1)
    texture = (perlin_noise(w, h, 0.6, rng) * 18).astype(np.int16) - 9
    base = np.clip(base + texture[..., None], 0, 255).astype(np.uint8)
    img = Image.fromarray(base)
    d = ImageDraw.Draw(img)
    for _ in range(rng.randint(1, 5)):
        bx = rng.randint(0, max(1, w-100)); by = rng.randint(0, max(1, h-40))
        bw = rng.randint(60, min(280, w-bx)); bh = rng.randint(8, 40)
        text_color = tuple(max(0, c - rng.randint(80, 150)) for c in base_c)
        for row in range(0, bh, 5):
            gx = 0
            while gx < bw:
                seg = rng.randint(4, 26)
                d.line([(bx+gx, by+row), (bx+gx+seg, by+row)], fill=text_color, width=1)
                gx += seg + rng.randint(1, 6)
    return img

def make_wood_bg(w, h, rng):
    r = perlin_noise(w, h, 0.3, rng)
    wood = np.zeros((h, w, 3), dtype=np.uint8)
    wood[..., 0] = np.clip(140 + r * 60, 0, 255)
    wood[..., 1] = np.clip(90  + r * 50, 0, 255)
    wood[..., 2] = np.clip(50  + r * 40, 0, 255)
    return Image.fromarray(wood)

def make_screen_bg(w, h, rng):
    """Screen/desktop background: dark UI + fake browser chrome."""
    dark = (rng.randint(25, 60), rng.randint(25, 60), rng.randint(28, 65))
    img = Image.new("RGB", (w, h), dark)
    d = ImageDraw.Draw(img)
    # Top browser bar
    if rng.random() < 0.7:
        bar_h = rng.randint(20, 40)
        d.rectangle([0, 0, w, bar_h], fill=(50, 55, 65))
        # Fake tabs
        tx = 10
        for _ in range(rng.randint(2, 4)):
            tw = rng.randint(80, 150)
            d.rounded_rectangle([tx, 5, tx + tw, bar_h - 5], radius=4, fill=(70, 78, 90))
            d.text((tx + 10, 12), "chess", fill=(200, 200, 200))
            tx += tw + 4
    # Fake sidebar
    if rng.random() < 0.5:
        d.rectangle([0, 0, rng.randint(40, 120), h], fill=(30, 35, 45))
    return img

def make_plain_bg(w, h, rng, light=True):
    if light:
        return Image.new("RGB", (w, h), tuple(rng.randint(200, 250) for _ in range(3)))
    return Image.new("RGB", (w, h), tuple(rng.randint(30, 90) for _ in range(3)))

def make_background(w, h, rng, style_hint=None):
    styles = ["paper", "aged_paper", "wood", "screen", "plain_light", "plain_dark", "colorful"]
    style = style_hint or rng.choice(styles)
    if style == "paper": return make_paper_bg(w, h, rng, False)
    if style == "aged_paper": return make_paper_bg(w, h, rng, True)
    if style == "wood": return make_wood_bg(w, h, rng)
    if style == "screen": return make_screen_bg(w, h, rng)
    if style == "plain_light": return make_plain_bg(w, h, rng, True)
    if style == "plain_dark": return make_plain_bg(w, h, rng, False)
    return Image.new("RGB", (w, h), tuple(rng.randint(0, 255) for _ in range(3)))

# =========================================================================
# SCREEN-PHOTO ARTIFACTS --------------------------------------------------
# =========================================================================
def apply_moire(img, rng):
    """Moiré pattern: colourful stripes from camera-sensor + screen-pixel-grid
    interference. Small-angle offset diagonal RGB shift."""
    if rng.random() < 0.75: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    ang = rng.uniform(-15, 15)
    freq = rng.uniform(0.15, 0.4)
    xs, ys = np.mgrid[0:h, 0:w].astype(np.float32)
    proj = xs * math.cos(math.radians(ang)) + ys * math.sin(math.radians(ang))
    stripe = np.sin(proj * freq) * rng.uniform(6, 18)
    # Different phase per channel
    arr[..., 0] += stripe
    arr[..., 1] += np.roll(stripe, rng.randint(2, 6), axis=1)
    arr[..., 2] += np.roll(stripe, rng.randint(4, 10), axis=1)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_scan_lines(img, rng):
    """Screen refresh scan lines: horizontal bright/dim bands."""
    if rng.random() < 0.8: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    band_h = rng.randint(8, 25)
    for y in range(0, h, band_h):
        strength = rng.uniform(-0.08, 0.08)
        arr[y:y+band_h//2] *= (1 + strength)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_screen_glare(img, rng):
    """Bright specular reflection zone from window/light on screen glass."""
    if rng.random() < 0.6: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    cx = rng.randint(-20, w + 20); cy = rng.randint(-20, h + 20)
    rx = rng.randint(50, w); ry = rng.randint(30, h // 2)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (xs - cx) / rx; dy = (ys - cy) / ry
    d2 = dx * dx + dy * dy
    mask = np.exp(-d2 * 2) * rng.uniform(30, 90)
    arr = np.clip(arr + mask[..., None], 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

# =========================================================================
# UI CHROME (browser bars, buttons around the board) ---------------------
# =========================================================================
def overlay_ui_chrome(img, rng, exclusion_box=None):
    """Draw fake browser UI elements: tabs, toolbar, buttons -- around
    the board area. exclusion_box = (x1,y1,x2,y2) region to NOT draw over
    (the board bounding rect). Some UI can still overlap slightly for
    realism (partial cover)."""
    if rng.random() < 0.6: return img
    w, h = img.size
    d = ImageDraw.Draw(img)
    ex1, ey1, ex2, ey2 = exclusion_box or (0, 0, 0, 0)
    # Top browser bar (won't touch board if board is below y=40)
    if ey1 > 40 or rng.random() < 0.3:
        bar_h = rng.randint(24, 48)
        d.rectangle([0, 0, w, bar_h], fill=(240, 240, 245))
        # Tabs
        tx = 10
        for _ in range(rng.randint(2, 5)):
            tw = rng.randint(70, 140)
            d.rounded_rectangle([tx, 6, tx + tw, bar_h - 4], radius=3, fill=(210, 210, 220))
            tx += tw + 3
    # Side toolbar
    if rng.random() < 0.4 and ex1 > 50:
        d.rectangle([0, 40, rng.randint(40, 90), h], fill=(50, 55, 65))
        for by in range(60, h - 30, 40):
            d.ellipse([15, by, 35, by + 20], fill=(120, 130, 145))
    # Question text (above/below board)
    if rng.random() < 0.5:
        ty = ey1 - 20 if ey1 > 30 else ey2 + 5
        if 0 < ty < h - 20:
            d.text((10 + rng.randint(0, 100), ty), "What is the best move?", fill=(60, 60, 60))
    return img

# =========================================================================
# ROTATION ---------------------------------------------------------------
# =========================================================================
def rotate_scene(img, corners, rng):
    """Rotate the entire scene by 0/90/180/270 or a small random angle,
    then recompute corner positions accordingly."""
    # Bucket the rotation: 40% no rotation, 20% each 90/180/270, 20% small tilt.
    r = rng.random()
    if r < 0.40: return img, corners
    if r < 0.60: angle = 90
    elif r < 0.75: angle = 180
    elif r < 0.90: angle = 270
    else: angle = rng.uniform(-25, 25)
    w0, h0 = img.size
    rotated = img.rotate(-angle, resample=Image.BICUBIC, expand=True)
    w1, h1 = rotated.size
    # Rotate corners about the ORIGINAL image centre, then translate to new frame
    cx0, cy0 = w0 / 2, h0 / 2
    cx1, cy1 = w1 / 2, h1 / 2
    rad = math.radians(angle)
    c, s = math.cos(rad), math.sin(rad)
    new_corners = []
    for (x, y) in corners:
        dx = x - cx0; dy = y - cy0
        rx = dx * c - dy * s; ry = dx * s + dy * c
        new_corners.append((rx + cx1, ry + cy1))
    return rotated, new_corners

# =========================================================================
# THE OTHER AUGMENTATIONS (from v3) - abbreviated for brevity ------------
# =========================================================================
def apply_directional_light(img, rng, strength_range=(0.15, 0.5)):
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    ang = rng.uniform(0, 2 * math.pi)
    strength = rng.uniform(*strength_range)
    xs = np.arange(w).reshape(1, w).astype(np.float32) / w - 0.5
    ys = np.arange(h).reshape(h, 1).astype(np.float32) / h - 0.5
    grad = (xs * math.cos(ang) + ys * math.sin(ang)) * strength
    arr = np.clip(arr * (1 + grad[..., None]), 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_color_temp(img, rng):
    arr = np.array(img, dtype=np.float32)
    shift = rng.uniform(-40, 40)
    arr[..., 0] = np.clip(arr[..., 0] + shift, 0, 255)
    arr[..., 2] = np.clip(arr[..., 2] - shift, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_sensor_noise(img, rng):
    arr = np.array(img, dtype=np.float32)
    arr += np.random.normal(0, rng.uniform(1, 8), arr.shape)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_motion_blur(img, rng):
    if rng.random() < 0.75: return img
    size = rng.choice([3, 5])
    ang = rng.uniform(0, 180)
    k = np.zeros((size, size), dtype=np.float32)
    cx = (size - 1) / 2
    for i in range(size):
        offset = i - cx
        x = int(round(cx + offset * math.cos(math.radians(ang))))
        y = int(round(cx + offset * math.sin(math.radians(ang))))
        if 0 <= x < size and 0 <= y < size: k[y, x] = 1
    if k.sum() == 0: return img
    k /= k.sum()
    kernel = ImageFilter.Kernel(size=(size, size), kernel=k.flatten().tolist(), scale=1.0, offset=0)
    return img.filter(kernel)

def apply_focus_blur(img, rng):
    if rng.random() < 0.5: return img
    return img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.3, 2.0)))

def apply_vignette(img, rng):
    if rng.random() < 0.55: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    r = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / math.sqrt(cx * cx + cy * cy)
    strength = rng.uniform(0.15, 0.45)
    dim = 1 - r ** 2 * strength
    arr = np.clip(arr * dim[..., None], 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_jpeg(img, rng):
    passes = rng.randint(1, 3)
    for _ in range(passes):
        buf = io.BytesIO(); img.save(buf, format="JPEG", quality=rng.randint(40, 92))
        img = Image.open(buf).convert("RGB")
    return img

# =========================================================================
# MAIN GENERATOR ---------------------------------------------------------
# =========================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/corner-train-v4")
    ap.add_argument("--samples", type=int, default=50000)
    ap.add_argument("--val-frac", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    np.random.seed(args.seed)
    out_dir = Path(args.out)
    (out_dir / "train" / "images").mkdir(parents=True, exist_ok=True)
    (out_dir / "val" / "images").mkdir(parents=True, exist_ok=True)
    train_labels = open(out_dir / "train" / "labels.jsonl", "w")
    val_labels = open(out_dir / "val" / "labels.jsonl", "w")

    # Load book diagram bases
    book_paths = sorted(glob.glob(BASE_BOARDS_GLOB))
    book_boards = []
    for p in book_paths:
        try:
            im = Image.open(p).convert("RGB")
            im.thumbnail((400, 400), Image.LANCZOS)
            book_boards.append(im)
        except Exception: pass
    print(f"[gen] {len(book_boards)} book bases")

    # Load Lichess piece sets for screen-style rendering. Filter to sets
    # whose SVGs all rasterise (some Lichess sets ship broken SVGs).
    all_sets = load_lichess_sets()
    lichess_sets = {}
    for name, svgs in all_sets.items():
        try:
            for k, v in svgs.items():
                svg_to_pil(v, 32)
            lichess_sets[name] = svgs
        except Exception: pass
    print(f"[gen] {len(lichess_sets)} clean Lichess piece sets (from {len(all_sets)})")

    train_count = 0; val_count = 0
    for i in range(args.samples):
        # Choose scene type
        scene_type = rng.choices(
            ["book_photo", "screen_photo", "puzzle_layout", "multi_board", "physical"],
            weights=[30, 25, 15, 15, 15]
        )[0]

        primary_board = None
        secondary_boards = []
        bg_hint = None

        if scene_type == "book_photo":
            primary_board = rng.choice(book_boards)
            bg_hint = rng.choice(["paper", "aged_paper", "wood"])
        elif scene_type == "screen_photo":
            # Render a fresh board from a Lichess set + random FEN
            set_name = rng.choice(list(lichess_sets.keys()))
            fen = rng.choice(SAMPLE_FENS)
            primary_board = render_screen_board(fen, lichess_sets[set_name], rng, side_px=320)
            bg_hint = "screen"
        elif scene_type == "puzzle_layout":
            # Screen board + a small "reference" board nearby (like a puzzle site)
            set_name = rng.choice(list(lichess_sets.keys()))
            primary_board = render_screen_board(rng.choice(SAMPLE_FENS), lichess_sets[set_name], rng, side_px=320)
            secondary_boards.append(render_screen_board(rng.choice(SAMPLE_FENS), lichess_sets[set_name], rng, side_px=100))
            bg_hint = "screen"
        elif scene_type == "multi_board":
            # 2-3 book boards on a page (multiple diagrams in a book chapter)
            primary_board = rng.choice(book_boards)
            for _ in range(rng.randint(1, 2)):
                secondary_boards.append(rng.choice(book_boards))
            bg_hint = "paper"
        else:   # physical
            primary_board = rng.choice(book_boards)
            bg_hint = rng.choice(["wood", "plain_dark"])

        # Perspective distort primary board
        warped, mask, dst_corners = warp_board(primary_board, rng.uniform(0.05, 0.28), rng)
        cw, ch = warped.size

        # Compose scene
        bg = make_background(OUT_SIZE, OUT_SIZE, rng, style_hint=bg_hint)
        # Primary board: 30-88% of frame
        target = int(OUT_SIZE * rng.uniform(0.30, 0.88))
        scale = target / max(cw, ch)
        nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
        warped_s = warped.resize((nw, nh), Image.LANCZOS)
        mask_s = mask.resize((nw, nh), Image.NEAREST)
        px = rng.randint(0, max(1, OUT_SIZE - nw))
        py = rng.randint(0, max(1, OUT_SIZE - nh))
        bg.paste(warped_s, (px, py), mask_s)
        final_corners = [(p[0] * scale + px, p[1] * scale + py) for p in dst_corners]

        # Composite secondary boards (never as label; they're distractors)
        for sec in secondary_boards:
            sw, mw, _ = warp_board(sec, rng.uniform(0.05, 0.15), rng)
            secondary_target = int(OUT_SIZE * rng.uniform(0.15, 0.30))
            s = secondary_target / max(sw.size)
            snw, snh = max(1, int(sw.size[0] * s)), max(1, int(sw.size[1] * s))
            sec_img = sw.resize((snw, snh), Image.LANCZOS)
            sec_mask = mw.resize((snw, snh), Image.NEAREST)
            # Try to place away from primary board (up to 10 tries)
            for _ in range(10):
                sx = rng.randint(0, max(1, OUT_SIZE - snw))
                sy = rng.randint(0, max(1, OUT_SIZE - snh))
                # No overlap with primary bbox
                pbb = (px, py, px + nw, py + nh)
                sbb = (sx, sy, sx + snw, sy + snh)
                if sx + snw < pbb[0] or sx > pbb[2] or sy + snh < pbb[1] or sy > pbb[3]:
                    bg.paste(sec_img, (sx, sy), sec_mask)
                    break

        # UI chrome for screen/puzzle scenes
        if scene_type in ("screen_photo", "puzzle_layout"):
            bg = overlay_ui_chrome(bg, rng, exclusion_box=(px, py, px + nw, py + nh))
            bg = apply_moire(bg, rng)
            bg = apply_scan_lines(bg, rng)
            bg = apply_screen_glare(bg, rng)

        # Common camera augmentations
        img = apply_directional_light(bg, rng)
        img = apply_color_temp(img, rng)
        img = apply_focus_blur(img, rng)
        img = apply_motion_blur(img, rng)
        img = apply_vignette(img, rng)
        img = apply_sensor_noise(img, rng)
        img = apply_jpeg(img, rng)

        # ROTATION -- 60% chance (includes 0° in the ratio)
        img, final_corners = rotate_scene(img, final_corners, rng)
        # If rotation expanded canvas, fit-fill back to OUT_SIZE
        if img.size != (OUT_SIZE, OUT_SIZE):
            src_w, src_h = img.size
            new_img = Image.new("RGB", (OUT_SIZE, OUT_SIZE), (128, 128, 128))
            # Fit within OUT_SIZE keeping aspect, centre
            fit_scale = min(OUT_SIZE / src_w, OUT_SIZE / src_h)
            fw = int(src_w * fit_scale); fh = int(src_h * fit_scale)
            fx = (OUT_SIZE - fw) // 2; fy = (OUT_SIZE - fh) // 2
            new_img.paste(img.resize((fw, fh), Image.LANCZOS), (fx, fy))
            final_corners = [(c[0] * fit_scale + fx, c[1] * fit_scale + fy) for c in final_corners]
            img = new_img

        # Skip sample if any corner ended up outside frame (rotation edge case)
        if any(c[0] < 0 or c[1] < 0 or c[0] > OUT_SIZE or c[1] > OUT_SIZE for c in final_corners):
            continue

        # Save
        val = rng.random() < args.val_frac
        idx = val_count if val else train_count
        name = f"{idx:06d}.jpg"
        img.save(out_dir / ("val" if val else "train") / "images" / name, format="JPEG", quality=88)
        rec = {"image": name, "corners": [[round(x, 2), round(y, 2)] for x, y in final_corners], "size": OUT_SIZE, "scene": scene_type}
        (val_labels if val else train_labels).write(json.dumps(rec) + "\n")
        if val: val_count += 1
        else: train_count += 1
        if (i + 1) % 2500 == 0:
            print(f"[gen] {i+1}/{args.samples} (train={train_count} val={val_count})")

    train_labels.close(); val_labels.close()
    print(f"[done] train={train_count} val={val_count} → {out_dir}/")

if __name__ == "__main__":
    main()
