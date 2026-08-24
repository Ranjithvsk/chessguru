// Coach ChessDB — search the 24M-game master corpus, preview games, send as
// Gameplay Revise assignments to students.
// Route: /coach-board/chessdb

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import OpeningExplorer from "../components/OpeningExplorer";
import { useFreePlay } from "../hooks/useFreePlay";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { api, get } from "../lib/api";
import { chessdbApi, gameplayReviseApi, type ChessdbGame, type GameplayReviseAssignment } from "../lib/chessdb-api";

type Student = { _id: string; username: string; name?: string | null };

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
async function fetchStudents(): Promise<Student[]> {
  const r = await fetch(`${BASE}/api/academy/students`, { credentials: "include" });
  if (!r.ok) return [];
  return r.json();
}

// All games are branded as ChessGuru DB — original source names are hidden.
const DB_LABEL = "ChessGuru DB";

function eloColor(elo?: number | null) {
  if (!elo) return "bg-ink-700 text-ink-300";
  if (elo >= 2700) return "bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white";
  if (elo >= 2500) return "bg-gradient-to-r from-amber-500 to-rose-500 text-white";
  if (elo >= 2300) return "bg-gradient-to-r from-emerald-500 to-teal-500 text-white";
  if (elo >= 2000) return "bg-teal-600 text-white";
  return "bg-ink-700 text-ink-300";
}

function resultBadge(result?: string) {
  if (!result) return null;
  const cls = result === "1-0" ? "bg-emerald-600" : result === "0-1" ? "bg-rose-600" : "bg-amber-600";
  const label = result === "1-0" ? "W" : result === "0-1" ? "B" : result === "1/2-1/2" ? "½" : "?";
  return <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${cls}`}>{label}</span>;
}

export default function CoachChessdbPage() {
  const authQ = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const [tab, setTab] = useState<"explore" | "mine">("explore");

  if (authQ.data && !authQ.data.loggedIn) return <Navigate to="/login?back=/coach-board/chessdb" replace />;

  return (
    <div className="mx-auto max-w-7xl px-3 py-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-white flex items-center gap-2">
          <span className="text-3xl">♞</span> Master Games Library
        </h1>
        <p className="text-sm text-ink-400 mt-1">Master games curated by ChessGuru</p>
      </div>

      <div className="mb-4 flex gap-2 border-b border-ink-800">
        <TabBtn active={tab === "explore"} onClick={() => setTab("explore")}>🔍 Explore</TabBtn>
        <TabBtn active={tab === "mine"} onClick={() => setTab("mine")}>📋 My Assignments</TabBtn>
      </div>

      <ErrorBoundary label="Master Games Library">
        {tab === "explore" ? <ExploreTab /> : <MineTab />}
      </ErrorBoundary>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? "border-teal-400 text-teal-300" : "border-transparent text-ink-400 hover:text-ink-200"
      }`}
    >
      {children}
    </button>
  );
}

// -------------------- Explore Tab --------------------
// Shares OpeningExplorer with /openings — same move browser (tree, WDL bar,
// top moves, keyboard nav, wheel scrub). Adds a "Games at this position"
// panel in the right aside that surfaces master-corpus games matching the
// current line.
function ExploreTab() {
  const fp = useFreePlay();
  const [filters, setFilters] = useState({ white: "", black: "", event: "", eco: "", yearFrom: "", yearTo: "" });

  return (
    <OpeningExplorer
      fp={fp}
      asideExtra={<GamesAtPositionPanel fp={fp} filters={filters} setFilters={setFilters} />}
    />
  );
}

function GamesAtPositionPanel({ fp, filters, setFilters }: {
  fp: ReturnType<typeof useFreePlay>;
  filters: { white: string; black: string; event: string; eco: string; yearFrom: string; yearTo: string };
  setFilters: (f: typeof filters) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  // Convert fp.history (SAN moves) to UCI so the by-position endpoint can
  // prefix-match the movesUci index.
  const uciSeq = useMemo(() => {
    const c = new Chess();
    const out: string[] = [];
    for (const san of fp.history) {
      let mv;
      try { mv = c.move(san); } catch { break; }
      if (!mv) break;
      out.push(mv.from + mv.to + (mv.promotion || ""));
    }
    return out.join(" ");
  }, [fp.history]);

  const hasFilter = uciSeq.length > 0 || Object.values(filters).some((v) => v !== "");

  // Debounce text filters — board moves are already event-throttled by fp
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(filters), 400);
    return () => clearTimeout(t);
  }, [filters]);

  const gamesQ = useQuery({
    queryKey: ["chessdb-explore", uciSeq, debouncedFilters],
    queryFn: () => chessdbApi.byPosition({
      moves: uciSeq,
      white: debouncedFilters.white || undefined,
      black: debouncedFilters.black || undefined,
      event: debouncedFilters.event || undefined,
      eco: debouncedFilters.eco || undefined,
      yearFrom: debouncedFilters.yearFrom || undefined,
      yearTo: debouncedFilters.yearTo || undefined,
      limit: 30,
    }),
    enabled: hasFilter,
    placeholderData: (prev) => prev, // keep results visible while re-fetching
  });

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Master games at this position</h3>
        {gamesQ.data && hasFilter && !gamesQ.data.error && (
          <span className="text-xs text-ink-400">{gamesQ.data.count} shown</span>
        )}
      </div>

      {/* Compact filters row */}
      <details className="mb-2">
        <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-200">Filters</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <PlayerField label="White" value={filters.white} onChange={(v) => setFilters({ ...filters, white: v })} placeholder="Carlsen" />
          <PlayerField label="Black" value={filters.black} onChange={(v) => setFilters({ ...filters, black: v })} placeholder="Nepo" />
          <FilterField label="Event" value={filters.event} onChange={(v) => setFilters({ ...filters, event: v })} placeholder="World Ch." />
          <FilterField label="ECO" value={filters.eco} onChange={(v) => setFilters({ ...filters, eco: v.toUpperCase() })} placeholder="B90" />
          <FilterField label="From" value={filters.yearFrom} onChange={(v) => setFilters({ ...filters, yearFrom: v })} placeholder="2000" type="number" />
          <FilterField label="To" value={filters.yearTo} onChange={(v) => setFilters({ ...filters, yearTo: v })} placeholder="2024" type="number" />
        </div>
      </details>

      {!hasFilter && (
        <div className="rounded-lg border border-dashed border-ink-700 p-4 text-center text-xs text-ink-500">
          Play a move or type a filter to see matching games.
        </div>
      )}
      {hasFilter && gamesQ.isFetching && !gamesQ.data && <div className="text-xs text-ink-400">Searching…</div>}
      {gamesQ.data && gamesQ.data.error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          ⏱ Backend busy — try again or narrow the query.
        </div>
      )}
      {gamesQ.data && !gamesQ.data.error && gamesQ.data.count === 0 && hasFilter && (
        <div className="rounded-lg border border-dashed border-ink-700 p-3 text-center text-xs text-ink-400">No games matched.</div>
      )}
      {gamesQ.data && gamesQ.data.count > 0 && (
        <div className="grid gap-1.5 max-h-[440px] overflow-y-auto pr-1">
          {gamesQ.data.items.map((g: any) => (
            <button key={g._id} onClick={() => setPreview(g._id)}
              className="text-left rounded-lg border border-ink-800 bg-ink-950/40 p-2 hover:border-teal-500/40 hover:bg-ink-900">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`px-1 py-0.5 rounded text-[9px] font-bold shrink-0 ${eloColor(g.whiteElo)}`}>{g.whiteElo || "?"}</span>
                <span className="text-xs font-semibold text-white truncate">{g.white || "?"}</span>
                <span className="text-ink-500 text-[10px]">vs</span>
                <span className={`px-1 py-0.5 rounded text-[9px] font-bold shrink-0 ${eloColor(g.blackElo)}`}>{g.blackElo || "?"}</span>
                <span className="text-xs font-semibold text-white truncate">{g.black || "?"}</span>
                <span className="ml-auto shrink-0 text-[10px]">{resultBadge(g.result)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-400">
                <span className="truncate">{g.event || "—"}</span>
                <span className="shrink-0">· {g.date || g.year || "—"}</span>
                {g.eco && <span className="ml-auto px-1 rounded bg-ink-800 text-cyan-300 shrink-0">{g.eco}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {preview && <GamePreviewModal gameId={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function FilterField({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase text-ink-500 mb-0.5 block">{label}</label>
      <input type={type || "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-white placeholder-ink-500 focus:border-teal-500 focus:outline-none" />
    </div>
  );
}

// Player search field with autocomplete (fuzzy match via /players/suggest)
// + recent searches from localStorage. Owner ask 2026-08-24: "even if type
// wrong name, % match; recent searched player list 1st next time".
const RECENT_PLAYERS_KEY = "cg_chessdb_recent_players";
function loadRecentPlayers(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_PLAYERS_KEY) || "[]").slice(0, 8); } catch { return []; }
}
function saveRecentPlayer(name: string) {
  try {
    const cur = loadRecentPlayers();
    const next = [name, ...cur.filter((n) => n !== name)].slice(0, 8);
    localStorage.setItem(RECENT_PLAYERS_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

function PlayerField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value);
  const [recents, setRecents] = useState<string[]>(() => loadRecentPlayers());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setQ(value); }, [value]);
  // Debounce fetch
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const suggestQ = useQuery({
    queryKey: ["player-suggest", debouncedQ],
    queryFn: () => get<{ items: Array<{ name: string; n: number }> }>(`/api/chessdb/players/suggest?q=${encodeURIComponent(debouncedQ)}&limit=10`),
    enabled: open && debouncedQ.length >= 2,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as any)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const pick = (name: string) => {
    setQ(name);
    onChange(name);
    saveRecentPlayer(name);
    setRecents(loadRecentPlayers());
    setOpen(false);
  };
  const suggestions = suggestQ.data?.items ?? [];
  // Ghost text: show completion of top suggestion when it starts with what
  // user typed (case-insensitive) OR when fuzzy-close. Owner ask 2026-08-24:
  // "auto fill while typing like ghost text even on fuzzy typing, space
  // fills the ghost text".
  const topSuggestion = suggestions[0]?.name || "";
  // Two ghost modes:
  //  a) EXACT prefix (case-insensitive) → show completion inline
  //  b) FUZZY (typo, no prefix match) → show " → Carlsen" hint at end
  //     to guide user; space still accepts full replace.
  const [ghostText, ghostMode] = ((): [string, "inline" | "hint" | ""] => {
    if (!topSuggestion || !q) return ["", ""];
    const qLc = q.toLowerCase();
    const tLc = topSuggestion.toLowerCase();
    if (tLc.startsWith(qLc)) return [topSuggestion.slice(q.length), "inline"];
    // Fuzzy: show hint at end
    return ["  →  " + topSuggestion, "hint"];
  })();
  const acceptGhost = () => {
    if (topSuggestion) pick(topSuggestion);
  };
  return (
    <div ref={wrapRef} className="relative">
      <label className="text-[10px] uppercase text-ink-500 mb-0.5 block">{label}</label>
      <div className="relative rounded bg-ink-950">
        {/* Ghost text underlay — same padding as input, typed portion invisible
            for horizontal alignment, ghost visible in dim gray. */}
        {ghostMode && (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center overflow-hidden whitespace-pre rounded border border-transparent px-2 py-1 text-xs text-ink-500">
            {ghostMode === "inline" ? (
              <>
                <span className="invisible">{q}</span>
                <span>{ghostText}</span>
              </>
            ) : (
              <>
                <span className="invisible">{q}</span>
                <span className="text-amber-400/70">{ghostText}</span>
              </>
            )}
            <span className="ml-3 text-[9px] italic opacity-70">↹ space</span>
          </div>
        )}
        <input type="text" value={q}
          onChange={(e) => { setQ(e.target.value); onChange(e.target.value); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            // Space or Tab or ArrowRight → accept top suggestion (works in
            // both inline-prefix and fuzzy-hint modes).
            if (ghostMode && (e.key === " " || e.key === "Tab" || e.key === "ArrowRight")) {
              e.preventDefault();
              acceptGhost();
            } else if (e.key === "Enter" && suggestions.length > 0) {
              e.preventDefault();
              acceptGhost();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="relative w-full rounded border border-ink-700 bg-transparent px-2 py-1 text-xs text-white placeholder-ink-500 focus:border-teal-500 focus:outline-none" />
      </div>
      {open && (recents.length > 0 || suggestions.length > 0) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-64 overflow-y-auto rounded border border-ink-700 bg-ink-900 shadow-lg">
          {q.length < 2 && recents.length > 0 && (
            <>
              <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-ink-500">Recent</div>
              {recents.map((r) => (
                <button key={"r-" + r} type="button" onClick={() => pick(r)}
                        className="block w-full truncate px-2 py-1 text-left text-xs text-ink-200 hover:bg-ink-800">
                  🕘 {r}
                </button>
              ))}
            </>
          )}
          {q.length >= 2 && suggestions.length > 0 && (
            <>
              {recents.length > 0 && q.length < 2 && <div className="my-0.5 h-px bg-ink-700" />}
              <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-ink-500">Matches</div>
              {suggestions.map((s) => (
                <button key={"s-" + s.name} type="button" onClick={() => pick(s.name)}
                        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs text-ink-200 hover:bg-ink-800">
                  <span className="truncate">{s.name}</span>
                  <span className="text-[10px] text-ink-500">{s.n}</span>
                </button>
              ))}
            </>
          )}
          {q.length >= 2 && suggestions.length === 0 && !suggestQ.isFetching && (
            <div className="px-2 py-2 text-[11px] text-ink-500">No matches — refine spelling</div>
          )}
          {suggestQ.isFetching && (
            <div className="px-2 py-2 text-[11px] text-ink-500">Searching…</div>
          )}
        </div>
      )}
    </div>
  );
}

function GameCard({ g, onClick }: { g: ChessdbGame & { movesPreview?: string }; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-left rounded-xl border border-ink-800 bg-ink-900/40 p-3 hover:bg-ink-900 hover:border-teal-500/50 transition-colors group">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${eloColor(g.whiteElo)}`}>{g.whiteElo || "?"}</span>
            <span className="text-sm font-semibold text-white truncate">{g.white || "Unknown"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${eloColor(g.blackElo)}`}>{g.blackElo || "?"}</span>
            <span className="text-sm font-semibold text-white truncate">{g.black || "Unknown"}</span>
          </div>
        </div>
        {resultBadge(g.result)}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-400">
        <span className="truncate">{g.event || "—"}</span>
        <span className="shrink-0">{g.date || g.year || "—"}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-500">
        {g.eco && <span className="px-1 py-0.5 rounded bg-ink-800 text-cyan-300">{g.eco}</span>}
        {g.plycount && <span>{Math.ceil(g.plycount / 2)} moves</span>}
      </div>
    </button>
  );
}

// -------------------- Game Preview Modal --------------------
function GamePreviewModal({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const gameQ = useQuery({ queryKey: ["chessdb-game", gameId], queryFn: () => chessdbApi.game(gameId) });
  const studentsQ = useQuery({ queryKey: ["academy-students"], queryFn: fetchStudents });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const createMut = useMutation({
    mutationFn: () => gameplayReviseApi.create({
      title: title || `${gameQ.data?.white || "?"} vs ${gameQ.data?.black || "?"}`,
      studentIds: Array.from(selected),
      sourceGameId: gameId,
      pgn: gameQ.data?.moves || "",
      coachNotes: notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gameplay-revise-mine"] });
      onClose();
    },
  });

  const g = gameQ.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-ink-800 bg-ink-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-800 p-4">
          <h2 className="font-display text-lg text-white">Game Details</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        {gameQ.isLoading ? <div className="p-6 text-sm text-ink-400">Loading…</div> : g ? (
          <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-ink-500 mb-1">White</div>
                <div className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded text-xs font-bold ${eloColor(g.whiteElo)}`}>{g.whiteElo || "?"}</span><span className="text-white font-semibold">{g.white}</span></div>
              </div>
              <div>
                <div className="text-xs text-ink-500 mb-1">Black</div>
                <div className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded text-xs font-bold ${eloColor(g.blackElo)}`}>{g.blackElo || "?"}</span><span className="text-white font-semibold">{g.black}</span></div>
              </div>
              <div><div className="text-xs text-ink-500 mb-1">Event</div><div className="text-sm text-white">{g.event || "—"}</div></div>
              <div><div className="text-xs text-ink-500 mb-1">Date</div><div className="text-sm text-white">{g.date || g.year || "—"}</div></div>
              <div><div className="text-xs text-ink-500 mb-1">Result</div><div className="flex items-center gap-2">{resultBadge(g.result)}<span className="text-sm text-white">{g.result}</span></div></div>
              <div><div className="text-xs text-ink-500 mb-1">ECO</div><div className="text-sm text-white">{g.eco || "—"}</div></div>
            </div>

            <div>
              <div className="text-xs text-ink-500 mb-1">Moves ({g.plycount ? Math.ceil(g.plycount / 2) : "?"} moves)</div>
              <div className="rounded-lg bg-ink-900 p-3 max-h-32 overflow-y-auto text-xs text-ink-300 font-mono whitespace-pre-wrap break-words">
                {g.moves || "(empty)"}
              </div>
            </div>

            <div className="text-xs text-ink-500">From {DB_LABEL}</div>

            {/* Send to students */}
            <div className="border-t border-ink-800 pt-4">
              <h3 className="text-sm font-semibold text-white mb-2">📤 Send as Gameplay Revise</h3>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${g.white} vs ${g.black}`}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white placeholder-ink-500 mb-2" />
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Coach notes (optional)"
                rows={2} className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-white placeholder-ink-500 mb-2" />

              <div className="text-xs text-ink-500 mb-1">Select students:</div>
              <div className="rounded-lg border border-ink-800 bg-ink-900 p-2 max-h-40 overflow-y-auto">
                {studentsQ.isLoading ? <div className="text-xs text-ink-400 p-2">Loading students…</div>
                  : (studentsQ.data || []).length === 0 ? <div className="text-xs text-ink-400 p-2">No students in roster.</div>
                    : (studentsQ.data || []).map((s) => (
                      <label key={s._id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-ink-800 rounded cursor-pointer">
                        <input type="checkbox" checked={selected.has(s._id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(s._id); else next.delete(s._id);
                            setSelected(next);
                          }} />
                        <span className="text-sm text-white">{s.name || s.username}</span>
                        <span className="text-xs text-ink-500">@{s.username}</span>
                      </label>
                    ))}
              </div>

              <div className="mt-3 flex justify-between items-center">
                <span className="text-xs text-ink-500">{selected.size} selected</span>
                <button disabled={selected.size === 0 || createMut.isPending}
                  onClick={() => createMut.mutate()}
                  className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-40 hover:opacity-90">
                  {createMut.isPending ? "Sending…" : `Send to ${selected.size} student${selected.size === 1 ? "" : "s"}`}
                </button>
              </div>
              {createMut.error && <div className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{String((createMut.error as any)?.message || createMut.error)}</div>}
            </div>
          </div>
        ) : <div className="p-6 text-sm text-ink-400">Not found.</div>}
      </div>
    </div>
  );
}

// -------------------- Mine Tab --------------------
function MineTab() {
  const qc = useQueryClient();
  const mineQ = useQuery({ queryKey: ["gameplay-revise-mine"], queryFn: gameplayReviseApi.mine });

  return (
    <div>
      {mineQ.isLoading && <div className="text-sm text-ink-400">Loading assignments…</div>}
      {mineQ.data && mineQ.data.length === 0 && <div className="rounded-xl border border-dashed border-ink-700 p-8 text-center text-sm text-ink-400">
        No assignments yet. Go to Explore → pick a game → send to students.
      </div>}
      {mineQ.data && mineQ.data.length > 0 && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {mineQ.data.map((a) => <AssignmentCard key={a._id} a={a} onDeleted={() => qc.invalidateQueries({ queryKey: ["gameplay-revise-mine"] })} />)}
        </div>
      )}
    </div>
  );
}

function AssignmentCard({ a, onDeleted }: { a: GameplayReviseAssignment; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(a.coachNotes);
  const [title, setTitle] = useState(a.title);
  const qc = useQueryClient();
  const saveMut = useMutation({
    mutationFn: () => gameplayReviseApi.update(a._id, { title, coachNotes: notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gameplay-revise-mine"] }); setEditing(false); },
  });
  const delMut = useMutation({ mutationFn: () => gameplayReviseApi.del(a._id), onSuccess: onDeleted });

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        {editing ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-white" />
        ) : (
          <h3 className="font-semibold text-white flex-1">{a.title}</h3>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">v{a.version}</span>
      </div>
      <div className="text-xs text-ink-400 mb-2">
        Sent to {a.studentIds.length} student{a.studentIds.length === 1 ? "" : "s"} · Updated {new Date(a.updatedAt).toLocaleDateString()}
      </div>
      {editing ? (
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-white mb-2" />
      ) : (
        a.coachNotes && <div className="text-xs text-ink-300 mb-2 italic">"{a.coachNotes}"</div>
      )}
      <div className="text-[10px] text-ink-500 font-mono truncate mb-2">{a.pgn.slice(0, 80)}{a.pgn.length > 80 ? "…" : ""}</div>
      <div className="flex gap-2 justify-end">
        {editing ? (
          <>
            <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs rounded border border-ink-700 text-ink-300 hover:bg-ink-800">Cancel</button>
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              className="px-3 py-1 text-xs rounded bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-40">
              {saveMut.isPending ? "Saving…" : "Save (bumps version)"}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="px-3 py-1 text-xs rounded border border-ink-700 text-ink-300 hover:bg-ink-800">Edit</button>
            <button onClick={() => { if (confirm(`Delete "${a.title}"?`)) delMut.mutate(); }}
              className="px-3 py-1 text-xs rounded border border-rose-700/40 text-rose-300 hover:bg-rose-900/40">Delete</button>
          </>
        )}
      </div>
    </div>
  );
}
