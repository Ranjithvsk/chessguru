// Create a study — 6-tile intent picker. Route: /studies/new
//
// Step 1: pick "what are you making?" (6 tiles).
// Step 2: fill only the fields that intent needs (title + FEN/PGN as required).
// Submit → POST /api/studies (creates study + first chapter) → navigate into editor.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studiesApi, type Intent } from "../lib/studies-api";
import { booksApi } from "../lib/books-api";

interface Tile {
  intent: Intent;
  icon: string;
  title: string;
  blurb: string;
  needs: ("pgn" | "fen" | "opening" | "book")[];
  chapterTitle: string;
}

const TILES: Tile[] = [
  // The six categories My Studies is organised by, in the order a game is played.
  { intent: "opening",      icon: "📖", title: "Opening",            blurb: "Build a repertoire tree from your favourite lines.",   needs: ["opening"], chapterTitle: "Line 1" },
  { intent: "middlegame",   icon: "⚔️", title: "Middlegame",         blurb: "Plans, structures and typical positions.",             needs: ["fen"],   chapterTitle: "Position" },
  { intent: "endgame",      icon: "👑", title: "Endgame",            blurb: "Study or drill from a specific endgame position.",     needs: ["fen"],   chapterTitle: "Position" },
  { intent: "game",         icon: "🎮", title: "Own game revision",  blurb: "Go back over a game you played and mark the turns.",   needs: ["pgn"],   chapterTitle: "Game" },
  { intent: "gm-game",      icon: "🏆", title: "Grandmaster game",   blurb: "Work through a master game and revise the key ideas.", needs: ["pgn"],   chapterTitle: "Game" },
  { intent: "classic-game", icon: "🏛️", title: "Classic game",       blurb: "The famous games worth knowing by heart.",             needs: ["pgn"],   chapterTitle: "Game" },
  { intent: "puzzle",   icon: "🧩", title: "Puzzle / tactic",   blurb: "Start from a specific position — teach the answer.", needs: ["fen"],   chapterTitle: "Position" },
  { intent: "concept",  icon: "💡", title: "Concept lesson",    blurb: "Blank board, add slides as you teach.",              needs: [],        chapterTitle: "Slide 1" },
  { intent: "notebook", icon: "📝", title: "Class notebook",    blurb: "Free-form — add chapters as class progresses.",      needs: [],        chapterTitle: "Session 1" },
  { intent: "book",     icon: "📚", title: "From a book",       blurb: "Link this study to a chapter of a chess book you own.", needs: ["book"], chapterTitle: "Chapter notes" },
];

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function StudyCreatePage() {
  const nav = useNavigate();
  const [tile, setTile] = useState<Tile | null>(null);
  const [title, setTitle] = useState("");
  const [fen, setFen] = useState(START_FEN);
  const [pgn, setPgn] = useState("");
  const [openingMoves, setOpeningMoves] = useState("");
  const [bookId, setBookId] = useState("");
  const [chapterNumber, setChapterNumber] = useState<number | "">("");
  const [bookSearch, setBookSearch] = useState("");
  const [err, setErr] = useState("");

  // Only fetch books when the "book" tile is active — cheap and skips wasted network on other flows.
  const booksQ = useQuery({
    queryKey: ["books"],
    queryFn: () => booksApi.list(),
    enabled: tile?.intent === "book",
  });
  const bookDetailQ = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => booksApi.get(bookId),
    enabled: !!bookId && tile?.intent === "book",
  });

  // Add a book that is not in the list yet, straight from the search box. It is
  // only an index entry -- a title somebody typed -- so no author or chapters
  // are asked for, and it lands in the caller's ACADEMY list the same way any
  // added book does, where the rest of the academy finds it next time.
  const qc = useQueryClient();

  // The owner's real library lives on the Vinayaka host — thousands of books,
  // against the handful ever attached here. Searched server-side so the 1.2 MB
  // catalogue never reaches the browser, and only once there is something to
  // search for.
  const libQ = useQuery({
    queryKey: ["book-library", bookSearch.trim()],
    queryFn: () => booksApi.librarySearch(bookSearch.trim(), 25),
    enabled: tile?.intent === "book" && bookSearch.trim().length >= 2,
    staleTime: 60_000,
  });
  // Attaching a library book creates its row here on first use, chapters and
  // all, instead of importing three thousand rows nobody asked for.
  const adopt = useMutation({
    mutationFn: (hostId: string) => booksApi.adoptLibrary(hostId),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["books"] });
      setBookId(r.bookId);
    },
  });
  const addBook = useMutation({
    mutationFn: (name: string) => booksApi.create({ title: name, chapters: [] }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["books"] });
      setBookId(r.bookId);
    },
  });

  // Library hits, minus anything already attached here (adopt is idempotent, so
  // a duplicate row would just be two doors to the same book).
  const libRows = useMemo(() => {
    const have = new Set((booksQ.data?.items ?? []).map((b: any) => String(b.title || "").toLowerCase()));
    return (libQ.data?.items ?? []).filter((b) => !have.has(String(b.title || "").toLowerCase()));
  }, [libQ.data, booksQ.data]);

  const filteredBooks = useMemo(() => {
    const arr = booksQ.data?.items ?? [];
    // While searching, show only a few of the already-attached books. They render
    // ABOVE the library section, and a long list of them pushed the library out
    // of a 224px scroll box entirely — which looked exactly like "the library
    // search is not working".
    if (!bookSearch.trim()) return arr.slice(0, 30);
    const n = bookSearch.trim().toLowerCase();
    return arr.filter((b) => b.title.toLowerCase().includes(n) || b.author.toLowerCase().includes(n)).slice(0, 5);
  }, [booksQ.data, bookSearch]);

  const mut = useMutation({
    mutationFn: (body: any) => studiesApi.create(body),
    onSuccess: (r) => nav(`/studies/${encodeURIComponent(r.studyId)}/edit/${encodeURIComponent(r.chapterId)}`),
    onError: (e: any) => setErr(String(e?.message || e)),
  });

  const submit = () => {
    if (!tile) return;
    setErr("");
    const body: any = {
      title: title.trim() || tile.title,
      intent: tile.intent,
      chapterTitle: tile.chapterTitle,
      visibility: "private",
    };
    if (tile.needs.includes("fen")) body.startingFen = fen.trim() || START_FEN;
    if (tile.needs.includes("pgn") && pgn.trim()) body.pgn = pgn;
    if (tile.needs.includes("opening") && openingMoves.trim()) {
      // Wrap the opening moves as a mini-PGN for the parser.
      body.pgn = `[SetUp "0"]\n\n${openingMoves.trim()} *`;
    }
    if (tile.needs.includes("book")) {
      if (!bookId) { setErr("Pick a book"); return; }
      const chap = bookDetailQ.data?.book.chapters.find((c) => c.number === chapterNumber);
      body.sourceBook = {
        bookId,
        chapterNumber: chapterNumber || undefined,
        topicTags: chap?.tags,
      };
      // Auto-fill title from book + chapter if user left blank.
      if (!title.trim() && bookDetailQ.data) {
        body.title = `${bookDetailQ.data.book.title}${chapterNumber ? ` — Ch ${chapterNumber}` : ""}${chap?.title ? `: ${chap.title}` : ""}`;
      }
    }
    mut.mutate(body);
  };

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <h1 className="mb-1 font-display text-2xl text-white">New study</h1>
      <p className="mb-6 text-sm text-ink-400">Pick what you're making — we'll set up the editor for that.</p>

      {/* Step 1: intent picker */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TILES.map((t) => (
          <button key={t.intent} type="button" onClick={() => setTile(t)}
            className={`text-left rounded-xl2 border p-4 transition ${
              tile?.intent === t.intent
                ? "border-brand-500 bg-brand-500/10 shadow-glow"
                : "border-ink-700 bg-ink-900 hover:border-ink-600 hover:bg-ink-800"
            }`}>
            <div className="mb-1 text-3xl">{t.icon}</div>
            <div className="font-semibold text-white">{t.title}</div>
            <div className="mt-1 text-xs text-ink-400">{t.blurb}</div>
          </button>
        ))}
      </div>

      {/* Step 2: intent-specific form */}
      {tile && (
        <div className="mt-6 rounded-xl2 border border-ink-700 bg-ink-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xl">{tile.icon}</span>
            <span className="text-sm text-ink-300">{tile.title}</span>
            <button type="button" onClick={() => { setTile(null); setErr(""); }}
              className="ml-auto text-xs text-ink-400 hover:text-ink-200 underline">change</button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={tile.title}
                maxLength={140}
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
            </div>

            {tile.needs.includes("fen") && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Starting FEN</label>
                <input value={fen} onChange={(e) => setFen(e.target.value)}
                  className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 font-mono text-xs text-white focus:border-brand-500 focus:outline-none" />
                <p className="mt-1 text-[10px] text-ink-500">Leave as the default for a standard starting position.</p>
              </div>
            )}

            {tile.needs.includes("pgn") && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">
                  PGN <span className="font-normal text-ink-500">(optional — you can also enter moves in the editor)</span>
                </label>
                <textarea value={pgn} onChange={(e) => setPgn(e.target.value)}
                  rows={6} placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 …"
                  className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 font-mono text-xs text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              </div>
            )}

            {tile.needs.includes("opening") && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Starting moves</label>
                <input value={openingMoves} onChange={(e) => setOpeningMoves(e.target.value)}
                  placeholder="1. e4 c5 2. Nf3 d6"
                  className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 font-mono text-xs text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                <p className="mt-1 text-[10px] text-ink-500">The editor will open with the position after these moves.</p>
              </div>
            )}

            {tile.needs.includes("book") && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Book</label>
                  {!bookId ? (
                    <>
                      <input value={bookSearch} onChange={(e) => setBookSearch(e.target.value)}
                        placeholder="Search title or author…"
                        className="mb-2 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                      <div className="max-h-80 overflow-y-auto rounded-lg border border-ink-700 bg-ink-800/50">
                        {booksQ.isLoading && <div className="p-3 text-xs text-ink-400">Loading…</div>}
                        {filteredBooks.length === 0 && libRows.length === 0 && !booksQ.isLoading && !libQ.isFetching && (
                          <div className="p-3">
                            {bookSearch.trim() ? (
                              <>
                                <div className="mb-2 text-xs text-ink-500">
                                  Nothing matches “{bookSearch.trim()}” — not in your books, and not in the library.
                                </div>
                                <button type="button"
                                  onClick={() => addBook.mutate(bookSearch.trim())}
                                  disabled={addBook.isPending}
                                  className="w-full rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-2 text-left text-sm text-brand-100 hover:bg-brand-500/20 disabled:opacity-50">
                                  {addBook.isPending ? "Adding…" : `➕ Add “${bookSearch.trim()}” to your academy's books`}
                                </button>
                                {addBook.error && (
                                  <div className="mt-2 text-[11px] text-rose-300">Could not add it — {String((addBook.error as any)?.message || addBook.error)}</div>
                                )}
                                <div className="mt-2 text-[11px] text-ink-500">Adds the title only — author and chapters can be filled in later from <a href="/books" className="text-brand-300 hover:underline">Books</a>.</div>
                              </>
                            ) : (
                              <div className="text-xs text-ink-500">Type a title or author to search.</div>
                            )}
                          </div>
                        )}
                        {filteredBooks.map((b) => (
                          <button key={b._id} type="button" onClick={() => setBookId(b._id)}
                            className="flex w-full items-center gap-2 border-b border-ink-800 px-3 py-2 text-left last:border-0 hover:bg-ink-800">
                            <span className="text-lg">📚</span>
                            <div className="flex-1">
                              <div className="text-sm font-semibold text-white">{b.title}</div>
                              {b.author && <div className="text-[11px] text-ink-400">{b.author}</div>}
                            </div>
                          </button>
                        ))}
                        {libQ.error && (
                          <div className="border-t border-ink-800 px-3 py-2 text-[11px] text-rose-300">
                            The library search is unavailable right now — {String((libQ.error as any)?.message || libQ.error)}.
                            Your own books above still work.
                          </div>
                        )}
                        {libQ.isFetching && (
                          <div className="border-t border-ink-800 px-3 py-2 text-[11px] text-ink-500">Searching the library…</div>
                        )}
                        {libRows.length > 0 && (
                          <div className="border-t border-ink-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                            From the library{libQ.data ? ` · ${libQ.data.total} match${libQ.data.total === 1 ? "" : "es"}` : ""}
                          </div>
                        )}
                        {libRows.map((b) => (
                          <button key={b.id} type="button" onClick={() => adopt.mutate(b.id)} disabled={adopt.isPending}
                            className="flex w-full items-center gap-2 border-b border-ink-800 px-3 py-2 text-left last:border-0 hover:bg-ink-800 disabled:opacity-50">
                            <span className="text-lg">📖</span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-white">{b.title}</div>
                              <div className="truncate text-[11px] text-ink-400">{[b.author, b.shelf].filter(Boolean).join(" · ")}</div>
                            </div>
                          </button>
                        ))}
                        {adopt.error && (
                          <div className="border-t border-ink-800 px-3 py-2 text-[11px] text-rose-300">Could not attach that book — {String((adopt.error as any)?.message || adopt.error)}</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-brand-500/40 bg-brand-500/5 p-3 text-sm text-white">
                      📚 {bookDetailQ.data?.book.title || "…"} — <span className="text-ink-400">{bookDetailQ.data?.book.author}</span>
                      <button type="button" onClick={() => { setBookId(""); setChapterNumber(""); }}
                        className="ml-2 text-xs text-ink-400 hover:text-ink-200 underline">change</button>
                    </div>
                  )}
                </div>

                {bookId && bookDetailQ.data && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Chapter (optional)</label>
                    <select value={chapterNumber} onChange={(e) => setChapterNumber(e.target.value ? Number(e.target.value) : "")}
                      className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none">
                      <option value="">— pick a chapter —</option>
                      {bookDetailQ.data.book.chapters.map((c) => (
                        <option key={c.number} value={c.number}>
                          {c.number}. {c.title}
                        </option>
                      ))}
                    </select>
                    {chapterNumber && (
                      <p className="mt-1 text-[10px] text-ink-500">
                        Tags: {bookDetailQ.data.book.chapters.find((c) => c.number === chapterNumber)?.tags.join(", ") || "(none)"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}

            <button type="button" onClick={submit} disabled={mut.isPending}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {mut.isPending ? "Creating…" : "Create study →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
