"""Generate phone-photo composites using REAL EXTRACTED book diagrams as
the board. Real piece art × synthetic scene diversity × 40 camera realism
factors = training data that ChessVision AI can't replicate.

INPUT:  a folder of clean board crops (from vinayaka_extract_diagrams.py)
OUTPUT: composites with realism applied (masks + labels for extractor training)

Runs on France. Real diagrams are pulled from Vinayaka via SFTP on demand
(caches to /var/chessguru-books/real-diagrams-cache/).
"""
from __future__ import annotations
import argparse, random, sys, time, math
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# Reuse all the effect functions from the main gen script
sys.path.insert(0, "/opt/chessguru-vision")
from gen_book_composites import (
    paper_bg, screen_bg, add_text,
    apply_moire, apply_screen_glare, apply_book_curvature,
    apply_chromatic_aberration, apply_sensor_noise, apply_book_binding_shadow,
    apply_monitor_bezel, apply_refresh_scan_lines, apply_camera_tilt,
    apply_strong_perspective, apply_vignetting, apply_depth_of_field,
    apply_motion_blur, apply_jpeg_recompress, apply_exposure,
    apply_white_balance, apply_hdr_tone_curve, apply_lens_flare,
    apply_page_wrinkles, apply_coffee_stain, apply_pen_underline,
    apply_highlighter, apply_paper_fibers, apply_dust_spots,
    apply_hand_at_edge, apply_table_surface, apply_room_shadow,
    apply_window_light_bar, apply_lamp_cone, draw_webapp_ui_chrome,
    apply_pixel_hdr_halos, apply_iphone_denoise, apply_samsung_saturation,
    apply_cheap_phone_softness, AVAILABLE_FONTS, random_text_line,
)


def add_coord_labels(page, bx, by, board_size, scene, flipped=False):
    """Draw a-h / 1-8 coordinate labels hugging the board — WITHOUT touching the
    mask, so the polygon label still covers only the 64 playing squares.

    Why this exists (added 2026-09-09 after TKT-166): every diagram in
    E:\\chess-diagrams is cropped tight to the playing area with the coordinates
    already stripped, so an extractor trained on these composites had never seen
    a coordinate strip sitting 3px from a board edge. Real book pages and
    Lichess / Chess.com screenshots nearly always have them. The result was that
    the crop swallowed the labels, which shifts the 8x8 tile split by up to half
    a square; every piece then straddles two tiles and reads as a confident
    "empty". Measured on the reported photo: 8 phantom pieces at 0.34-0.68 conf
    and every real piece missed, versus 63/64 correct once the strips were
    trimmed off. Teaching the model that coordinates are NOT board is the whole
    point — hence they are drawn on the page but never added to the mask.
    """
    if not AVAILABLE_FONTS:
        return False
    # Books vary: some label all four sides, some only left+bottom, some none.
    if random.random() > (0.6 if scene == "book_photo" else 0.45):
        return False
    sq = board_size / 8.0
    fs = max(7, int(sq * random.uniform(0.30, 0.55)))
    try:
        font = ImageFont.truetype(random.choice(AVAILABLE_FONTS), fs)
    except Exception:
        return False
    d = ImageDraw.Draw(page)
    ink = (random.randint(20, 70),) * 3
    gap = random.randint(2, max(3, int(sq * 0.35)))   # tight: this is the hard case
    # `flipped` means the BOARD PIXELS were rotated 180 by the caller (a diagram
    # printed from Black's side). Both axes must reverse together — files run
    # h..a and ranks 1..8 — or the coordinates contradict the position they
    # label, which would poison them as an orientation signal.
    files = "hgfedcba" if flipped else "abcdefgh"
    ranks = "12345678" if flipped else "87654321"

    def cx(i):   # centre of file i
        return bx + sq * (i + 0.5)

    def cy(i):   # centre of rank row i
        return by + sq * (i + 0.5)

    if random.random() < 0.9:                          # files below
        for i, ch in enumerate(files):
            d.text((cx(i), by + board_size + gap), ch, fill=ink, font=font, anchor="ma")
    if random.random() < 0.25:                         # files above too
        for i, ch in enumerate(files):
            d.text((cx(i), by - gap), ch, fill=ink, font=font, anchor="md")
    if random.random() < 0.9:                          # ranks left
        for i, ch in enumerate(ranks):
            d.text((bx - gap, cy(i)), ch, fill=ink, font=font, anchor="rm")
    if random.random() < 0.3:                          # ranks right too
        for i, ch in enumerate(ranks):
            d.text((bx + board_size + gap, cy(i)), ch, fill=ink, font=font, anchor="lm")
    return True


def gen_one_with_real_board(seq: int, board_path: Path, out_dir: Path) -> bool:
    """Take a real extracted diagram, inlay it into a synthetic phone-photo
    scene with full camera realism."""
    board_pil = Image.open(board_path).convert("RGB")
    bw, bh = board_pil.size

    scene = random.choices(["book_photo", "pc_screen", "mobile_screen"], weights=[7, 2, 1])[0]
    W = random.choice([768, 960, 1024])
    H = random.choice([576, 720, 768])
    if random.random() < 0.5: W, H = H, W

    if scene == "book_photo": page = paper_bg(W, H)
    elif scene == "pc_screen": page = screen_bg(W, H, "pc")
    else: page = screen_bg(W, H, "mobile")

    # Fit board into page
    # Board scale. The old range was 0.5-0.75, i.e. the board always dominated
    # the frame — a close-up photo of a board. That is NOT how a book page looks:
    # measured on real PDF pages from this very corpus, a diagram occupies about
    # 0.25-0.35 of the page. Tested 2026-09-09 on 12 rendered pages of Aagaard's
    # Attacking Manual: the extractor found a usable board on 0 of 12 full pages,
    # yet cropping one page down to the diagram's neighbourhood gave 64/64 at
    # 0.991. The classifier was never the problem; the extractor had simply never
    # been shown a small board on a dense page. So sample both regimes.
    if random.random() < 0.45:
        frac = random.uniform(0.18, 0.40)   # diagram embedded in a full page
    else:
        frac = random.uniform(0.45, 0.80)   # framed close-up of the board
    board_size = int(min(W, H) * frac)
    b_resized = board_pil.resize((board_size, board_size), Image.LANCZOS)
    # Some book diagrams are printed from Black's side. Rotate the PIXELS, so the
    # coordinates drawn below describe the board they actually sit next to.
    flipped = random.random() < 0.15
    if flipped:
        b_resized = b_resized.rotate(180)
    bx = random.randint(int(W * 0.05), max(int(W * 0.05) + 1, W - board_size - int(W * 0.05)))
    by = random.randint(int(H * 0.05), max(int(H * 0.05) + 1, H - board_size - int(H * 0.05)))
    page.paste(b_resized, (bx, by))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rectangle([bx, by, bx + board_size, by + board_size], fill=255)

    # Coordinates go on the PAGE only — never the mask. See add_coord_labels.
    has_coords = add_coord_labels(page, bx, by, board_size, scene, flipped)

    fs = random.randint(9, 16)
    if scene == "book_photo":
        # Text columns around the diagram
        if random.random() < 0.85:
            cx = bx + board_size + random.randint(8, 40); cw = W - cx - 10
            if cw > 40: add_text(page, cx, by, cw, board_size, fs, random.randint(6, 25))
        if random.random() < 0.6:
            cw = max(20, bx - 20)
            if cw > 40: add_text(page, 10, by, cw, board_size, fs, random.randint(6, 25))
        if random.random() < 0.7:
            th = max(20, by - 20)
            if th > 15: add_text(page, bx, 10, board_size, th, fs + 2, random.randint(1, 3))
        bh_ = H - (by + board_size) - 10
        if bh_ > 15 and random.random() < 0.8:
            add_text(page, bx, by + board_size + 10, board_size, bh_, fs, random.randint(2, 8))
        if random.random() < 0.4:
            page, mask = apply_book_curvature(page, mask)
        if random.random() < 0.5:
            page = apply_book_binding_shadow(page)
        if random.random() < 0.3:
            page = apply_page_wrinkles(page)
        if random.random() < 0.1:
            page = apply_coffee_stain(page)
        if random.random() < 0.15:
            page = apply_highlighter(page, bx, by, board_size)
        if random.random() < 0.1:
            page = apply_pen_underline(page, bx, by, board_size)
    else:
        if random.random() < 0.7: page = apply_moire(page, intensity=random.uniform(0.05, 0.18))
        if random.random() < 0.6: page = apply_screen_glare(page)
        if random.random() < 0.55: page = apply_refresh_scan_lines(page, intensity=random.uniform(0.04, 0.14))
        if scene == "pc_screen" and random.random() < 0.5:
            page = apply_monitor_bezel(page)
        if random.random() < 0.35:
            page = draw_webapp_ui_chrome(page, bx, by, board_size)

    # Ambient
    if scene == "book_photo" and random.random() < 0.5:
        page = apply_paper_fibers(page, strength=random.uniform(3.0, 7.0))
    if scene == "book_photo" and random.random() < 0.3:
        page = apply_table_surface(page)
    if scene == "book_photo" and random.random() < 0.3:
        page = apply_room_shadow(page)
    if scene == "book_photo" and random.random() < 0.15:
        page = apply_window_light_bar(page)
    if scene == "book_photo" and random.random() < 0.15:
        page = apply_lamp_cone(page)
    if random.random() < 0.15:
        page, mask = apply_hand_at_edge(page, mask)
    if random.random() < 0.25:
        page = apply_dust_spots(page)

    # Universal camera pipeline
    if random.random() < 0.55:
        page, mask = apply_strong_perspective(page, mask, max_frac=random.uniform(0.06, 0.15))
    if random.random() < 0.7:
        page, mask = apply_camera_tilt(page, mask, max_deg=random.uniform(1.0, 5.0))
    if random.random() < 0.75:
        page = apply_chromatic_aberration(page, intensity=random.uniform(0.8, 2.5))
    if random.random() < 0.85:
        page = apply_sensor_noise(page, sigma=random.uniform(1.5, 7.0))
    if random.random() < 0.4:
        page = apply_depth_of_field(page, focus_radius_frac=random.uniform(0.25, 0.5))
    if random.random() < 0.25:
        page = apply_motion_blur(page, kernel_size=random.choice([3, 5, 7]))
    if random.random() < 0.7:
        page = apply_white_balance(page)
    if random.random() < 0.6:
        page = apply_exposure(page, factor=random.uniform(0.7, 1.3))
    if random.random() < 0.5:
        page = apply_hdr_tone_curve(page)
    if random.random() < 0.7:
        page = apply_vignetting(page, strength=random.uniform(0.15, 0.4))
    if random.random() < 0.1:
        page = apply_lens_flare(page)

    # Phone quirk
    quirk = random.choices(["pixel", "iphone", "samsung", "cheap", "raw"], weights=[2, 2, 2, 1, 3])[0]
    if quirk == "pixel": page = apply_pixel_hdr_halos(page)
    elif quirk == "iphone": page = apply_iphone_denoise(page)
    elif quirk == "samsung": page = apply_samsung_saturation(page)
    elif quirk == "cheap": page = apply_cheap_phone_softness(page)

    if random.random() < 0.65:
        page = apply_jpeg_recompress(page, quality=random.randint(40, 78))

    # Save + YOLO polygon label
    ip = out_dir / "images" / f"real-{seq:06d}.jpg"
    lp = out_dir / "labels" / f"real-{seq:06d}.txt"
    mp = out_dir / "masks" / f"real-{seq:06d}.png"
    page.convert("RGB").save(ip, quality=random.randint(78, 90))
    mask.save(mp)
    m = np.array(mask)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours: ip.unlink(missing_ok=True); mp.unlink(missing_ok=True); return False
    largest = max(contours, key=cv2.contourArea)
    eps = 0.002 * cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, eps, True).reshape(-1, 2)
    if len(approx) < 3: ip.unlink(missing_ok=True); mp.unlink(missing_ok=True); return False
    with lp.open("w") as f:
        norm = [(x / m.shape[1], y / m.shape[0]) for x, y in approx]
        f.write("0 " + " ".join(f"{x:.6f} {y:.6f}" for x, y in norm) + "\n")
    # Orientation sidecar. The extractor does not use it, but it is free here and
    # it is the only trustworthy orientation ground truth we have: today the
    # service guesses which way is up by scoring all 4 rotations on confidence,
    # which is why BoardEditor still ships a manual "Rotate 180°" button. A crop
    # that keeps the coordinate strip can be READ instead of guessed. Emitted
    # only when coordinates were actually drawn, since otherwise the image
    # carries no orientation evidence at all.
    (out_dir / "orient").mkdir(parents=True, exist_ok=True)
    (out_dir / "orient" / f"real-{seq:06d}.txt").write_text(
        f"{'flipped' if flipped else 'white_bottom'} coords={'1' if has_coords else '0'}\n"
    )
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--per-board", type=int, default=3, help="composites per real diagram")
    ap.add_argument("--seed", type=int, default=0)
    # The generator is pure CPU and single-threaded; 21.5k diagrams x N is hours
    # on one core. Shard the board list so M workers can run side by side over
    # disjoint slices writing into the same out dir. seq is offset by the shard
    # so filenames never collide between workers.
    ap.add_argument("--shard", type=int, default=0, help="this worker's index, 0-based")
    ap.add_argument("--shards", type=int, default=1, help="total number of workers")
    # The newer bulk pile (E:\\ChessDiagramsExtracted) is nested one directory
    # per book — 405k diagrams across 2887 books, versus 21.5k across 504 in the
    # old flat pile. Book count is what buys generalisation, because each book is
    # a different piece font, so sample ACROSS books rather than taking whole
    # books. Directories still prefixed .tmp_ are mid-extraction; skip them.
    ap.add_argument("--recursive", action="store_true",
                    help="walk one level of per-book subdirectories")
    ap.add_argument("--max-per-book", type=int, default=0,
                    help="cap diagrams taken from each book (0 = no cap)")
    args = ap.parse_args()
    if not (0 <= args.shard < args.shards):
        sys.exit(f"--shard {args.shard} out of range for --shards {args.shards}")
    # Different seed per shard, or every worker draws the same scene sequence.
    random.seed(args.seed + 1000 * args.shard); np.random.seed(args.seed + 1000 * args.shard)
    for sub in ("images", "labels", "masks"): (args.out / sub).mkdir(parents=True, exist_ok=True)
    if args.recursive:
        books = sorted(d for d in args.boards_dir.iterdir()
                       if d.is_dir() and not d.name.startswith(".tmp_"))
        rng = random.Random(args.seed)          # same pick in every shard
        boards = []
        for bk in books:
            pages = sorted(bk.glob("*.png"))
            if args.max_per_book and len(pages) > args.max_per_book:
                pages = rng.sample(pages, args.max_per_book)
            boards.extend(sorted(pages))
        boards.sort()
        print(f"books: {len(books)} (skipped {sum(1 for d in args.boards_dir.iterdir() if d.is_dir() and d.name.startswith('.tmp_'))} still extracting)")
    else:
        boards = sorted(args.boards_dir.glob("*.png"))
    all_n = len(boards)
    boards = boards[args.shard::args.shards]
    print(f"real diagrams: {all_n} (shard {args.shard}/{args.shards} takes {len(boards)})")
    total = len(boards) * args.per_board
    print(f"target composites: {total}")
    kept = 0; t0 = time.time()
    seq = args.shard * args.per_board * (all_n // args.shards + 1) + 1_000_000
    for board in boards:
        for _ in range(args.per_board):
            try:
                if gen_one_with_real_board(seq, board, args.out): kept += 1
            except Exception as e: print(f"[{seq}] {e}", file=sys.stderr)
            seq += 1
            if seq % 200 == 0:
                dt = time.time() - t0
                print(f"  {seq}/{total} kept={kept} {dt:.0f}s {seq/dt:.1f}s/s")
    print(f"done. kept {kept}/{total}")


if __name__ == "__main__":
    main()
