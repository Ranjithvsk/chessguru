# Opening-Comic Image Generation — Style Spec

The "engine" that generates comic-strip visuals for the Opening Memory
trainer. One prompt → one landscape 4-6-panel comic strip that tells the
whole opening as a single story using our named characters + picture-set
scenes. Serves as the visual anchor next to the "One combined story" card
on `/study/opening-memory`.

Consumed by `scripts/openings/genOpeningComic.ts`.

---

## 1. Visual style (LOCKED across every panel and every opening)

- **Medium**: flat 2D cartoon, thick friendly outlines (2-3 px), bright
  saturated primary colours, simple painterly backgrounds. Think
  Cartoon-Network / early-Pixar-shorts, NOT anime, NOT photorealistic,
  NOT dark fantasy.
- **Layout**: single wide landscape image (16:9), N vertical panels
  separated by white gutters (~10 px), each panel numbered top-left in a
  small circle "1", "2", … "N".
- **Panel size**: uniform (all panels same width). Tall wide panels
  preferred over grids — reads left-to-right like a book.
- **Framing**: each panel is a **medium shot** (character shown from
  waist up, background scene visible). Not tight portraits, not wide
  landscapes.
- **Text in panels**: allowed but tiny — one short caption at the bottom
  of each panel reading the move in SAN plus the character name
  (e.g. "1. e4 · Phil"). Nothing else. No speech bubbles unless a
  CHECK — then "!" bubble.
- **Palette**: warm background, character costumes in high-contrast
  primary colours so each character is instantly recognisable across
  panels.

## 2. Character reference (identity that MUST stay consistent across panels)

Every character keeps identical face, costume, colour, and pose language
across every panel they appear in. Refer by name AND by visual anchor —
Gemini's image model conditions on both.

### White army
| Piece | Character | Visual anchor |
|-------|-----------|---------------|
| ♔ King | **Little Krishna** | Small blue-skinned boy, single peacock feather in hair, holding a bansuri (bamboo flute), yellow dhoti |
| ♕ Queen | **Hanuman** | Flying monkey-god, orange fur, gold mace, red loincloth |
| ♘ Knight (b1) | **Bheem** | Muscular boy from Chota Bheem, orange dhoti, bare chest, holding a laddoo, red hair-band |
| ♘ Knight (g1) | **Chutki** | Girl from Chota Bheem, pink frock, two braids, pink bindi |
| ♗ Bishop (dark) | **Warrior Arjuna** | Bearded adult warrior, dark-blue kurta, golden-tipped Gandiva bow, quiver on back |
| ♗ Bishop (light) | **Young Arjuna** | Teenage version of Arjuna, no beard, light-blue kurta, same Gandiva bow |
| ♖ Rook (a1) | **Dholu** | Round chubby boy in yellow half-pants, cheeky grin, riding a small white cartoon elephant |
| ♖ Rook (h1) | **Bholu** | Twin of Dholu in green half-pants, mischievous smile, on a white cartoon elephant |
| ♙ Pawn a | **Kevin** | Tall Minion, one eye, blue overalls, banana in pocket |
| ♙ Pawn b | **Stuart** | Short Minion, one eye, blue overalls, guitar strap |
| ♙ Pawn c | **Bob** | Short Minion, two eyes (one green, one brown), teddy bear |
| ♙ Pawn d | **Dave** | Tall Minion, two eyes, hairbrush comb-over |
| ♙ Pawn e | **Phil** | Tall Minion, one eye, silly grin |
| ♙ Pawn f | **Carl** | Short Minion, two eyes, chef hat |
| ♙ Pawn g | **Mel** | Tall Minion, one eye, wild bushy hair |
| ♙ Pawn h | **Larry** | Short Minion, two eyes, propeller beanie |

### Black army
| Piece | Character | Visual anchor |
|-------|-----------|---------------|
| ♚ King | **Lord Shiva** | Meditating figure, blue skin, third eye, crescent moon on head, trident |
| ♛ Queen | **Nandi** | Sacred bull, white/grey fur, golden bells around neck, calm eyes |
| ♞ Knight (b8) | **Tom** | Grey cartoon cat, plotting grin, small pointed ears |
| ♞ Knight (g8) | **Jerry** | Small brown cartoon mouse, big round ears, cheeky smile |
| ♝ Bishop (dark) | **Warrior Karna** | Bearded warrior in golden armour, black kurta, Vijaya bow |
| ♝ Bishop (light) | **Young Karna** | Teenage Karna, golden armour, light kurta, Vijaya bow |
| ♜ Rook (a8) | **Motu** | Fat cheerful man, moustache, red kurta, on a dark grey cartoon elephant |
| ♜ Rook (h8) | **Patlu** | Thin bespectacled man, blue kurta, on a dark grey cartoon elephant |
| ♟ Pawn a-h | **Lil-a … Lil-h** | Tiny medieval warriors, sepia tunics, wooden shields, wooden helmets. Distinguish by hair colour: a=red, b=brown, c=black, d=blond, e=grey, f=white, g=orange, h=silver |

## 3. Scene reference (backgrounds — driven by the active picture set)

The user's active memory-palace picture set (default `set5` Ocean) defines
what background scene lives on each destination square. Every panel's
background = the scene for THAT panel's destination square, drawn as a
recognizable painterly setting.

E.g. in the Ocean set:
- e4 = "Engine + More" → giant steam engine chugging coal, shovellers
- d5 = "Diver + Fizz" → deep-sea diver with a fizzing soda can
- a6 = "Abalone + Sticks" → giant abalone shell playing drums with sticks
- (etc.)

Scene descriptions are pulled from `memoryPalace.ts scenes[square].scene`
(one-sentence painterly description) and inlined per panel.

## 4. Move-to-panel translation

For each ply in the opening's `mainlinePgn` (up to a chosen depth — 12
plies = 6 full moves is the sweet spot for a comic strip):

```
Panel N: <Character> <verbing> the <SquareScene>
  Character = anchorFor(step).character   (Bheem, Chutki, Nandi, etc.)
  Verb      = anchorFor(step) verb        (marches to / jumps to / flies to)
  SquareScene = scenes[step.to].scene     (painterly one-line description)
  If capture: character is grabbing / snatching the scene's object
  If check:  small "!" bubble on the enemy king in the background
  If castle: both king and rook appear in the panel switching places
```

## 5. Prompt template (skeleton the script actually sends to Gemini)

```
Draw one wide landscape comic strip, {N} equal-width vertical panels
numbered 1..{N} left-to-right, flat 2D cartoon style, thick friendly
outlines, bright saturated colours, painterly backgrounds.

Story: the {OpeningName} opening move-by-move.

Consistent characters (keep identical across every panel they appear in):
- {char1 visual anchor}
- {char2 visual anchor}
- ...

Panels:
1. [{Character1} {verb1} the {Scene1}.] Caption: "1. e4 · Phil"
2. [{Character2} {verb2} the {Scene2}.] Caption: "1... d5 · Lil-d"
...

Overall composition: read left-to-right, each panel is a medium shot, the
character is instantly recognisable by their locked visual anchor. NO
photorealism, NO anime, NO dark fantasy — think Cartoon Network.
```

## 6. Model + cost

- Model: `gemini-2.5-flash-image` (Nano Banana). Text-to-image.
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=$GEMINI_API_KEY`
- Output: single PNG per call, ~1-2 MP, ~$0.03-0.04 per image.
- Rate: sequential, ~5 s per call.

## 7. Output layout

```
apps/web/public/openings/
  scandinavian-qa5/
    comic.png              ← the generated 12-ply comic strip
    comic.prompt.txt       ← the exact prompt used (for reproducibility)
    comic.manifest.json    ← { openingSlug, theme, plies, generatedAt, model }
```

The web app checks for `comic.png` at render time and displays it in the
"One combined story" card if present. Missing = graceful fallback to
text-only (current behaviour).

## 8. Regenerating

```bash
npx tsx v2/scripts/openings/genOpeningComic.ts \
  --slug scandinavian-qa5 \
  --theme set5 \
  --plies 12
```

Idempotent — overwrites the previous `comic.png` for that slug.
