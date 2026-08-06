# Memory Palace — design rules

Everything in `memoryPalace.ts` follows these rules. If you rewrite a theme
or add a new one, apply them all.

## 1. Coordinate encoding — the WHOLE point of the system

Every square on the board (`a1` … `h8`) gets one `Scene` with a `pair` of
two nouns and a one-line story. The two nouns encode the square's
coordinate PHONETICALLY:

- **First noun encodes the FILE (a-h)** — chosen for the file letter (e.g.
  `a` → *Ant / Ashoka / Apple / Astronaut / …*, `c` → *Cat / Chitrasena /
  Cashew / Comet / …*). The starting letter of the character must match
  the file letter.

- **Second noun encodes the RANK (1-8)** — chosen for a RHYME with the
  rank digit itself. This is the phonetic hook that lets the reader
  decode a square just by hearing the pair:

  | Rank | Rhymes with | Example objects |
  |------|-------------|-----------------|
  | 1 | one (`-un` / `-on`) | Sun, Bun, Fun, Ton, Done, Marathon, Skeleton |
  | 2 | two (`-oo`) | Zoo, Glue, Bamboo, Kangaroo, Cockatoo |
  | 3 | three (`-ee`) | Tree, Bee, Key, Fee, Pea, Chimpanzee, Referee |
  | 4 | four (`-or`) | Door, Floor, Snore, Core, Dinosaur, Metaphor |
  | 5 | five (`-ive`) | Hive, Dive, Drive, Alive, Jive, Thrive, Chive |
  | 6 | six (`-ix`) | Fix, Mix, Bricks, Sticks, Ticks, Wicks, Styx |
  | 7 | seven (`-even`) | Heaven, Eleven, Oven, Driven, Coven, Given |
  | 8 | eight (`-ate` / `-ait`) | Gate, Plate, Skate, Bait, Fate, Freight, State |

  So `c3` = `Cashew + Cherry` doesn't work as a memory hook because Cherry
  is a soft `-ry`, not a stressed `-ee`. `c3` = `Cashew + Spree` works
  (Spree ends in stressed `-ee` = 3). **The rank rhyme is non-negotiable.**

- Reading a pair out loud → your ear recovers the coordinate. That's the
  entire pedagogical purpose. Break the phonetic system and the mnemonic
  becomes just 64 arbitrary pairs to memorise.

## 2. Rhyme quality bar

SET1 (Classic Animals) is the reference. Every SET1 rank-object is
one-syllable and ends in a strict, stressed target sound:

- rank 3: **Tree · Bee · Key · Sea · Tea · Flea · Ski · Knee** — all
  single-syllable `/iː/`.

Match this quality for new themes. If you can't find 8 strict monosyllabic
rhymes for a rank (which is common — see §5 below), use **multi-syllable
words where the FINAL syllable is stressed on the target sound**. Examples:

- rank 3 stressed `-ee`: Chimpanzee, Manatee, Honeybee, Bumblebee,
  Referee, Jubilee, Jamboree, Employee.
- rank 4 stressed `-or`: Dinosaur, Corridor, Meteor, Metaphor, Emperor,
  Sophomore, Furthermore, Nevermore.

**Don't accept** words where the target sound is unstressed:

- `Cheese` /tʃiːz/ — ends in `-eez`, extra consonant, weaker rhyme.
- `Cherry` /ˈtʃɛri/ — short unstressed `-ry`, not the strict `-ee`.
- `Cookie` /ˈkʊki/ — same problem, weak rhyme.

## 3. Scene composition

Each `Scene` has:

```ts
{
  pair: "Bheem + Ghee",     // "<Character> + <Object>"
  emoji: "🧈",              // one visual glyph, matches the object
  scene: "one silly sentence — the two nouns interacting"
}
```

Rules for the sentence:

- **Both nouns appear.** The character AND the object must be named. The
  scene shows them INTERACTING (touching / carrying / eating / dancing
  with), NOT sitting side by side.
- **One sentence.** Ends with `!` — vivid + kid-friendly voice.
- **Exaggerated + absurd.** Memory-master principle: the weirder the
  scenario, the stickier the memory (elephant WEARING a door as a hat >
  elephant next to a door).
- **Consistent character voice per theme.** SET2 characters stay in the
  Indian-mythology world; SET3 characters stay food-shaped; SET4 stays in
  space; etc.

## 4. Character rules (file dimension)

- Character's starting letter MUST match the file letter (`a`-character
  starts with A, etc.). This is the alliterative anchor for the file.
- Each theme has its own 8 characters (one per file). No two characters
  in the same theme.
- **Character reuse across themes is fine** — different themes have
  different vibes (Astronaut / Ashoka / Almond / Ant are all `a`-file
  characters in different themes).

## 5. Rhyme-pool scarcity — the shared-object exception

Some rank rhymes are genuinely scarce (fewer usable rhyming words exist in
English):

- **Rank 5** (`-ive`): ~12 usable words total. Once SET1 uses 8, only 4
  are left for other 9 themes.
- **Rank 7** (`-even`): ~7 usable words total. Once SET1 uses 8 there's
  none left.

Rule: **ranks 5 and 7 stay shared across ALL themes** (same object per
square, only the character differs). This is a deliberate compromise —
the alternative is weaker/forced rhymes that break §2.

The rich ranks (3, 4, 8) can support ~40-50 unique rhymes → give each
theme its own 8-object roster where possible.

## 6. Object reuse rule (Aug 2026 owner note)

Individual rank-objects CAN repeat across themes as long as the same
(character + object) pair is not too frequent:

- OK: SET1 `c3` = `Cuckoo + Key` and SET3 `c3` = `Cucumber + Key` —
  character differs, so the two scenes read very differently.
- OK: SET1 `c3` = `Cuckoo + Key` and SET5 `c3` = `Cuckoo + Spree` —
  character same, object different.
- Not preferred: too many themes reusing the exact same (character,
  object) pair.

## 7. Character-name conflicts with piece names

The piece characters (`WHITE_ARMY`, `BLACK_ARMY`) are the ACTORS in the
anchor sentence — they DO the moving. The Scene's file-character
(Ashoka, Cashew, etc.) is the OBJECT of the sentence — where the piece
moves TO.

Anchor sentence template (see `openingMemory.ts anchorFor`):

```
"{PieceCharacter} {verb} the {Scene.pair}"
e.g. "Bheem jumps to the Cashew + Spree"
```

So don't reuse piece names as file characters (e.g. don't have a
"Bheem" a-file character in a theme — it collides with the knight name).

## 8. Meanings (planned, not yet built)

For less-common objects (Chive, Jubilee, Freight, Styx, Manatee, etc.)
we plan to add an optional `objectMeaning` string on Scene, rendered as a
small caption in the anchor card. Not implemented yet — see Scene
interface if this needs adding.

## 9. Emoji

Every Scene has one emoji glyph. Pick something that visualises the
OBJECT (not the character), because the object is the mnemonic hook. Use
a single emoji per scene (not a string of them).

## 10. Which themes are frozen

- **SET1 (Classic Animals)** — LOCKED. Reference for all other themes'
  rhyme quality. Also referenced by the Scandinavian comic-strip images
  under `apps/web/public/openings/scandinavian-qa5/`.
- **EASY** — LOCKED. Auto-generated from `EASY_ANIMALS` (per-file animal)
  + `EASY_OBJECTS` (per-rank object). Referenced by the Scandinavian
  move-1 to move-3 comic images in the EASY theme.

Everything else (SET2 through SET10) is fair game to iterate.

## 11. Rendering paths

Where these scenes actually appear on the site:

- **`/study/memory-palace`** — the gallery page. Shows all 64 squares
  with the pair, emoji, and scene text.
- **`/study/opening-memory`** — the trainer. As the user steps through a
  mainline, each move's anchor card shows the character + scene at the
  destination square. Read at that point, the pair becomes the
  MOVE-encoding: piece + verb + pair = the move.

Any scene edit → next production build picks it up. There's no per-scene
cache aside from the user's browser + service worker.
