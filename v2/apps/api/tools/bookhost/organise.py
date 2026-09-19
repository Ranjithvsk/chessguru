"""Turn a dump of filenames into a library: clean titles, authors, shelves.

The files arrive named by whatever pirated them — "Emailing pdfcoffee.com_test-
your-positional-play-pdf-free" is one book. A shelf that shows THAT is unusable,
so display titles are derived, never trusted from the filename as-is.

Nothing here renames a file on disk. The owner's Drive is left exactly as it is;
this only decides what the reader displays and how it groups.
"""
from __future__ import annotations

import re
import unicodedata

# Junk the dump sites staple on. Order matters: site prefixes before suffixes.
SITE = re.compile(
    r"(?i)^\s*(emailing\s+)?((www\.)?(pdfcoffee|epdf|vdoc|dokumen|idoc|ebin|"
    r"annas-archive|libgen|z-?lib\w*|b-ok|zoboko|kupdf|fliphtml5|studylib)"
    r"\.(com|pub|pl|org|net|site|in|ws)[_\- ]*)+")
SUFFIX = re.compile(
    r"(?i)[\s_\-]*\((pdfdrive(\.com)?|z-?lib(\.org)?|gnv\d*|libgen|ebook|"
    r"retail|scan|ocr|v\d)\)[\s_\-]*|"
    r"[\s_\-]*(gnv\d+|_compress(ed)?|-?pdf-?free|-?free-?download|"
    r"\bz-?lib\b|\bpdfdrive\b|\bebook\b|\bretail\b)[\s_\-]*$")
NOISE_WORD = re.compile(r"(?i)\b(pdf|djvu|epub|mobi|chm|compressed?)\b")

# "Kasparov, Garry - My Great Predecessors" / "Nunn John - Understanding"
AUTHOR_FIRST = re.compile(
    r"^([A-Z][A-Za-z'\-]+),?\s+([A-Z][A-Za-z'\-\.]+(?:\s+[A-Z]\.?)?)\s*[-–—]\s*(.+)$")
# "My Great Predecessors - Kasparov"
AUTHOR_LAST = re.compile(r"^(.+?)\s*[-–—]\s*(?:by\s+)?([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)?)$")

SHELVES: list[tuple[str, tuple[str, ...]]] = [
    # Most specific first — "rook endgame" is an endgame book, not a "rook" book.
    ("Endgames",   ("endgame", "endings", "ending", "pawn ending", "rook ending",
                    "tablebase", "theoretical and practical endgame")),
    ("Openings",   ("opening", "sicilian", "caro-kann", "caro kann", "french defen",
                    "ruy lopez", "spanish", "queen's gambit", "queens gambit",
                    "king's indian", "kings indian", "nimzo", "grunfeld", "grünfeld",
                    "slav", "benoni", "benko", "pirc", "alekhine", "scandinavian",
                    "english opening", "catalan", "london system", "dragon",
                    "najdorf", "gambit", "repertoire", "defence", "defense",
                    "e4", "d4", "c4", "nf3")),
    ("Tactics & Puzzles", ("tactic", "puzzle", "combination", "checkmate", "mate in",
                    "calculation", "sacrifice", "attack", "exercises", "problems",
                    "test your", "chess quiz", "studies", "brilliancies")),
    ("Strategy",   ("strategy", "strategic", "positional", "planning", "pawn structure",
                    "pawn power", "space", "prophylaxis", "manoeuvr", "maneuver",
                    "judgment", "judgement", "imbalance", "positional play",
                    "strategic play", "chess strategy")),
    ("Middlegame", ("middlegame", "middle game")),
    ("Game Collections", ("best games", "greatest games", "greatest chess games",
                    "chess games", "selected games", "masterpieces",
                    "my games", "immortal", "brilliant games", "tournament book",
                    "match", "world championship", "olympiad", "candidates",
                    "500 master games", "game collection")),
    ("Players & History", ("biography", "life and games", "story of", "history of",
                    "memoir", "portrait", "legend", "champions", "predecessors")),
    ("Training & Improvement", ("training", "improve", "improvement", "course",
                    "school", "lessons", "learn", "manual", "workbook", "coach",
                    "club player", "rating", "master", "grandmaster preparation",
                    "think like", "thinking", "practice")),
    ("Beginners & Kids", ("beginner", "kids", "children", "for you and me",
                    "first book", "starting out", "chess for", "step by step",
                    "complete idiot", "for dummies", "junior", "scholastic")),
]


def clean_title(raw: str) -> str:
    t = unicodedata.normalize("NFKC", raw)
    prev = None
    while prev != t:                      # sites stack: "Emailing pdfcoffee.com_..."
        prev = t
        t = SITE.sub("", t)
        t = SUFFIX.sub("", t)
    t = t.replace("_", " ").replace("x27", "'")
    # Dump sites slugify: "the-chess-kids-book-of-tactics". Those hyphens are
    # word separators, not punctuation, and leaving them in wrecks both the
    # display name and every keyword match that decides the shelf. Only convert
    # when it really is a slug — a genuine hyphen ("Caro-Kann", "well-known")
    # sits between two words in otherwise spaced text.
    if t.count("-") >= 2 and " " not in t.strip():
        t = t.replace("-", " ")
    t = NOISE_WORD.sub(" ", t)
    t = re.sub(r"[\s\-]{2,}", " ", t).strip(" -–—_.")
    if not t:
        return raw.strip()
    # ALL CAPS or all-lower filenames read badly on a shelf; title-case those
    # only, so a correctly-cased name like "My System" is left alone.
    if t.isupper() or t.islower():
        small = {"a", "an", "the", "of", "in", "on", "to", "for", "and", "or",
                 "with", "at", "by", "vs", "from"}
        words = t.split()
        t = " ".join(w if (i and w.lower() in small) else w.capitalize()
                     for i, w in enumerate(words))
    return t


def split_author(title: str) -> tuple[str | None, str]:
    m = AUTHOR_FIRST.match(title)
    if m:
        last, first, rest = m.groups()
        if len(rest.split()) >= 2:        # "Smith, John - Chess" not "A - B"
            return f"{first} {last}".strip(), rest.strip()
    m = AUTHOR_LAST.match(title)
    if m:
        rest, name = m.groups()
        if len(rest.split()) >= 2 and len(name.split()) <= 2:
            return name.strip(), rest.strip()
    return None, title


def shelf_of(title: str) -> str:
    low = " " + title.lower() + " "
    for name, keys in SHELVES:
        for k in keys:
            # Short keys like "e4" must not match inside another word.
            pat = r"\b" + re.escape(k) + r"\b" if len(k) <= 3 else re.escape(k)
            if re.search(pat, low):
                return name
    return "General"


def organise(book: dict) -> dict:
    title = clean_title(book.get("title", ""))
    author, title = split_author(title)
    book = dict(book)
    book["title"] = title or book.get("title", "")
    book["author"] = author
    book["shelf"] = shelf_of(title)
    book["sort"] = re.sub(r"(?i)^(the|a|an)\s+", "", title).lower()
    return book
