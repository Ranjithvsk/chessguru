// The 20 opening families — root of the corpus tree. Every Opening.familyId
// points at one of these. displayOrder = suggested beginner→advanced arc for the
// belt progression + the Family Tree visualisation (S7).
import type { OpeningFamily } from "./types";

export const FAMILIES: OpeningFamily[] = [
  { id: "italian", name: "Italian Game", displayOrder: 1, colorHex: "#dc2626", approxOpenings: 25,
    intro: "1.e4 e5 2.Nf3 Nc6 3.Bc4 — the oldest opening in written history. Classical piece play, symmetric centre, both sides target f7/f2. The perfect first opening: teaches development, castling, and central pawn breaks." },
  { id: "ruy-lopez", name: "Ruy Lopez", displayOrder: 2, colorHex: "#ea580c", approxOpenings: 40,
    intro: "1.e4 e5 2.Nf3 Nc6 3.Bb5 — the deepest theory in chess. Pins the c6 knight, threatens to trade for it, plays for a long-term positional squeeze. Home of the Berlin Wall that dethroned Kasparov." },
  { id: "open-e5-misc", name: "Open Games (misc.)", displayOrder: 3, colorHex: "#d97706", approxOpenings: 20,
    intro: "Everything else after 1.e4 e5: Scotch, Vienna, King's Gambit, Petroff, Philidor. Sharp classical openings, less theory than the Ruy but full of tactics." },
  { id: "sicilian", name: "Sicilian Defence", displayOrder: 4, colorHex: "#7c3aed", approxOpenings: 80,
    intro: "1.e4 c5 — Black's most fighting reply to 1.e4. Asymmetric structure guarantees imbalanced play. Home to the Najdorf, Dragon, Sveshnikov, Kan, Taimanov — the deepest opening tree in chess." },
  { id: "french", name: "French Defence", displayOrder: 5, colorHex: "#7c3aed", approxOpenings: 30,
    intro: "1.e4 e6 — solid, cramped, counterattacking. Black accepts a bad light-squared bishop for a rock-solid centre + …c5 counterplay. Winawer, Advance, Tarrasch, Classical." },
  { id: "caro-kann", name: "Caro-Kann Defence", displayOrder: 6, colorHex: "#4f46e5", approxOpenings: 20,
    intro: "1.e4 c6 — French's saner cousin. Black plays …c6 first so …d5 doesn't lock in the bishop. Solid, strategic, endgame-oriented. Karpov and Anand's weapon." },
  { id: "scandi-alekhine", name: "Scandinavian & Alekhine", displayOrder: 7, colorHex: "#0891b2", approxOpenings: 15,
    intro: "1.e4 d5 (Scandinavian) and 1.e4 Nf6 (Alekhine). Provocative surprise weapons — Black challenges the centre immediately, invites overextension." },
  { id: "modern-pirc", name: "Modern & Pirc", displayOrder: 8, colorHex: "#0ea5e9", approxOpenings: 18,
    intro: "1.e4 g6 (Modern) / 1.e4 d6 2.d4 Nf6 3.Nc3 g6 (Pirc). Hypermodern — let White build a big centre, then punch holes with …c5, …e5. Kasparov, Botvinnik, and Larsen played the Modern." },
  { id: "qgd", name: "Queen's Gambit Declined", displayOrder: 9, colorHex: "#059669", approxOpenings: 35,
    intro: "1.d4 d5 2.c4 e6 — Black declines the gambit pawn for solid classical play. Orthodox, Lasker, Tartakower, Cambridge Springs. Foundation of positional chess." },
  { id: "slav", name: "Slav Defence", displayOrder: 10, colorHex: "#10b981", approxOpenings: 28,
    intro: "1.d4 d5 2.c4 c6 — Black defends d5 with the c-pawn instead of the e-pawn, keeping the light-squared bishop free. Meran (Semi-Slav) is the sharpest branch; Chebanenko and Dutch Slav are solid choices." },
  { id: "kings-indian", name: "King's Indian Defence", displayOrder: 11, colorHex: "#f59e0b", approxOpenings: 35,
    intro: "1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 — Black lets White build the ideal centre, then attacks it with …e5/…f5. Fischer, Kasparov, Nakamura's fighting weapon. Two openings on one board (queenside race vs kingside race)." },
  { id: "nimzo", name: "Nimzo-Indian", displayOrder: 12, colorHex: "#eab308", approxOpenings: 28,
    intro: "1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 — pin the c3 knight, threaten to double White's pawns. Karpov's masterpiece. Rubinstein, Sämisch, Classical, Leningrad — many rich sub-systems." },
  { id: "grunfeld", name: "Grünfeld Defence", displayOrder: 13, colorHex: "#f59e0b", approxOpenings: 22,
    intro: "1.d4 Nf6 2.c4 g6 3.Nc3 d5 — hypermodern doctrine at its purest. Let White have the big centre, then attack it with pieces + …c5. Kasparov's main defence to 1.d4." },
  { id: "qi-bogo", name: "Queen's Indian & Bogo", displayOrder: 14, colorHex: "#84cc16", approxOpenings: 15,
    intro: "1.d4 Nf6 2.c4 e6 3.Nf3 b6 (QID) / 3…Bb4+ (Bogo). Elastic classical defences — Black keeps options open, contests the long diagonal with …Bb7." },
  { id: "catalan", name: "Catalan", displayOrder: 15, colorHex: "#22c55e", approxOpenings: 20,
    intro: "1.d4 Nf6 2.c4 e6 3.g3 — the Catalan bishop on g2 pressures Black's queenside forever. Slow torture, sometimes 30 moves before something concrete happens. Kramnik's weapon of choice." },
  { id: "english", name: "English Opening", displayOrder: 16, colorHex: "#0d9488", approxOpenings: 30,
    intro: "1.c4 — the flexible flank opening. Can transpose into everything (Sicilian reversed, QGD reversed, hypermodern setups). Universal and low-theory." },
  { id: "d4-side", name: "London / Trompowsky / d4 side-systems", displayOrder: 17, colorHex: "#14b8a6", approxOpenings: 20,
    intro: "1.d4 without 2.c4: London (2.Nf3 + Bf4), Trompowsky (2.Bg5), Colle, Torre, Barry, Veresov. Play the same setup vs anything — low theory, high strategic content." },
  { id: "dutch", name: "Dutch Defence", displayOrder: 18, colorHex: "#0891b2", approxOpenings: 15,
    intro: "1.d4 f5 — Black stakes kingside space immediately. Stonewall (…d5, …e6, …f5, …c6), Leningrad (…g6), Classical. Weakens e6/kingside for attacking chances." },
  { id: "benoni-benko", name: "Benoni & Benko", displayOrder: 19, colorHex: "#3b82f6", approxOpenings: 12,
    intro: "1.d4 Nf6 2.c4 c5 3.d5 — Black accepts a space disadvantage for dynamic piece play + the …b5 pawn break. Modern Benoni (fianchetto king) and Benko Gambit (…b5 immediately)." },
  { id: "reti-kia", name: "Réti / King's Indian Attack", displayOrder: 20, colorHex: "#6366f1", approxOpenings: 15,
    intro: "1.Nf3 (Réti) / 1.e4 + Nd2 + Ngf3 + g3 + Bg2 (KIA). Hypermodern white systems — flexible, transposition-heavy, played by Petrosian, Fischer, Bronstein, Nakamura." },
];

export const familyById = new Map(FAMILIES.map((f) => [f.id, f]));
