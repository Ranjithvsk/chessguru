// Opening layer (owner 2026-09-12: "opening accuracy, opening traps, wrong opening moves"). Uses
// the local masters book (`openingpositions`, 38 M positions keyed "masters|<epd>", move counts) and
// `openingnames` (ECO + name by epd). Everything here is a lookup; the engine (caller) supplies the
// centipawn loss that turns "out of book" into "wrong".
import type { Collection } from "mongodb";

export const OPENING_PLIES = 24;          // first 12 moves each side count as "the opening"
const BOOK_MIN_GAMES = 30;                // a position needs this many master games to judge by book
const BOOK_MOVE_SHARE = 0.02;             // a move played in ≥2% of master games here is "book"
export const OPENING_POINTS = { openingTrap: 3, openingMistake: 1, fellIntoTrap: 3 } as const;
export const OPENING_LABEL: Record<string, string> = { openingTrap: "Opening trap sprung", openingMistake: "Wrong opening move", fellIntoTrap: "Fell into an opening trap", bookMove: "Book move" };

export const epdOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

export type BookLookup = { games: number; moves: Map<string, number>; known: boolean };
export class OpeningBook {
  private cache = new Map<string, BookLookup>();
  private names = new Map<string, { eco: string; name: string } | null>();
  constructor(private readonly positions: Collection<any>, private readonly openingNames: Collection<any>) {}
  async lookup(fen: string): Promise<BookLookup> {
    const epd = epdOf(fen);
    const hit = this.cache.get(epd); if (hit) return hit;
    const doc = await this.positions.findOne({ _id: `masters|${epd}` } as any, { projection: { g: 1, moves: 1 } });
    const moves = new Map<string, number>();
    let games = 0;
    if (doc) {
      games = Number(doc.g ?? 0);
      for (const [uci, m] of Object.entries((doc.moves as Record<string, any>) ?? {})) moves.set(uci, Number(m.w ?? 0) + Number(m.d ?? 0) + Number(m.b ?? 0));
    }
    const res = { games, moves, known: games >= BOOK_MIN_GAMES };
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(epd, res);
    return res;
  }
  /** Is `uci` a master book move here? null = position too rare to judge. */
  async isBook(fen: string, uci: string): Promise<boolean | null> {
    const b = await this.lookup(fen);
    if (!b.known) return null;
    const n = b.moves.get(uci) ?? 0;
    return n >= Math.max(3, b.games * BOOK_MOVE_SHARE);
  }
  async name(fen: string): Promise<{ eco: string; name: string } | null> {
    const epd = epdOf(fen);
    if (this.names.has(epd)) return this.names.get(epd)!;
    const doc = await this.openingNames.findOne({ _id: epd } as any);
    const v = doc ? { eco: String(doc.eco), name: String(doc.name) } : null;
    if (this.names.size > 5000) this.names.clear();
    this.names.set(epd, v);
    return v;
  }
}

/** Running opening tally for one player in one game. */
export class OpeningTally {
  plies = 0; book = 0; engineOk = 0; deviationPly: number | null = null; mistakes = 0; trapsFell = 0; trapsSprung = 0;
  eco: string | null = null; name: string | null = null;
  /** accuracy = share of opening moves that were book, or engine-approved when the book runs out. */
  get accuracy(): number | null { return this.plies ? Math.round(((this.book + this.engineOk) / this.plies) * 100) : null; }
  toJSON() { return { plies: this.plies, book: this.book, engineOk: this.engineOk, accuracy: this.accuracy, deviationPly: this.deviationPly, mistakes: this.mistakes, trapsFell: this.trapsFell, trapsSprung: this.trapsSprung, eco: this.eco, name: this.name }; }
}
