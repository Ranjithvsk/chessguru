# Memory Master 500 — 6-month opening memorisation program

**Status:** S1 in progress (2026-08-02). Corpus schema + 10 hand-authored pillars committed. Bootstrap script for Tier 2/3/4 generation from Lichess ECO tsv + Wikibooks running in background. Browse page (`/study/openings`) + detail page shipped alongside.

## The vision

Memorise the 500 most-played chess openings — 15 moves each side, plus plans + ideas + stories + strategic tags — in **6 months** using memory-master techniques. Client-first, offline-capable, integrated with the existing ChessGuru Opening Memory trainer (which already anchors moves to the 64-square memory palace via PAO = Piece + Action + Square).

## The 11-slice roadmap

| # | Slice | Ships | Wks |
|---|---|---|---|
| **S1** | **Corpus** | 500 openings JSON: ECO + tags + family + 15-move mainline + Wikibook | 2 |
| **S2** | **Repertoire wizard** | 10-question onboarding → personalised 20W + 20B repertoire | 1 |
| **S3** | **Study UI** | Board + idea + story + Wikibook + citations + tree navigator | 2 |
| **S4** | **Card engine** | FSRS scheduler · 4 card types · interleaved · daily queue | 2 |
| **S5** | **Personal engine coach** | Stockfish post-mortem on every failed card | 1 |
| **S6** | **Story mode + community mnemonics** | 20 pillar stories · community voting on alternates | 2 |
| **S7** | **Family tree viz** | Zoomable mastery-coloured tree; 20 family "forest" | 1 |
| **S8** | **Progress dashboard** | Belts · XP · titles · streak · 6-mo projection · weak spots | 2 |
| **S9** | **Prep-test mode** | In-app play from position vs engine; deviation → card lapse | 2 |
| **S10** | **Real-game import + scorecard** | Lichess + chess.com sync; prep vs actual scorecard | 2 |
| **S11** | **Rewards + unlockables** | Badges · belt ceremonies · Grandmaster portfolio PDF | 1 |

Total build: 18 weeks. Content authoring + polish: 8 weeks. 6 months total.

## The 20 opening families

`italian · ruy-lopez · open-e5-misc · sicilian · french · caro-kann · scandi-alekhine · modern-pirc · qgd · slav · kings-indian · nimzo · grunfeld · qi-bogo · catalan · english · d4-side · dutch · benoni-benko · reti-kia`

See `apps/web/src/lib/openings/families.ts` for the full list with `displayOrder` (belt progression) + `colorHex`.

## The 5-axis tag system

Every opening gets 1-3 tags per axis:

- **CHARACTER**: strategic · positional · dynamic · aggressive · tactical · solid · risky
- **STRUCTURE**: open · semi-open · closed · fluid · locked · hanging-pawns · iqp · fianchetto
- **ATTACK**: kingside · queenside · central · both-flanks · endgame-oriented
- **SCHOOL**: classical · hypermodern · romantic · modern · universal
- **PRACTICALITY**: theory-heavy · idea-based · trap-heavy · surprise-weapon · sound-long-term

## The 12 canonical pawn structures (chunks — De Groot 1965)

`carlsbad · iqp · hanging-pawns · hedgehog · kid-chain · maroczy-bind · boleslavsky-hole · botvinnik-system · stonewall · panov-iqp · kings-fianchetto · slav-meran`

Learn these 12 well and dozens of openings become "reach this structure + apply the plan".

## Memory-master techniques baked in

10 evidence-based techniques, each mapped to a slice:

1. **Method of Loci** — S6 stories anchored on ChessGuru's existing 64 named squares.
2. **Dual coding** — S3 board (visual) + move (verbal) + story scene (image) on every card.
3. **Story chaining** — S6 delivers 15 causally-linked scenes per mainline, not 15 disconnected images.
4. **Elaborative encoding** — S4 forces user to write the idea in own words before card is marked "learned".
5. **Chunking / pattern recognition** — S1 pawn structure library + Structure card type.
6. **Interleaved practice** — S4 session queue mixes variations within family, not blocked drill.
7. **Spaced repetition (FSRS)** — S4. FSRS beats SM-2 by ~25% at same review count.
8. **Retrieval practice + testing effect** — S3+S4. Every card is a test, not a review.
9. **Sleep consolidation** — S4 flags cards seen in the 90 min before user's bedtime for morning re-test.
10. **Encoding specificity** — S3+S4 one board style app-wide (themes are unlock-only).

Plus chess-specific bonuses:

- **PAO adapted** (piece = character, square = place, move = action) — already implemented in `lib/openingMemory.ts`.
- **Anchor moves** — `criticalMoveNo` field on each opening weights that move heavier in FSRS.
- **Prototype positions** — 200-position library across all 500 openings (S6 subfeature).
- **Confidence prediction** — [Certain/Likely/Guessing] tap on every card; kills overconfidence (S4).
- **Overlearning** — cards past 90 days retention stay in queue at 90-day interval permanently.

## The 5 game-changing enhancements

Beyond the base plan, these lift the program from "Anki for chess" to "unique value":

1. **Personal engine coach (S5)** — Stockfish 3-paragraph post-mortem on every failed card, grounded on THIS position + THIS variation's plan.
2. **Real-game import + data-driven coach (S10)** — imports Lichess/chess.com games nightly; scorecard shows what you PREPARED vs what you PLAYED. Redirects prep away from what you like into what you need.
3. **Repertoire wizard (S2)** — 10-question onboarding → 40-opening personalised repertoire. Solves the "500 is overwhelming" problem.
4. **Family tree with mastery colouring (S7)** — zoomable tree, nodes coloured by mastery. Whole-corpus "chess forest" — visual dopamine.
5. **Community mnemonics (S6)** — users submit + vote on story hooks. Best rises to canonical. Solves 500-story authoring bottleneck.

## Sources — layered by licence

**Tier A** (free, licence-clean, direct-quote-with-attribution):
- Wikipedia (CC BY-SA)
- Lichess opening wiki (CC BY-SA)
- **Wikibooks — Chess Opening Theory** (CC BY-SA 3.0) — the PER-MOVE tree at `en.wikibooks.org/wiki/Chess_Opening_Theory/...`; primary source for auto-generated openings.
- Chessgames.com opening explorer (paraphrase)
- 365Chess (paraphrase)

**Tier B** (public-domain classics — safe to quote directly):
- Fine — *Ideas Behind the Chess Openings* (1943)
- Nimzowitsch — *My System* + *Chess Praxis*
- Réti — *Modern Ideas in Chess*
- Lasker — *Common Sense in Chess*
- Steinitz — *Modern Chess Instructor*
- Capablanca — *Chess Fundamentals* + *Last Lectures*

**Tier C** (copyrighted; referenced/paraphrased only):
- Kasparov — *My Great Predecessors* (5 vols)
- Watson — *Mastering the Chess Openings* (4 vols) + *Secrets of Modern Chess Strategy*
- Avrukh — *1.d4* / *Vol 2*
- Marin — *English Opening* (3 vols)
- Aagaard — *Grandmaster Preparation* series
- Modern commentators (Naroditsky, Ginger GM, Nakamura) — YouTube transcript summaries

**Tier D** (engine):
- Stockfish 16+ — flags positions where engine top move ≠ theoretical mainline.

Every `OpeningIdea.citations[]` records `{author, work, section, licence, url}` — users see WHOSE theory they're learning.

## Corpus generation — Strategy A (frequency-weighted)

Chosen by owner 2026-08-02.

1. Fetch Lichess `chess-openings` TSV (~3800 rows, CC0).
2. Dedupe by UCI position (keep shortest name).
3. For EACH unique position, query `explorer.lichess.ovh/masters?play=<uci>` for game count.
4. Sort desc by count, take top 500 = "the 500 most-played openings by master frequency".
5. For each of the 500:
   - Compute Wikibook URL from SAN path: `/wiki/Chess_Opening_Theory/1._e4/1...c5/2._Nf3/…`
   - Fetch page via MediaWiki parse API, extract first two paragraphs as excerpt.
   - Emit as Opening record with `frequencyBps` (0-10000, share of top opening's count).

Cost: ~1 h cold (rate-limited to 2 req/s on masters, 1 req/s on Wikibooks). Cache is permanent per URL → subsequent runs are seconds.

Script: `scripts/openings/build.mjs` — idempotent, resumable, generates `apps/web/src/lib/openings/generated.ts`.

## Card types (S4)

Four flavours, all board-native:

1. **Next-move** — position → move (why on flip)
2. **Plan** — opening name → plan / king safety / pawn break
3. **Structure** — pawn skeleton → recall opening + breaks
4. **Model game** — opening name → canonical game (player, year, key moment)

Grading: **Again / Hard / Good / Easy** (FSRS grades).

## Reward escalation (S11)

- **XP**: +1 per review, +3 Good, +5 Easy, +10 opening completed. Streak multiplier ×1.5 @ day 7, ×2 @ 30, ×3 @ 100.
- **Titles**: Novice → Club Player → CM → FM → IM → **Grandmaster of Memory**.
- **Belts**: 8 per family (white → black).
- **Badges**: Sicilian Slayer, First Blood, Streak Warrior, Comeback Kid, Perfect Recall, Speed Demon, Storyteller, Grandmaster of X, Explorer, Deep Diver.
- **Unlockables**: story voices, board themes, master's commentary audio.
- **Progress rituals**: Sunday Wrap, monthly Belt Ceremony, 6-month Graduation portfolio PDF.

## File layout (S1)

```
apps/web/src/lib/openings/
  types.ts          — Opening, OpeningIdea, OpeningTag, OpeningFamily, PawnStructure, Citation, ModelGame
  tags.ts           — 30 tags × 5 axes
  families.ts       — 20 opening families with displayOrder + colorHex
  structures.ts     — 12 canonical pawn structures
  pillars.ts        — hand-authored Tier 1 openings (10/20 as of 2026-08-02)
  generated.ts      — auto-generated from Lichess + Wikibooks (created by build.mjs)
  index.ts          — corpus aggregator + filter helpers
apps/web/src/pages/
  Openings.tsx      — /study/openings — corpus browse with tag+family filters
  OpeningDetail.tsx — /study/openings/:slug — full write-up + step-through board
scripts/openings/
  build.mjs         — bootstrap: Lichess TSV → masters ranking → top 500 → Wikibook excerpts → generated.ts
```

## The 10 pillars authored so far (2026-08-02)

| ECO | Name | Family | Critical move |
|---|---|---|---|
| C54 | Italian, Giuoco Piano | italian | 7 (Ng5 lunge) |
| C67 | Ruy Lopez, Berlin Wall | ruy-lopez | 8 (…Kxd8 handshake) |
| B90 | Sicilian Najdorf English Attack | sicilian | 10 (…Nbd7 vs …Ne5) |
| C18 | French Winawer | french | 5 (Bxc3+ doubled-pawns trade) |
| E97 | KID Classical Bayonet | kings-indian | 9 (b4 kicks off both storms) |
| C97 | Ruy Lopez, Closed Chigorin | ruy-lopez | 9 (…Na5 knight reroute) |
| B33 | Sicilian Sveshnikov | sicilian | 5 (…e5 hole-accepting) |
| B12 | Caro-Kann Advance | caro-kann | 3 (…Bf5 unlock the bishop) |
| D48 | Semi-Slav, Meran | slav | 8 (…a6 pawn-storm launcher) |
| D35 | QGD Exchange (Carlsbad) | qgd | 4 (cxd5 triggers structure) |

10/20 pillars pending: Nimzo Rubinstein · Grünfeld Exchange · English Symmetric · London · Scandinavian 3…Qa5 · Alekhine Modern · Modern Defence · Pirc Austrian · Dutch Stonewall · Catalan Closed. Each: 15 min authoring, batches of 5.

## Open questions / decisions to revisit

- **Corpus refresh cadence** — Lichess tsv and Wikibook content evolve. Monthly regeneration? Alert on divergence between what we have and current tsv.
- **User-authored idea storage** — S4 elaborative encoding needs a place for user text. IndexedDB (client-only) vs new API table (community).
- **Community mnemonics moderation** — S6 needs a voting / abuse-flagging model.
- **Real-game import (S10)** — requires OAuth to Lichess + chess.com. Which API tokens store where.
- **FSRS parameters** — start with defaults, later personalise per-user via retention tuning.

## Owner's five confirmed enhancements

Locked in during Aug 1 conversation:

1. Personal engine coach (post-mortem on every miss).
2. Real-game import (data-driven coach).
3. Repertoire wizard (10-question onboarding).
4. Family tree with mastery colouring.
5. Community mnemonics + voting.

All folded into the 11-slice roadmap above (S5, S10, S2, S7, S6 respectively).
