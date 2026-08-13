import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import type { Difficulty } from "@chessguru/types";
import Board from "../components/Board";
import SolvedStrip from "../components/SolvedStrip";
import { api, get } from "../lib/api";
import { usePuzzleGame } from "../hooks/usePuzzleGame";
import MilestoneOverlay from "../components/MilestoneOverlay";
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

// Pick the puzzle's OWN representative theme (skip broad/length tags) — used to label the
// header while reviewing so it reflects the opened puzzle, not the leftover theme selector.
const REVIEW_GENERIC = new Set(["short", "long", "veryLong", "oneMove", "middlegame", "opening", "endgame", "master", "masterVsMaster", "superGM", "crushing", "advantage", "equality", "mate"]);
function primaryTheme(themes: string[] = []) {
  const m = themes.find((t) => /^mateIn\d/.test(t)); if (m) return m;
  const t = themes.find((x) => !REVIEW_GENERIC.has(x)); if (t) return t;
  return themes[0] ?? "Other";
}

// Homework doc shape (subset the trainer cares about — from GET /api/me/homework).
type StudentHwDoc = {
  _id: string;
  title: string;
  tasks: Array<{ kind: string; theme?: string; targetCount?: number; targetRating?: number }>;
  progress: Record<string, number>;
  dueAt?: string;
};

export default function PuzzlesPage() {
  const { userId, rating } = useOutletContext<Ctx>();
  const [searchParams, setSearchParams] = useSearchParams();
  // Homework-mode deep-link from the student dashboard:
  //   /?theme=pin&rating=1234&hw=<homeworkId>&hwTaskIdx=0
  // In this mode the trainer is LOCKED to the homework's theme + student's
  // rating band, shows a purple progress banner, and posts to
  // /api/me/homework/:id/advance on every solve (owner 2026-08-12: "students
  // finish assigned homework only, when opening homework").
  const hwId = searchParams.get("hw");
  const hwTaskIdx = Math.max(0, Number(searchParams.get("hwTaskIdx") ?? 0));
  const urlTheme = searchParams.get("theme");
  const urlRating = Number(searchParams.get("rating"));
  const inHwMode = !!hwId;
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("cg_theme") || "mix"; } catch { return "mix"; } });
  // Sync URL ?theme=… into state ONCE on mount (deep link from homework or
  // any other source). Doesn't overwrite subsequent user picks.
  useEffect(() => {
    if (urlTheme && urlTheme !== theme) {
      setTheme(urlTheme);
      try { localStorage.setItem("cg_theme", urlTheme); } catch { /* */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [section, setSection] = useState<"normal" | "masters">(() => { try { return (localStorage.getItem("cg_section") as "normal" | "masters") || "normal"; } catch { return "normal"; } });
  const [player, setPlayer] = useState<string>("");
  const { data: masterPlayers } = useQuery({ queryKey: ["master-players"], queryFn: api.masterPlayers, enabled: section === "masters" });
  const { data: themes } = useQuery({ queryKey: ["themes"], queryFn: api.themes });
  // Selected-theme rating shown right on the training screen (owner 2026-07-08).
  type DashLite = { loggedIn: boolean; themes?: { theme: string; rating: number; games: number }[] };
  const { data: dashLite } = useQuery({ queryKey: ["dashboard"], queryFn: () => get<DashLite>("/api/puzzles/dashboard"), staleTime: 15_000 });
  const themePerf = theme !== "mix" && dashLite?.loggedIn ? dashLite.themes?.find((t) => t.theme === theme) : undefined;

  // In homework mode we honour ?rating= from the URL (snapshotted at assign
  // time by the coach's one-click flow); otherwise use the student's own
  // rating from the outlet context.
  const effectiveRating = inHwMode && urlRating > 0 ? urlRating : rating;
  const g = usePuzzleGame({ theme, difficulty, userId, initialRating: effectiveRating, section, player });

  // Fetch student's homework list to pull progress + target for the active
  // task. Only runs in homework mode; served from /api/me/homework which the
  // dashboard already caches so this is usually a hit.
  const { data: myHw, refetch: refetchHw } = useQuery({
    queryKey: ["me-homework-active"],
    queryFn: () => get<StudentHwDoc[]>("/api/me/homework"),
    enabled: inHwMode,
    staleTime: 30_000,
  });
  const hwDoc = inHwMode ? (myHw ?? []).find((h) => h._id === hwId) : undefined;
  const hwTask = hwDoc?.tasks?.[hwTaskIdx];
  const hwTarget = hwTask?.targetCount ?? 5;
  const hwProgress = Math.min(hwTarget, hwDoc?.progress?.[String(hwTaskIdx)] ?? 0);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  useEffect(() => { setLocalProgress(hwProgress); /* reset when hw doc arrives / refetches */ }, [hwProgress]);
  const shownProgress = localProgress ?? hwProgress;
  const hwDone = shownProgress >= hwTarget;

  // On each SUCCESSFUL solve while in hw mode, POST advance once. Uses a ref
  // guard so the same solve doesn't double-post when React re-renders.
  const solvedGuard = useRef<{ solved: boolean; failed: boolean }>({ solved: false, failed: false });
  useEffect(() => {
    if (!inHwMode || !hwId) { solvedGuard.current = { solved: false, failed: false }; return; }
    // Rising edge: solved just flipped from false → true AND wasn't failed.
    const wasSolved = solvedGuard.current.solved;
    if (g.solved && !wasSolved && !g.failed) {
      solvedGuard.current = { solved: true, failed: g.failed };
      // Optimistic bump; server confirms
      setLocalProgress((p) => Math.min((p ?? 0) + 1, hwTarget));
      fetch(`${(import.meta as any).env?.VITE_API_BASE ?? ""}/api/me/homework/${encodeURIComponent(hwId)}/advance`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIndex: hwTaskIdx }),
      }).then(() => refetchHw()).catch(() => { /* best-effort; local optimistic still stands */ });
    } else if (!g.solved) {
      solvedGuard.current = { solved: false, failed: false };
    }
  }, [g.solved, g.failed, inHwMode, hwId, hwTaskIdx, hwTarget, refetchHw]);

  // Deep-link handoff from the History page: /?review=<id> auto-loads that solve
  // in review mode. We consume the param once, then strip it so a refresh doesn't
  // trap the user in review-of-N forever. (searchParams/setSearchParams are
  // already destructured above the hw-mode block near the top of the fn.)
  useEffect(() => {
    const rid = searchParams.get("review");
    if (!rid) return;
    g.review(rid);
    const next = new URLSearchParams(searchParams); next.delete("review");
    setSearchParams(next, { replace: true });
    // g.review is stable (useCallback) but eslint-plugin-react-hooks can't prove it —
    // deliberately omit from deps so we consume the param exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reviewing a past solve? Fetch the user's round for the puzzle so we can show
  // WHAT went wrong (red arrow of the wrong move + green arrow of the best move)
  // and a SAN callout in the sidebar. Only runs while a review is active — hidden
  // when the user clicks Next / picks a fresh puzzle.
  const { data: reviewRound } = useQuery({
    queryKey: ["me-round", g.puzzle?.id],
    enabled: !!g.puzzle?.id && g.reviewing,
    queryFn: () => api.myRound(g.puzzle!.id),
    staleTime: 60_000,
  });
  const round = reviewRound?.round ?? null;
  // Convert UCIs to SAN using the puzzle's starting FEN so the callout reads like a
  // human ("Nf3", not "g1f3"). If SAN conversion fails (bad move / promotion edge),
  // fall back to the raw UCI so we never crash the page.
  const analysis = useMemo(() => {
    if (!g.reviewing || !round || !g.puzzle?.fen) return null;
    const toSan = (uci: string | null): string | null => {
      if (!uci) return null;
      try {
        const c = new Chess(g.puzzle!.fen);
        const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) || "q" });
        return mv?.san ?? uci;
      } catch { return uci; }
    };
    const wrongSan = toSan(round.wrong);
    const bestSan  = toSan(round.best);
    const shapes: DrawShape[] = [];
    if (round.wrong) shapes.push({ orig: round.wrong.slice(0, 2) as Key, dest: round.wrong.slice(2, 4) as Key, brush: "red" });
    if (round.best)  shapes.push({ orig: round.best.slice(0, 2) as Key,  dest: round.best.slice(2, 4) as Key,  brush: "green" });
    return { shapes, wrongSan, bestSan, win: round.win };
  }, [g.reviewing, g.puzzle?.fen, round]);
  // Board shapes: analysis arrows take priority over normal hint shapes while reviewing.
  const boardShapes = analysis?.shapes.length ? analysis.shapes : g.hintShapes;

  // Mixed ("All themes") puzzles hide their theme so it is not a spoiler;
  // reveal on demand and re-hide whenever the puzzle changes.
  const [showTheme, setShowTheme] = useState(false);
  useEffect(() => { setShowTheme(false); }, [g.puzzle?.id]);

  // Keyboard shortcuts. Bound to window so they fire regardless of focus, but
  // we bail whenever the user is typing into an input/textarea/contentEditable
  // (Blindfold's SAN input in particular), or holding any modifier so we don't
  // hijack the browser's own Ctrl+N / Cmd+R.
  const [showShortcuts, setShowShortcuts] = useState(false);
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (k === "?" || (ev.key === "/" && ev.shiftKey)) { setShowShortcuts((v) => !v); ev.preventDefault(); return; }
      if (k === "escape") { if (showShortcuts) setShowShortcuts(false); return; }
      // Solved-only actions
      if (g.solved && (k === "n" || k === " ")) { ev.preventDefault(); g.next(); return; }
      if (g.solved && g.failed && k === "r") { ev.preventDefault(); g.retry(); return; }
      if (g.solved && g.replayTotal > 0 && !g.exploring) {
        if (k === "arrowleft")  { ev.preventDefault(); g.replayPrev(); return; }
        if (k === "arrowright") { ev.preventDefault(); g.replayNext(); return; }
      }
      // Unsolved shortcuts — hint / solution only make sense mid-solve.
      if (!g.solved) {
        if (k === "h") { ev.preventDefault(); g.showHint(); return; }
        if (k === "s") { ev.preventDefault(); g.viewSolution(); return; }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [g.solved, g.failed, g.replayTotal, g.exploring, showShortcuts, g.next, g.retry, g.replayPrev, g.replayNext, g.showHint, g.viewSolution]);
  const tacticalThemes = (g.puzzle?.themes ?? []).filter((t) => !META_THEMES.has(t));
  // Always surface something: a tactical motif if present, else the meaningful meta
  // tag (mate-in-N, endgame type, phase) — only pure-noise tags are dropped.
  const displayThemes = tacticalThemes.length ? tacticalThemes : (g.puzzle?.themes ?? []).filter((t) => !NOISE_THEMES.has(t));
  // Reveal on demand, and automatically once solved (shows "what it was", no spoiler).
  const revealTheme = showTheme || g.fb.kind === "solved";
  const fbColor = { wait: "text-ink-300", good: "text-accent-400", bad: "text-rose-400", solved: "text-accent-400" }[g.fb.kind];

  return (
    <div className="grid gap-6 lg:h-[calc(100dvh-6.5rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
      {/* Homework mode banner — spans both columns. Locks theme + shows
       *  progress bar + celebrates when task is complete. */}
      {inHwMode && (
        <div className="lg:col-span-2 mb-1 rounded-xl border-2 border-purple-500/60 bg-gradient-to-r from-purple-500/20 via-fuchsia-500/10 to-purple-500/10 p-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-purple-200">🎯 Homework mode</div>
              <div className="mt-0.5 truncate text-sm text-white">
                <b className="font-display">{hwDoc?.title ?? "Practice"}</b>
                <span className="mx-2 text-purple-300">·</span>
                Theme: <b>{urlTheme || theme}</b>
                {hwTask?.targetRating != null && (
                  <>
                    <span className="mx-2 text-purple-300">·</span>
                    Rating band: ~{hwTask.targetRating}
                  </>
                )}
                <span className="mx-2 text-purple-300">·</span>
                <b className="tabular-nums">{shownProgress}/{hwTarget}</b> solved
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {hwDone ? (
                <Link to="/dashboard"
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-bold text-white shadow hover:bg-emerald-400">
                  ✓ Done — back to dashboard
                </Link>
              ) : (
                <button
                  onClick={() => { setSearchParams({}, { replace: true }); location.reload(); }}
                  title="Exit homework mode — you can come back from the dashboard"
                  className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800"
                >
                  Leave
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-[width] duration-500"
              style={{ width: `${Math.min(100, (shownProgress / hwTarget) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {/* Phase 7n: milestone celebration — only shown for first-time crossings. */}
      {g.milestone?.firstTime && (
        <MilestoneOverlay milestone={g.milestone.milestone} type={g.milestone.type} onClose={g.clearMilestone} />
      )}
      {/* Floating keyboard-shortcut help chip. Fixed bottom-right so it's
          always reachable without stealing valuable sidebar space. */}
      <button onClick={() => setShowShortcuts((v) => !v)}
        title="Keyboard shortcuts (press ? anytime)"
        className="fixed bottom-4 right-4 z-30 grid h-9 w-9 place-items-center rounded-full border border-ink-600 bg-ink-800/90 text-sm text-ink-300 shadow-lg backdrop-blur hover:bg-ink-700 hover:text-white">
        ?
      </button>
      {showShortcuts && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowShortcuts(false)}>
          <div onClick={(e) => e.stopPropagation()}
               className="w-full max-w-sm rounded-xl2 border border-brand-500/40 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg text-white">⌨ Shortcuts</h3>
              <button onClick={() => setShowShortcuts(false)}
                className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800">Close</button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
              {[
                { keys: ["N", "Space"], label: "Next puzzle", when: "when solved" },
                { keys: ["R"],          label: "Try again",   when: "on a missed puzzle" },
                { keys: ["H"],          label: "Hint",        when: "mid-solve" },
                { keys: ["S"],          label: "View solution", when: "mid-solve" },
                { keys: ["←", "→"],     label: "Replay prev / next", when: "when solved" },
                { keys: ["?"],          label: "Toggle this panel", when: "" },
              ].map((row) => (
                <div key={row.label} className="contents">
                  <span className="flex gap-1">
                    {row.keys.map((k) => (
                      <kbd key={k} className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] font-semibold text-brand-100 shadow-sm">{k}</kbd>
                    ))}
                  </span>
                  <span className="text-ink-200">
                    {row.label}
                    {row.when && <span className="ml-1 text-[11px] text-ink-500">— {row.when}</span>}
                  </span>
                </div>
              ))}
            </dl>
            <div className="mt-3 text-[11px] text-ink-500">Shortcuts skip while you're typing in an input.</div>
          </div>
        </div>
      )}
      <section className="min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:justify-center">
        <Board
          fen={g.fen} orientation={g.orientation} turnColor={g.turnColor}
          movableColor={g.movableColor} dests={g.dests} lastMove={g.lastMove}
          shapes={boardShapes} onMove={g.onMove}
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
                <h1 className="font-display text-xl text-white">{section === "masters" ? "\u{1F451} Master Games" : g.reviewing && g.puzzle?.themes?.length ? prettify(primaryTheme(g.puzzle?.themes)) : theme === "mix" ? "Mixed puzzles" : prettify(theme)}</h1>
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

        {/* Analysis callout — visible only when reviewing a past solve. For a MISS it
            shows "you played X, best was Y" with matching red/green pills that echo the
            arrows drawn on the board. For a WIN it just labels the arrow legend so the
            replay reads clearly. Two follow-up buttons at the bottom: Try again (retry
            the SAME puzzle in practice mode — no rating), Try similar (fresh puzzle at
            same theme). */}
        {g.reviewing && analysis && (analysis.wrongSan || analysis.bestSan) && (
          <div className={`rounded-xl2 border p-4 ${analysis.win ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-ink-900" : "border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-ink-900"}`}>
            <div className="mb-2 text-sm font-semibold text-white">
              {analysis.win ? "🔍 Replay" : "🔎 What went wrong"}
            </div>
            {!analysis.win && analysis.wrongSan && (
              <div className="flex items-center justify-between rounded-lg bg-rose-500/10 px-3 py-2">
                <span className="text-xs text-rose-300/80">You played</span>
                <span className="font-display text-base font-bold text-rose-200 tabular-nums">
                  <span className="mr-1">↳</span>{analysis.wrongSan}
                </span>
              </div>
            )}
            {analysis.bestSan && (
              <div className="mt-1.5 flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2">
                <span className="text-xs text-emerald-300/80">{analysis.win ? "Winning move" : "Best move was"}</span>
                <span className="font-display text-base font-bold text-emerald-200 tabular-nums">
                  <span className="mr-1">✓</span>{analysis.bestSan}
                </span>
              </div>
            )}
            <div className="mt-2 text-[11px] text-ink-500">Arrows on the board show the same moves — 🔴 wrong, 🟢 best.</div>
            {/* Follow-up actions. Retry only for misses — a win has nothing to reprove.
                Try-similar picks the first tactical theme so it filters, not resets. */}
            <div className="mt-3 flex gap-2">
              {!analysis.win && (
                <button onClick={g.retry}
                  className="flex-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:from-emerald-400 hover:to-teal-400">
                  ▶ Try again
                </button>
              )}
              {tacticalThemes.length > 0 && (
                <button onClick={() => { const t = tacticalThemes[0]; if (!t) return; try { localStorage.setItem("cg_theme", t); } catch { /* */ } setTheme(t); g.next(); }}
                  className="flex-1 rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-2 text-sm font-semibold text-brand-100 hover:bg-brand-500/20">
                  ↻ Try similar
                </button>
              )}
            </div>
          </div>
        )}

        {/* Practice-mode banner — replaces the analysis card while retrying. Reminds the
            user this attempt won't count so they don't wonder why their rating didn't move. */}
        {g.practice && !g.solved && (
          <div className="rounded-xl2 border border-teal-500/30 bg-gradient-to-br from-teal-500/10 to-ink-900 p-4">
            <div className="text-sm font-semibold text-teal-200">🧪 Practice run</div>
            <div className="mt-1 text-xs text-ink-400">Rating stays untouched — you're re-solving after seeing the answer.</div>
          </div>
        )}

        {theme === "mix" && displayThemes.length > 0 && (
          <div className="rounded-xl2 border border-brand-500/25 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-300">
                <span className="text-brand-300">🎭 This puzzle's theme</span>
                <span className="ml-2 text-xs text-ink-500">(you're playing "All themes")</span>
              </span>
              {g.fb.kind === "solved" ? (
                <span className="shrink-0 text-xs text-accent-400">✓ revealed</span>
              ) : showTheme ? (
                <button onClick={() => setShowTheme(false)} className="shrink-0 text-xs text-ink-400 underline hover:text-ink-200">Hide</button>
              ) : (
                <button onClick={() => setShowTheme(true)} className="shrink-0 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-200 hover:bg-brand-500/20">Peek</button>
              )}
            </div>
            {revealTheme && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {displayThemes.map((t) => (
                  <span key={t} className="rounded-md border border-brand-500/30 bg-brand-500/10 px-2 py-1 text-xs font-medium text-brand-100">{prettify(t)}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Theme</label>
          <select
            value={theme}
            disabled={inHwMode}
            title={inHwMode ? "Theme is locked by your homework assignment" : undefined}
            onChange={(e) => { const t = e.target.value; try { localStorage.setItem("cg_theme", t); localStorage.removeItem("cg_puzzle"); } catch { /* */ } setTheme(t); }}
            className={`mb-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white ${inHwMode ? "cursor-not-allowed opacity-60" : ""}`}>
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
