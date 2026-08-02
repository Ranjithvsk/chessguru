// Canonical pawn structures — the CHUNKS masters recognise instantly (De Groot
// 1965). Learn 12 structures well and dozens of openings become "reach this
// structure + do the standard plan". Each opening in openings.ts cross-refs one.
//
// FENs are pawn-only sketches (kings on e1/e8 for legality) meant as visual
// prototypes, not real game positions.
import type { PawnStructure } from "./types";

export const STRUCTURES: PawnStructure[] = [
  {
    slug: "carlsbad",
    name: "Carlsbad Structure",
    glyph: "🎼",
    fen: "4k3/pp3pp1/2p1p2p/3p4/3P4/2P1P2P/PP3PP1/4K3 w - - 0 1",
    short: "White pawns c3-d4-e3, Black pawns c6-d5-e6. The 'minority attack' structure — White plays b4-b5 to create a weak c6 pawn.",
    whitePlans: [
      "Minority attack: b4-b5, trade c-pawns, target the weak c-pawn",
      "Central break e3-e4 if piece play allows",
      "Bishop pair advantage in the resulting endgame",
    ],
    blackPlans: [
      "Kingside attack: …Ne4, …f5, …Bd6-c7-Qc8 lift",
      "Prevent b4-b5 with …a5",
      "…e5 break to open the position",
    ],
    reachedFrom: ["qgd-exchange", "qgd-orthodox", "slav-exchange"],
  },
  {
    slug: "iqp",
    name: "Isolated Queen's Pawn (IQP)",
    glyph: "♟",
    fen: "4k3/pp3ppp/8/3p4/8/8/PP3PPP/4K3 w - - 0 1",
    short: "One side has a pawn on d5 with no c- or e-pawn support. Sharp — piece activity vs long-term weakness.",
    whitePlans: [
      "Piece activity: Rooks on c1/e1, knight to e5, bishop to c2/b1",
      "d5 break to eliminate the weakness",
      "Direct kingside attack with h4-h5",
    ],
    blackPlans: [
      "Blockade d4 with a knight",
      "Trade pieces to reach a winning endgame",
      "…Nb4, …Nbd5 exchange manoeuvres",
    ],
    reachedFrom: ["qgd-tarrasch", "sicilian-alapin", "caro-kann-panov", "nimzo-classical"],
  },
  {
    slug: "hanging-pawns",
    name: "Hanging Pawns",
    glyph: "🪢",
    fen: "4k3/pp3ppp/8/2pp4/8/8/PP3PPP/4K3 w - - 0 1",
    short: "Two pawns side by side on c- and d-files with no neighbours. Powerful when advanced, weak when static.",
    whitePlans: [
      "Push c4-c5 or d4-d5 to open lines",
      "Piece activity along half-open b- and e-files",
    ],
    blackPlans: [
      "Blockade both pawns",
      "…b5 to fix and pressure c4",
    ],
    reachedFrom: ["qgd-tartakower", "nimzo-rubinstein"],
  },
  {
    slug: "hedgehog",
    name: "Hedgehog",
    glyph: "🦔",
    fen: "4k3/1p1p1ppp/p1p1pn2/8/8/PP2PN2/1BPP1PPP/4K3 w - - 0 1",
    short: "Black pawns on a6, b6, d6, e6 — a low, prickly wall waiting to lash out with …b5 or …d5.",
    whitePlans: [
      "Cramp Black with pieces on c4/d4/e4",
      "Prevent the …b5 and …d5 breaks",
      "Slow squeeze with Rc1, Qd2, Rfd1",
    ],
    blackPlans: [
      "…b5 break for queenside counterplay",
      "…d5 break for central liberation",
      "Regroup pieces to spring the break at the right moment",
    ],
    reachedFrom: ["sicilian-kan", "sicilian-taimanov", "english-hedgehog"],
  },
  {
    slug: "kid-chain",
    name: "King's Indian Pawn Chain",
    glyph: "⛓",
    fen: "4k3/pppn1pbp/3p1np1/3Pp3/2P1P3/2N2N2/PP3PPP/4K3 w - - 0 1",
    short: "White pawns c4-d5, Black pawns d6-e5. Locked centre; both sides attack on flanks pointing at their pawn arrow.",
    whitePlans: [
      "Queenside pawn storm: b4, c5, cxd6",
      "Nb5 outpost, Ra1-c1 pressure",
      "Prevent Black's …f5 with h3-Bg5",
    ],
    blackPlans: [
      "Kingside pawn storm: …f5, …g5, …h5",
      "…Ng6, …Bf6, …Rf7-g7 kingside build-up",
      "Mate the White king via the h-file",
    ],
    reachedFrom: ["kid-classical", "kid-bayonet", "kid-samisch"],
  },
  {
    slug: "maroczy-bind",
    name: "Maróczy Bind",
    glyph: "🪤",
    fen: "4k3/pp1p1ppp/2p5/8/2P1P3/8/PP3PPP/4K3 w - - 0 1",
    short: "White pawns on c4 and e4, no d-pawn — clamps down on Black's …d5 forever. Slow, positional squeeze.",
    whitePlans: [
      "Trade dark-squared bishops to reduce Black's counterplay",
      "Slowly prepare central breaks e4-e5 or c4-c5",
      "Piece pressure — Nd5 outpost",
    ],
    blackPlans: [
      "…Nc5 attacking e4",
      "…f5 break (risky but freeing)",
      "…b5 break to open the c-file",
    ],
    reachedFrom: ["sicilian-accelerated-dragon", "english-symmetric"],
  },
  {
    slug: "boleslavsky-hole",
    name: "Boleslavsky Hole",
    glyph: "🕳",
    fen: "4k3/pp1p1ppp/2n5/4p3/4P3/2N5/PPP2PPP/4K3 w - - 0 1",
    short: "Black plays …e5 in the Sicilian creating a weak d5 square, but gets active piece play + bishop pair in return.",
    whitePlans: [
      "Occupy d5 with a knight or bishop permanently",
      "Trade Black's dark-squared bishop with Bg5xf6",
      "Nc3-d5 route the knight",
    ],
    blackPlans: [
      "…Be6 pressuring d5, ready to trade any occupier",
      "…a5-a4 queenside space",
      "…f5 counterattack in the centre",
    ],
    reachedFrom: ["sicilian-najdorf", "sicilian-sveshnikov"],
  },
  {
    slug: "botvinnik-system",
    name: "Botvinnik System",
    glyph: "🔷",
    fen: "4k3/pp3ppp/2p1pn2/3p4/2PP4/2N1P3/PP3PPP/4K3 w - - 0 1",
    short: "White pawns c4-d4-e3 vs Black c6-d5-e6 with knights on f3/f6. English/Slav crossover — closed, positional.",
    whitePlans: [
      "Fianchetto king with g3-Bg2 pointing at d5",
      "Nc3-e2-f4 knight tour",
      "Break with cxd5 at the right moment",
    ],
    blackPlans: [
      "Symmetric setup with …g6 fianchetto",
      "…dxc4 opening the position",
      "…e5 central break",
    ],
    reachedFrom: ["english-symmetric", "slav-closed"],
  },
  {
    slug: "stonewall",
    name: "Stonewall",
    glyph: "🧱",
    fen: "4k3/ppp3pp/4p3/3p1p2/3P1P2/4P3/PPP3PP/4K3 w - - 0 1",
    short: "Pawns on c-d-e-f in a bricked wall. Locked, static, king-attack focused. Weak e5/e4 outpost for the other side.",
    whitePlans: [
      "Piece attack against Black's kingside via Ne5, Qh5, Rf3-h3",
      "Trade dark-squared bishops (Black's is bad; White's is great)",
    ],
    blackPlans: [
      "…Bd6, …Qe7, …Rf6-h6 kingside attack",
      "…g5 break to open lines against White",
      "…Bd7-e8-h5 bishop manoeuvre",
    ],
    reachedFrom: ["dutch-stonewall", "colle-stonewall"],
  },
  {
    slug: "panov-iqp",
    name: "Panov IQP",
    glyph: "🎯",
    fen: "4k3/pp3ppp/2n1pn2/8/2PP4/8/PP3PPP/4K3 w - - 0 1",
    short: "White gets an IQP on d4 with piece activity vs Black's solid but passive structure. Kasparov's favourite.",
    whitePlans: [
      "Attack Black's king with pieces (Bg5, Qd2, Rd1)",
      "Push d4-d5 to open the position for active pieces",
    ],
    blackPlans: [
      "Blockade d4 with …Nd5",
      "Trade queens to neutralise the attack",
    ],
    reachedFrom: ["caro-kann-panov", "sicilian-alapin", "qgd-tarrasch"],
  },
  {
    slug: "kings-fianchetto",
    name: "King's Fianchetto",
    glyph: "🏹",
    fen: "4k1b1/pppp1p1p/6p1/8/8/6P1/PPPP1PBP/4K3 w - - 0 1",
    short: "Bishop on g2 or g7, king castled behind. Long-diagonal pressure + safe king.",
    whitePlans: [
      "Long-diagonal pressure (a8-h1)",
      "Central pawn breaks e4 or c4",
    ],
    blackPlans: [
      "Same, mirrored",
    ],
    reachedFrom: ["kings-indian", "grunfeld", "catalan", "reti-kia"],
  },
  {
    slug: "slav-meran",
    name: "Meran / Semi-Slav Complex",
    glyph: "⚔️",
    fen: "4k3/1p1n1ppp/p1p1pn2/3p4/2PP4/2N1PN2/PP3PPP/4K3 w - - 0 1",
    short: "Black pawns a6-b7-c6-d5-e6 with knight on d7. The Meran / Botvinnik / Anti-Meran launching pad — extremely sharp theory.",
    whitePlans: [
      "e3-e4 break to open lines against Black's king",
      "Piece activity while Black is developing",
    ],
    blackPlans: [
      "…dxc4 grabbing the pawn, then …b5 and …b4",
      "…Bb7 long diagonal + …c5 break",
      "Queenside pawn mass",
    ],
    reachedFrom: ["slav-semi-slav", "slav-meran", "slav-botvinnik"],
  },
];

export const structureBySlug = new Map(STRUCTURES.map((s) => [s.slug, s]));
