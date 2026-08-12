"""Camera simulator v3 — deeply models a real human phone-photo capture
of a chess book page, covering the factors below. Trained model on this
data should generalise to actual user uploads without needing years of
real user photos.

FACTORS SIMULATED (grouped)
============================

A. GEOMETRY (how phone is held vs. page)
   1. Random 3D pose: tilt/pitch/yaw via 4-corner homography
   2. Camera-book distance: board takes 30-92% of frame
   3. Off-axis position: board can be anywhere in the frame
   4. Book curvature: barrel warp on one side (open-book fold-line)
   5. Random rotation of the whole scene (0-360°, phone orientation)

B. LENS (hardware artefacts)
   6. Barrel or pincushion radial distortion (phone wide/tele lens)
   7. Vignetting: corners darker than centre
   8. Chromatic aberration: RGB channel offset near edges

C. FOCUS + MOTION
   9. Motion blur: 3x3 or 5x5 directional kernel (hand shake)
  10. Focus blur: Gaussian defocus radius 0.2-2.5
  11. Depth-of-field asymmetry: sharper in centre, softer at edges

D. SENSOR + EXPOSURE
  12. Gaussian sensor noise (ISO gain proxy)
  13. Poisson shot noise (bright regions noisier)
  14. Occasional hot pixels
  15. Dynamic range clipping: highlights can blow out

E. WHITE BALANCE + COLOUR
  16. Colour temperature shift: warm (tungsten) to cool (daylight)
  17. Green/magenta tint (fluorescent lighting)
  18. Overall saturation boost/reduce
  19. Environment colour cast (reddish from wooden table etc.)

F. LIGHTING
  20. Primary directional light (window/lamp) with angle + strength
  21. Optional secondary light (softer, opposite direction)
  22. Ambient light level (bright day / dim evening)
  23. Photographer/phone self-shadow (soft rectangular dim patch)
  24. Specular highlight on glossy pages (bright small spot)
  25. Uneven light falloff across the page

G. PHYSICAL SCENE
  26. Backgrounds: paper texture, wood grain, dark table, plain colours
  27. Optional visible finger/thumb edge on one side
  28. Optional bookmark string overlaid on the page
  29. Adjacent page or column text on either side
  30. Aged/yellowed paper tint

H. POST-PROCESSING
  31. JPEG compression (1-3 passes, quality 40-95)
  32. Sharpening halos (phone processing)
  33. Denoise smoothing (high-ISO phone processing)
  34. Resize round-trip (loss of detail)
  35. Optional Instagram-style filter tint

I. FRAMING
  36. Portrait / landscape / square aspect variation
  37. Board can be MOSTLY of frame (tight photo) or SMALL (wide shot)

Base boards: 975 real book-diagram PNGs extracted from Final Theory,
Idiot's Guide, Chernev-Capa (real ink, real fonts, real print artefacts).

Run: /tmp/chesstrain-env/bin/python /tmp/gen-corner-data-v3.py \
     --out /tmp/corner-train-v3 --samples 30000
"""
import argparse, io, json, random, glob, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

OUT_SIZE = 256
BASE_BOARDS_GLOB = "/tmp/chessbook/boards/*.png"

# =========================================================================
# A. GEOMETRY -------------------------------------------------------------
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

def apply_book_curvature(img, mask, rng):
    """Bend the right (or left) half of the board upward slightly, like
    an open-book page near the spine. Barrel-like warp on half the image."""
    if rng.random() < 0.85: return img, mask   # 15% of samples
    w, h = img.size
    arr = np.array(img, dtype=np.uint8)
    marr = np.array(mask, dtype=np.uint8)
    out = np.zeros_like(arr); mout = np.zeros_like(marr)
    strength = rng.uniform(0.02, 0.06)   # curve amplitude fraction
    side = rng.choice(["left", "right"])
    xs, ys = np.meshgrid(np.arange(w), np.arange(h))
    if side == "right":
        x_norm = np.clip((xs - w/2) / (w/2), 0, 1)   # 0 on left half, 1 on right edge
    else:
        x_norm = np.clip((w/2 - xs) / (w/2), 0, 1)
    dy = (x_norm ** 2 * strength * h).astype(np.int32)
    ys_new = np.clip(ys - dy, 0, h-1)
    out = arr[ys_new, xs]
    mout = marr[ys_new, xs]
    return Image.fromarray(out), Image.fromarray(mout)

# =========================================================================
# B. LENS ------------------------------------------------------------------
# =========================================================================
def apply_radial_distortion(img, rng, k1_range=(-0.15, 0.15)):
    """Barrel (k1<0) or pincushion (k1>0). Small k1 for phone lenses."""
    if rng.random() < 0.85: return img   # 15% of samples
    w, h = img.size
    arr = np.array(img)
    k1 = rng.uniform(*k1_range)
    cx, cy = w / 2, h / 2
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    x_norm = (xs - cx) / cx
    y_norm = (ys - cy) / cy
    r2 = x_norm ** 2 + y_norm ** 2
    factor = 1 + k1 * r2
    sx = np.clip((x_norm * factor * cx + cx).astype(np.int32), 0, w - 1)
    sy = np.clip((y_norm * factor * cy + cy).astype(np.int32), 0, h - 1)
    if arr.ndim == 2: return Image.fromarray(arr[sy, sx])
    return Image.fromarray(arr[sy, sx])

def apply_vignette(img, rng):
    if rng.random() < 0.4: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    r = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / math.sqrt(cx * cx + cy * cy)
    strength = rng.uniform(0.15, 0.5)
    dim = 1 - r ** 2 * strength
    arr = np.clip(arr * dim[..., None], 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_chromatic_aberration(img, rng):
    if rng.random() < 0.55: return img
    arr = np.array(img)
    if arr.ndim != 3 or arr.shape[2] < 3: return img
    # Shift more at frame edges than centre -- realistic aberration.
    dx_r, dy_r = rng.randint(-3, 3), rng.randint(-3, 3)
    dx_b, dy_b = rng.randint(-3, 3), rng.randint(-3, 3)
    r = np.roll(arr[..., 0], (dy_r, dx_r), axis=(0, 1))
    b = np.roll(arr[..., 2], (dy_b, dx_b), axis=(0, 1))
    out = arr.copy(); out[..., 0] = r; out[..., 2] = b
    return Image.fromarray(out)

# =========================================================================
# C. FOCUS + MOTION --------------------------------------------------------
# =========================================================================
def apply_motion_blur(img, rng):
    if rng.random() < 0.65: return img
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
    if rng.random() < 0.3: return img
    return img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.3, 2.0)))

def apply_dof_edge_blur(img, rng):
    """Sharp in centre, blurred at edges (depth-of-field asymmetry)."""
    if rng.random() < 0.90: return img   # 10% -- expensive, weight-composite
    w, h = img.size
    sharp = np.array(img, dtype=np.float32)
    blurred = np.array(img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(1.5, 3))), dtype=np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    r = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / math.sqrt(cx * cx + cy * cy)
    weight = np.clip(r ** 2 * rng.uniform(0.8, 1.6), 0, 1)
    out = sharp * (1 - weight[..., None]) + blurred * weight[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

# =========================================================================
# D. SENSOR + EXPOSURE ----------------------------------------------------
# =========================================================================
def apply_sensor_noise(img, rng):
    arr = np.array(img, dtype=np.float32)
    sigma = rng.uniform(1, 8)
    arr += np.random.normal(0, sigma, arr.shape)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_shot_noise(img, rng):
    if rng.random() < 0.6: return img
    arr = np.array(img, dtype=np.float32) / 255
    scale = rng.uniform(80, 300)   # lower = more Poisson-like noise
    arr = np.random.poisson(arr * scale) / scale
    return Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8))

def apply_hot_pixels(img, rng):
    if rng.random() < 0.85: return img
    arr = np.array(img)
    w, h = img.size
    for _ in range(rng.randint(1, 5)):
        x, y = rng.randint(0, w-1), rng.randint(0, h-1)
        arr[y, x] = [255, 255, 255] if rng.random() < 0.5 else [0, 0, 0]
    return Image.fromarray(arr)

def apply_dynamic_range(img, rng):
    """Clip highlights (blown-out sky/glare) with soft roll-off."""
    if rng.random() < 0.7: return img
    arr = np.array(img, dtype=np.float32)
    ceil = rng.uniform(210, 245)
    arr = np.where(arr > ceil, ceil + (arr - ceil) * 0.3, arr)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

# =========================================================================
# E. WHITE BALANCE + COLOUR -----------------------------------------------
# =========================================================================
def apply_color_temp(img, rng):
    arr = np.array(img, dtype=np.float32)
    shift = rng.uniform(-40, 40)
    arr[..., 0] = np.clip(arr[..., 0] + shift, 0, 255)
    arr[..., 2] = np.clip(arr[..., 2] - shift, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_tint(img, rng):
    """Green/magenta shift (fluorescent lighting)."""
    if rng.random() < 0.6: return img
    arr = np.array(img, dtype=np.float32)
    shift = rng.uniform(-20, 20)
    arr[..., 1] = np.clip(arr[..., 1] + shift, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_saturation(img, rng):
    if rng.random() < 0.4: return img
    return ImageEnhance.Color(img).enhance(rng.uniform(0.7, 1.3))

# =========================================================================
# F. LIGHTING -------------------------------------------------------------
# =========================================================================
def apply_directional_light(img, rng, strength_range=(0.15, 0.5)):
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    ang = rng.uniform(0, 2 * math.pi)
    strength = rng.uniform(*strength_range)
    xs = np.arange(w).reshape(1, w).astype(np.float32) / w - 0.5
    ys = np.arange(h).reshape(h, 1).astype(np.float32) / h - 0.5
    grad = xs * math.cos(ang) + ys * math.sin(ang)
    grad = grad * strength
    arr = np.clip(arr * (1 + grad[..., None]), 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_specular_highlight(img, rng):
    """Small bright hot spot on glossy paper (specular reflection)."""
    if rng.random() < 0.75: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    cx, cy = rng.randint(0, w), rng.randint(0, h)
    radius = rng.randint(15, 45)
    ys, xs = np.mgrid[0:h, 0:w]
    d2 = (xs - cx) ** 2 + (ys - cy) ** 2
    mask = np.exp(-d2 / (2 * radius * radius))
    arr = np.clip(arr + mask[..., None] * rng.uniform(70, 130), 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def apply_self_shadow(img, rng):
    """Soft rectangular shadow from photographer/phone."""
    if rng.random() < 0.75: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    sx1 = rng.randint(0, w * 3 // 4)
    sy1 = rng.randint(0, h * 3 // 4)
    sx2 = sx1 + rng.randint(w // 5, w // 2)
    sy2 = sy1 + rng.randint(h // 5, h // 2)
    mask = np.zeros((h, w), dtype=np.float32)
    y1, y2 = max(0, sy1), min(h, sy2)
    x1, x2 = max(0, sx1), min(w, sx2)
    mask[y1:y2, x1:x2] = 1
    mask_img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=rng.randint(12, 25)))
    mask = np.array(mask_img, dtype=np.float32) / 255
    arr = np.clip(arr * (1 - mask[..., None] * rng.uniform(0.25, 0.55)), 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

# =========================================================================
# G. PHYSICAL SCENE -------------------------------------------------------
# =========================================================================
def perlin_noise(w, h, scale, rng):
    result = np.zeros((h, w), dtype=np.float32)
    for octave, weight in [(1, 0.5), (2, 0.25), (4, 0.15), (8, 0.1)]:
        gh, gw = max(2, int(h * scale * octave / 10)), max(2, int(w * scale * octave / 10))
        arr = np.random.RandomState(int(rng.random() * 1e9) % (2**32)).rand(gh, gw).astype(np.float32)
        arr_img = Image.fromarray((arr * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
        result += np.array(arr_img, dtype=np.float32) / 255 * weight
    return np.clip(result, 0, 1)

def make_background(w, h, rng):
    style = rng.choice(["paper", "aged_paper", "wood", "table_dark", "plain_light", "plain_dark", "colorful"])
    if style in ("paper", "aged_paper"):
        base_c = (245, 240, 225) if style == "paper" else (232, 218, 175)
        base = np.array([[list(base_c)]], dtype=np.uint8).repeat(h, 0).repeat(w, 1)
        texture = (perlin_noise(w, h, 0.6, rng) * 18).astype(np.int16) - 9
        base = np.clip(base + texture[..., None], 0, 255).astype(np.uint8)
        img = Image.fromarray(base)
        d = ImageDraw.Draw(img)
        # Fake text-block strips (columns)
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
    if style == "wood":
        r = perlin_noise(w, h, 0.3, rng)
        wood = np.zeros((h, w, 3), dtype=np.uint8)
        wood[..., 0] = np.clip(140 + r * 60, 0, 255)
        wood[..., 1] = np.clip(90  + r * 50, 0, 255)
        wood[..., 2] = np.clip(50  + r * 40, 0, 255)
        return Image.fromarray(wood)
    if style == "table_dark":
        r = perlin_noise(w, h, 0.4, rng)
        arr = np.zeros((h, w, 3), dtype=np.uint8)
        base_c = rng.randint(30, 80)
        for c in range(3):
            arr[..., c] = np.clip(base_c + r * 30 + rng.randint(-10, 10), 0, 255)
        return Image.fromarray(arr)
    if style == "plain_light":
        return Image.new("RGB", (w, h), tuple(rng.randint(200, 250) for _ in range(3)))
    if style == "plain_dark":
        return Image.new("RGB", (w, h), tuple(rng.randint(30, 90) for _ in range(3)))
    return Image.new("RGB", (w, h), tuple(rng.randint(0, 255) for _ in range(3)))

def apply_finger_edge(img, rng):
    """Draw a soft skin-tone blob on one edge -- simulates thumb holding the book."""
    if rng.random() < 0.85: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    side = rng.choice(["l", "r", "b"])
    tone = (rng.randint(140, 230), rng.randint(105, 180), rng.randint(80, 150))
    mask = np.zeros((h, w), dtype=np.float32)
    if side == "l":
        ex = rng.randint(20, w // 6)
        for y in range(h): mask[y, :ex] = np.linspace(1, 0, ex)
    elif side == "r":
        ex = rng.randint(20, w // 6)
        for y in range(h): mask[y, w-ex:] = np.linspace(0, 1, ex)
    else:
        ey = rng.randint(20, h // 6)
        for x in range(w): mask[h-ey:, x] = np.linspace(0, 1, ey)
    # Soften
    mask_img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=rng.randint(4, 12)))
    mask = np.array(mask_img, dtype=np.float32) / 255
    for c in range(3):
        arr[..., c] = arr[..., c] * (1 - mask) + tone[c] * mask
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_bookmark(img, rng):
    """Diagonal thin coloured line across the page."""
    if rng.random() < 0.9: return img
    d = ImageDraw.Draw(img)
    w, h = img.size
    color = (rng.randint(100, 255), rng.randint(0, 150), rng.randint(0, 150))
    x1, y1 = rng.randint(0, w // 2), 0
    x2, y2 = rng.randint(w // 2, w), h
    d.line([(x1, y1), (x2, y2)], fill=color, width=rng.randint(3, 8))
    return img

def apply_page_fold_crease(img, rng):
    """Dark line across the page from a fold or open-book spine."""
    if rng.random() < 0.7: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    orientation = rng.choice(["v", "h", "diag"])
    strength = rng.uniform(0.15, 0.4)
    width = rng.randint(4, 12)
    if orientation == "v":
        cx = rng.randint(w // 4, 3 * w // 4)
        for x in range(max(0, cx - width), min(w, cx + width)):
            dim = 1 - strength * math.exp(-((x - cx) ** 2) / (2 * (width / 2) ** 2))
            arr[:, x] *= dim
    elif orientation == "h":
        cy = rng.randint(h // 4, 3 * h // 4)
        for y in range(max(0, cy - width), min(h, cy + width)):
            dim = 1 - strength * math.exp(-((y - cy) ** 2) / (2 * (width / 2) ** 2))
            arr[y, :] *= dim
    else:   # diagonal soft crease
        ang = rng.uniform(-30, 30)
        cx, cy = w // 2, h // 2
        c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        rel = (xs - cx) * c + (ys - cy) * s
        dim = 1 - strength * np.exp(-(rel ** 2) / (2 * width ** 2))
        arr = arr * dim[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_bleed_through(img, rng, base_boards):
    """Faint back-page text/diagram showing through thin paper. Composite a
    HEAVILY-blurred and lightened random other board on top at low opacity."""
    if rng.random() < 0.92: return img   # 8% of samples (expensive I/O)
    w, h = img.size
    other = rng.choice(base_boards).resize((w, h), Image.LANCZOS)
    # Horizontal flip (back page is mirror-image-like when viewed from front)
    other = other.transpose(Image.FLIP_LEFT_RIGHT)
    # Heavy blur + lighten so it looks like ghost bleed
    other = other.filter(ImageFilter.GaussianBlur(radius=rng.uniform(2, 4)))
    # Blend at low alpha
    alpha = rng.uniform(0.06, 0.15)
    arr = np.array(img, dtype=np.float32)
    other_arr = np.array(other, dtype=np.float32)
    out = arr * (1 - alpha) + other_arr * alpha
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

def apply_highlighter(img, rng):
    """Yellow/pink transparent overlay stripe like a highlighter mark."""
    if rng.random() < 0.9: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    color = rng.choice([(255, 240, 100), (255, 180, 200), (180, 255, 180)])
    x1 = rng.randint(0, w // 2)
    y1 = rng.randint(0, h - 20)
    x2 = x1 + rng.randint(80, w // 2)
    y2 = y1 + rng.randint(8, 24)
    mask = np.zeros((h, w), dtype=np.float32)
    mask[max(0,y1):min(h,y2), max(0,x1):min(w,x2)] = rng.uniform(0.25, 0.5)
    mask_img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=3))
    mask = np.array(mask_img, dtype=np.float32) / 255
    for c in range(3):
        arr[..., c] = arr[..., c] * (1 - mask) + color[c] * mask
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_coffee_stain(img, rng):
    """Brown circular ring blob."""
    if rng.random() < 0.92: return img
    w, h = img.size
    arr = np.array(img, dtype=np.float32)
    cx, cy = rng.randint(0, w), rng.randint(0, h)
    radius = rng.randint(30, 90)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    # Ring shape (max at radius, tapered inside/outside)
    ring = np.exp(-((d - radius) ** 2) / (2 * (radius * 0.15) ** 2))
    ring += 0.3 * np.exp(-((d) ** 2) / (2 * radius ** 2))   # some centre fill
    ring = np.clip(ring, 0, 1) * rng.uniform(0.25, 0.5)
    brown = (110, 70, 40)
    for c in range(3):
        arr[..., c] = arr[..., c] * (1 - ring) + brown[c] * ring
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

def apply_torn_corner(img, rng):
    """Simulate torn/dogeared corner -- irregular clipped region."""
    if rng.random() < 0.9: return img
    w, h = img.size
    arr = np.array(img, dtype=np.uint8)
    corner = rng.choice(["tl", "tr", "bl", "br"])
    size = rng.randint(30, min(80, w // 4))
    bg = (rng.randint(200, 240),) * 3   # background-ish colour
    # Fill an irregular pentagon in that corner
    if corner == "tl": pts = [(0, 0), (size + rng.randint(-10,10), 0), (rng.randint(size//2,size), size), (0, size + rng.randint(-10,10))]
    elif corner == "tr": pts = [(w-1, 0), (w-size, 0), (w-1-rng.randint(size//2,size), size), (w-1, size)]
    elif corner == "bl": pts = [(0, h-1), (size, h-1), (rng.randint(size//2,size), h-1-size), (0, h-1-size)]
    else: pts = [(w-1, h-1), (w-size, h-1), (w-1-rng.randint(size//2,size), h-1-size), (w-1, h-1-size)]
    tmp = Image.fromarray(arr)
    d = ImageDraw.Draw(tmp)
    d.polygon(pts, fill=bg)
    return tmp

def apply_lens_smudge(img, rng):
    """Localized soft blur from a fingerprint on the lens."""
    if rng.random() < 0.9: return img
    w, h = img.size
    cx, cy = rng.randint(w//4, 3*w//4), rng.randint(h//4, 3*h//4)
    radius = rng.randint(60, 150)
    sharp = np.array(img, dtype=np.float32)
    blurred = np.array(img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(3, 6))), dtype=np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    d2 = (xs - cx) ** 2 + (ys - cy) ** 2
    mask = np.exp(-d2 / (2 * radius * radius))
    out = sharp * (1 - mask[..., None]) + blurred * mask[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

def apply_dust_spots(img, rng):
    """A few small dark dust particles on the lens."""
    if rng.random() < 0.85: return img
    w, h = img.size
    arr = np.array(img, dtype=np.uint8)
    for _ in range(rng.randint(1, 4)):
        cx, cy = rng.randint(0, w-1), rng.randint(0, h-1)
        r = rng.randint(2, 5)
        alpha = rng.uniform(0.3, 0.7)
        for dy in range(-r, r+1):
            for dx in range(-r, r+1):
                if dx*dx + dy*dy > r*r: continue
                x, y = cx+dx, cy+dy
                if 0 <= x < w and 0 <= y < h:
                    arr[y, x] = (arr[y, x] * (1 - alpha)).astype(np.uint8)
    return Image.fromarray(arr)

def apply_pen_underline(img, rng):
    """Handwritten underline / annotation stroke."""
    if rng.random() < 0.88: return img
    d = ImageDraw.Draw(img)
    w, h = img.size
    ink = rng.choice([(0, 0, 120), (80, 0, 0), (0, 60, 0)])
    y = rng.randint(0, h - 5)
    x1 = rng.randint(0, w // 2)
    x2 = x1 + rng.randint(40, w // 2)
    # Wobbly line
    prev = (x1, y)
    for x in range(x1, x2, 5):
        ny = y + rng.randint(-1, 1)
        d.line([prev, (x, ny)], fill=ink, width=rng.randint(2, 3))
        prev = (x, ny)
    return img

def apply_page_bulge(img, mask, rng):
    """Bulge the middle of the page outward (soft radial warp) -- simulates
    a slightly puffy printed page. Simpler than book_curvature; can stack."""
    if rng.random() < 0.88: return img, mask   # 12% of samples (expensive)
    w, h = img.size
    arr = np.array(img, dtype=np.uint8)
    marr = np.array(mask, dtype=np.uint8)
    cx, cy = w // 2 + rng.randint(-30, 30), h // 2 + rng.randint(-30, 30)
    strength = rng.uniform(0.02, 0.05)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = xs - cx; dy = ys - cy
    r = np.sqrt(dx * dx + dy * dy) / max(1, math.sqrt(cx * cx + cy * cy))
    factor = 1 - strength * np.exp(-(r ** 2) * 2)
    sx = np.clip((dx * factor + cx).astype(np.int32), 0, w - 1)
    sy = np.clip((dy * factor + cy).astype(np.int32), 0, h - 1)
    return Image.fromarray(arr[sy, sx]), Image.fromarray(marr[sy, sx])

# =========================================================================
# H. POST-PROCESSING ------------------------------------------------------
# =========================================================================
def apply_jpeg(img, rng):
    passes = rng.randint(1, 3)
    for _ in range(passes):
        buf = io.BytesIO(); img.save(buf, format="JPEG", quality=rng.randint(40, 92))
        img = Image.open(buf).convert("RGB")
    return img

def apply_sharpening(img, rng):
    if rng.random() < 0.5: return img
    return img.filter(ImageFilter.UnsharpMask(radius=rng.uniform(1, 3), percent=rng.randint(50, 200), threshold=3))

def apply_denoise_smooth(img, rng):
    """Phone denoising sometimes over-smooths detail."""
    if rng.random() < 0.7: return img
    return img.filter(ImageFilter.SMOOTH)

def apply_resize_roundtrip(img, rng):
    if rng.random() < 0.6: return img
    tmp = rng.randint(150, 320)
    return img.resize((tmp, tmp), Image.BILINEAR).resize(img.size, Image.BILINEAR)

def apply_filter_tint(img, rng):
    """Instagram-style filter (warmth + contrast)."""
    if rng.random() < 0.85: return img
    img = ImageEnhance.Contrast(img).enhance(rng.uniform(1.05, 1.25))
    return apply_color_temp(img, rng)

# =========================================================================
# MAIN --------------------------------------------------------------------
# =========================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/corner-train-v3")
    ap.add_argument("--samples", type=int, default=30000)
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

    board_paths = sorted(glob.glob(BASE_BOARDS_GLOB))
    print(f"[gen] {len(board_paths)} board images available")
    base_boards = []
    for p in board_paths:
        try:
            img = Image.open(p).convert("RGB")
            img.thumbnail((400, 400), Image.LANCZOS)
            base_boards.append(img)
        except Exception: pass
    print(f"[gen] {len(base_boards)} base boards loaded")

    train_count = 0; val_count = 0
    for i in range(args.samples):
        base = rng.choice(base_boards)
        bw, bh = base.size

        # A. Geometry: perspective + optional book curvature
        src = [(0, 0), (bw, 0), (bw, bh), (0, bh)]
        nudge = int(min(bw, bh) * rng.uniform(0.08, 0.28))
        dst = [(x + rng.randint(-nudge, nudge), y + rng.randint(-nudge, nudge)) for (x, y) in src]
        min_x = min(p[0] for p in dst); min_y = min(p[1] for p in dst)
        dst = [(p[0] - min_x, p[1] - min_y) for p in dst]
        cw = max(p[0] for p in dst) + 1; ch = max(p[1] for p in dst) + 1
        coeffs = perspective_coeffs(dst, src)
        warped = base.transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
        mask = Image.new("L", (bw, bh), 255).transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.NEAREST)
        # Book curvature + page bulge (optional per-sample)
        warped, mask = apply_book_curvature(warped, mask, rng)
        warped, mask = apply_page_bulge(warped, mask, rng)

        # G. Physical scene: pick a background + composite
        bg = make_background(OUT_SIZE, OUT_SIZE, rng)
        # Board takes 30-92% of frame
        target = int(OUT_SIZE * rng.uniform(0.32, 0.92))
        scale = target / max(cw, ch)
        nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
        warped_s = warped.resize((nw, nh), Image.LANCZOS)
        mask_s = mask.resize((nw, nh), Image.NEAREST)
        px = rng.randint(0, OUT_SIZE - nw) if nw < OUT_SIZE else 0
        py = rng.randint(0, OUT_SIZE - nh) if nh < OUT_SIZE else 0
        bg.paste(warped_s, (px, py), mask_s)
        final_corners = [(p[0] * scale + px, p[1] * scale + py) for p in dst]

        img = bg

        # F. Lighting
        img = apply_directional_light(img, rng)
        if rng.random() < 0.35: img = apply_directional_light(img, rng, (0.1, 0.25))   # secondary
        img = apply_specular_highlight(img, rng)
        img = apply_self_shadow(img, rng)

        # G. Physical scene props (paper wear, occlusion, human traces)
        img = apply_finger_edge(img, rng)
        img = apply_bookmark(img, rng)
        img = apply_page_fold_crease(img, rng)
        img = apply_bleed_through(img, rng, base_boards)
        img = apply_highlighter(img, rng)
        img = apply_pen_underline(img, rng)
        img = apply_coffee_stain(img, rng)
        img = apply_torn_corner(img, rng)

        # E. White balance + colour
        img = apply_color_temp(img, rng)
        img = apply_tint(img, rng)
        img = apply_saturation(img, rng)

        # B. Lens (radial, vignette, aberration, smudges, dust)
        img = apply_radial_distortion(img, rng)
        img = apply_vignette(img, rng)
        img = apply_chromatic_aberration(img, rng)
        img = apply_lens_smudge(img, rng)
        img = apply_dust_spots(img, rng)

        # C. Focus + motion
        img = apply_focus_blur(img, rng)
        img = apply_motion_blur(img, rng)
        img = apply_dof_edge_blur(img, rng)

        # D. Sensor
        img = apply_sensor_noise(img, rng)
        img = apply_shot_noise(img, rng)
        img = apply_hot_pixels(img, rng)
        img = apply_dynamic_range(img, rng)

        # H. Post-processing
        img = apply_sharpening(img, rng)
        img = apply_denoise_smooth(img, rng)
        img = apply_jpeg(img, rng)
        img = apply_resize_roundtrip(img, rng)
        img = apply_filter_tint(img, rng)

        val = rng.random() < args.val_frac
        idx = val_count if val else train_count
        name = f"{idx:06d}.jpg"
        img.save(out_dir / ("val" if val else "train") / "images" / name, format="JPEG", quality=90)
        rec = {"image": name, "corners": [[round(x, 2), round(y, 2)] for x, y in final_corners], "size": OUT_SIZE}
        (val_labels if val else train_labels).write(json.dumps(rec) + "\n")
        if val: val_count += 1
        else: train_count += 1
        if (i + 1) % 2000 == 0:
            print(f"[gen] {i+1}/{args.samples} (train={train_count} val={val_count})")

    train_labels.close(); val_labels.close()
    print(f"[done] train={train_count} val={val_count} → {out_dir}/")

if __name__ == "__main__":
    main()
