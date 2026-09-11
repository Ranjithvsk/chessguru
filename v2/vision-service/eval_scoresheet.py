"""M0 for scoresheet OCR: score Qwen's handwritten reads before and after the
chess-legality beam, on HCS sheets with known ground truth.

Inputs (all under data/scoresheets/m0/):
  manifest.json  cells in played order, with sheet / move / colour
  truth.json     cell id -> ground-truth SAN (HCS labels)
  reads.json     cell id -> [[text, conf], ...] from hcs_qwen_read.py on Vinayaka

Numbers, in the order that matters (same discipline as eval_dream_ocr.py):
  raw MRA        Qwen's first reading == truth
  beam MRA       after apply_chess_constraints from the initial position
  FALSE CONF     tokens marked `verified` that are WRONG — must stay ~0
  clean sheets   sheets with zero wrong moves after the beam
Also prints the commonest raw confusions so the handwriting confusion table
in dream_ocr can be extended from evidence rather than guesswork.
"""
from __future__ import annotations
import collections, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import chess
import dream_ocr as d

ROOT = Path(__file__).resolve().parent / "data" / "scoresheets" / "m0"
START = chess.STARTING_FEN


def norm(s: str) -> str:
    """Compare moves loosely the way a coach would: 0-0 == O-O, drop +/#, x/: ."""
    s = s.strip().replace("0", "O") if re.fullmatch(r"[0O]-[0O](-[0O])?[+#]?", s.strip()) else s.strip()
    return re.sub(r"[+#!?]", "", s).replace(":", "x")


def main(reads_path: str = str(ROOT / "reads.json")):
    manifest = json.load(open(ROOT / "manifest.json"))
    truth = json.load(open(ROOT / "truth.json"))
    reads = json.load(open(reads_path))
    by_sheet: dict[str, list[dict]] = collections.defaultdict(list)
    for it in manifest:
        if it["id"] in reads:
            by_sheet[it["sheet"]].append(it)
    raw_ok = beam_ok = n = false_conf = verified = 0
    clean = 0
    confusions = collections.Counter()
    per_sheet = []
    damaged = []
    sheet_meta = json.load(open(ROOT / "sheets.json")) if (ROOT / "sheets.json").exists() else {}
    for sheet, items in by_sheet.items():
        toks = []
        for it in items:
            txt = reads[it["id"]][0][0] if reads[it["id"]] else ""
            toks.append(d.Token(text=txt, confidence=float(reads[it["id"]][0][1]) if reads[it["id"]] else 0.0))
        raw_texts = [t.text for t in toks]
        out = d.apply_chess_constraints([t.copy() for t in toks], START, beam=10)
        s_raw = s_beam = 0
        for it, r, t in zip(items, raw_texts, out):
            gt = truth[it["id"]]; n += 1
            if norm(r) == norm(gt): raw_ok += 1; s_raw += 1
            else: confusions[(gt, r)] += 1
            ok = norm(t.text) == norm(gt)
            if ok: beam_ok += 1; s_beam += 1
            if t.verified:
                verified += 1
                if not ok: false_conf += 1
        per_sheet.append((sheet, len(items), s_raw, s_beam))
        clean += (s_beam == len(items))
        # over-correction: the beam turned a CORRECT raw read into a wrong one.
        # HCS truth is what the player WROTE, and players write illegal moves
        # (only 10 of 206 HCS sheets replay legally), so a beam that forces
        # legality will "repair" real human errors into fiction. Count it.
        for it, r, t in zip(items, raw_texts, out):
            gt = truth[it["id"]]
            if norm(r) == norm(gt) and norm(t.text) != norm(gt):
                damaged.append((sheet, it["move"], it["colour"], gt, t.text, t.verified))
    print(f"cells scored: {n}   sheets: {len(by_sheet)}")
    print(f"raw MRA   : {raw_ok/n:6.1%}   ({raw_ok}/{n})")
    print(f"beam MRA  : {beam_ok/n:6.1%}   ({beam_ok}/{n})")
    print(f"verified  : {verified/n:6.1%}   FALSE-CONFIDENT: {false_conf}")
    print(f"clean sheets after beam: {clean}/{len(by_sheet)}")
    print(f"over-corrected (raw right, beam wrong): {len(damaged)}   of which marked verified: {sum(1 for x in damaged if x[5])}")
    legal = [p for p in per_sheet if sheet_meta.get(p[0], {}).get("legal_fraction") == 1.0]
    if legal:
        c = sum(p[1] for p in legal); r = sum(p[2] for p in legal); b = sum(p[3] for p in legal)
        print(f"\nfully-legal sheets only ({len(legal)}): raw {r/c:.1%}  beam {b/c:.1%}  ({c} cells)")
    print("\nper sheet  (legal-frac cells raw beam):")
    for s, c, r, b in per_sheet:
        print(f"  {s:8} {sheet_meta.get(s, {}).get('legal_fraction', '?'):>5} {c:3} {r:3} {b:3}")
    if damaged:
        print("\nfirst over-corrections (sheet move colour truth -> beam):")
        for x in damaged[:12]:
            print("  ", *x[:5], "VERIFIED" if x[5] else "")
    print("\ncommonest raw misreads (truth -> read):")
    for (gt, r), k in confusions.most_common(25):
        print(f"  {k:3}  {gt!r:10} -> {r!r}")


if __name__ == "__main__":
    main(*sys.argv[1:])
