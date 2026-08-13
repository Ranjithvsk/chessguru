// Memory Master 500 — import a real game and grade your opening.
// Route: /study/import-game
//
// Textarea → chess.js PGN parse → identify corpus opening → find first
// deviation → optionally activate the opening so the correct move enters the
// FSRS queue.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Board from "../components/Board";
import { analyseGame, summarise, deviationCardId, type GameAnalysis } from "../lib/gameAnalysis";
import { activateOpening, isActivated } from "../lib/cards";
import { familyById, tagBySlug } from "../lib/openings";
import EngineCoach from "../components/EngineCoach";

const SAMPLE_PGN = `[Event "Casual game"]
[Site "?"]
[Date "2026.08.02"]
[White "You"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O
7. Re1 Bg4 8. Nbd2 Nd7 9. h3 Bh5 10. Nf1 Ng6 11. Ng3 Bxf3 12. Qxf3 1-0`;

export default function ImportGame() {
  const [pgn, setPgn] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const analysis = useMemo(() => submitted ? analyseGame(submitted) : null, [submitted]);

  return (
    <div className="mx-auto max-w-4xl p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Import a game</h1>
        <p className="mt-1 text-sm text-ink-500">
          Paste a PGN. We'll identify the opening from the 500-corpus, count how many book moves you
          played, and pin the first deviation so its cards enter your daily queue.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div>
          <textarea
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
            placeholder="[Event ...]&#10;1. e4 c5 2. Nf3 d6 ..."
            className="h-72 w-full rounded-xl border border-ink-800 p-3 font-mono text-xs outline-none focus:border-ink-600"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setSubmitted(pgn)}
              disabled={!pgn.trim()}
              className="rounded-full bg-ink-100 px-4 py-2 text-sm font-bold text-white hover:bg-ink-200 disabled:opacity-40"
            >
              Analyse
            </button>
            <button
              onClick={() => { setPgn(SAMPLE_PGN); setSubmitted(null); }}
              className="rounded-full bg-ink-900 px-3 py-2 text-xs font-semibold hover:bg-ink-800"
            >
              Load sample
            </button>
            {submitted && (
              <button
                onClick={() => { setPgn(""); setSubmitted(null); }}
                className="rounded-full bg-ink-900 px-3 py-2 text-xs font-semibold hover:bg-ink-800"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-2 text-[10px] text-ink-600">
            Tip: from Lichess, click "Share &amp; export" → "PGN". From Chess.com, the download PGN button.
          </p>
        </div>

        <div>
          {!analysis && <Placeholder />}
          {analysis && !analysis.ok && <ErrorPanel msg={analysis.error} />}
          {analysis && analysis.ok && <ResultPanel a={analysis} />}
        </div>
      </div>
    </div>
  );
}

function Placeholder() {
  return (
    <div className="rounded-xl border border-dashed border-ink-800 bg-ink-900 p-6 text-center text-sm text-ink-500">
      Paste a PGN on the left and click <b>Analyse</b>.
    </div>
  );
}

function ErrorPanel({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      ⚠️ {msg}
    </div>
  );
}

function ResultPanel({ a }: { a: GameAnalysis }) {
  const opening = a.identified;
  const family = opening ? familyById.get(opening.familyId) : null;
  const [added, setAdded] = useState(opening ? isActivated(opening.slug) : false);

  const handleAdd = () => {
    if (!opening) return;
    activateOpening(opening.slug);
    setAdded(true);
  };

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <div className="rounded-xl border border-ink-900 bg-ink-900 p-4">
        <p className="text-sm leading-relaxed text-ink-200">{summarise(a)}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <MiniStat label="game plies" value={a.totalPlies} />
          <MiniStat label="book plies" value={a.bookPly} accent="text-emerald-600" />
          <MiniStat
            label="book %"
            value={a.totalPlies ? `${Math.round((a.bookPly / a.totalPlies) * 100)}%` : "—"}
            accent="text-emerald-600"
          />
        </div>
      </div>

      {/* Opening identity */}
      {opening ? (
        <div className="rounded-xl border border-ink-900 bg-ink-900 p-4">
          <div className="flex items-baseline gap-2">
            <span className="rounded bg-ink-900 px-2 py-0.5 font-mono text-xs font-bold">{opening.eco}</span>
            <Link to={`/study/openings/${opening.slug}`} className="text-base font-bold text-ink-100 hover:underline">
              {opening.name}
            </Link>
            {family && (
              <span className="text-[10px] uppercase tracking-wide" style={{ color: family.colorHex }}>
                · {family.name}
              </span>
            )}
          </div>
          {opening.idea?.short && (
            <p className="mt-1 text-xs text-ink-400">{opening.idea.short}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {opening.tagSlugs.slice(0, 6).map((s) => {
              const t = tagBySlug.get(s);
              if (!t) return null;
              return (
                <span key={s} className="rounded bg-ink-950 px-1.5 py-0.5 text-[10px] text-ink-400">
                  {t.glyph ? `${t.glyph} ` : ""}{t.label}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This opening isn't in the 500-corpus yet. Try a mainline (Sicilian, Ruy Lopez, Queen's Gambit …).
        </div>
      )}

      {/* Deviation */}
      {a.deviation && opening && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-orange-700">First deviation</div>
          <div className="mb-3">
            <EngineCoach fen={a.deviation.fenBefore} declaredSan={a.deviation.theory}
              ctaLabel="Was theory right? Ask the engine" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div className="max-w-xs">
              <Board fen={a.deviation.fenBefore} viewOnly coordinates
                orientation={a.deviation.side === "white" ? "white" : "black"} />
            </div>
            <div className="text-sm">
              <p className="mb-2 text-orange-900">
                Move <b>{Math.ceil(a.deviation.ply / 2)}{a.deviation.side === "black" ? "…" : "."}</b> — <b>{a.deviation.side}</b> to play.
              </p>
              <p className="text-xs text-ink-400">You played</p>
              <p className="font-mono text-2xl font-bold text-red-700">{a.deviation.played}</p>
              <p className="mt-2 text-xs text-ink-400">Theory says</p>
              <p className="font-mono text-2xl font-bold text-emerald-700">{a.deviation.theory}</p>
              <div className="mt-3 flex flex-col gap-1.5">
                {!added ? (
                  <button onClick={handleAdd}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700">
                    🔁 Add {opening.name} cards to daily queue
                  </button>
                ) : (
                  <div className="rounded-lg bg-emerald-100 px-3 py-2 text-center text-xs font-bold text-emerald-800">
                    ✓ In your queue
                  </div>
                )}
                <Link to={`/study/openings/${opening.slug}`}
                  className="rounded-lg bg-ink-100 px-3 py-2 text-center text-xs font-bold text-white hover:bg-ink-200">
                  Read the theory →
                </Link>
                {deviationCardId(a) && (
                  <Link to="/study/daily"
                    className="rounded-lg bg-ink-900 px-3 py-2 text-center text-xs font-bold text-ink-200 ring-1 ring-ink-800 hover:bg-ink-950">
                    Review deviation card →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!a.deviation && opening && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm font-semibold text-emerald-800">
          🎉 You followed the full mainline — no deviation from theory.
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-lg bg-ink-950 p-2">
      <div className={`text-lg font-bold ${accent ?? "text-ink-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
    </div>
  );
}
