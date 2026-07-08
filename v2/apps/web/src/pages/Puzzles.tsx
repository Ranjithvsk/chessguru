import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Difficulty } from "@chessguru/types";
import Board from "../components/Board";
import SolvedStrip from "../components/SolvedStrip";
import { api, get } from "../lib/api";
import { usePuzzleGame } from "../hooks/usePuzzleGame";
import { prettify } from "../lib/format";

type Ctx = { userId: string | null; rating: number };
const DIFFS: Difficulty[] = ["easiest", "easier", "normal", "harder", "hardest"];
// Non-tactical "meta" theme tags (game phase, endgame type, puzzle length,
// eval goal, generic mate-in-N, source) — hidden so only real tactical motifs show.
const META_THEMES = new Set<string>([
  "opening", "middlegame", "endgame",
  "rookEndgame", "bishopEndgame", "pawnEndgame", "knightEndgame", "queenEndgame", "queenRookEndgame",
  "oneMove", "short", "long", "veryLong",
  "advantage", "crushing", "equality",
  "mate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5",
  "master", "masterVsMaster", "superGM",
]);

// Pure noise tags — never worth showing even as a fallback (length, eval goal, source).
const NOISE_THEMES = new Set<string>([
  "oneMove", "short", "long", "veryLong",
  "advantage", "crushing", "equality",
  "master", "masterVsMaster", "superGM",
]);

export default function PuzzlesPage() {
  const { userId, rating } = useOutletContext<Ctx>();
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("cg_theme") || "mix"; } catch { return "mix"; } });
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [section, setSection] = useState<"normal" | "masters">(() => { try { return (localStorage.getItem("cg_section") as "normal" | "masters") || "normal"; } catch { return "normal"; } });
  const [player, setPlayer] = useState<string>("");
  const { data: masterPlayers } = useQuery({ queryKey: ["master-players"], queryFn: api.masterPlayers, enabled: section === "masters" });
  const { data: themes } = useQuery({ queryKey: ["themes"], queryFn: api.themes });
  // Selected-theme rating shown right on the training screen (owner 2026-07-08).
  type DashLite = { loggedIn: boolean; themes?: { theme: string; rating: number; games: number }[] };
  const { data: dashLite } = useQuery({ queryKey: ["dashboard"], queryFn: () => get<DashLite>("/api/puzzles/dashboard"), staleTime: 15_000 });
  const themePerf = theme !== "mix" && dashLite?.loggedIn ? dashLite.themes?.find((t) => t.theme === theme) : undefined;

  const g = usePuzzleGame({ theme, difficulty, userId, initialRating: rating, section, player });
  // Mixed ("All themes") puzzles hide their theme so it is not a spoiler;
  // reveal on demand and re-hide whenever the puzzle changes.
  const [showTheme, setShowTheme] = useState(false);
  useEffect(() => { setShowTheme(false); }, [g.puzzle?.id]);
  const tacticalThemes = (g.puzzle?.themes ?? []).filter((t) => !META_THEMES.has(t));
  // Always surface something: a tactical motif if present, else the meaningful meta
  // tag (mate-in-N, endgame type, phase) — only pure-noise tags are dropped.
  const displayThemes = tacticalThemes.length ? tacticalThemes : (g.puzzle?.themes ?? []).filter((t) => !NOISE_THEMES.has(t));
  // Reveal on demand, and automatically once solved (shows "what it was", no spoiler).
  const revealTheme = showTheme || g.fb.kind === "solved";
  const fbColor = { wait: "text-ink-300", good: "text-accent-400", bad: "text-rose-400", solved: "text-accent-400" }[g.fb.kind];

  return (
    <div className="grid gap-6 lg:h-[calc(100dvh-6.5rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
      <section className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:justify-center">
        <Board
          fen={g.fen} orientation={g.orientation} turnColor={g.turnColor}
          movableColor={g.movableColor} dests={g.dests} lastMove={g.lastMove}
          shapes={g.hintShapes} onMove={g.onMove}
        />
        {g.solved && g.replayTotal > 0 && !g.exploring && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <button onClick={g.replayPrev} aria-label="Previous move"
              className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-lg text-ink-200 hover:bg-ink-700">◀</button>
            <span className="min-w-[3rem] text-center text-sm tabular-nums text-ink-300">{(g.replayPly ?? g.replayTotal)} / {g.replayTotal}</span>
            <button onClick={g.replayNext} aria-label="Next move"
              className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-lg text-ink-200 hover:bg-ink-700">▶</button>
            <button onClick={g.startExplore}
              className="rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-300 hover:bg-ink-800">🔍 Try moves</button>
          </div>
        )}
        {g.exploring && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm text-ink-400">Explore — move <b className="text-ink-200">both sides</b> freely to try lines.</span>
            <button onClick={g.exploreUndo}
              className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">↶ Undo</button>
            <button onClick={g.stopExplore}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">Back to review</button>
          </div>
        )}
      </section>

      <aside className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <div className="flex gap-2">
          {([["normal", "Normal"], ["masters", "\u{1F451} Master Games"]] as const).map(([sec, label]) => (
            <button key={sec} onClick={() => { setSection(sec); try { localStorage.setItem("cg_section", sec); } catch { /* */ } }}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${section === sec ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
              {label}
            </button>
          ))}
        </div>

        {section === "masters" && (masterPlayers?.length ?? 0) > 0 && (
          <select value={player} onChange={(e) => setPlayer(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-200">
            <option value="">⭐ All master players</option>
            {(masterPlayers ?? []).map((mp) => <option key={mp.name} value={mp.name}>{mp.name} ({mp.count})</option>)}
          </select>
        )}
        {section === "masters" && (
          <div className="space-y-2">
            {g.puzzle?.winnerName && (
              <div className="rounded-xl2 border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <div className="text-[11px] uppercase tracking-wide text-amber-300/80">Master game</div>
                <div className="mt-1">
                  <span className="font-semibold text-amber-200">👑 {g.puzzle.winnerName}</span>
                  {g.puzzle.winnerElo ? <span className="text-ink-500"> ({g.puzzle.winnerElo})</span> : null}
                  <span className="text-ink-400"> found the winning move</span>
                </div>
                <div className="text-ink-400">vs {g.puzzle.loserName}{g.puzzle.loserElo ? ` (${g.puzzle.loserElo})` : ""} — you play {g.puzzle.pov === "white" ? "White" : "Black"}</div>
              </div>
            )}
          </div>
        )}
        {g.solved && (
          <button onClick={g.next} disabled={g.isFetching}
            className="w-full rounded-xl2 bg-brand-600 px-3 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {g.isFetching ? "…" : (g.reviewing ? "Back to training →" : "Next →")}
          </button>
        )}
        {g.puzzle && (
          <div className="flex items-center justify-between rounded-xl2 border border-ink-700 bg-ink-900 px-4 py-2.5">
            <span className="text-sm text-ink-400">Puzzle rating</span>
            <span className="font-display text-xl font-bold tabular-nums text-white">{g.puzzle.rating}</span>
          </div>
        )}
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-gradient text-white">♞</span>
              <div className="min-w-0">
                <h1 className="font-display text-xl text-white">{section === "masters" ? "\u{1F451} Master Games" : theme === "mix" ? "Mixed puzzles" : prettify(theme)}</h1>
                <p className="truncate text-sm text-ink-400">
                  {g.puzzle ? <>#{g.puzzle.id} · Rating {g.puzzle.rating} · Played {g.puzzle.plays ?? 0}</> : "Loading…"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <SolvedStrip onSelect={g.review} />

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-400">Your rating</span>
            <span className="text-lg font-semibold text-white">
              {g.displayRating}
              {g.ratingDiff != null && (
                <span className={g.ratingDiff >= 0 ? "ml-2 text-accent-400" : "ml-2 text-rose-400"}>
                  {g.ratingDiff >= 0 ? "+" : ""}{g.ratingDiff}
                </span>
              )}
            </span>
          </div>
          <div className={`mt-4 ${fbColor}`}>
            <div className="text-base font-semibold">{g.fb.title}</div>
            <div className="text-sm text-ink-400">{g.fb.sub}</div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={g.showHint} className="flex-1 rounded-lg border border-gold-500/60 px-3 py-2 text-sm text-gold-400 hover:bg-gold-500/10">💡 Hint</button>
            <button onClick={g.viewSolution} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">View Solution</button>
          </div>
        </div>

        {theme === "mix" && displayThemes.length > 0 && (
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-400">Puzzle theme</span>
              {g.fb.kind === "solved" ? (
                <span className="shrink-0 text-xs text-ink-500">solved</span>
              ) : showTheme ? (
                <button onClick={() => setShowTheme(false)} className="shrink-0 text-xs text-ink-400 underline hover:text-ink-200">Hide</button>
              ) : (
                <button onClick={() => setShowTheme(true)} className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800">Show</button>
              )}
            </div>
            {revealTheme && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {displayThemes.map((t) => (
                  <span key={t} className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-ink-200">{prettify(t)}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Theme</label>
          <select value={theme} onChange={(e) => { const t = e.target.value; try { localStorage.setItem("cg_theme", t); localStorage.removeItem("cg_puzzle"); } catch { /* */ } setTheme(t); }}
            className="mb-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            <option value="mix">All themes</option>
            {(themes?.themes ?? []).filter((t) => t !== "mix").map((t) => <option key={t} value={t}>{prettify(t)}</option>)}
          </select>
          {theme !== "mix" && dashLite?.loggedIn && (
            <p className="mb-3 flex items-baseline justify-between rounded-lg bg-ink-800 px-3 py-2 text-sm">
              <span className="text-ink-400">Your {prettify(theme)} rating</span>
              {themePerf
                ? <span className="font-semibold tabular-nums text-white">{themePerf.rating}{themePerf.games < 5 && <span className="text-gold-400">?</span>} <span className="text-xs text-ink-500">({themePerf.games})</span></span>
                : <span className="text-xs text-ink-500">unrated — this solve starts it!</span>}
            </p>
          )}
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Difficulty</label>
          <select value={difficulty} onChange={(e) => { try { localStorage.removeItem("cg_puzzle"); } catch { /* */ } setDifficulty(e.target.value as Difficulty); }}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
            {DIFFS.map((d) => <option key={d} value={d}>{prettify(d)}</option>)}
          </select>
          <button onClick={g.next} disabled={g.isFetching}
            className="mt-3 w-full rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-50">
            {g.isFetching ? "Loading…" : "New puzzle"}
          </button>
        </div>
      </aside>
    </div>
  );
}
