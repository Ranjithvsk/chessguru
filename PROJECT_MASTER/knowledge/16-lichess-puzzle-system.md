# Lichess Puzzle System — Complete Reference

> Source-code-verified notes from lila `master`. Every formula and
> code snippet was copied verbatim from
> `github.com/lichess-org/lila/tree/master/modules/puzzle` and
> `github.com/lichess-org/lila/tree/master/modules/rating` — 2026-08-24.
>
> **Purpose:** design reference when redesigning our own puzzle
> rating + picker. Owner ask: "learn 100% how Lichess suggests
> puzzles and updates rating."

## Table of contents

1. [Big-picture architecture](#big-picture-architecture)
2. [Data structures — the `paths` collection](#data-structures)
3. [Picker — how a puzzle is chosen](#picker)
4. [Picker — exact band per rating tier](#picker-band-per-tier)
5. [Rating update — the weighted-average model](#rating-update)
6. [Theme classifier + weight table](#theme-classifier)
7. [Glicko constants](#glicko-constants)
8. [Anti-abuse: dubiousPuzzle, rate limit, provisional](#anti-abuse)
9. [Anti-replay](#anti-replay)
10. [Session, Daily, Streak, Storm, Racer](#special-modes)
11. [Worked example — 2113 wins vs 1854 fork](#worked-example)
12. [Design implications for ChessGuru](#implications)

---

<a id="big-picture-architecture"></a>
## 1. Big-picture architecture

Two-collection design that separates the "which puzzle to serve" query from the puzzle document itself:

```
paths        — pre-baked pool documents
puzzle2      — ~4.5M puzzles (immutable positions + tags + Glicko)
round        — user solve history (composite _id = "userId:puzzleId")
```

Live-picking against 4.5M puzzles by rating band would kill Mongo. Lichess pre-generates path documents (regenerated when stale, `isStale = gen < now - 1 day`) so the runtime query is an `_id`-prefix lookup + `$sample(1)`. Everything else follows from this.

<a id="data-structures"></a>
## 2. Data structures — the `paths` collection

Each path holds an array of ~64 puzzle IDs pre-sorted, tagged with `(angle, tier, min-rating, max-rating)`. The path `_id` is a string:

```
angle|tier|RRRR         e.g. "mix|top|1214"
                             "fork|good|2100"
```

Query pattern (as printed in a slow-query comment in `PuzzlePath.scala`):

```js
{ $match: { min: { $lte: "mix|top|1214" }, max: { $gte: "mix|top|1214" } } },
{ $sample: { size: 1 } },
{ $project: { _id: true } }
```

`min` and `max` are the same shape strings — string comparison works because the RRRR field is zero-padded 4 digits.

**Three tiers** (`PuzzleTier.scala`):
- `top` = highly-voted, low-Glicko-deviation puzzles
- `good` = decent quality
- `all` = whole pool

**Five difficulty modifiers** (`PuzzleDifficulty.scala`):

| Modifier | Rating delta |
|---|---:|
| Easiest | −600 |
| Easier | −300 |
| Normal | 0 |
| Harder | +300 |
| Hardest | +600 |

`isExtreme(d) = d == Easiest || d == Hardest` — used to force tier downgrade.

<a id="picker"></a>
## 3. Picker — how a puzzle is chosen

Single function `PuzzlePath.nextFor`:

```scala
def nextFor(requester)(
    angle: PuzzleAngle, tier: PuzzleTier, difficulty: PuzzleDifficulty,
    previousPaths: Set[Id], compromise: Int = 0
)(using perf: Perf): Fu[Option[Id]] = {
  val actualTier =
    if tier == PuzzleTier.top && PuzzleDifficulty.isExtreme(difficulty)
    then PuzzleTier.good else tier
  colls.path.aggregateOne(_.pri): framework =>
    import framework.*
    val rating     = perf.glicko.intRating.map(_ + difficulty.ratingDelta)
    val ratingFlex = (100 + math.abs(1500 - rating.value) / 4) * compromise.atMost(4)
    Match(
      select(angle, actualTier, (rating.value - ratingFlex) to (rating.value + ratingFlex)) ++
        ((compromise != 5 && previousPaths.nonEmpty).so($doc("_id".$nin(previousPaths))))
    ) -> List(Sample(1), Project($id(true)))
  .flatMap:
    case Some(path) => fuccess(path.some)
    case _ if actualTier == PuzzleTier.top =>
      nextFor(requester)(angle, PuzzleTier.good, difficulty, previousPaths)
    case _ if actualTier == PuzzleTier.good && compromise == 2 =>
      nextFor(requester)(angle, PuzzleTier.all, difficulty, previousPaths, compromise = 1)
    case _ if compromise < 5 =>
      nextFor(requester)(angle, actualTier, difficulty, previousPaths, compromise + 1)
    case _ => fuccess(none)
}
```

### The band formula (the money line)

```
target = userRating + difficultyDelta
base   = 100 + |1500 − target| / 4
flex   = base × min(compromise, 4)
band   = target ± flex
```

- **`compromise` starts at 0** → flex = 0 → single-target scan. Fine because path docs cover ~50-100 rating each; overlap query returns any path whose `[min, max]` includes the target.
- Each empty result increments compromise → widens by another `base`.
- **Widening schedule:**

| compromise | flex | band around target |
|---|---:|---|
| 0 | 0 | exact hit only |
| 1 | base | ±base |
| 2 | 2·base | ±2·base |
| 3 | 3·base | ±3·base |
| 4 | 4·base | ±4·base |
| 5 | 4·base + drops `previousPaths` exclusion | may repeat a path family |

### Tier fallback

- Empty at `top` → drop to `good` immediately (compromise reset to 0)
- Empty at `good` when compromise == 2 → drop to `all`, compromise reset to 1
- Empty otherwise while compromise < 5 → same tier, compromise+1
- compromise == 5 → give up (`None`)

Also: on `Easiest` or `Hardest`, picker silently downgrades `top → good` at entry — the top pool doesn't cover the extremes.

<a id="picker-band-per-tier"></a>
## 4. Picker — exact band per rating tier

`base = 100 + |1500 − target|/4`. Enumerated for common tiers:

| User rating | Difficulty | target | base flex | compromise=1 band | compromise=4 band |
|---:|---|---:|---:|---|---|
| **800** | Easiest (−600) | 200 | 425 | −225 … 625 (mostly ~400-625 in practice) | ±1700 |
| 800 | Easier (−300) | 500 | 350 | 150 … 850 | ±1400 |
| **800** | **Normal** | **800** | **275** | **525 … 1075** | ±1100 |
| 800 | Harder (+300) | 1100 | 200 | 900 … 1300 | ±800 |
| 800 | Hardest (+600) | 1400 | 125 | 1275 … 1525 | ±500 |
| **1200** | Normal | 1200 | **175** | **1025 … 1375** | ±700 |
| 1200 | Easier | 900 | 250 | 650 … 1150 | ±1000 |
| 1200 | Harder | 1500 | 100 | 1400 … 1600 | ±400 |
| **1500** | Normal | 1500 | **100** | **1400 … 1600** | ±400 |
| 1500 | Easiest (→good) | 900 | 250 | 650 … 1150 | ±1000 |
| 1500 | Hardest (→good) | 2100 | 250 | 1850 … 2350 | ±1000 |
| **1800** | Normal | 1800 | **175** | **1625 … 1975** | ±700 |
| 1800 | Harder | 2100 | 250 | 1850 … 2350 | ±1000 |
| **2100** | Normal | 2100 | **250** | **1850 … 2350** | ±1000 |
| 2100 | Harder | 2400 | 325 | 2075 … 2725 | ±1300 |
| **2500** | Normal | 2500 | **350** | **2150 … 2850** | ±1400 |
| 2500 | Hardest (→good) | 3100 | 500 | 2600 … 3600 | ±2000 |
| **2800** | Normal | 2800 | **425** | **2375 … 3225** | ±1700 |

**Key observation:** 1500 gets the tightest band (±100 per widen). Both kids at 800 and masters at 2800 get progressively wider bands — because the puzzle path density thins out at the extremes and the picker MUST return something.

### Higher-level orchestration — `PuzzleSelector.scala`

The picker is wrapped in a 20+ retry loop that handles session pathing and anti-replay:

```scala
private def findNextPuzzleFor(angle, retries)(using me, perf) =
  sessionApi.continueOrCreateSessionFor(angle, canFlush = retries == 0)
    .flatMap { session =>
      def switchPath(reason)(withRetries)(tier) =
        pathApi.nextFor(s"switchPath.$reason")(angle, tier, session.settings.difficulty, session.previousPaths)
          .flatMap { pathId => sessionApi.set(session.switchTo(pathId)); findNextPuzzleFor(angle, withRetries + 1) }
      nextPuzzleResult(session).flatMap:
        case PathMissing if retries < 10 => switchPath("missing")(retries)(session.path.tier)
        case PathEnded  if retries < 10 => switchPath("ended")(retries)(session.path.tier)
        case PuzzleMissing(id) => sessionApi.set(session.next); findNextPuzzleFor(angle, retries + 1)
        case PuzzleAlreadyPlayed(_) if retries < 5 => sessionApi.set(session.next); findNextPuzzleFor(angle, retries + 1)
        case PuzzleAlreadyPlayed(puzzle) =>
          session.path.tier.stepDown.fold(fuccess(serveAndMonitor(puzzle)))(switchPath("played")(retries))
        case WrongColor(_) if retries < 10 => sessionApi.set(session.next); findNextPuzzleFor(angle, retries + 1)
        case WrongColor(puzzle) => session.path.tier.stepDown.fold(fuccess(serveAndMonitor(puzzle)))(switchPath("wrongColor")(retries - 5))
        case PuzzleFound(puzzle) => fuccess(serveAndMonitor(puzzle))
    }
```

<a id="rating-update"></a>
## 5. Rating update — the weighted-average model

Path: `puzzle/src/main/PuzzleFinisher.scala`.

### The apply flow

```scala
def apply(id, angle, win, rated)(using me, perf) =
  if api.casual(me.value, id) then                 // 30-min casual set
    fuccess(round -> perf)                          // no rating change
  else
    sequencer(id):
      api.round.find(me.value, id).zip(api.puzzle.find(id))
        .flatMap:
          case (_, None)              => fuccess(none)                             // puzzle deleted
          case (Some(prev), _)        => fuccess((prev.updateWithWin(win), none, perf))  // REPLAY — no rating change
          case (None, Some(puzzle)) if rated.no  => fuccess((newRound, none, perf))       // casual first play
          case (None, Some(puzzle))   =>                                            // FIRST RATED PLAY — full path
            val (userGlicko, puzzleGlicko) =
              val players = ByColor(perf.toGlickoPlayer, Player(puzzle.glicko.cap, puzzle.plays, none))
              calculator.computeGame(Game(players, Outcome(Color.fromWhite(win.yes).some)))
                .map(_.map(_.glicko)).fold(_ => players.map(_.glicko).toPair, _.toPair)
            userApi.dubiousPuzzle(me.userId, perf).map: dubiousPlayer =>
              val updatePuzzleGlicko = !dubiousPlayer && canUpdatePuzzleRating(me.userId, false)(true)
              val newPuzzleGlicko = updatePuzzleGlicko.so:
                ponder.puzzle(angle, win,
                  puzzle.glicko -> puzzleGlicko.copy(
                    rating = puzzleGlicko.rating
                      .atMost(puzzle.glicko.rating + Glicko.maxRatingDelta)    // ±700 clamp
                      .atLeast(puzzle.glicko.rating - Glicko.maxRatingDelta)
                  ).cap,
                  player = perf.glicko
                ).some.filter(puzzle.glicko !=).filter(_.sanityCheck)
              val userPerf = perf.addOrReset(...)(userGlicko, now).pipe: p =>
                p.copy(glicko = ponder.player(angle, win, perf.glicko -> p.glicko, puzzle.glicko))
              (round, newPuzzleGlicko, userPerf)
          .flatMap: (round, newPuzzleGlicko, userPerf) =>
            for
              _ <- api.round.upsert(round, angle).zip(
                     (userPerf != perf).so(
                       userApi.setPerf(...).zip(historyApi.addPuzzle(...))))
              _ <- colls.puzzle.map(_.updateUnchecked($id(puzzle.id),
                     $inc(plays -> 1) ++ newPuzzleGlicko.so($set(glicko -> _))))
              _  = if prevRound.isEmpty then Bus.pub(Puzzle.UserResult(...))
            yield (round -> userPerf).some
```

### Key insight: two-step "compute then weight"

Lichess treats the solve as a Glicko-2 game between user (white) and puzzle (black), runs the vanilla Glickman-2 update, then DOES NOT store the raw output. Instead, the stored rating is a **weighted linear average between pre-solve and raw-Glicko output**:

```scala
def player(angle, win, glicko: (Glicko, Glicko), puzzle: Glicko) =
  val provisionalPuzzle = puzzle.provisional.yes.so:
    if win.yes then -0.2f else -0.7f
  glicko._1.average(glicko._2, (weightOf(angle, win) + provisionalPuzzle).atLeast(0.1f))

def puzzle(angle, win, glicko: (Glicko, Glicko), player: Glicko) =
  if player.clueless then glicko._1                       // player RD ≥ 230 → no puzzle update
  else glicko._1.average(glicko._2, weightOf(angle, win))
```

`Glicko.average` (from scalachess):

```scala
def average(other: Glicko, weight: Float = 0.5f): Glicko =
  if weight >= 1 then other
  else if weight <= 0 then this
  else Glicko(
    rating     = rating * (1 - weight) + other.rating * weight,
    deviation  = deviation * (1 - weight) + other.deviation * weight,
    volatility = volatility * (1 - weight) + other.volatility * weight
  )
```

All three components (rating, RD, volatility) pulled proportionally toward raw output. **This is NOT standard Glicko-2** — it's a Lichess-invented dampener designed to slow rating movement on themed puzzles where the theme label leaks a hint at the solution.

<a id="theme-classifier"></a>
## 6. Theme classifier + weight table

```scala
private val nonHintingThemes: Set[PuzzleTheme.Key] = Set(
  opening, middlegame, endgame,
  rookEndgame, bishopEndgame, pawnEndgame, knightEndgame, queenEndgame, queenRookEndgame,
  master, masterVsMaster, superGM
).map(_.key)
private def isHinting(theme) = !nonHintingThemes(theme)

private val isObvious: Set[PuzzleTheme.Key] = Set(
  enPassant, attackingF2F7, doubleCheck, mateIn1, castling
).map(_.key) ++ PuzzleTheme.allMates        // allMates = every theme ending in "Mate"
```

**Bucket contents:**

- **Obvious** (heaviest dampening): `enPassant`, `attackingF2F7`, `doubleCheck`, `mateIn1`, `castling`, all `*Mate` themes (`anastasiaMate`, `arabianMate`, `backRankMate`, `balestraMate`, `blindSwineMate`, `bodenMate`, `cornerMate`, `doubleBishopMate`, `dovetailMate`, `epauletteMate`, `hookMate`, `killBoxMate`, `pillsburysMate`, `morphysMate`, `operaMate`, `swallowstailMate`, `triangleMate`, `vukovicMate`, `smotheredMate`)
- **Neutral** (least dampening): `opening`, `middlegame`, `endgame`, all `*Endgame` variants, `master`, `masterVsMaster`, `superGM`
- **Hinting** (medium dampening): every other visible theme — `fork`, `pin`, `skewer`, `sacrifice`, `discoveredAttack`, `deflection`, `attraction`, `clearance`, `interference`, `xRayAttack`, `trappedPiece`, `quietMove`, `zugzwang`, `defensiveMove`, `hangingPiece`, `promotion`, `advancedPawn`, `kingsideAttack`, `queensideAttack`, `exposedKing`, `discoveredCheck`, ...
- **Mix** (`PuzzleAngle.mix` — no theme filter): weight = 1.0

### The weight table

```scala
private def weightOf(angle, win) =
  angle.asTheme.fold(1f): theme =>
    if theme == PuzzleTheme.mix.key then 1
    else if isObvious(theme) then if win.yes then 0.1f else 0.4f
    else if isHinting(theme) then if win.yes then 0.2f else 0.7f
    else if win.yes then 0.7f else 0.8f
```

| Category | Win weight | Loss weight | Loss/Win ratio |
|---|---:|---:|---:|
| **mix** (no theme) | 1.00 | 1.00 | 1× |
| **Neutral** (endgame, master, etc.) | 0.70 | 0.80 | 1.14× |
| **Hinting** (fork, pin, skewer, ...) | **0.20** | 0.70 | **3.5×** |
| **Obvious** (mateIn1, all mates, enPassant) | **0.10** | 0.40 | **4×** |

**Asymmetric by design:** losing an "obvious" puzzle carries 4× the weight of winning it. This is the anti-inflation mechanism — you barely gain from grinding easy themes, but you pay real cost when you miss one.

### Provisional-puzzle modifier

If the puzzle itself is `provisional` (its RD ≥ 110 — puzzle hasn't been played much), an additional modifier is subtracted from the weight, then floored at 0.1:

```scala
val provisionalPuzzle = puzzle.provisional.yes.so:
  if win.yes then -0.2f else -0.7f
val w = (weightOf(angle, win) + provisionalPuzzle).atLeast(0.1f)
```

So a win against a provisional fork puzzle: `max(0.1, 0.2 - 0.2) = 0.1`. Barely any gain — because the puzzle rating is not trusted.

<a id="glicko-constants"></a>
## 7. Glicko constants (Lichess puzzles path)

From `rating/src/main/Glicko.scala`:

```scala
val minRating = 400
val maxRating = 4000
val minDeviation = 45
val variantRankableDeviation = 65
val standardRankableDeviation = 75         // leaderboard eligibility
val maxDeviation = 500.0
val maxVolatility = 0.10
val defaultVolatility = 0.09

val default              = Glicko(1500.0, 500.0, 0.09)
val pairingDefault       = Glicko(1450.0, 500.0, 0.09)  // makes first-pairing expected-score 50%
val defaultManaged       = Glicko(800.0, 400.0, 0.09)
val defaultManagedPuzzle = Glicko(800.0, 400.0, 0.09)
val defaultBot           = Glicko(3000.0, 500.0, 0.09)

val maxRatingDelta = 700
val periodsPerDay = RatingPeriodsPerDay(0.21436)   // 1 period ≈ 4.66 days

val calculator = GlickoCalculator(ratingPeriodsPerDay = periodsPerDay)
```

From scalachess `glicko/model.scala`:

```scala
val provisionalDeviation = 110       // established when RD < 110
val cluelessDeviation    = 230
val defaultTau           = 0.75      // never overridden in lila

def provisional = RatingProvisional(deviation >= 110)
def established = provisional.no
def clueless    = deviation >= 230
```

### The `.cap` + `.sanityCheck` guards

```scala
def cap: Glicko = copy(
  rating     = rating.atLeast(400),
  deviation  = deviation.atLeast(45).atMost(500),
  volatility = volatility.atMost(0.10)
)
def sanityCheck: Boolean =
  rating > 0 && rating < 4000 &&
    deviation > 0 && deviation < 1000 &&
    volatility > 0 && volatility < 0.20
```

Applied on every write. New puzzle Glicko is only stored if `sanityCheck` passes.

<a id="anti-abuse"></a>
## 8. Anti-abuse: dubiousPuzzle, rate limit, provisional

### `dubiousPuzzle` — sandbagging filter

```scala
def dubiousPuzzle(puzzle: Perf, standard: Perf): Boolean =
  puzzle.glicko.rating > 3000 && !standard.glicko.establishedIntRating.exists(_ > 2100) ||
  puzzle.glicko.rating > 2900 && !standard.glicko.establishedIntRating.exists(_ > 2000) ||
  puzzle.glicko.rating > 2700 && !standard.glicko.establishedIntRating.exists(_ > 1900) ||
  puzzle.glicko.rating > 2500 && !standard.glicko.establishedIntRating.exists(_ > 1800)
```

Thresholds (puzzle rating vs. required OTB standard rating):

| Puzzle rating > | Requires standard > |
|---:|---:|
| 3000 | 2100 (established) |
| 2900 | 2000 |
| 2700 | 1900 |
| 2500 | 1800 |

If the user is `dubiousPuzzle`, **puzzle-side Glicko is NOT updated** (user's rating still is — only the puzzle is protected from noise).

### Rate limiter — 300/day

```scala
private val canUpdatePuzzleRating =
  lila.memo.RateLimit[UserId](300, 1.day, key = "puzzle.canUpdatePuzzleRating")

val updatePuzzleGlicko = !dubiousPlayer && canUpdatePuzzleRating(me.userId, false)(true)
```

Above 300 solves/day, the puzzle-side update stops for that user (but the user's own rating still updates). Prevents any single actor from single-handedly moving puzzle ratings.

### Clueless user → no puzzle update

```scala
def puzzle(angle, win, glicko, player) =
  if player.clueless then glicko._1     // player RD ≥ 230 → puzzle unchanged
  else glicko._1.average(glicko._2, weightOf(angle, win))
```

If the user's RD ≥ 230 (they haven't played much yet), the puzzle's Glicko is left alone. New users cannot move puzzle ratings.

<a id="anti-replay"></a>
## 9. Anti-replay

The `round` collection is authoritative. Composite `_id = "userId:puzzleId"` makes point lookups O(1):

```scala
def find(user: User, puzzleId: PuzzleId): Fu[Option[PuzzleRound]] =
  colls.round(_.byId[PuzzleRound](PuzzleRound.Id(user.id, puzzleId).toString))
```

In `nextPuzzleResult`, the aggregation joins the candidate puzzle → round collection by composite key. If a round exists → `PuzzleAlreadyPlayed`. That is the sole anti-replay mechanism:

- No bloom filter
- No per-user solved-set cache
- Just a hot `round` collection with the right index

When path is exhausted (5 forward-skips within the session's path), fall back a tier (`top → good → all`) and search again. From `all` there's no further stepDown, so we may end up re-serving a played puzzle — replays don't cost rating (see [Rating Update § replay branch](#rating-update)).

<a id="special-modes"></a>
## 10. Session, Daily, Streak, Storm, Racer

### Session (`PuzzleSession.scala`)

```scala
case class PuzzleSession(
    settings: PuzzleSettings,
    path: PuzzlePath.Id,
    positionInPath: Int,
    rating: IntRating,
    previousPaths: Set[PuzzlePath.Id] = Set.empty
)
```

- Caffeine cache, 16384 entries, TTL 1h
- Pins user to a single path document (~64 IDs), walks `positionInPath++`
- Recreated when angle changes OR when:

```scala
private def shouldFlushSession(session)(using perf) = !session.brandNew &&
  Math.abs((perf.intRating - session.rating).value) > 100
```

(user drifted >100 rating since session start).

Path-switch appends to `previousPaths` so the picker's `_id.$nin(previousPaths)` skips them.

### Daily puzzle (`DailyPuzzle.scala`)

Selected from `PuzzleTier.top`, `angle=mix`, band **2150–2300**:

```scala
Match(pathApi.select(mix, top, 2150 to 2300)) -> List(
  Sample(3), ...,
  AddFields($doc("dayScore" -> $doc("$multiply" -> $arr("$plays", "$vote")))),
  Sort(Descending("dayScore")),
  Limit(1)
)
```

Extra filters:
- `plays > 9000 * (maxTries-tries)/maxTries` (relax with retries)
- `day` field not previously set (dedup across days)
- Not in `forbiddenThemes = [oneMove]`
- 50% chance to exclude `checkFirst`
- `anastasiaMate` / `arabianMate` downsampled to 1-in-3

Winner picked by `plays × vote`. `day` field stamped so it won't repeat.

### Streak (`PuzzleStreak.scala`)

Pre-baked cached pool of ~150 puzzles covering fixed bucket ladder. Cache refresh every 30s:

```scala
private val buckets = List(
  1050 -> 3,  1150 -> 4,  1300 -> 5,  1450 -> 6,  1600 -> 7,
  1750 -> 8,  1900 -> 10, 2050 -> 13, 2199 -> 15, 2349 -> 17,
  2499 -> 19, 2649 -> 21, 2799 -> 21
)
```

- Below 2300: `top` tier, RD ≤ 85
- Above 2300: `good` tier, RD ≤ 110
- **Global pool** — user rating NOT consulted; player climbs the ladder
- **No rating impact** — Streak submissions do not run through `PuzzleFinisher`

### Storm & Racer

Stored as `PuzPerf(runs, score)` in `UserPerfs` — just `(runs, score)` counters, NOT Glicko. Do not touch puzzle Glicko.

```scala
storm  = r.getD[PuzPerf]("storm", puzPerfDefault)
racer  = r.getD[PuzPerf]("racer", puzPerfDefault)
streak = r.getD[PuzPerf]("streak", puzPerfDefault)
```

<a id="worked-example"></a>
## 11. Worked example — 2113 wins vs 1854 fork puzzle

Starting state:
- User Perf: rating=2113, deviation=75 (established), volatility=0.09
- Puzzle: glicko=(1854, 80, 0.09), themes contains `fork`, plays=500
- angle=Theme("fork"), win=YES, rated=YES
- User is not dubiousPuzzle, within 300/day rate limit

**Step 1 — picker chose this puzzle:**
Session angle=fork, Normal difficulty. target=2113. base=`100 + |1500-2113|/4 = 253`. First try compromise=0 → flex=0 → exact-target scan of `fork|top|2113` paths. Match returns a path holding ~64 fork puzzles around rating 2113. The specific puzzle picked from that pool has rating 1854 (a path centered at 2113 can contain puzzles from ~2050 to ~2170; if compromise widened, the pool is broader).

**Step 2 — PuzzleFinisher.apply enters full-Glicko branch** (no prev round, rated).

**Step 3 — Raw Glicko game:**
```
players = [user(2113,75,0.09), puzzle(1854,80,0.09)]
outcome = White wins
→ raw output ≈ user(2118, 74.5, 0.09), puzzle(1846, 79.5, 0.09)
```
Small movement because expected score was ~0.82 (heavy favorite).

**Step 4 — Puzzle-side clamp + ponder.puzzle:**
```
puzzleGlicko.rating.atMost(1854 + 700).atLeast(1854 - 700) → 1846 (no clamp)
player.clueless = (75 >= 230) = false
weightOf(fork, YES) = 0.2 (isHinting, win)
newPuzzleGlicko = (1854 * 0.8 + 1846 * 0.2, 80 * 0.8 + 79.5 * 0.2, 0.09)
                = (1852.4, 79.9, 0.09)
```

**Step 5 — User-side ponder.player:**
```
puzzle.provisional = (80 >= 110) = false → provisionalPuzzle = 0
effective weight = max(0.1, 0.2 + 0) = 0.2
newUserGlicko = (2113 * 0.8 + 2118 * 0.2, 75 * 0.8 + 74.5 * 0.2, 0.09)
             = (2114.0, 74.9, 0.09)
```

**Stored rating: 2113 → 2114 (Δ=+1)**

Compare to raw Glicko: 2113 → 2118 (Δ=+5). The 0.2 weight for a themed-win kept movement small because the theme label told the user "look for a fork" — a genuine skill signal is weaker than a mix-puzzle win.

**Step 6 — Persistence:**
- `round` upsert with `_id="userid:puzzleid"`, `win=YES`, `angle=fork`, `date=now`
- User perf: rating=2114, nb++, `recent` prepended, `latest=now`
- Puzzle: `$inc plays 1`, `$set glicko (1852.4, 79.9, 0.09)`
- `Bus.pub(Puzzle.UserResult(...))` fires

### Loss variant

Had it been a **LOSS** to the same 1854 fork puzzle:
```
weightOf(fork, NO) = 0.7
raw Glicko loss ≈ user(2093, ...)   // Δ ≈ -20
stored = 2113 * 0.3 + 2093 * 0.7 ≈ 2099    // Δ ≈ -14
```

**3.5× the movement magnitude of the win.** This is the asymmetry that keeps ratings honest.

### Provisional-puzzle variant

Had the puzzle been provisional (RD ≥ 110) and we won:
```
extra weight = -0.2
effective = max(0.1, 0.2 - 0.2) = 0.1
stored = 2113 * 0.9 + 2118 * 0.1 = 2113.5   // ≈ no change
```

Essentially no rating change — puzzle is untrusted.

<a id="implications"></a>
## 12. Design implications for ChessGuru

### What we should adopt

1. **Weighted-average model** — replace our easy-win cap + slow-climb + Layer 1/2 dampening + solvePattern classifier with the single `Glicko.average(oldG, newG, weight)` pattern. It's ~50 lines DELETED, ~30 added. Handles srinithi-type cases correctly by design (never a "flat +1" cliff at threshold).
2. **Theme weight table** — port the obvious/hinting/neutral/mix classifier. Losses > wins for themed puzzles. This is the actual anti-inflation mechanism.
3. **Picker floor formula: `flex = 100 + |1500-target|/4`** — replaces our fixed ±100 flex. Naturally wider at extremes.
4. **300/day rate limit on puzzle-side update** — cheap safety.
5. **dubiousPuzzle check** — noise-mining protection.
6. **Provisional-puzzle weight modifier** — untrusted puzzles barely move user rating.
7. **Session-based pathing** — 64-puzzle path per session, walk positionInPath++. We already do something similar but the Lichess model is cleaner.

### What we should NOT adopt

1. **No per-theme user ratings.** Root cause of srinithi's -347 drop. Lichess has ONE puzzle rating per user; theme is only a weight modifier. Consider removing our `themes.<theme>.gl` per-user storage entirely (or convert to a display-only "win rate per theme" without Glicko).
2. **No streak-based grinder classifier.** The weight table self-regulates — mate grinding gives 0.1 win vs 0.4 loss, so it's mathematically break-even at best.
3. **No slow-climb (delta × 100/d) multiplier.** Weighted average serves the same purpose without discontinuities.

### What Lichess doesn't have that we should keep

1. **Provisional badge UI (`≈N?`)** — our provisional badge on new users is nicer UX than Lichess's silent "clueless RD ≥ 230" gate. Keep it.
2. **Anti-grinding attendance / streaks in Consistency Score** — Lichess doesn't have leaderboards structured this way. Our leaderboard model is fine.

### Migration order

**Phase 1 (safe, one week):**
- Replace `updatePuzzleRating` internals with the weighted-average pattern
- Add theme-weight table
- Keep per-theme ratings but stop using them in the picker (picker uses global only)

**Phase 2 (bigger change, month later):**
- Remove per-theme user ratings entirely (migration script)
- Replace with "theme performance dashboard" (win rate per theme, no Glicko)

**Phase 3 (polish):**
- Session-based pathing exactly as Lichess does it
- 300/day rate limit
- dubiousPuzzle check
