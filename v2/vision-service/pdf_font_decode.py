"""Decode a chess DIAGRAM FONT straight out of a born-digital PDF.

Books typeset with a diagram font (HastingsDiagramA, Chess Merida, Chess Cases…)
carry each board as eight lines of eight characters in the PDF's own text layer.
That is not OCR and not vision: it is the exact position the typesetter placed,
so it is 100% correct by construction — and it costs nothing to read.
"""
import json, pymupdf, sys

EMPTY = set("WwDd+-")           # light/dark empty-square glyphs
WHITE = set("KQRBNP")
BLACK = set("kqrbnp")

def rows_from_page(page):
    """Collect every 8-char diagram row on the page, in order, and chunk by 8.

    Do NOT reset on an intervening non-diagram line: a page of four problems
    interleaves captions and problem numbers between the boards, and resetting
    threw away all but one board per page.
    """
    rows = [l.strip()[1:-1] for l in page.get_text().splitlines()
            if l.strip().startswith("{") and l.strip().endswith("}") and len(l.strip()) == 10]
    return [rows[i:i + 8] for i in range(0, len(rows) - 7, 8)]

def to_fen(rows):
    ranks = []
    for r in rows:
        if len(r) != 8: return None
        s, run = "", 0
        for ch in r:
            if ch in WHITE or ch in BLACK:
                if run: s += str(run); run = 0
                s += ch
            elif ch in EMPTY:
                run += 1
            else:
                return None
        if run: s += str(run)
        ranks.append(s)
    return "/".join(ranks)

if __name__ == "__main__":
    doc = pymupdf.open(sys.argv[1])
    vision = json.load(open(sys.argv[2]))
    got = []
    for i in range(len(doc)):
        for rows in rows_from_page(doc[i]):
            f = to_fen(rows)
            if f: got.append({"page": i, "fen": f})
    print("positions from the FONT TEXT : %d" % len(got))
    print("positions from OUR VISION    : %d" % len(vision))
    vs = [v["fen"] for v in vision]
    fs = [g["fen"] for g in got]
    match = sum(1 for f in fs if f in vs)
    print()
    print("font positions our vision also produced: %d/%d (%.0f%%)" % (match, len(fs), 100*match/len(fs) if fs else 0))
    miss = [f for f in fs if f not in vs]
    print("vision missed or misread      : %d" % len(miss))
    for m in miss[:4]: print("   truth:", m)
