# Plan — "My Books": upload a PDF or EPUB and play the positions in it

_Proposed 2026-09-09. Owner: "build a pdf, epub reader which reads the position in
the book, and click to play — we already have in learn book something like this",
and the reader page "should be modern, colourful, interactive and nice user
friendly UI"._

## Why this is now buildable

The vision pipeline crossed the line tonight. Measured on Thursby's *75 Chess
Problems*, 29 pages rendered at 150 dpi and pushed through the live service:

| | |
|---|---|
| Boards found on the 19 problem pages | 67 |
| Legal positions | 65 — **97%** |
| Whole book, end to end | **100 seconds** |
| Logic-engine corrections applied | 84 |

A spot-check of one page matched the printed diagrams piece for piece. So a
book can be ingested in about the time it takes to make tea, and the answer is
good enough that a coach corrects the odd square instead of typing 75 positions.

## What already exists — build on it, don't fork it

- `/book` (`pages/Book.tsx`) renders books as page images with clickable diagram
  hotspots. Dvoretsky's Endgame Manual is fully wired; **Yusupov's Build Up Your
  Chess is already loaded as 266 pages with the subtitle "clickable diagrams
  coming via vision extractor"** — this plan is what finishes that sentence.
- `book-diagrams` API + `lib/book-diagrams-api.ts` already model exactly the
  right shape: `{ page, bbox: [x,y,w,h], fen }` plus an `annotate` endpoint.
- `/classify` returns `candidates[]` with a per-board `box` and a rectified
  crop, which is precisely a page's hotspot list.

**The gap is ingestion, not intelligence.** Today books are placed on the server
by us. The coach cannot bring their own.

## Scope

### 1. Upload
`POST /api/books/upload` — multipart, PDF or EPUB, cap ~80 MB. Store the file
outside the web root; serve pages only as rendered images. Owned by the
uploading user, private by default, optionally shared to their academy.

**Copyright is a real constraint, not a footnote.** Private-to-uploader by
default, no cross-academy sharing, no public listing, and no "library" of
uploaded books. We are giving a coach a better way to read a book they own.

### 2. Render
PyMuPDF at 150 dpi (proven tonight). EPUB reflows, so render through the same
engine to fixed-size pages, otherwise bboxes are meaningless. Cache page PNGs
under the book's id. Render lazily: first 10 pages on upload, the rest in the
background, so the reader opens in seconds.

### 3. Detect and read
Per page, one `/classify` call gives every board with its box and a rectified
crop; classify each crop for its FEN. Store as existing `Diagram` rows. **Do
this once at ingest, never on view** — 100 s per book once, versus a scan every
time somebody turns a page.

Keep `modelConf` per diagram. A low-confidence board gets a "check me" dot
rather than pretending.

### 4. Reader UI — the part the owner cares about

Modern, colourful, interactive, friendly. Concretely:

- **Two-pane on desktop, stacked on phone.** Page image left, live board right.
  Tapping a diagram slides the position onto the board; the board is playable
  immediately, no dialog.
- **Diagram hotspots drawn as soft rounded highlights** over the page, not hard
  rectangles — a gentle brand-gradient glow on hover, a ▶ badge in the corner.
  Confidence shows as a colour: confident is brand/teal, unsure is amber.
- **A filmstrip of every position in the book** along the bottom, each a tiny
  rendered board. This is the "colourful" bit and it makes a book feel like a
  puzzle set. Click to jump; the current one is ringed.
- **Continuous scroll with snap**, page numbers floating, plus a jump-to-page
  field. Never a modal for turning a page.
- **Play from any diagram**: the board offers Play vs engine, Analyse, or Send
  to class. Reuse `Board` + `useFreePlay` so behaviour matches every other
  board in the product.
- **Fix a square inline.** Drag a piece and it corrects the stored diagram AND
  feeds `visionRefs` through the capture wired tonight. A coach reading a book
  becomes the training loop.
- **Progress**: chapters read, positions played, a quiet streak marker. Ties
  into the existing `/books` chapter tracking rather than inventing a parallel
  one.
- Dark mode from day one; the page image gets a subtle inversion-safe frame so
  a white scan does not glare in a dark room.

### 5. Ownership and cost
Ingest is CPU-heavy in bursts (~2.6 core-seconds a board). Queue it, one book
at a time, and never during class hours. Show honest progress: "reading page 14
of 29, 38 positions found".

## Build order

1. Upload + store + render pages, reader shows the book with no diagrams.
2. Ingest pass populating `Diagram` rows; hotspots appear.
3. Board pane, click-to-play, filmstrip.
4. Inline correction feeding `visionRefs`.
5. EPUB, progress, sharing to an academy.

Ship 1-3 before adding anything else; a reader that shows a book and plays its
positions is already the whole idea.

## Risks

- **Copyright.** Private by default. No sharing beyond the uploader's academy,
  no public library. Revisit before any "browse books" feature.
- **Scanned (photographed) books** will do far worse than typeset PDFs. Tonight's
  97% is on clean rendering; a phone photo of the same page is much harder.
  Show confidence honestly rather than implying every position is right.
- **Text pages currently return a garbage board** instead of "no diagram here".
  Fix that first — see `knowledge/18` — or every solutions page in every book
  sprouts a nonsense position.
- Storage: a 300-page book at 150 dpi is a few hundred MB of PNGs. Consider JPEG
  for page images and prune on delete.
