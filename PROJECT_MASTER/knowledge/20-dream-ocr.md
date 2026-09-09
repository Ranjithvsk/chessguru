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

## Four bugs that only measuring would ever have found

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
   against whichever engine carries the most confidence mass.

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

| Engine | Version | On one book page |
|---|---|---|
| Tesseract | 5.5.0 | 0.8s, 55 words, avg conf 0.78 |
| docTR | 1.1.0 | 9.1s, 40 words, avg conf 0.92 |
| PaddleOCR / PP-Structure | 3.7.0 | 22.5s, 41 words, avg conf 0.98 |
| Surya | 0.16.7 | 81.1s, 40 words, avg conf 1.00 |

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

## Files

- `v2/vision-service/dream_ocr.py` — engines, consensus, figurine mapping, constraint pass
- `v2/vision-service/eval_dream_ocr.py` — the harness that found all four bugs

## Open

- Wire `read_page` into `/book/ingest` so a book stores its move text, not only diagrams
- GOT-OCR 2.0 as a fifth engine, if wanted
- Surya 0.22.1 via the llama.cpp binary, if latest matters more than a contained pin
