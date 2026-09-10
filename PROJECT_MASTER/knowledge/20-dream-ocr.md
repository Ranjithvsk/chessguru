# Dream OCR — reading a chess page, and why the engines are the small half

_Built 2026-09-09. Owner: "lets combine surya, paddleocr with ppstructure, doctr,
tesseract and build our own dream ocr, with best figurine notation for chess, and
our dream ocr should be trained to be near 100%"._

## The finding that shaped it

Four OCR engines were combined as asked. They are **not** where the accuracy comes
from, and it is worth being blunt about that because the obvious plan is the
weaker one.

Chess text is not free text. It is a rigid grammar in which every move token must
be a **legal move in a position we already know**, because the diagram above it
was read by our own YOLO extractor. Tesseract cannot tell `Nf3` from `Nf8`. We can
prove which one it was. That single constraint is worth more than a fourth engine,
and it is the reason "near 100%" is achievable on move text at all.

Stated limit, so nobody quotes this wrongly: this approaches certainty on MOVE
text. It does nothing for prose. Confidence is reported per token and `verified`
marks only moves that were proved.

## Measured

`eval_dream_ocr.py` garbles real games with a realistic OCR noise model and scores
the repair. 8,000 move tokens across 5 unseen seeds.

| Noise | OCR as-is | After constraint pass | Proved certain |
|---|---|---|---|
| Realistic (typeset book) | 89% | **99%** | ~93% |
| Heavy adversarial | 57% | **88%** | ~72% |

**False certainty is the number that matters**, not accuracy: a reader that says
"certain" and is wrong is worse than one that says "unsure", because nobody checks
it. It is 0 on 7 of 8 runs and 1 token on the eighth.

## Six bugs that only measuring would ever have found

The first version passed a hand-made 20-move test 20/20 and was nearly worthless.
The first honest run scored 55.3% -> 58.1%.

1. **Square repair never ran.** The rank/file confusion pass only rewrote
   candidates that were ALREADY valid SAN, so `NfE` — a mangled rank digit, the
   commonest OCR corruption there is — produced an empty candidate list and was
   passed through untouched. Piece glyph and square are now repaired
   independently, then combined. **58% -> 86%.**
2. **"Exactly one legal reading" was treated as proof.** It is only proof *given
   the moves before it*. 130 of 2,377 tokens were marked certain and were wrong.
3. **Beam agreement is not proof either**, because the beam collapses onto a
   shared wrong prefix and then agrees with itself. The tell was in the data: 10
   of the 12 remaining false-certain tokens had the correct reading sitting there
   as the *cheapest* candidate, rejected because legality — computed in an
   already-diverged position — overruled it. Certainty now also requires the
   reading to be OCR's own most plausible one. Being driven off it is the
   signature of a diverged line.
4. **Consensus aligned engines by index.** The code claimed engines "produce
   nearly the same word sequence". They do not: on one book page they returned
   55, 40, 41 and 40 words in different orders. Surya put the page number before
   the running head, docTR dropped it, Paddle inserted a stray glyph off the
   diagram. Index voting produced duplicated, scrambled output — real example:
   `White to mate in three moves moves White to mate in three ... White to 60 in
   three mate Problem three 60`. Now aligned with a longest-matching-block diff
   against a spine engine. **65% -> 98% precision on a real page.**

   The spine must be chosen by MEAN confidence, not total. Total rewards
   whichever engine wrote the most words, and on a chess page the most verbose
   engine is the one hallucinating text off the DIAGRAM — Tesseract reads a board
   as `Vi, Wi, Wi, Ui "O86 @ U27), Y, BZ`. Picking it as the spine dragged all of
   that into the merged page.

| Page 21 of the test book | Words | Match printed text | Precision | Recall |
|---|---|---|---|---|
| Index-aligned | 55 | 36 | 65% | 90% |
| Diff-aligned, mean-confidence spine | 40 | 39 | **98%** | **98%** |

5. **Per-engine weights were never passed.** `read_page` called `consensus(per)`
   without them, so Surya at 1.3 and Tesseract at 1.0 counted the same.
6. **Move numbers were never labelled.** The token was stripped of punctuation
   before the move-number test ran, and the trailing dot is the only thing that
   distinguishes `12.` from anything else.

## The beam

A greedy pass picks arbitrarily when two readings are both legal, and one wrong
pick poisons every move after it — measured, a single bad choice at move 8 turned
a 20-move line from 20/20 into 16/20. The beam keeps several lines alive so a
LATER move disambiguates an EARLIER one, which is how a human reads a smudged
score sheet.

Candidate cost is edit plausibility: 0 = exactly what OCR said, 1 = a known glyph
confusion, 5 = brute-force piece substitution. The brute tier sits at 5 rather
than 3 so it can never tie with a table-backed reading; a tie would hide the fact
that the glyph contributed no evidence at all. A brute-forced read is never called
certain.

The confusion table is a hint, not a limit. Books use fonts we have never seen, so
any move-shaped token gets all five piece letters tried and legality settles it.

## Engines

Scored against two pages transcribed **by eye from the images**, not against
each other. Precision here means "of the words it emitted, how many are really
printed" — which is what catches an engine inventing text off a diagram.

| Engine | Prose page (114 words) | Four-diagram page (40 words) | sec/page |
|---|---|---|---|
| **PaddleOCR** 3.7.0 | **100%** | **100%** | 16-32 |
| Surya 0.16.7 | 99.1% | 97.5% | 72-131 |
| Tesseract 5.5.0 | **100%** | 69.8% | 0.7-1.1 |
| docTR 1.1.0 | 100% | 60.0% | 2.4-3.8 |
| all four | 100% | 100% | 91-168 |

**The ensemble buys nothing on a clean typeset page.** Paddle alone equals all
four at a fifth of the cost. Tesseract is perfect on prose in ONE SECOND and
collapses to 69.8% on a page with diagrams, because it reads the board as text —
53 words where 40 are printed. That is the whole story of why an ensemble is
worth having at all: not accuracy on easy pages, but not falling over on hard
ones.

For book ingest, run **Paddle alone**: a 300-page book is ~2 hours instead of
~10. Keep the rest for hard input — photographs, skew, unusual fonts — which is
untested because we have no such pages yet.

### GPU engines (added 2026-09-10, after the owner pointed out Vinayaka has a 3080)

My "a VLM is not practical" verdict was about the Linux box, which has no GPU. It
does not apply to Vinayaka. Model choice is forced by 10 GB on an **Ampere** card:
Qwen3-VL-8B needs ~16 GB in bf16, and its FP8 build needs Ada or newer, so 4B is
the largest of the current line that fits.

| Engine | Four-diagram page | Prose page | sec/page | Confidence | Runs on |
|---|---|---|---|---|---|
| **PaddleOCR** | 100% | 100% | 16-32 | 0.98 | CPU |
| **GOT-OCR 2.0** | 100% | 99.1% | ~17 | 0.97-0.99 | GPU |
| **Qwen3-VL-4B** | 100% | 99.1% | 14-23 | 1.00 flat | GPU |
| Surya 0.22.1 | 100% | — | ~55 | 0.95 | CPU |
| Tesseract | 69.8% | 100% | ~1 | 0.78 | CPU |
| docTR | 60.0% | 100% | 2-4 | 0.92 | CPU |

**Pin the VLM to the card.** `device_map="auto"` let accelerate reserve headroom
and offload layers to CPU — *"Some parameters are on the meta device"* — which
turned a 22s page into **660s**. Pinning to `cuda:0` was a 29x speedup. It sits
at ~9.7 GB of 10 GB, which is tight; a much larger page may need downscaling.

Only ONE large model stays resident, because Qwen alone is ~6 GB of a 10 GB card.

**Qwen is the only engine that can be told what it is looking at.** "Keep
figurine symbols, transcribe moves exactly, do not solve or explain" is an
instruction no classical engine can accept. That, not raw accuracy, is why it
earns a slot — on clean pages it merely ties.

Its confidence is the mean probability of the tokens it actually chose, because a
VLM has no per-word confidence and inventing one would defeat the purpose. It
still reads ~1.00 on easy pages, so it is NOT trusted for spine selection.

### The measurement trap I fell into

The first sweep scored each engine subset against the FOUR-ENGINE CONSENSUS and
concluded Surya was essential. That was circular: Surya was usually the spine, so
it agreed with the reference by construction. Two of the six pages were also a
3-word title page and a **blank** one, which every engine "agreed" on perfectly
and which inflated every row to ~100%.

Transcribing two pages by eye reversed the conclusion completely.

### Confidence is not comparable across engines

Surya reports ~1.00 on everything it emits. That is overconfidence, not accuracy.
Because the spine was picked by mean confidence, Surya always seized it — and
adding Surya to Paddle made the merged page WORSE, 100% down to 97.5%. An
ensemble that degrades when you add an engine to it is broken.

The spine is now chosen by a weight WE set from measurement (Paddle 1.4, Surya
1.1, Tesseract 1.0, docTR 0.9), and an engine's opinion of itself only breaks
ties. With that fixed, all four together score 100% on both pages.

Three of the four needed fixing before they produced a single word:

- **Paddle returned zero words.** Its default oneDNN CPU backend dies with
  `ConvertPirAttribute2RuntimeAttribute not support` the moment text detection
  runs. Disabled.
- **Surya 0.22 is NOT installed, on purpose.** It dropped its PyTorch recognition
  backend for a `llama-server` binary from llama.cpp, a C++ dependency outside
  pip. Pinned to 0.16.7, the last pure-PyTorch release, which needs
  `transformers < 5` (v5 removed an attribute its decoder config still reads).
  Nothing else in that venv uses transformers, so the pin is contained.
- **Both adapters swallowed their own exceptions** and returned an empty list.
  That is the worst failure mode available: the page still reads, just worse, and
  nobody ever finds out. They log now.

### Two venvs, deliberately

Engines live in `/opt/chessguru-vision/.venv-ocr`. The live scanner's venv keeps
only Tesseract, and `available_engines()` degrades to it silently. Surya, Paddle
and docTR each pin their own torch/numpy, and a bad resolve in the live venv would
take board scanning offline. Importing `dream_ocr` can never drag three
deep-learning frameworks into the process that serves scans.

## Visual AI — already doing the chess half

No OCR engine can read a chessboard picture. The diagrams are read by our own
YOLOv8 segmentation + classifier models into FENs; these four read the text
around them.

The gap is a page-level vision-language model reading layout and text together.
The blocker is hardware, not preference: this box is CPU-only, so a 7B model
(Qwen2.5-VL, InternVL) would take minutes per page and about a day for a 300-page
book. The realistic candidate if we want a fifth engine is **GOT-OCR 2.0 (580M)**,
purpose-built for OCR and CPU-feasible.

## Real scanned books — where it actually breaks (2026-09-10)

Everything above was measured on a clean, digitally-typeset PDF. Pandolfini's
*Kasparov and Deep Blue* is a **photograph of paper**: two-page spreads, gutter
shadow, curvature, skew, italic sidebars, no text layer at all. Ground truth came
from transcribing eight spreads by eye — 87 printed moves.

Six defects, none of which the clean book could have shown.

1. **The extractor found NO diagram on four of eight spreads**, so the chess
   constraint pass — the entire point — could not run on half the book. A
   diagram on a two-page scan fills a small fraction of the frame. **Splitting at
   the gutter** doubles its share:

   | Spread | Whole frame | Split |
   |---|---|---|
   | page-25 | 0 | 1 |
   | page-35 | 0 | 1 |
   | page-50 | 0 | 2 |
   | page-60 | 1 | 1 |
   | page-30 | 2 | 2 |
   | page-45 | 2 | 2 |
   | **total** | **5** | **9** |

   Every blind page fixed, none made worse. Note the 40,234-composite retrain
   aimed at exactly this failure changed nothing end-to-end. **Framing beat
   training.**

2. **Long algebraic was invisible.** Books print `Qe8-d8`, `d2-d3`, `c2-c4`.
   SAN_RE allowed an `x` between source and destination but not a `-`, so those
   produced ZERO candidates. 6 of 87 moves, ~7% of a real book, silently
   unreadable. python-chess parses the long form natively; only our gate was wrong.

3. **The constraint pass was CORRUPTING correct moves** — measured recovery went
   DOWN, 78.2% -> 77.0%. It overwrote moves OCR had read right with legal-but-
   wrong alternatives from a drifted line. It now repairs what is broken and
   leaves a properly-formed move alone unless the replacement is proved.

4. **"Zero false certainty" was flattered by the scoring.** The eval compared
   OCR's own spelling against truth, so a diverged line recording "Ne3" scored
   correct while the board played Nxe3 elsewhere. Recording what the board plays
   exposed 14 wrong-but-certain moves. Fixed by requiring the book's notation and
   the board's to agree on piece, destination, capture, disambiguation AND check.
   The check marker mattered most: forgiving it left exactly 10 such moves.

5. **Diagram border labels look exactly like moves.** Every board is ringed with
   a-h / 1-8 and OCR drops them beside the move list. They arrive as a RUN
   climbing a ladder, which prose never does, so runs are stripped and isolated
   squares kept.

6. **Words break across lines and pages** (`cru-` / `cial`), leaving both halves
   wrong.

### Cost on real spreads (1755x1275)

| Engine | sec/spread |
|---|---|
| Tesseract | 3 |
| docTR | 9-21 |
| PaddleOCR | 115-164 |
| GOT-OCR 2.0 | 31-49 |
| Qwen3-VL-4B | 181-337 (now capped at 1400px) |
| Surya 0.22.1 | **948** |

Surya at sixteen minutes a spread is not viable for book ingest at any accuracy.

### The recurring hazard: engines that fail SILENTLY

Four in one session, none of which raised anything:
- **Paddle** returned zero words from a oneDNN backend crash
- **Surya 0.22** returned zero from a perfectly working server whose result shape
  had moved from `text_lines` to `blocks`
- **Tesseract** reported itself available on a box with no tesseract binary,
  because pytesseract is only a wrapper that imports fine and throws per page
- **Both GPU engines** vanished when installing Surya pulled `torch+cpu` over the
  CUDA build

Every adapter now logs. Assume a new engine is lying about working until a page
comes back with words on it.

## Files

- `v2/vision-service/dream_ocr.py` — engines, consensus, figurine mapping, constraint pass
- `v2/vision-service/eval_dream_ocr.py` — the harness that found all four bugs

## Open

- Wire `read_page` into `/book/ingest` so a book stores its move text, not only diagrams
- GOT-OCR 2.0 as a fifth engine, if wanted
- Surya 0.22.1 via the llama.cpp binary, if latest matters more than a contained pin
