// Create a study — 6-tile intent picker. Route: /studies/new
//
// Step 1: pick "what are you making?" (6 tiles).
// Step 2: fill only the fields that intent needs (title + FEN/PGN as required).
// Submit → POST /api/studies (creates study + first chapter) → navigate into editor.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { studiesApi, type Intent } from "../lib/studies-api";

interface Tile {
  intent: Intent;
  icon: string;
  title: string;
  blurb: string;
  needs: ("pgn" | "fen" | "opening")[];
  chapterTitle: string;
}

const TILES: Tile[] = [
  { intent: "game",     icon: "🎮", title: "Game analysis",     blurb: "Paste a PGN or enter moves — annotate as you go.",  needs: ["pgn"],   chapterTitle: "Game" },
  { intent: "puzzle",   icon: "🧩", title: "Puzzle / tactic",   blurb: "Start from a specific position — teach the answer.", needs: ["fen"],   chapterTitle: "Position" },
  { intent: "concept",  icon: "💡", title: "Concept lesson",    blurb: "Blank board, add slides as you teach.",              needs: [],        chapterTitle: "Slide 1" },
  { intent: "opening",  icon: "📖", title: "Opening",           blurb: "Build a repertoire tree from your favourite lines.", needs: ["opening"], chapterTitle: "Line 1" },
  { intent: "endgame",  icon: "👑", title: "Endgame",           blurb: "Study or drill from a specific endgame position.",   needs: ["fen"],   chapterTitle: "Position" },
  { intent: "notebook", icon: "📝", title: "Class notebook",    blurb: "Free-form — add chapters as class progresses.",      needs: [],        chapterTitle: "Session 1" },
];

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function StudyCreatePage() {
  const nav = useNavigate();
  const [tile, setTile] = useState<Tile | null>(null);
  const [title, setTitle] = useState("");
  const [fen, setFen] = useState(START_FEN);
  const [pgn, setPgn] = useState("");
  const [openingMoves, setOpeningMoves] = useState("");
  const [err, setErr] = useState("");

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
