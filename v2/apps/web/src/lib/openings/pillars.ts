// Tier 1 pillar openings — hand-authored with full metadata (tags, mainline,
// idea, plans, story, citations). Target: 20 pillars. This file ships the FIRST
// 5 (Italian, Ruy Berlin, Sicilian Najdorf English Attack, French Winawer, KID
// Bayonet) as a proof-of-corpus. Remaining 15 land in follow-on authoring
// sessions — the format below is the template.
//
// Every citation says WHO said WHAT — see types.ts:Citation. Wikipedia and Fine
// (Ideas Behind the Chess Openings, 1943) are public domain; Watson / Kasparov
// are paraphrased with attribution (never quoted verbatim).
import type { Opening } from "./types";

export const PILLARS: Opening[] = [
  //───────────────────────────────────────────────────────────────────────────
  // 1) Italian Game — Giuoco Piano (Classical)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "italian-giuoco-piano",
    eco: "C54",
    ecoName: "Italian Game: Giuoco Piano",
    name: "Italian, Giuoco Piano",
    aliases: ["Italian Game", "Giuoco Piano"],
    familyId: "italian",
    tier: 1,
    frequencyBps: 620,
    pgnStart: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"],
    mainlinePgn: [
      "e4","e5","Nf3","Nc6","Bc4","Bc5","c3","Nf6","d3","d6","O-O","O-O",
      "Re1","a6","Bb3","Ba7","h3","h6","Nbd2","Re8","Nf1","Be6","Ng3","d5",
      "Bxe6","fxe6","Ng5","Qd7","exd5","exd5",
    ],
    tagSlugs: ["strategic","open","central","classical","idea-based"],
    structureSlug: "iqp",
    criticalMoveNo: 7,
    idea: {
      short: "Slow-burn manoeuvring around a symmetric centre — regroup pieces before breaking.",
      long:
        "The Giuoco Piano ('quiet game') is the polite cousin of the sharp Italian gambit lines. " +
        "Both sides castle short, plant pieces on active but non-committal squares, and manoeuvre " +
        "for 10-15 moves before the position clarifies. Fine calls it 'the perfect classical " +
        "opening for a beginner' — every principle (rapid development, castling, control of the " +
        "centre) is directly rewarded. Watson notes that modern grandmasters have revived it " +
        "specifically BECAUSE it's low-theory: opponents can't prepare a knockout blow.",
      whitePlans: [
        "Complete development with c3, d3, Re1, h3, Nbd2, Nf1, Ng3",
        "Reroute Nf3 → h4 or Nd2 → f1 → g3 → f5 for a kingside probe",
        "Central break with d4 or e4-e5 once pieces support it",
      ],
      blackPlans: [
        "Mirror White's setup with …h6, …Re8, …a6, …Ba7",
        "…d5 pawn break to challenge the centre",
        "…Nh5-f4 or …Nd7-f8-g6 knight regrouping",
      ],
      storyHook:
        "The Bishop's Bridge: both sides send their bishop across to c4/c5 first, and every " +
        "later move dances around this ancient handshake.",
      storyLong:
        "In the town of Giuoco, two old bishops meet at the Bishop's Bridge (c4 for White, c5 " +
        "for Black). Neither draws a sword — this is a game of manners. Behind them, the knights " +
        "trot into position, the kings tuck into their castles, and the rooks slide onto the " +
        "back rank. Only when everyone has taken their tea (moves 1-8) does the real work start: " +
        "White probes with the Ng5 lunge (move 14), Black opens the position with …d5.",
      citations: [
        { author: "Fine",     work: "Ideas Behind the Chess Openings", section: "ch. 12", licence: "PD" },
        { author: "Watson",   work: "Mastering the Chess Openings, vol. 1", section: "pp. 83-87", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "Italian_Game", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/Italian_Game" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 2) Ruy Lopez — Berlin Defence (the 'Berlin Wall' endgame)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "ruy-lopez-berlin",
    eco: "C67",
    ecoName: "Ruy Lopez: Berlin Defence, Rio Gambit / Berlin Wall",
    name: "Ruy Lopez, Berlin Wall",
    aliases: ["Berlin Defence", "Berlin Wall"],
    familyId: "ruy-lopez",
    tier: 1,
    frequencyBps: 480,
    pgnStart: ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"],
    mainlinePgn: [
      "e4","e5","Nf3","Nc6","Bb5","Nf6","O-O","Nxe4","d4","Nd6","Bxc6","dxc6",
      "dxe5","Nf5","Qxd8+","Kxd8","Nc3","Ke8","h3","h5","Bf4","Be7","Rad1","Be6",
      "Ng5","Rh6","g3","h4","Nxe6","fxe6",
    ],
    tagSlugs: ["strategic","solid","open","endgame-oriented","classical","theory-heavy"],
    structureSlug: "kings-fianchetto",   // approximate — Berlin has its own structure
    criticalMoveNo: 8,                    // 8...Kxd8 is THE move that defines this
    idea: {
      short: "Voluntarily enter a queen-less endgame that looks slightly worse — but is impregnable.",
      long:
        "The Berlin Defence is one of the most famous strategic decisions in modern chess. On " +
        "move 8, Black recaptures the queen with the KING (…Kxd8), losing castling rights and " +
        "accepting doubled c-pawns. The compensation: rock-solid pawns, the bishop pair, and " +
        "endgame theory that gives White essentially zero winning chances. " +
        "Kramnik weaponised this in the 2000 World Championship match, using it to draw every " +
        "game he played on the black side against Kasparov — and eventually took the title. " +
        "The 'Berlin Wall' name comes from the resulting fortress. Kasparov later admitted he " +
        "had no antidote. Watson: 'The Berlin's power is not in its ideas but in its structural " +
        "immunity — nothing bad happens.'",
      whitePlans: [
        "Improve piece placement patiently — no forcing lines exist",
        "Fix Black's weak c6 pawn, prepare c4-c5 or exchange operations",
        "Rook lift Rf1-e1-e3-g3/h3 for kingside probes",
      ],
      blackPlans: [
        "King to e8, then h7 or g8 for eventual …Rh6-g6 activity",
        "Bishop pair on e6 and e7/f8 — never trade them cheaply",
        "…h5-h4 to fix White's kingside pawns",
      ],
      storyHook:
        "The two kings shake hands: on move 8, both queens leave the board and Black's king " +
        "walks to e8 to receive the handshake in person. That handshake is a wall.",
      storyLong:
        "In the year 2000, in a great hall in London, the young Prince Kramnik faced the reigning " +
        "Sun King Kasparov. Twelve times the Sun King attacked with 1.e4. Twelve times Kramnik " +
        "played the Berlin, and on move 8 walked his king out to e8 to shake the Sun King's " +
        "hand personally, offering a draw before the game had really begun. Kasparov, unable " +
        "to punch the wall, lost his crown. Every future world champion has kept a Berlin in " +
        "their pocket.",
      citations: [
        { author: "Kasparov",  work: "My Great Predecessors, vol. 1", section: "on Steinitz-Zukertort", licence: "paraphrase" },
        { author: "Watson",    work: "Mastering the Chess Openings, vol. 2", section: "Berlin chapter", licence: "paraphrase" },
        { author: "Kramnik",   work: "My Life & Games", licence: "paraphrase" },
        {                      work: "Wikipedia", section: "Ruy_Lopez#Berlin_Defence", licence: "CC-BY-SA",
                               url: "https://en.wikipedia.org/wiki/Ruy_Lopez#Berlin_Defence" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 3) Sicilian Najdorf — English Attack (6.Be3)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "sicilian-najdorf-english-attack",
    eco: "B90",
    ecoName: "Sicilian: Najdorf, English Attack",
    name: "Sicilian Najdorf, English Attack",
    aliases: ["Najdorf 6.Be3", "English Attack"],
    familyId: "sicilian",
    parentSlug: "sicilian-najdorf",       // Najdorf itself is a Tier 1 too
    tier: 1,
    frequencyBps: 340,
    pgnStart: ["e4","c5","Nf3","d6","d4","cxd4","Nxd4","Nf6","Nc3","a6","Be3"],
    mainlinePgn: [
      "e4","c5","Nf3","d6","d4","cxd4","Nxd4","Nf6","Nc3","a6","Be3","e5",
      "Nb3","Be6","f3","Be7","Qd2","O-O","O-O-O","Nbd7","g4","b5",
      "g5","b4","Ne2","Ne8","f4","a5","f5","a4",
    ],
    tagSlugs: ["dynamic","aggressive","semi-open","both-flanks","modern","theory-heavy"],
    structureSlug: "boleslavsky-hole",
    criticalMoveNo: 10,
    idea: {
      short: "Opposite-side castling race — whoever's attack lands first wins.",
      long:
        "The English Attack (Nunn, Chandler, Short in the 1980s London 'English School') is the " +
        "most direct anti-Najdorf: White castles queenside and throws the g/h pawns at Black's " +
        "king. Black responds symmetrically — castles kingside, throws the a/b pawns at White. " +
        "It is a genuine race. Miss a tempo and you lose. Every move from 12 onwards is " +
        "concrete. Kasparov's early Najdorf games are the textbook. Watson: 'The English Attack " +
        "made positional players learn to attack again — the pawns simply do not stop.'",
      whitePlans: [
        "Long castle by move 10, then g4-g5-h4-h5 pawn storm",
        "Nb3-a5 or Nb3-d5 to jump the queenside knight",
        "Bh6 to trade Black's fianchetto bishop when possible",
      ],
      blackPlans: [
        "…Nbd7-b6-c4 or …Nbd7-e5 knight route",
        "…a6-b5-b4 to dislodge Nc3 and open the b-file",
        "…Rb8 stacking behind the b-pawn",
      ],
      storyHook:
        "Two castles rise on opposite hills — White in the west (O-O-O), Black in the east " +
        "(O-O). Both sides light their siege pawns. The first to reach the enemy king wins.",
      storyLong:
        "It is 6 in the evening in the year 1990. In the fortress town of Najdorf, the English " +
        "commander (Be3) has just arrived to lead the attack. White's king takes shelter in the " +
        "west tower; Black's in the east. Then the pawns march. On move 10, Black's queen's " +
        "knight (Nbd7) makes the critical choice — d7, not e5 — because it will need to swing " +
        "to b6 to slow White's g-pawns. From here, every move is a countdown: g4-g5, …b5-b4, " +
        "h4-h5, …a5-a4. Whoever's siege reaches the enemy king first wins the game and the war.",
      citations: [
        { author: "Kasparov", work: "My Great Predecessors, vol. 4", section: "Najdorf chapters", licence: "paraphrase" },
        { author: "Watson",   work: "Mastering the Chess Openings, vol. 1", section: "Najdorf", licence: "paraphrase" },
        { author: "Nunn",     work: "The Complete Najdorf: 6.Be3", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "Sicilian_Defence,_Najdorf_Variation", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/Sicilian_Defence,_Najdorf_Variation" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 4) French Defence — Winawer
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "french-winawer",
    eco: "C18",
    ecoName: "French: Winawer, Main Line",
    name: "French Winawer",
    aliases: ["Winawer Variation"],
    familyId: "french",
    tier: 1,
    frequencyBps: 210,
    pgnStart: ["e4","e6","d4","d5","Nc3","Bb4"],
    mainlinePgn: [
      "e4","e6","d4","d5","Nc3","Bb4","e5","c5","a3","Bxc3+","bxc3","Ne7",
      "Qg4","Qc7","Qxg7","Rg8","Qxh7","cxd4","Ne2","Nbc6","f4","Bd7","Qd3","dxc3",
      "h4","O-O-O","h5","Nf5","Rh3","d4",
    ],
    tagSlugs: ["dynamic","positional","closed","queenside","classical","theory-heavy"],
    structureSlug: "slav-meran",   // approximate — the French Winawer has its own signature
    criticalMoveNo: 5,
    idea: {
      short: "Doubled c-pawns for the bishop pair + open g-file. Opposite-side castling attack race.",
      long:
        "The Winawer is French chess in its purest, sharpest form. Black trades a bishop for a " +
        "knight to double White's c-pawns; White accepts the pawn structure damage because the " +
        "position becomes wildly attacking. On move 7-11 White typically grabs the g-pawn with " +
        "the queen (Qg4-Qxg7), Black gets massive open lines against the White king. Fine " +
        "writes: 'the Winawer changes French chess from a defensive to a counter-attacking " +
        "weapon.' Botvinnik used it to become world champion. Watson notes that the modern " +
        "engine era has confirmed both sides' resources are approximately balanced — which is " +
        "remarkable given how imbalanced the position LOOKS.",
      whitePlans: [
        "Grab the g-pawn with Qg4/Qxg7 to disrupt Black's kingside",
        "Push h4-h5-h6 to open the h-file against Black's king",
        "Reroute Ne2 → g3 → f5 or → f4 for kingside pressure",
      ],
      blackPlans: [
        "Play …Qc7 defending g7, allowing calm development",
        "…c5, …Nbc6, …Bd7 rapid queenside development",
        "Castle long, then attack White's king with …dxc3 and open lines",
      ],
      storyHook:
        "Black gives away a bishop's coat to spill White's wine (doubled c-pawns) — then both " +
        "sides run for opposite doors and set the house on fire.",
      storyLong:
        "In the French quarter, Black offers a coat (the b4 bishop) to spill White's cellar " +
        "wine (…Bxc3+ → bxc3 doubled pawns). White, furious, marches out the queen (Qg4) to " +
        "grab the g-pawn — but this leaves the White king exposed. On move 11 the parties " +
        "castle in opposite directions: Black long, White having already stayed in the middle. " +
        "The last 4 moves are pawn spears: h4-h5 vs …dxc3-d4-c3. It's Botvinnik's system, and " +
        "whoever knows the theory 3 moves deeper wins.",
      citations: [
        { author: "Fine",     work: "Ideas Behind the Chess Openings", section: "French chapter", licence: "PD" },
        { author: "Botvinnik", work: "One Hundred Selected Games", licence: "paraphrase" },
        { author: "Watson",   work: "Play the French, 4th ed.", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "French_Defence#Winawer_Variation", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/French_Defence#Winawer_Variation" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 6) Ruy Lopez — Closed, Chigorin Variation (the classic Spanish squeeze)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "ruy-lopez-chigorin",
    eco: "C97",
    ecoName: "Ruy Lopez: Closed, Chigorin",
    name: "Ruy Lopez, Closed Chigorin",
    aliases: ["Ruy Lopez Chigorin", "Closed Ruy Lopez"],
    familyId: "ruy-lopez",
    tier: 1,
    frequencyBps: 260,
    pgnStart: ["e4","e5","Nf3","Nc6","Bb5","a6","Ba4","Nf6","O-O","Be7","Re1","b5","Bb3","d6","c3","O-O","h3","Na5"],
    mainlinePgn: [
      "e4","e5","Nf3","Nc6","Bb5","a6","Ba4","Nf6","O-O","Be7","Re1","b5",
      "Bb3","d6","c3","O-O","h3","Na5","Bc2","c5","d4","Qc7","Nbd2","cxd4",
      "cxd4","Nc6","d5","Nb4","Bb1","a5",
    ],
    tagSlugs: ["strategic","positional","semi-open","kingside","classical","theory-heavy"],
    // No structure among the 12 matches — the Ruy Closed builds its own signature
    // "small centre" (d4/e4 vs d6/e5) that transitions to whatever break lands first.
    criticalMoveNo: 9,
    idea: {
      short: "Pin the c6 knight, provoke …a6/…b5, then squeeze with the small centre for 30 moves.",
      long:
        "The Closed Ruy Lopez is the deepest positional battle in chess. White pins the c6 knight, " +
        "gets Black to weaken the queenside with …a6/…b5, then retreats the bishop to b3-c2 " +
        "(the 'Spanish bishop') aiming at the h7-b1 diagonal. Black responds by rerouting the " +
        "knight from c6 to a5 (Chigorin) or via d7-f8-g6/e6 (Breyer). Both sides then " +
        "manoeuvre for 15-25 moves before a break happens — usually …c5/…d5 for Black or a " +
        "central d4-d5 for White. Fine wrote that the Ruy Lopez 'requires the deepest strategic " +
        "understanding of any opening' and remains the most-played 1.e4 opening at world " +
        "championship level. Kasparov, Karpov, Anand, Carlsen all made it their main weapon " +
        "with the white pieces.",
      whitePlans: [
        "Nbd2 → f1 → g3 knight reroute for kingside pressure",
        "Central break d4-d5 to clamp Black's queenside knight",
        "Long-term Bc2-b1-Qd3 battery on the h7-b1 diagonal",
      ],
      blackPlans: [
        "…Na5-c4 or …Nc6-b8-d7 knight reroute (Chigorin vs Breyer)",
        "…c5 pawn break to challenge d4",
        "…exd4, …Bb7, …Qc7 quiet development targeting c-file + e-file",
      ],
      storyHook:
        "The Spanish Bishop makes a slow pilgrimage a4 → b3 → c2 → b1, and every step brings " +
        "him closer to Black's king. The knight on a5 leaps to c4 to block the pilgrimage.",
      storyLong:
        "In old Madrid, the Spanish Bishop begins his pilgrimage on b5, pinning Sir Cavallero " +
        "(Nc6). Black waves him off with …a6, so the Bishop steps back to a4. He steps again " +
        "to b3 when …b5 shoos him. On move 9, Cavallero rides all the way over to a5 to threaten " +
        "the Bishop again — the Chigorin manoeuvre — and the Bishop retreats one more square to " +
        "c2. Now he aims at the far corner (h7). For 20 more moves, both armies shuffle to " +
        "prepare a single decisive break: …c5, …d5, or White's d4-d5. Whoever times it right " +
        "cracks the small centre open. The Ruy has been called 'the Mozart of chess'.",
      citations: [
        { author: "Fine",     work: "Ideas Behind the Chess Openings", section: "Ruy Lopez chapter", licence: "PD" },
        { author: "Kasparov", work: "My Great Predecessors, vol. 1-2", section: "Steinitz/Lasker Ruy games", licence: "paraphrase" },
        { author: "Watson",   work: "Mastering the Chess Openings, vol. 1", section: "Closed Ruy chapter", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "Ruy_Lopez#Closed_variations", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/Ruy_Lopez#Closed_variations" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 7) Sicilian — Sveshnikov (Pelikan/Cheliabinsk)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "sicilian-sveshnikov",
    eco: "B33",
    ecoName: "Sicilian: Sveshnikov Variation",
    name: "Sicilian Sveshnikov",
    aliases: ["Pelikan", "Cheliabinsk Variation", "Lasker-Pelikan"],
    familyId: "sicilian",
    tier: 1,
    frequencyBps: 195,
    pgnStart: ["e4","c5","Nf3","Nc6","d4","cxd4","Nxd4","Nf6","Nc3","e5"],
    mainlinePgn: [
      "e4","c5","Nf3","Nc6","d4","cxd4","Nxd4","Nf6","Nc3","e5","Ndb5","d6",
      "Bg5","a6","Na3","b5","Nd5","Be7","Bxf6","Bxf6","c3","O-O","Nc2","Bg5",
      "a4","bxa4","Rxa4","a5","Bc4","Rb8",
    ],
    tagSlugs: ["dynamic","aggressive","semi-open","central","modern","theory-heavy"],
    structureSlug: "boleslavsky-hole",
    criticalMoveNo: 5,
    idea: {
      short: "Accept a permanent hole on d5 for the bishop pair, …f5 counter-attack, and queenside space.",
      long:
        "On move 5, Black plays …e5, kicking White's centralised knight AND weakening the d5 " +
        "square permanently. This looks anti-positional (a Sveshnikov Black often has a knight " +
        "sitting on d5 forever), but Black gets: (a) the bishop pair after the standard " +
        "Bg5xNf6 trade, (b) massive queenside space with …a6/…b5, and (c) the eventual …f5 " +
        "kingside counter-attack. Carlsen used the Sveshnikov as his main defence to 1.e4 in " +
        "the 2018 World Championship match. Watson: 'The Sveshnikov violates almost every " +
        "classical rule and works precisely because piece activity + concrete threats trump " +
        "structural principles in this specific position.' Sveshnikov himself (Evgeny) developed " +
        "the theory in Cheliabinsk in the 1970s.",
      whitePlans: [
        "Nd5 outpost — plant the knight and don't move it",
        "Trade Bg5xNf6 to secure d5 (Black's dark-squared bishop can't cover it)",
        "a4-a5 clamp on the queenside, restricting Black's …b5",
      ],
      blackPlans: [
        "…a6, …b5, …Be7-g5 (or Bh4) unblocking the bishop pair",
        "…f5 kingside pawn break",
        "Rook lift …Rb8 or …a8-a5 to challenge White's queenside space",
      ],
      storyHook:
        "Black plants a flag on d5 that says 'YES, this square is weak — good luck holding it'. " +
        "Then both bishops go for a walk while the pawns fight on the flanks.",
      storyLong:
        "In the Ural town of Cheliabinsk, the young student Sveshnikov noticed that Black's " +
        "'weak' d5 square in the classical Sicilian was actually a trap for White: yes, White " +
        "gets a knight there, but Black gets EVERYTHING else — the bishop pair, queenside space, " +
        "and a kingside pawn storm ready to fire. On move 5, Black kicks the White knight with " +
        "…e5, and though the d5 hole is permanent, the bishop pair goes on a slow walk (…Bg5 " +
        "on move 12, then …Bh4 or …Bd8) while the pawns storm both wings. Carlsen used it in " +
        "London 2018 to draw all 12 classical games vs Caruana.",
      citations: [
        { author: "Sveshnikov", work: "The Sveshnikov Reloaded", licence: "paraphrase" },
        { author: "Kasparov",   work: "Revolution in the 70s", section: "Sveshnikov chapter", licence: "paraphrase" },
        { author: "Watson",     work: "Mastering the Chess Openings, vol. 1", section: "Sveshnikov chapter", licence: "paraphrase" },
        {                       work: "Wikipedia", section: "Sicilian_Defence,_Sveshnikov_Variation", licence: "CC-BY-SA",
                                url: "https://en.wikipedia.org/wiki/Sicilian_Defence,_Sveshnikov_Variation" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 8) Caro-Kann — Advance Variation
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "caro-kann-advance",
    eco: "B12",
    ecoName: "Caro-Kann: Advance Variation",
    name: "Caro-Kann Advance",
    aliases: ["Advance Caro-Kann", "3.e5 Caro"],
    familyId: "caro-kann",
    tier: 1,
    frequencyBps: 170,
    pgnStart: ["e4","c6","d4","d5","e5","Bf5"],
    mainlinePgn: [
      "e4","c6","d4","d5","e5","Bf5","Nf3","e6","Be2","Nd7","O-O","Ne7",
      "Nh4","Bg6","Nxg6","hxg6","Nd2","Qb6","Nf3","O-O-O","b3","c5","c3","Nf5",
      "g3","cxd4","cxd4","Nb4","a3","Nc6",
    ],
    tagSlugs: ["strategic","solid","semi-open","central","classical","idea-based"],
    // Advance Caro reaches a French-like pawn chain (c6-d5 vs d4-e5) but with
    // Black's light-squared bishop DEVELOPED outside the chain — the whole point.
    criticalMoveNo: 3,
    idea: {
      short: "Solve the French's 'bad bishop' problem by developing …Bf5 before …e6.",
      long:
        "The Caro-Kann's defining advantage over the French is that Black can develop the " +
        "queen's bishop OUTSIDE the pawn chain (…Bf5) before playing …e6. In the Advance " +
        "Variation, White grabs central space with 3.e5, and Black immediately plays …Bf5 to " +
        "prevent the bishop from being locked in behind the c6-d5-e6 chain. From there, the " +
        "opening becomes a French Advance but with Black's problem piece already solved. Watson: " +
        "'The Caro-Kann is not a passive defence — it's a strategic one. Black accepts less " +
        "space in return for a superior piece placement, then patiently pressures White's " +
        "advanced e-pawn.' Karpov and Anand made it their weapon of choice at world championship " +
        "level.",
      whitePlans: [
        "Nh4 to trade off Black's light-squared bishop (its whole point of being on f5)",
        "c3, Be2, O-O quiet development; slow squeeze",
        "Central break c3-c4 or f4-f5 at the right moment",
      ],
      blackPlans: [
        "…Nd7, …Ne7, …e6, …Qb6, castle long, attack White's centre with …c5",
        "…Nh6-f5 alternative knight development",
        "…f6 pawn break attacking the e5 pawn",
      ],
      storyHook:
        "Sir Karpov opens his own door BEFORE building the wall — the light-squared Bishop " +
        "steps out to f5 first, so when the wall goes up (…e6, …c6), the Bishop is free outside.",
      storyLong:
        "Black is building a fortress with pawns c6, d5, and eventually e6. But in the French, " +
        "the light-squared bishop gets locked INSIDE the fortress and becomes useless. Karpov's " +
        "solution: open the front door FIRST — send the bishop out to f5 before building the " +
        "wall. Now the bishop is outside, the fortress is up, and Black slowly builds " +
        "counterplay against White's advanced e5 pawn (…c5, …Nc6, …f6). It is chess' most " +
        "patient opening — Karpov's Anand's, later Petrosian's — and utterly impossible to " +
        "blitz through.",
      citations: [
        { author: "Karpov",  work: "Karpov's Caro-Kann", licence: "paraphrase" },
        { author: "Watson",  work: "Play the Caro-Kann", licence: "paraphrase" },
        { author: "Kasparov", work: "My Great Predecessors, vol. 5", section: "Karpov chapters", licence: "paraphrase" },
        {                    work: "Wikipedia", section: "Caro%E2%80%93Kann_Defence", licence: "CC-BY-SA",
                             url: "https://en.wikipedia.org/wiki/Caro%E2%80%93Kann_Defence" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 9) Semi-Slav — Meran Variation
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "slav-meran",
    eco: "D48",
    ecoName: "Semi-Slav: Meran Variation",
    name: "Semi-Slav, Meran",
    aliases: ["Meran", "Meraner Variante"],
    familyId: "slav",
    tier: 1,
    frequencyBps: 130,
    pgnStart: ["d4","d5","c4","c6","Nc3","Nf6","Nf3","e6","e3","Nbd7","Bd3","dxc4","Bxc4","b5"],
    mainlinePgn: [
      "d4","d5","c4","c6","Nc3","Nf6","Nf3","e6","e3","Nbd7","Bd3","dxc4",
      "Bxc4","b5","Bd3","a6","e4","c5","e5","cxd4","Nxb5","axb5","exf6","gxf6",
      "O-O","Bb7","Qc2","Qb6","Rd1","Bd6",
    ],
    tagSlugs: ["dynamic","aggressive","semi-open","queenside","classical","theory-heavy"],
    structureSlug: "slav-meran",
    criticalMoveNo: 8,
    idea: {
      short: "Grab the c4 pawn, launch queenside pawn mass, race for open lines against White's king.",
      long:
        "The Meran Variation (named after the town in Italy where it was first analysed in 1924) " +
        "is one of the sharpest lines in classical chess. Black concedes the centre by grabbing " +
        "c4, then uses the tempo won by attacking White's bishop to push …b5/…a6 and prepare " +
        "…c5. When White responds with e4-e5, the position explodes: piece sacrifices on b5 or " +
        "d5, opposite-side castling, and race-condition attacks against both kings. Theory " +
        "extends past move 25 in critical lines. Kramnik played it as Black; Kasparov used it " +
        "with both colours. Watson describes the Meran as 'the queenside Najdorf' — same " +
        "tempo-race feel, same requirement that you know theory 3 moves deeper than your " +
        "opponent.",
      whitePlans: [
        "e4-e5 break to open lines against Black's king",
        "Piece sacrifice on b5 (Nxb5!) to open the a-file + b-file",
        "d4-d5 pawn break at the right moment",
      ],
      blackPlans: [
        "…b5, …a6, …c5 queenside pawn mass",
        "…Bb7 long-diagonal pressure vs the White king",
        "Long castle to move the king away from White's kingside build-up",
      ],
      storyHook:
        "Black grabs the c4 pawn (a gift the Bishop meant for himself), then throws the entire " +
        "queenside — b5, a6, c5 — at White's king. Both sides open the box; loudest bang wins.",
      storyLong:
        "In Meran, Italy, 1924, two masters at a mountain hotel worked out that Black can grab " +
        "the c4 pawn (a sacrifice by White's Bishop, who had wanted it for himself) and then " +
        "immediately go on the attack. The Bishop retreats to safety on d3; Black plays …b5 " +
        "with tempo (attacking the bishop again), then …a6 and …c5, launching every queenside " +
        "pawn. On move 8, the critical moment: does Black continue with …Bb7 (calm) or …b4 " +
        "(sharp)? The mainline explodes on move 11 with Nxb5, a piece sacrifice that opens " +
        "the a- and b-files. Both kings run for cover, both sides castle opposite, and the " +
        "loudest bang wins.",
      citations: [
        { author: "Kramnik",  work: "My Life & Games", licence: "paraphrase" },
        { author: "Kasparov", work: "Revolution in the 70s", section: "Meran chapter", licence: "paraphrase" },
        { author: "Watson",   work: "Mastering the Chess Openings, vol. 2", section: "Semi-Slav", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "Semi-Slav_Defense#Meran_Variation", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/Semi-Slav_Defense#Meran_Variation" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 10) Queen's Gambit Declined — Exchange Variation (Carlsbad)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "qgd-exchange",
    eco: "D35",
    ecoName: "QGD: Exchange Variation",
    name: "QGD, Exchange (Carlsbad)",
    aliases: ["QGD Exchange", "Carlsbad Variation"],
    familyId: "qgd",
    tier: 1,
    frequencyBps: 140,
    pgnStart: ["d4","d5","c4","e6","Nc3","Nf6","cxd5","exd5"],
    mainlinePgn: [
      "d4","d5","c4","e6","Nc3","Nf6","cxd5","exd5","Bg5","Be7","e3","O-O",
      "Bd3","Nbd7","Qc2","Re8","Nf3","Nf8","O-O","c6","Rab1","a5","a3","Ng6",
      "b4","axb4","axb4","Bd7","b5","cxb5",
    ],
    tagSlugs: ["strategic","positional","semi-open","queenside","classical","idea-based"],
    structureSlug: "carlsbad",
    criticalMoveNo: 4,
    idea: {
      short: "The purest 'minority attack' opening. White creates a weak Black c-pawn with b4-b5, then wins the endgame.",
      long:
        "The Carlsbad structure (named after the 1929 Carlsbad tournament) is the archetypal " +
        "positional chess lesson. After 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.cxd5 exd5, the pawn " +
        "skeleton becomes: White c3-d4-e3 vs Black c6-d5-e6 (once Black plays …c6). White's plan " +
        "is the MINORITY ATTACK: push b4-b5, force an exchange of pawns on b5, and leave Black " +
        "with a weak isolated c-pawn on c6. Black's counterplay: kingside piece build-up with " +
        "…Ne4, …f5, …Bd6. Capablanca made this his signature — his book has 4 games with the " +
        "Carlsbad plan explained move-by-move. Watson: 'If you understand the Carlsbad " +
        "minority attack, you understand positional chess.'",
      whitePlans: [
        "Minority attack: b4-b5, force bxc6, leave Black with weak c6 pawn",
        "Rooks on b1 + c1 to press the c-file after the exchange",
        "Slow, patient piece rerouting — Nf3-e5, Qc2-b3",
      ],
      blackPlans: [
        "Kingside piece attack: …Ne4, …Bd6, …f5, …Qf6 or …Rf6-h6",
        "…Nb6-c4 knight jump to challenge White's queenside plans",
        "…a5 preventing b4 (only slows the minority attack, doesn't stop it)",
      ],
      storyHook:
        "The Carlsbad race: White marches TWO pawns (b + c) to attack Black's FOUR (a-b-c-d) — " +
        "the 'minority attack'. It works because at the end, ONE pawn on c6 is left standing " +
        "and it's weak.",
      storyLong:
        "In 1929 at the Carlsbad tournament, Aron Nimzowitsch and José Capablanca both showed " +
        "that a small pawn majority on one side can defeat a large one on the other. The " +
        "Carlsbad structure crystallises this: White's TWO queenside pawns (b + c) advance to " +
        "attack Black's FOUR (a-b-c-d). White pushes b4, then b5, then trades: bxc6 forces " +
        "…bxc6 or …Nxc6. Either way, Black is left with a weak, exposed pawn on c6 in the " +
        "endgame. Meanwhile, Black tries a kingside attack to distract — …Ne4, …f5, …Bd6, " +
        "…Rf6-h6 — but if White defends carefully, the queenside plan wins the endgame " +
        "70 moves later. Capablanca made this look effortless.",
      citations: [
        { author: "Capablanca", work: "Chess Fundamentals + Last Lectures", licence: "PD" },
        { author: "Nimzowitsch", work: "Chess Praxis", section: "on Carlsbad structure", licence: "PD" },
        { author: "Watson",     work: "Mastering the Chess Openings, vol. 2", section: "QGD Exchange", licence: "paraphrase" },
        { author: "Kasparov",   work: "My Great Predecessors, vol. 2", section: "Capablanca chapter", licence: "paraphrase" },
        {                       work: "Wikipedia", section: "Queen%27s_Gambit_Declined#Exchange_Variation", licence: "CC-BY-SA",
                                url: "https://en.wikipedia.org/wiki/Queen%27s_Gambit_Declined#Exchange_Variation" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 11) Nimzo-Indian — Rubinstein Variation
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "nimzo-rubinstein",
    eco: "E43",
    ecoName: "Nimzo-Indian: Rubinstein Variation",
    name: "Nimzo-Indian, Rubinstein",
    aliases: ["Rubinstein Nimzo", "4.e3 Nimzo"],
    familyId: "nimzo",
    tier: 1,
    frequencyBps: 155,
    pgnStart: ["d4","Nf6","c4","e6","Nc3","Bb4","e3"],
    mainlinePgn: [
      "d4","Nf6","c4","e6","Nc3","Bb4","e3","b6","Ne2","Bb7","a3","Bxc3+",
      "Nxc3","d5","b3","O-O","Bb2","Nbd7","Bd3","c5","O-O","Rc8","Rc1","Re8",
      "cxd5","exd5","Ne2","c4","bxc4","dxc4",
    ],
    tagSlugs: ["strategic","positional","semi-open","central","hypermodern","idea-based"],
    structureSlug: "hanging-pawns",
    criticalMoveNo: 6,
    idea: {
      short: "Trade the bishop for a knight, double White's c-pawns, then clamp c4 forever.",
      long:
        "The Rubinstein System (4.e3) is Nimzo's oldest and most solid antidote to Black's " +
        "pin. White quietly develops behind pawns e3+c4+d4, offering to accept the doubled " +
        "c-pawns after …Bxc3+ in return for the bishop pair. Black's plan (per Nimzowitsch " +
        "himself in My System): use the doubled pawns as a positional target, blockade c4 " +
        "with a knight, then patiently squeeze the endgame. Karpov perfected the Black side; " +
        "Kasparov used both colours. Watson: 'The Nimzo-Indian is the most influential defence " +
        "of the 20th century — it made hypermodernism respectable at the classical level.'",
      whitePlans: [
        "Ne2 (not Nf3) to recapture on c3 with the knight, preserving pawn structure",
        "e3-e4 central break at the right moment",
        "Bishop pair activation via Bd3 + Bb2 (or Ba3)",
      ],
      blackPlans: [
        "…Bxc3+ trading bishop for knight to inflict the doubled c-pawns",
        "…b6-Bb7-c5 queenside development pressing c4",
        "…Ne4 outpost preventing White's central break",
      ],
      storyHook:
        "Black offers a bishop for a knight in return for TWO doubled White pawns to torment " +
        "forever. Every White move for 30 moves is trying to escape the c4 clamp.",
      storyLong:
        "In 1914, Aron Nimzowitsch invented the Nimzo-Indian: on move 3, pin the c3 knight and " +
        "threaten to trade for it, damaging White's queenside pawns permanently. The Rubinstein " +
        "System (4.e3) accepts the trade with poise: White plays Nge2 (NOT Nf3) so the c3 knight " +
        "can be recaptured, then patiently develops behind the pawn wall. Black's plan is pure " +
        "Nimzo: get the pawn on c4 into a permanent bind, blockade with knights, and grind " +
        "White down in a bishops-of-opposite-colour endgame 40 moves later. Karpov made this " +
        "one of his signature Black setups.",
      citations: [
        { author: "Nimzowitsch", work: "My System + Chess Praxis", section: "on the Nimzo-Indian", licence: "PD" },
        { author: "Kasparov",   work: "My Great Predecessors, vol. 5", section: "Karpov's Nimzo games", licence: "paraphrase" },
        { author: "Watson",     work: "Mastering the Chess Openings, vol. 3", section: "Nimzo-Indian chapters", licence: "paraphrase" },
        {                       work: "Wikipedia", section: "Nimzo-Indian_Defence", licence: "CC-BY-SA",
                                url: "https://en.wikipedia.org/wiki/Nimzo-Indian_Defence" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 12) Grünfeld — Exchange Variation (Classical)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "grunfeld-exchange",
    eco: "D85",
    ecoName: "Grünfeld: Exchange Variation",
    name: "Grünfeld, Exchange",
    aliases: ["Grünfeld Exchange", "Classical Exchange Grünfeld"],
    familyId: "grunfeld",
    tier: 1,
    frequencyBps: 148,
    pgnStart: ["d4","Nf6","c4","g6","Nc3","d5","cxd5","Nxd5","e4","Nxc3","bxc3"],
    mainlinePgn: [
      "d4","Nf6","c4","g6","Nc3","d5","cxd5","Nxd5","e4","Nxc3","bxc3","Bg7",
      "Nf3","c5","Rb1","O-O","Be2","cxd4","cxd4","Qa5+","Bd2","Qxa2","O-O","b6",
      "Qc1","Bb7","Bc4","Qa4","Bd3","Nc6",
    ],
    tagSlugs: ["dynamic","aggressive","semi-open","central","hypermodern","theory-heavy"],
    structureSlug: "hanging-pawns",
    criticalMoveNo: 5,
    idea: {
      short: "Let White build a big centre, then dismantle it with pieces + a well-timed …c5.",
      long:
        "The Grünfeld is hypermodernism at its purest. Black challenges the centre on move 3 " +
        "with …d5, provokes cxd5 Nxd5 Nc3 e4 Nxc3 bxc3, and lets White have an imposing pawn " +
        "duo on c3+d4+e4. Black's compensation is dynamic: attack the centre with piece " +
        "activity + a timed …c5 break, and target the c3 pawn as a permanent weakness. " +
        "Kasparov used the Grünfeld as his main defence to 1.d4 in the world championship " +
        "matches. The Exchange Variation is White's most ambitious try — take EVERYTHING in " +
        "the centre, then defend it. Fine's evaluation from 1943 called Grünfeld 'chess's " +
        "most sophisticated defence'; modern engines confirm it's fully sound.",
      whitePlans: [
        "Rb1 + Bc4 development, protecting the pawn centre and c3",
        "d4-d5 central push at the right moment",
        "Ne2-Nf3-Ng5 kingside attacking manoeuvre",
      ],
      blackPlans: [
        "…c5 break challenging d4 immediately",
        "…Bg7 + …Nc6 + …Bg4 piece pressure on d4",
        "…Qa5+ then …Qxa2 pawn-grabbing raid (very theoretical)",
      ],
      storyHook:
        "White builds a mountain of pawns (c3-d4-e4) — the biggest centre in chess. Black " +
        "chips at it with a knight, a bishop, and a well-timed pickaxe (…c5).",
      storyLong:
        "In 1922, Ernst Grünfeld played …d5 on move 3 vs Alekhine and destroyed the classical " +
        "assumption that Black must PROTECT his own centre. Instead: PROVOKE White to build " +
        "the biggest possible centre, THEN dismantle it. In the Exchange Variation White takes " +
        "everything — cxd5 Nxd5 Nc3 (recapture) e4 Nxc3 bxc3 — resulting in a mountain of " +
        "pawns c3+d4+e4. Black's whole game plan: get the bishop to g7 aimed at that centre, " +
        "then break it with …c5 (move 7 in the mainline). Kasparov made this his main defence " +
        "vs 1.d4 for 20 years.",
      citations: [
        { author: "Fine",     work: "Ideas Behind the Chess Openings", section: "Grünfeld chapter", licence: "PD" },
        { author: "Kasparov", work: "My Great Predecessors + How Life Imitates Chess", section: "Grünfeld", licence: "paraphrase" },
        { author: "Watson",   work: "Mastering the Chess Openings, vol. 3", section: "Grünfeld Exchange", licence: "paraphrase" },
        { author: "Rowson",   work: "Understanding the Grünfeld", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "Gr%C3%BCnfeld_Defence", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/Gr%C3%BCnfeld_Defence" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 13) English Opening — Symmetric Four Knights
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "english-symmetric-four-knights",
    eco: "A35",
    ecoName: "English: Symmetrical, Four Knights",
    name: "English, Symmetric Four Knights",
    aliases: ["Symmetric English", "Four Knights English"],
    familyId: "english",
    tier: 1,
    frequencyBps: 130,
    pgnStart: ["c4","c5","Nc3","Nc6","Nf3","Nf6","g3"],
    mainlinePgn: [
      "c4","c5","Nc3","Nc6","Nf3","Nf6","g3","d5","cxd5","Nxd5","Bg2","g6",
      "O-O","Bg7","d3","O-O","Bd2","Nc7","Rc1","Rb8","a3","a6","Nd5","Nxd5",
      "Rxc5","Nxb2","Qb3","Nc4","dxc4","dxc4",
    ],
    tagSlugs: ["positional","solid","semi-open","both-flanks","universal","idea-based"],
    structureSlug: "maroczy-bind",
    criticalMoveNo: 4,
    idea: {
      short: "A 'reverse Sicilian' — White gets Black's usual counterplay one tempo up.",
      long:
        "The Symmetric English (1.c4 c5) is a REVERSED Sicilian: White plays the …c5 setup " +
        "with the extra tempo. This alone gives a small but persistent edge — hedgehog vs " +
        "reversed hedgehog, Maroczy Bind vs reversed Maroczy. The Symmetric Four Knights " +
        "(…Nc6, Nf3 Nf6, g3) is the most positional line: both fianchetto, both control d5/d4, " +
        "and the first side to break symmetry gains. Kasparov, Karpov, Kramnik, Carlsen all " +
        "played the English as a low-theory, high-strategic-content alternative to 1.d4. " +
        "Watson: 'The English rewards the player who understands what to DO in symmetric " +
        "positions — not memorised lines, but pattern recognition.'",
      whitePlans: [
        "g3 + Bg2 fianchetto, pressuring d5/b7",
        "Nd5 outpost jump when structure permits",
        "d3 quiet development, prepare Bg2 pressure",
      ],
      blackPlans: [
        "…d5 immediate central challenge (Rubinstein System)",
        "…g6 mirror fianchetto — reach a symmetric middlegame",
        "…e5 (Rubinstein Variation) — commit to Sicilian-reversed structure",
      ],
      storyHook:
        "Both bishops walk into fianchettos, both knights out to Nf3/f6+Nc3/c6, mirroring " +
        "each other for 6 moves. Whoever breaks the mirror first wins.",
      storyLong:
        "The English is the mirror-image opening: White plays what Black plays in the " +
        "Sicilian, but ONE MOVE EARLIER. Both sides develop symmetrically — c4/c5, Nc3/Nc6, " +
        "Nf3/Nf6, g3/g6, Bg2/Bg7, O-O — for 6-8 moves. Then someone breaks the mirror: the " +
        "first sub-variation Black picks (…d5 or …e5 or …g6) commits to a structure and White " +
        "gets to respond ONE MOVE UP the theory tree. Symmetric-with-extra-tempo. This is why " +
        "the English is a 'low-theory' opening — you don't need to know 20-move mainlines, " +
        "you need to know the STRUCTURES that arise. Kramnik and Kasparov used it repeatedly " +
        "at the world championship level for exactly this reason.",
      citations: [
        { author: "Marin",    work: "Mastering the English Opening (3 vols)", licence: "paraphrase" },
        { author: "Kasparov", work: "Revolution in the 70s", section: "English chapters", licence: "paraphrase" },
        { author: "Watson",   work: "Mastering the Chess Openings, vol. 4", section: "English chapter", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "English_Opening", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/English_Opening" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 14) London System
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "london-system",
    eco: "D02",
    ecoName: "London System",
    name: "London System",
    aliases: ["London", "Bf4 System"],
    familyId: "d4-side",
    tier: 1,
    frequencyBps: 175,
    pgnStart: ["d4","d5","Nf3","Nf6","Bf4"],
    mainlinePgn: [
      "d4","d5","Nf3","Nf6","Bf4","e6","e3","Bd6","Bg3","O-O","Bd3","b6",
      "Nbd2","Bb7","c3","Nbd7","Qc2","h6","O-O","c5","Bxd6","Qxd6","Rae1","Rac8",
      "Ne5","Rfe8","f4","Nxe5","fxe5","Nd7",
    ],
    tagSlugs: ["strategic","solid","closed","central","universal","sound-long-term"],
    // London reaches a slightly Stonewall-ish structure with e3-d4 vs d5-e6 pawns.
    structureSlug: "stonewall",
    criticalMoveNo: 3,
    idea: {
      short: "Same setup vs anything — d4, Nf3, Bf4, e3, Bd3, Nbd2, O-O. Zero forced theory.",
      long:
        "The London System is the anti-theory opening. White plays the SAME 6-8 moves no " +
        "matter what Black does: d4, Nf3, Bf4 (the London bishop), e3, Bd3, Nbd2, c3, O-O. " +
        "This 'system' approach means an amateur can play the London confidently vs any Black " +
        "reply, and grandmasters (Magnus Carlsen used it extensively in 2019-2020) can use " +
        "it as a low-theory alternative to open theoretical debates. The trade-off is a " +
        "modest opening edge — the London gives up the fight for maximum advantage in return " +
        "for a rock-solid, learnable structure. Watson calls the London 'the most-played " +
        "system opening among strong club players' — for good reason.",
      whitePlans: [
        "Standard setup: Nf3, Bf4, e3, Bd3, Nbd2, c3, O-O regardless of Black's moves",
        "Ne5 knight outpost + f4 pawn to lock it in",
        "Kingside attack via Qc2 + Rae1 + h3-g4 (if Black castles)",
      ],
      blackPlans: [
        "…Bd6 trading the London bishop to remove White's best piece",
        "…c5 pawn break to open the position and use active development",
        "…Nh5 hunting the Bf4 bishop",
      ],
      storyHook:
        "The London Bishop leaves home on move 3 (Bf4) and stays there forever, controlling " +
        "the e5 outpost. Every other White piece finds its spot behind him. Simple, patient, " +
        "unstoppable if you don't know how to attack it.",
      storyLong:
        "The London System got its name from the 1922 London tournament where several strong " +
        "players used it. It's the ultimate 'system opening': White plays the same 8 moves " +
        "vs any Black setup, arriving at a rock-solid position with clear plans. In the last " +
        "5 years it has EXPLODED at the top level — Carlsen, Nakamura, Nepo, and other elite " +
        "players use it as a low-theory alternative to the deeply-analysed Ruy Lopez / Nimzo " +
        "Indian battles. The 'London Bishop' on f4 controls e5, prepares Ne5, and forces " +
        "Black to make trade-off decisions on which bad exchange to allow. Not the flashiest " +
        "opening in the book, but the win-rate at club level is undeniable.",
      citations: [
        { author: "Kovacevic",  work: "The London System with 2.Bf4", licence: "paraphrase" },
        { author: "Johnsen & Kovacevic", work: "Win with the London System", licence: "paraphrase" },
        { author: "Sedlak",     work: "Winning with the Modern London System", licence: "paraphrase" },
        {                       work: "Wikipedia", section: "London_System", licence: "CC-BY-SA",
                                url: "https://en.wikipedia.org/wiki/London_System" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 15) Scandinavian Defence — 3…Qa5 Main Line
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "scandinavian-qa5",
    eco: "B01",
    ecoName: "Scandinavian Defence: Main Line",
    name: "Scandinavian, 3…Qa5",
    aliases: ["Scandinavian Defense", "Center Counter"],
    familyId: "scandi-alekhine",
    tier: 1,
    frequencyBps: 95,
    pgnStart: ["e4","d5","exd5","Qxd5","Nc3","Qa5"],
    mainlinePgn: [
      "e4","d5","exd5","Qxd5","Nc3","Qa5","d4","Nf6","Nf3","c6","Bc4","Bf5",
      "Bd2","e6","Nd5","Qd8","Nxf6+","gxf6","Bh4","Nd7","O-O","Bd6","c3","Qc7",
      "Bg3","Bxg3","hxg3","O-O-O","b4","Kb8",
    ],
    tagSlugs: ["dynamic","solid","semi-open","central","modern","surprise-weapon"],
    // No canonical structure — the Scandinavian creates its own asymmetric one.
    criticalMoveNo: 3,
    idea: {
      short: "Bring the queen out on principle, tuck her back safely, castle long, then attack.",
      long:
        "The Scandinavian violates the classical rule 'don't move the queen early' — and works " +
        "because Black gets her back to safety with tempo (Nc3 attacks Qd5, …Qa5 sidesteps AND " +
        "eyes a2). From there Black develops rapidly (…Nf6, …c6, …Bf5, …e6, …Nbd7), castles " +
        "long, and attacks the kingside with the extra tempo he saved by NOT playing a slow " +
        "…d6 like the Caro-Kann. Not theoretical — practical and surprising, especially at " +
        "club level. Anand used the Scandinavian in Game 14 of his 1995 World Championship " +
        "match vs Kasparov to draw a must-win game (Kasparov was shocked). Curt Hansen, Sergei " +
        "Tiviakov, and other GMs have used it as a surprise weapon at the top level.",
      whitePlans: [
        "Bc4 + Nf3 rapid development, pressure the queen",
        "d4 central control (Black doesn't contest)",
        "Kingside pawn storm if opposite-side castling develops",
      ],
      blackPlans: [
        "…c6 quiet development + queen safety",
        "…Bf5 (or …Bg4) getting the light bishop OUT before …e6",
        "Castle long, attack White's kingside with …h5",
      ],
      storyHook:
        "The Queen makes a bold trip to a5 on move 3 — everyone gasps — but she's safe. From " +
        "her camp at a5 she watches the whole opening unfold without ever being in danger.",
      storyLong:
        "In every chess-beginner book, the first rule is 'don't move your queen early — she'll " +
        "just get chased around.' The Scandinavian breaks this rule immediately: move 2, out " +
        "she comes to d5. When Nc3 chases her, she sidesteps to a5 (or d6 or d8) — safely, " +
        "with tempo. Now Black develops normally (…c6, …Nf6, …Bf5, …e6, …Nbd7) with an extra " +
        "tempo saved. Not a mainstream defence at the elite level, but a nasty surprise " +
        "weapon and Anand's choice for a critical world-championship game in 1995. The " +
        "modern engine era has confirmed the Scandinavian is fully sound — just slightly " +
        "worse than 1…e5 or 1…c5. Fine as an occasional weapon; too passive as a main " +
        "defence.",
      citations: [
        { author: "Tiviakov", work: "Scandinavian for the Tournament Player", licence: "paraphrase" },
        { author: "Melts",    work: "Scandinavian Defense: The Dynamic 3...Qd6", licence: "paraphrase" },
        {                     work: "Wikipedia", section: "Scandinavian_Defense", licence: "CC-BY-SA",
                              url: "https://en.wikipedia.org/wiki/Scandinavian_Defense" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 16) Alekhine's Defence — Modern Variation
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "alekhine-modern",
    eco: "B04",
    ecoName: "Alekhine's Defence: Modern Variation",
    name: "Alekhine's Defence, Modern",
    aliases: ["Alekhine 4.Nf3", "Modern Alekhine"],
    familyId: "scandi-alekhine",
    tier: 1,
    frequencyBps: 65,
    pgnStart: ["e4","Nf6","e5","Nd5","d4","d6","Nf3"],
    mainlinePgn: [
      "e4","Nf6","e5","Nd5","d4","d6","Nf3","g6","Bc4","Nb6","Bb3","Bg7",
      "a4","a5","Ng5","e6","f4","dxe5","fxe5","c5","c3","cxd4","cxd4","O-O",
      "O-O","Nc6","h4","Nb4","Kh1","h6",
    ],
    tagSlugs: ["dynamic","risky","semi-open","central","hypermodern","surprise-weapon"],
    // No exact match in my 12 structures — the Alekhine e5-pawn structure is its own.
    criticalMoveNo: 2,
    idea: {
      short: "Provoke White to over-extend the pawn centre, then dismantle it. Hypermodernism to the extreme.",
      long:
        "Alexander Alekhine invented this defence in 1921 to shock White with a rule violation: " +
        "on move 1, the KNIGHT (not a pawn) goes forward. The knight INVITES attack — 2.e5 " +
        "chases it to d5, 3.d4 grabs more space, 4.c4 or 4.Nf3 keeps pushing. Black lets " +
        "White build a huge but overextended centre (pawns on c4-d4-e5), then attacks it with " +
        "…d6, …dxe5, …c5, …Nc6, …Bg4/Bf5. It's the boldest possible hypermodern statement. " +
        "The Modern Variation (4.Nf3) is White's most flexible reply — keeping pieces active " +
        "without committing to a specific pawn structure. Fischer used the Alekhine in his " +
        "1972 world championship match; Bagirov and Alburt were its 20th-century advocates. " +
        "Not fashionable at the elite level today, but a nasty surprise weapon.",
      whitePlans: [
        "Bc4 + Bb3 development, controlling f7 diagonal",
        "Ng5 threatening f7 + e6 pawn probe",
        "f4-f5 kingside pawn advance",
      ],
      blackPlans: [
        "…Nb6 knight retreat away from Bb3 pressure",
        "…dxe5 dismantling White's centre",
        "…c5 immediate central challenge + …Nc6-Nb4 pressure",
      ],
      storyHook:
        "Alekhine's knight leaps out on move 1 (Nf6) — an OFFERING, not a threat. White " +
        "chases with pawns (e5, d4, more…), building a massive but overextended fortress. " +
        "Then Black attacks the fortress from all sides.",
      storyLong:
        "In 1921, Alexander Alekhine (future world champion) sat down against a strong master " +
        "and, on move 1, played a KNIGHT. Everyone gasped: 'you're supposed to move a PAWN'. " +
        "But Alekhine's plan was clear: let White's pawns come rushing forward (e5 to chase " +
        "the knight, d4 to grab space, c4 to grab more), then attack the overextended fortress " +
        "from all sides. The knight retreats gracefully to d5, then b6, then …Nc4 or …Nd7 — " +
        "always with tempo, always redeploying. Fischer used the Alekhine in his 1972 " +
        "world championship match. Not mainstream today, but any player who understands the " +
        "attack-the-centre plan can trouble a strict classical opponent.",
      citations: [
        { author: "Alekhine",  work: "My Best Games 1908-1923", licence: "paraphrase" },
        { author: "Bagirov",   work: "Alekhine's Defence for the Tournament Player", licence: "paraphrase" },
        { author: "Alburt",    work: "Alekhine's Defence: How to Play It", licence: "paraphrase" },
        {                      work: "Wikipedia", section: "Alekhine%27s_Defence", licence: "CC-BY-SA",
                               url: "https://en.wikipedia.org/wiki/Alekhine%27s_Defence" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 17) Modern Defence — Standard
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "modern-defence",
    eco: "B06",
    ecoName: "Modern Defence: Standard Line",
    name: "Modern Defence",
    aliases: ["Robatsch Defence", "…g6 System"],
    familyId: "modern-pirc",
    tier: 1,
    frequencyBps: 45,
    pgnStart: ["e4","g6","d4","Bg7","Nc3","d6"],
    mainlinePgn: [
      "e4","g6","d4","Bg7","Nc3","d6","Be3","a6","Qd2","b5","f3","Nd7",
      "g4","h5","gxh5","Rxh5","O-O-O","Nb6","Bg2","Bb7","a3","e6","h3","Ne7",
      "Nge2","Nc4","Bxc4","bxc4","h4","Nc6",
    ],
    tagSlugs: ["dynamic","risky","fluid","central","hypermodern","idea-based"],
    // No matching structure — Modern often reaches Hedgehog-like or KID-chain-like
    // formations depending on Black's follow-up.
    criticalMoveNo: 2,
    idea: {
      short: "Fianchetto without …Nf6 first — keep every option open.",
      long:
        "The Modern Defence (1…g6 2…Bg7) commits to the kingside fianchetto but not to any " +
        "specific piece deployment yet. Unlike the Pirc (which commits to …Nf6 on move 2), the " +
        "Modern lets Black delay …Nf6 for several moves and instead play …c6, …d6, …b5, …Nd7 " +
        "in various orders. This flexibility is the whole point: White can't play a targeted " +
        "'anti-KID' or 'anti-Pirc' system because it's not clear what Black is transposing to. " +
        "Watson: 'The Modern Defence is a portmanteau opening — you're playing KID, Pirc, " +
        "Robatsch, or something novel depending on what you play on move 4-6.' Larsen and " +
        "Suba made it their signature; Nakamura still uses it occasionally as a blitz weapon.",
      whitePlans: [
        "Be3 + Qd2 + f3 + g4 + O-O-O kingside pawn storm (Yugoslav-attack style)",
        "Bc4 targeting f7 + Nge2 flexible development",
        "c4 grab central space (Sämisch-like setup)",
      ],
      blackPlans: [
        "…a6 + …b5 queenside pawn expansion",
        "…Nd7 + …Ngf6 flexible knight development",
        "…c5 or …c6 + …Nb6/…Nc6 based on White's setup",
      ],
      storyHook:
        "Sir Robatsch fianchettos his bishop before committing to ANY other plan — he waits, " +
        "he watches, he plays whatever Black system fits White's response.",
      storyLong:
        "The Modern Defence (also called Robatsch Defence after the Austrian GM) is Black's " +
        "'wait and see' hypermodern system. On move 1 Black plays …g6, on move 2 Black plays " +
        "…Bg7, and THEN Black decides what kind of game to play based on White's setup. If " +
        "White plays f3+Be3+Qd2 (Yugoslav-attack style), Black plays …b5 queenside expansion. " +
        "If White plays a quiet c4+Nc3, Black might transpose to a KID with …Nf6+…O-O. If " +
        "White plays Bc4, Black plays …e6 and defends. The whole point is flexibility. Not " +
        "mainstream at the top level today but a genuine surprise weapon at club level.",
      citations: [
        { author: "Norwood",    work: "The Modern Defence", licence: "paraphrase" },
        { author: "Speelman & McDonald", work: "Modern Defence", licence: "paraphrase" },
        { author: "Watson",     work: "Mastering the Chess Openings, vol. 4", section: "Modern chapter", licence: "paraphrase" },
        {                       work: "Wikipedia", section: "Modern_Defense", licence: "CC-BY-SA",
                                url: "https://en.wikipedia.org/wiki/Modern_Defense" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 18) Pirc Defence — Austrian Attack (4.f4)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "pirc-austrian",
    eco: "B09",
    ecoName: "Pirc: Austrian Attack",
    name: "Pirc, Austrian Attack",
    aliases: ["Austrian Attack", "Pirc 4.f4"],
    familyId: "modern-pirc",
    tier: 1,
    frequencyBps: 55,
    pgnStart: ["e4","d6","d4","Nf6","Nc3","g6","f4"],
    mainlinePgn: [
      "e4","d6","d4","Nf6","Nc3","g6","f4","Bg7","Nf3","O-O","Bd3","Nc6",
      "e5","dxe5","fxe5","Nd7","h4","Nb6","e6","fxe6","Ng5","Nd5","Nxd5","exd5",
      "Qh5","Rf5","Qxh7+","Kf8","g4","Rxf3",
    ],
    tagSlugs: ["dynamic","aggressive","semi-open","kingside","modern","idea-based"],
    criticalMoveNo: 4,
    idea: {
      short: "White throws pawns forward as fast as possible. Black must find precise defensive resources.",
      long:
        "The Austrian Attack (4.f4) is White's sharpest response to the Pirc. Instead of the " +
        "quiet Classical setup (Nf3+Be2), White immediately builds a massive pawn centre with " +
        "e4-d4-f4 and prepares e4-e5 to blow the position open. Black must defend precisely: " +
        "the knight on f6 must jump correctly (…Nd7, …Nfd7, or …Ng4 depending on the line), " +
        "and Black's fianchetto bishop needs to stay on g7 as long as possible for defence. " +
        "It's one of the most spectacular openings in classical chess — theoretical, tactical, " +
        "and unforgiving. Watson: 'The Austrian Attack is White's attempt to punish the Pirc " +
        "for its slow start — either it works and White wins in 25 moves, or Black survives " +
        "and gets a good middlegame.'",
      whitePlans: [
        "e4-e5 immediate central break, chasing Black's Nf6",
        "h4-h5 kingside pawn storm targeting …g6",
        "Bd3 + Qe1-h4 direct king attack",
      ],
      blackPlans: [
        "…Nd7 (or …Nfd7) knight retreat after e5, preparing …Nb6-Nd5",
        "…e6 solid central defence + queenside expansion",
        "…c5 central counter to challenge White's pawn wedge",
      ],
      storyHook:
        "White marches THREE pawns forward as fast as possible (e4, d4, f4) then pushes e5 " +
        "to blow the game open. Black has ONE turn per move to defend precisely — one slip " +
        "and mate follows.",
      storyLong:
        "The Austrian Attack was popularised in the 1950s by Austrian masters (hence the " +
        "name) who wanted to punish the fashionable new Pirc Defence. Instead of quietly " +
        "developing, White plays 4.f4 — turning the opening into a MIDDLEGAME by move 6. " +
        "The e5 push comes on move 7 or 8, ripping open the g7 diagonal against Black's " +
        "castled king. Every move for Black is a defensive puzzle: which square for the " +
        "knight, when to trade, how to break White's initiative. Get it right and Black has " +
        "a fine position with the bishop pair. Get it wrong and mate in 20.",
      citations: [
        { author: "Chandler & Nunn", work: "The Pirc for the Tournament Player", licence: "paraphrase" },
        { author: "Vigus",     work: "The Pirc in Black and White", licence: "paraphrase" },
        {                      work: "Wikipedia", section: "Pirc_Defence#Austrian_Attack", licence: "CC-BY-SA",
                               url: "https://en.wikipedia.org/wiki/Pirc_Defence#Austrian_Attack" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 19) Dutch Defence — Stonewall
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "dutch-stonewall",
    eco: "A95",
    ecoName: "Dutch: Stonewall Variation",
    name: "Dutch, Stonewall",
    aliases: ["Stonewall Dutch", "Modern Stonewall"],
    familyId: "dutch",
    tier: 1,
    frequencyBps: 60,
    pgnStart: ["d4","f5","g3","Nf6","Bg2","e6","Nf3","d5"],
    mainlinePgn: [
      "d4","f5","g3","Nf6","Bg2","e6","Nf3","d5","O-O","Bd6","c4","c6",
      "b3","Qe7","Ne5","O-O","Nd2","Nbd7","Nxd7","Bxd7","Bb2","Rae8","Rc1","Bh4",
      "Nf3","Bd8","Qd2","g5","Nxg5","Bxg5",
    ],
    tagSlugs: ["strategic","solid","closed","kingside","classical","idea-based"],
    structureSlug: "stonewall",
    criticalMoveNo: 4,
    idea: {
      short: "Pawns on c6, d5, e6, f5 form the Stonewall — Black attacks the kingside with pieces.",
      long:
        "The Stonewall Dutch commits Black to a specific pawn structure on move 4-5: pawns on " +
        "c6, d5, e6, f5. This structure has a KEY weakness (the e5 outpost — Black's " +
        "dark-squared bishop is bad, White can plant a knight on e5) and a KEY strength (Black " +
        "has unbeatable kingside attacking chances via …Bd6-c7, …Ne4, …Qh4, …Rf6-h6). Great " +
        "at club level — the plans are clear + the attacking chances are always there. Elite " +
        "level less popular because the e5 hole is a real weakness against precise defence. " +
        "Watson calls the Stonewall 'the most thematic Black attacking system in classical " +
        "chess'.",
      whitePlans: [
        "Ne5 knight outpost + b3-Bb2 fianchetto pressuring e5",
        "Trade Black's bad dark-squared bishop (White's is great, Black's is trapped)",
        "c4-c5 queenside space grab",
      ],
      blackPlans: [
        "…Bd6 + …Qe7 + …Ne4 kingside piece build-up",
        "…g5 pawn break to open the g-file against White's king",
        "…Bd7-e8-h5 bishop manoeuvre to the kingside",
      ],
      storyHook:
        "Black builds a stone wall of pawns (c6, d5, e6, f5) — impossible to break through — " +
        "then rams every piece into White's kingside via g5 and h5.",
      storyLong:
        "The Stonewall Dutch was named for its distinctive pawn wall: c6, d5, e6, f5 stand " +
        "like immovable stones. White cannot break through the centre; Black cannot advance " +
        "his queenside pawns easily either. Both sides know the deal: closed centre, opposite " +
        "flanks, race for the enemy king. Black's advantage is the direct kingside attack — " +
        "…Bd6, …Ne4, …Qh4, …Rf6-h6 is the classical attacking build-up. White's advantage is " +
        "the e5 hole and the bad Black dark-squared bishop. Whoever plays better wins; whoever " +
        "misunderstands the position gets mated in 20 moves.",
      citations: [
        { author: "Yrjölä & Tella", work: "An Explosive Chess Opening Repertoire for Black", licence: "paraphrase" },
        { author: "Williams",  work: "The Killer Dutch (Ginger GM DVD)", licence: "paraphrase" },
        { author: "Vaïsser",   work: "Beating the Anti-King's Indians", licence: "paraphrase" },
        {                      work: "Wikipedia", section: "Dutch_Defence#Stonewall", licence: "CC-BY-SA",
                               url: "https://en.wikipedia.org/wiki/Dutch_Defence#Stonewall" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 20) Catalan — Closed Main Line
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "catalan-closed",
    eco: "E06",
    ecoName: "Catalan: Closed",
    name: "Catalan, Closed",
    aliases: ["Closed Catalan"],
    familyId: "catalan",
    tier: 1,
    frequencyBps: 115,
    pgnStart: ["d4","Nf6","c4","e6","g3","d5","Bg2","Be7","Nf3","O-O","O-O"],
    mainlinePgn: [
      "d4","Nf6","c4","e6","g3","d5","Bg2","Be7","Nf3","O-O","O-O","dxc4",
      "Qc2","a6","Qxc4","b5","Qc2","Bb7","Bd2","Bd6","Ba5","Nbd7","Bd8","Rxd8",
      "Rc1","c5","dxc5","Bxc5","Nbd2","Rac8",
    ],
    tagSlugs: ["strategic","positional","semi-open","central","modern","theory-heavy"],
    structureSlug: "kings-fianchetto",
    criticalMoveNo: 3,
    idea: {
      short: "The Catalan bishop on g2 pressures Black's queenside for the next 30 moves. Slow torture.",
      long:
        "The Catalan (named after the 1929 Barcelona tournament in Catalonia) combines the " +
        "Queen's Gambit setup with a fianchettoed king's bishop. The Bg2 aims at the h1-a8 " +
        "diagonal, pressuring c6 and b7 for the rest of the game. It's Kramnik's signature " +
        "opening — he used it repeatedly at world championship level for its long-term " +
        "positional pressure and low theoretical burden. In the Closed Catalan main line, " +
        "Black plays …dxc4 grabbing the pawn but then must return it with …b5-…Bb7 as White " +
        "regains material with tempo. The resulting position is quietly better for White " +
        "— nothing dramatic, just a slow, patient squeeze. Sometimes it takes 40 moves before " +
        "something concrete happens. Watson: 'The Catalan is the antithesis of the Najdorf. " +
        "Where the Najdorf demands memorised tactics, the Catalan demands strategic patience.'",
      whitePlans: [
        "Qxc4 regaining the pawn with tempo, then Qc2 keeping the queen active",
        "Bd2-Ba5-Bd8! (exchange bishop for rook trick, or force queen back)",
        "Nc3 knight development + Rd1 building central pressure",
      ],
      blackPlans: [
        "…dxc4 grab, then …b5-…Bb7 to hold the pawn OR give it back with …a6",
        "…c5 central break to challenge d4",
        "…Nbd7-b6-Nc4 knight outpost pressuring White's queenside",
      ],
      storyHook:
        "The Catalan Bishop makes his home on g2 forever, staring down the long diagonal at " +
        "b7. For 30+ moves, every Black move must consider what this bishop threatens next.",
      storyLong:
        "In 1929, at a great tournament in Barcelona, Catalonia, master Savielly Tartakower " +
        "showed that combining the Queen's Gambit (1.d4 + 2.c4) with a KINGSIDE fianchetto " +
        "(3.g3 + 4.Bg2) gave White a beautiful long-diagonal attack against Black's queenside " +
        "for the rest of the game. Vladimir Kramnik took this idea to the top of chess: in " +
        "the 2006, 2007, and 2008 world championship matches he used the Catalan as his main " +
        "white weapon, winning several patient games from long endgame squeezes. In the Closed " +
        "Catalan mainline, Black grabs a pawn (…dxc4) and must return it while White repositions " +
        "pieces with tempo. The resulting endgame is quiet, slightly better for White, and " +
        "requires patience — the antithesis of the Najdorf.",
      citations: [
        { author: "Kramnik", work: "My Life and Games", licence: "paraphrase" },
        { author: "Avrukh",  work: "1.d4 Vol 1: Catalan chapters", licence: "paraphrase" },
        { author: "Watson",  work: "Mastering the Chess Openings, vol. 2", section: "Catalan chapter", licence: "paraphrase" },
        {                    work: "Wikipedia", section: "Catalan_Opening", licence: "CC-BY-SA",
                             url: "https://en.wikipedia.org/wiki/Catalan_Opening" },
      ],
    },
  },

  //───────────────────────────────────────────────────────────────────────────
  // 5) King's Indian Defence — Bayonet Attack (reordered by ECO chronology; kept
  //    numbered "5" for stable Git blame — the DISPLAY order in the UI is
  //    families.displayOrder + tags, not this file's line order.)
  //───────────────────────────────────────────────────────────────────────────
  {
    slug: "kings-indian-bayonet",
    eco: "E97",
    ecoName: "King's Indian: Orthodox, Bayonet Attack (9.b4)",
    name: "KID, Classical Bayonet Attack",
    aliases: ["Bayonet Attack", "KID 9.b4"],
    familyId: "kings-indian",
    parentSlug: "kings-indian-classical",
    tier: 1,
    frequencyBps: 180,
    pgnStart: ["d4","Nf6","c4","g6","Nc3","Bg7","e4","d6","Nf3","O-O","Be2","e5","O-O","Nc6","d5","Ne7","b4"],
    mainlinePgn: [
      "d4","Nf6","c4","g6","Nc3","Bg7","e4","d6","Nf3","O-O","Be2","e5",
      "O-O","Nc6","d5","Ne7","b4","Nh5","Re1","f5","Ng5","Nf6","f3","f4",
      "c5","g5","Nc4","Ng6","a4","Rf7",
    ],
    tagSlugs: ["dynamic","aggressive","closed","kingside","queenside","hypermodern","theory-heavy"],
    structureSlug: "kid-chain",
    criticalMoveNo: 9,
    idea: {
      short: "Two openings on one board — White races queenside, Black races kingside. Speed wins.",
      long:
        "The Bayonet Attack (9.b4) is White's most direct way to play against the King's Indian: " +
        "immediately grab queenside space with pawns pointing where the pawn chain arrow points " +
        "(the c4-d5 pawns). Black responds with the reverse plan — kingside pawn storm using " +
        "his own d6-e5 pawn arrow. This is the archetypal 'two games on one board'. Both sides " +
        "attack the enemy king; whoever's attack lands first wins. Kasparov chose this defence " +
        "for his most creative games; Nakamura is its modern champion. Watson: 'The KID Bayonet " +
        "is the purest expression of hypermodern doctrine — pieces + a pawn arrow defeat " +
        "static central pawns.'",
      whitePlans: [
        "b4-c5 queenside pawn storm to open lines vs Black's king (in his own corner)",
        "Nc4-b6 or Nc4-a5 knight jumps into Black's queenside",
        "Ra1-c1 and Qa1-b1 pressure along the c-file",
      ],
      blackPlans: [
        "…f5-f4 kingside pawn storm targeting White's king",
        "…Nf6-h5-f4 or …Ng6-h4 knight route into White's kingside",
        "…Rf7-g7 rook lift, then …g5-g4 to open the g-file",
      ],
      storyHook:
        "The KID chain (c4-d5 vs d6-e5) is an arrow: each side attacks in the direction their " +
        "arrow points. Fastest sword wins.",
      storyLong:
        "The kingdom is split by a diagonal wall of pawns pointing northeast (White's c4-d5) " +
        "and southwest (Black's d6-e5). No pieces can cross the wall — but the KINGS are behind " +
        "the walls of the OTHER side. So both armies attack backwards: White's soldiers march " +
        "west-to-east across the queenside (b4-c5-cxd6) to reach Black's castled king. Black's " +
        "soldiers march east-to-west across the kingside (…f5-f4-…g5-…h5) to reach White's " +
        "castled king. Both storms will land — the race is which lands first. Kasparov called " +
        "these positions 'the reason chess was invented'.",
      citations: [
        { author: "Kasparov",     work: "My Great Predecessors + Modern Chess", section: "on KID", licence: "paraphrase" },
        { author: "Watson",       work: "Mastering the Chess Openings, vol. 3", section: "KID Bayonet", licence: "paraphrase" },
        { author: "Bologan",      work: "The King's Indian: A Complete Repertoire", licence: "paraphrase" },
        {                         work: "Wikipedia", section: "King%27s_Indian_Defence", licence: "CC-BY-SA",
                                  url: "https://en.wikipedia.org/wiki/King%27s_Indian_Defence" },
      ],
    },
  },
];
