// ChessGuru DB — search surface over the deduped master-game corpus.
// (Named "Ultra Database" when built, renamed 2026-09-21. The route /database and the API
//  path /api/ultra-db were left alone: changing a live route would break any
//  link already shared, and the API path is not user-visible.)
// Route: /database
//
// The existing /broadcasts browser filters by Elo, result, a name regex and a
// date range, and shows rows. That answers "recent strong games" and little
// else. What you actually open a chess database for is:
//
//   a PLAYER with a colour and a score — "Carlsen as Black", and how he did
//   an OPENING by its moves — everything that began 1.e4 c5 2.Nf3
//   the SHAPE of the result set — score split, top lines, which years
//   and then to take a game away with you — into My Studies, or as PGN
//
// So this page is two halves: the rows, and an answer panel above them that is
// computed over the SAME filter, so the summary can never disagree with the
// list underneath it.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "../lib/api";

type Row = {
  _id: string;
  whiteName?: string; blackName?: string;
  whiteElo?: number; blackElo?: number;
  event?: string; date?: string; dateKey?: string; result?: string; round?: string; ply?: number;
  eco?: string | null; openingName?: string | null;
};
/** 12,145,183 -> "12.1M". Feeds the "of N" caption, which used to be the literal
 *  string "1.09M" and stayed that way when this page was repointed at a corpus ten
 *  times larger -- so it read "0 of 1.09M" while searching 12.1M games. */
function compactCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

type SearchResp = { ok: boolean; rows: Row[]; total: number; totalIsCapped: boolean; offset: number; limit: number };
type StatsResp = {
  ok: boolean;
  byResult: { result: string; n: number }[];
  topOpenings: { line: string; n: number }[];
  byYear: { year: string; n: number }[];
  summary: { avgWhiteElo: number; avgBlackElo: number; topElo: number; avgPly: number } | null;
  playerScore: { wins: number; draws: number; losses: number } | null;
};

const PAGE = 25;
// The reference viewer (TKT-254) sorts by Index, Date, Alphabet White, Elo
// White, Alphabet Black, Elo Black, Result and ECO. Same set here, minus
// "Index" (an internal row number means nothing to a coach) and plus game
// length, which is how you find a miniature.
const SORTS = [
  { id: "date", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "elo", label: "White Elo" },
  { id: "eloBlack", label: "Black Elo" },
  { id: "white", label: "White A–Z" },
  { id: "black", label: "Black A–Z" },
  { id: "eco", label: "ECO" },
  { id: "result", label: "Result" },
  { id: "short", label: "Shortest" },
  { id: "long", label: "Longest" },
];

export default function UltraDatabase() {
  // ── the query ─────────────────────────────────────────────────────
  // Seeded from, and mirrored back into, the URL. Before this the whole query lived only in
  // component state: opening a game unmounted the page and every filter was gone, so coming
  // back -- or pressing reload -- landed you on an empty form with your search lost. The
  // page was already building exactly the right URLSearchParams for its API call; it simply
  // never put them in the address bar. Now the query IS the URL, which also makes a search
  // shareable and the browser's Back button work the way people expect.
  const [sp, setSp] = useSearchParams();
  const q0 = (k: string, d = "") => sp.get(k) ?? d;

  const [player, setPlayer] = useState(() => q0("player"));
  const [colour, setColour] = useState<"any" | "white" | "black">(
    () => (q0("colour", "any") as "any" | "white" | "black"));
  const [opponent, setOpponent] = useState(() => q0("opponent"));
  const [text, setText] = useState(() => q0("q"));
  const [opening, setOpening] = useState(() => q0("opening"));
  const [result, setResult] = useState(() => q0("result"));
  const [bothElo, setBothElo] = useState(() => Number(q0("bothElo", "0")) || 0);
  const [from, setFrom] = useState(() => q0("from"));
  const [to, setTo] = useState(() => q0("to"));
  const [minPly, setMinPly] = useState(() => q0("minPly"));
  const [maxPly, setMaxPly] = useState(() => q0("maxPly"));
  const [eco, setEco] = useState(() => q0("eco"));
  const [sort, setSort] = useState(() => q0("sort", "date"));
  const [offset, setOffset] = useState(() => Number(q0("offset", "0")) || 0);
  // Table or list, as the reference viewer offers. Table is for scanning a
  // tournament; list is for reading on a phone. Remembered, because a coach
  // has a preference and re-picking it every visit is friction.
  const [view, setView] = useState<"list" | "table">(() => {
    try { return (localStorage.getItem("cg-udb-view") as "list" | "table") || "list"; } catch { return "list"; }
  });
  useEffect(() => { try { localStorage.setItem("cg-udb-view", view); } catch { /* private mode */ } }, [view]);
  // Multi-select, for bulk download / bulk save.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Debounced copy — typing a player name should not fire a query per keystroke
  // against a million rows.
  // Seeded from the URL too: starting it empty would fire one query with no filters on every
  // reload, flashing an unfiltered result set before the real one arrived.
  const [live, setLive] = useState(() => ({
    player: sp.get("player") ?? "", opponent: sp.get("opponent") ?? "",
    text: sp.get("q") ?? "", opening: sp.get("opening") ?? "",
  }));
  useEffect(() => {
    const h = setTimeout(() => {
      setLive({ player, opponent, text, opening });
      setOffset(0);
    }, 350);
    return () => clearTimeout(h);
  }, [player, opponent, text, opening]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (live.player) { p.set("player", live.player); if (colour !== "any") p.set("colour", colour); }
    if (live.opponent) p.set("opponent", live.opponent);
    if (live.text) p.set("q", live.text);
    if (live.opening) p.set("opening", live.opening);
    if (result) p.set("result", result);
    if (eco.trim()) p.set("eco", eco.trim());
    if (bothElo) p.set("bothElo", String(bothElo));
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (minPly) p.set("minPly", minPly);
    if (maxPly) p.set("maxPly", maxPly);
    p.set("sort", sort);
    return p;
  }, [live, colour, result, eco, bothElo, from, to, minPly, maxPly, sort]);

  // Mirror the query back into the address bar. `replace` rather than `push`: a filter is not
  // a navigation, and pushing one entry per keystroke would make Back walk backwards through
  // every character typed. Replacing keeps the CURRENT history entry carrying the query, so
  // opening a game and pressing Back returns to the search exactly as it was, and reload
  // rebuilds it from the URL.
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (offset) next.set("offset", String(offset));
    if (next.toString() !== sp.toString()) setSp(next, { replace: true });
    // `sp` is deliberately not a dependency: it changes as a RESULT of this effect, and the
    // string comparison above is what stops the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, offset]);

  const hasQuery = params.toString() !== "sort=date" && [...params.keys()].some((k) => k !== "sort");

  const search = useQuery<SearchResp>({
    queryKey: ["ultradb", params.toString(), offset],
    queryFn: () => get<SearchResp>(`/api/ultra-db/search?${params.toString()}&limit=${PAGE}&offset=${offset}`),
    staleTime: 30_000,
  });
  const corpus = useQuery<{ ok: boolean; total: number }>({
    queryKey: ["ultradb-count"],
    queryFn: () => get<{ ok: boolean; total: number }>("/api/ultra-db/count"),
    staleTime: 60 * 60_000,     // changes when the corpus is rebuilt, not per session
  });
  const stats = useQuery<StatsResp>({
    queryKey: ["ultradb-stats", params.toString()],
    queryFn: () => get<StatsResp>(`/api/ultra-db/stats?${params.toString()}`),
    staleTime: 60_000,
    enabled: hasQuery,          // the whole-library stats are meaningless, and slow
  });

  const rows = search.data?.rows ?? [];
  const total = search.data?.total ?? 0;

  const reset = () => {
    setPlayer(""); setOpponent(""); setText(""); setOpening(""); setResult("");
    setBothElo(0); setFrom(""); setTo(""); setMinPly(""); setMaxPly(""); setEco("");
    setSort("date"); setOffset(0); setPicked(new Set());
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold text-white">ChessGuru DB</h1>
        <p className="mt-1 text-sm text-ink-400">
          Search the master game library by player, opening, strength or date — and take any game into your studies.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ── filters ─────────────────────────────────────────────── */}
        <aside className="min-w-0 space-y-4">
          <Panel title="Player">
            <Field label="Name">
              <input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="Carlsen, Magnus" className={INPUT} />
            </Field>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {(["any", "white", "black"] as const).map((c) => (
                <button key={c} onClick={() => { setColour(c); setOffset(0); }}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize transition-colors ${colour === c ? "border-brand-500/60 bg-brand-500/15 text-brand-100" : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                  {c === "any" ? "Either" : c}
                </button>
              ))}
            </div>
            <Field label="Opponent" className="mt-3">
              <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Any" className={INPUT} />
            </Field>
          </Panel>

          <Panel title="Opening">
            <Field label="Starts with these moves">
              <input value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="e4 c5 Nf3" className={`${INPUT} font-mono`} />
            </Field>
            <p className="mt-1 text-[11px] text-ink-500">Move numbers are ignored — “1. e4 c5” and “e4 c5” both work.</p>
          </Panel>

          <Panel title="Filters">
            <Field label="Both players rated at least">
              <select value={bothElo} onChange={(e) => { setBothElo(Number(e.target.value)); setOffset(0); }} className={INPUT}>
                {[0, 2000, 2200, 2400, 2500, 2600, 2700].map((v) => <option key={v} value={v}>{v === 0 ? "Any" : v + "+"}</option>)}
              </select>
            </Field>
            <Field label="ECO" className="mt-3">
              <input value={eco} onChange={(e) => { setEco(e.target.value.toUpperCase()); setOffset(0); }}
                     placeholder="C78, or just C" maxLength={3} className={`${INPUT} font-mono uppercase`} />
            </Field>
            <Field label="Result" className="mt-3">
              <select value={result} onChange={(e) => { setResult(e.target.value); setOffset(0); }} className={INPUT}>
                <option value="">Any</option>
                <option value="1-0">White won</option>
                <option value="0-1">Black won</option>
                <option value="1/2-1/2">Draw</option>
              </select>
            </Field>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="From"><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="2024.01.01" className={INPUT} /></Field>
              <Field label="To"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="2026.12.31" className={INPUT} /></Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Min plies"><input value={minPly} onChange={(e) => setMinPly(e.target.value)} inputMode="numeric" placeholder="—" className={INPUT} /></Field>
              <Field label="Max plies"><input value={maxPly} onChange={(e) => setMaxPly(e.target.value)} inputMode="numeric" placeholder="—" className={INPUT} /></Field>
            </div>
            <Field label="Event or name contains" className="mt-3">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tata Steel" className={INPUT} />
            </Field>
            <button onClick={reset} className="mt-4 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm font-semibold text-ink-200 hover:bg-ink-800">
              Clear all
            </button>
          </Panel>
        </aside>

        {/* ── answers + rows ──────────────────────────────────────── */}
        <section className="min-w-0 space-y-4">
          {hasQuery && <StatsPanel stats={stats.data} loading={stats.isLoading} player={live.player} />}

          {/* Count, sort, and the table/list switch — the reference viewer's
            *  "50/14.34M Games · Index ↓" row, with the sort exposed as chips
            *  rather than hidden behind a dropdown. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink-400">
              {search.isLoading ? "Searching…"
                : `${search.data?.totalIsCapped ? "10,000+" : total.toLocaleString()} game${total === 1 ? "" : "s"}`}
              {corpus.data?.total ? (
                <span className="text-ink-600"> · of {compactCount(corpus.data.total)}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {/* wraps: ten sort chips are wider than a 390px phone column */}
              <div className="flex flex-wrap items-center gap-1">
                {SORTS.map((x) => (
                  <button key={x.id} onClick={() => { setSort(x.id); setOffset(0); }}
                    className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${sort === x.id ? "bg-brand-500/20 text-brand-100" : "text-ink-400 hover:bg-ink-800 hover:text-ink-100"}`}>
                    {x.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setView(view === "list" ? "table" : "list")}
                title={view === "list" ? "Switch to table" : "Switch to list"}
                className="shrink-0 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-sm text-ink-200 hover:bg-ink-800">
                {view === "list" ? "▦" : "☰"}
              </button>
            </div>
          </div>

          {/* Bulk bar — only once something is picked, so it never occupies
            *  space for the common case of just browsing. */}
          {picked.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-500/10 px-3 py-2">
              <span className="text-sm font-semibold text-brand-100">{picked.size} selected</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button onClick={() => downloadPgn([...picked])}
                  className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1 text-xs font-semibold text-ink-100 hover:bg-ink-800">⬇ Download PGN</button>
                <button onClick={() => setPicked(new Set())}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-400 hover:text-white">Clear</button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-ink-800">
            {rows.length === 0 && !search.isLoading ? (
              <div className="p-8 text-center text-sm text-ink-400">
                No games match that. Try widening the rating or clearing the opening moves.
              </div>
            ) : view === "table" ? (
              <GameTable rows={rows} picked={picked} onPick={togglePick} highlight={live.player} />
            ) : (
              <div className="divide-y divide-ink-800/70">
                {rows.map((g) => (
                  <GameRow key={g._id} g={g} highlight={live.player}
                           picked={picked.has(g._id)} onPick={() => togglePick(g._id)} />
                ))}
              </div>
            )}
          </div>

          {rows.length > 0 && (
            <div className="flex items-center justify-between">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
                className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-200 disabled:opacity-40 hover:bg-ink-800">← Previous</button>
              <span className="text-xs tabular-nums text-ink-500">{offset + 1}–{offset + rows.length}</span>
              <button disabled={rows.length < PAGE} onClick={() => setOffset(offset + PAGE)}
                className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-200 disabled:opacity-40 hover:bg-ink-800">Next →</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const INPUT = "w-full rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500";

/** Fetch PGN for these games and hand the file to the browser. The server
 *  builds the PGN so the headers match what the library actually holds. */
async function downloadPgn(ids: string[]) {
  if (!ids.length) return;
  const r = await get<{ ok: boolean; pgn: string; count: number }>(`/api/ultra-db/pgn?ids=${ids.join(",")}`);
  if (!r?.pgn) return;
  const blob = new Blob([r.pgn], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ids.length === 1 ? `game-${ids[0]}.pgn` : `games-${ids.length}.pgn`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Dense table — the reference viewer's default, for scanning a tournament.
 *  Scrolls sideways INSIDE its own container so the page never does. */
function GameTable({ rows, picked, onPick, highlight }: { rows: Row[]; picked: Set<string>; onPick: (id: string) => void; highlight: string }) {
  const hit = (n?: string) =>
    highlight && n && n.toLowerCase().includes(highlight.toLowerCase().split(",")[0]!.trim()) ? "text-brand-200" : "text-ink-100";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-800 bg-ink-900/60 text-[11px] uppercase tracking-wide text-ink-500">
            <th className="w-8 px-2 py-2" />
            <th className="px-2 py-2 text-left font-semibold">Year</th>
            <th className="px-2 py-2 text-left font-semibold">White</th>
            <th className="px-2 py-2 text-right font-semibold">Elo</th>
            <th className="px-2 py-2 text-left font-semibold">Black</th>
            <th className="px-2 py-2 text-right font-semibold">Elo</th>
            <th className="px-2 py-2 text-center font-semibold">Res</th>
            <th className="px-2 py-2 text-left font-semibold">ECO</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g._id} className={`border-b border-ink-800/60 ${picked.has(g._id) ? "bg-brand-500/10" : "hover:bg-ink-900/60"}`}>
              <td className="px-2 py-1.5">
                <input type="checkbox" checked={picked.has(g._id)} onChange={() => onPick(g._id)}
                       aria-label="Select game" className="h-3.5 w-3.5 accent-brand-500" />
              </td>
              <td className="px-2 py-1.5 tabular-nums text-ink-400">{g.dateKey ? g.dateKey.slice(0, 4) : "—"}</td>
              <td className={`max-w-[10rem] truncate px-2 py-1.5 font-medium ${hit(g.whiteName)}`}>{g.whiteName ?? "?"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-400">{g.whiteElo ?? ""}</td>
              <td className={`max-w-[10rem] truncate px-2 py-1.5 font-medium ${hit(g.blackName)}`}>{g.blackName ?? "?"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-400">{g.blackElo ?? ""}</td>
              <td className="px-2 py-1.5 text-center font-mono text-[11px] text-ink-300">{g.result ?? "*"}</td>
              <td className="px-2 py-1.5 font-mono text-[11px] text-ink-400" title={g.openingName ?? ""}>{g.eco ?? "—"}</td>
              <td className="px-1 py-1.5 text-right"><RowMenu g={g} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The per-row ⋮ from the reference: save, download, and here also the
 *  opening name, which the reference only ever shows as a bare ECO code. */
function RowMenu({ g }: { g: Row }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<null | "busy" | "done" | "err">(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const save = async () => {
    setSaving("busy");
    try {
      const full = await get<{ found: boolean; moves?: string[]; white?: string; black?: string; event?: string; date?: string; result?: string }>(`/api/broadcasts/${g._id}`);
      if (!full?.found) throw new Error("not found");
      const pgn = buildPgn({ moves: full.moves, whiteName: full.white, blackName: full.black, event: full.event, date: full.date, result: full.result });
      await post("/api/studies/from-pgn", { pgn, topic: "gm-game", lessonName: `${g.whiteName ?? "?"} vs ${g.blackName ?? "?"}` });
      setSaving("done");
    } catch { setSaving("err"); }
  };

  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)} aria-label="Game actions"
              className="rounded px-1.5 py-0.5 text-ink-400 hover:bg-ink-800 hover:text-white">⋮</button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
          {g.openingName && (
            <div className="border-b border-ink-800 px-3 py-2 text-[11px] text-ink-400">
              <span className="font-mono text-ink-300">{g.eco}</span> · {g.openingName}
            </div>
          )}
          <button onClick={save} disabled={saving === "busy" || saving === "done"}
                  className="block w-full px-3 py-2 text-left text-xs text-ink-100 hover:bg-ink-800 disabled:opacity-50">
            {saving === "busy" ? "Saving…" : saving === "done" ? "✓ In My Studies" : saving === "err" ? "Save failed" : "Save to My Studies"}
          </button>
          <button onClick={() => downloadPgn([g._id])}
                  className="block w-full px-3 py-2 text-left text-xs text-ink-100 hover:bg-ink-800">Download PGN</button>
          <Link to={`/broadcasts/${g._id}`} className="block px-3 py-2 text-left text-xs text-ink-100 hover:bg-ink-800">Open in viewer</Link>
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-500">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] text-ink-400">{label}</span>
      {children}
    </label>
  );
}

/** The answer panel. Everything here is computed over the same filter as the
 *  rows below, so it can never describe a different set of games. */
function StatsPanel({ stats, loading, player }: { stats?: StatsResp; loading: boolean; player: string }) {
  if (loading) return <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 text-sm text-ink-400">Working out the numbers…</div>;
  if (!stats?.ok) return null;
  const ps = stats.playerScore;
  const totalScored = ps ? ps.wins + ps.draws + ps.losses : 0;
  const pct = (n: number) => (totalScored ? Math.round((n / totalScored) * 100) : 0);
  const maxYear = Math.max(1, ...stats.byYear.map((y) => y.n));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ps && totalScored > 0 && (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
            Score{player ? ` — ${player}` : ""}
          </div>
          {/* Score from the named player's side. A raw 1-0/0-1 split says
            *  nothing once both of their colours are in the set. */}
          <div className="flex h-3 overflow-hidden rounded-full bg-ink-950">
            <div className="bg-emerald-500/80" style={{ width: `${pct(ps.wins)}%` }} />
            <div className="bg-ink-600" style={{ width: `${pct(ps.draws)}%` }} />
            <div className="bg-rose-500/70" style={{ width: `${pct(ps.losses)}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs tabular-nums">
            <span className="text-emerald-300">{ps.wins} won</span>
            <span className="text-ink-400">{ps.draws} drawn</span>
            <span className="text-rose-300">{ps.losses} lost</span>
          </div>
        </div>
      )}

      {stats.summary && (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-500">At a glance</div>
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-ink-400">Avg rating</dt>
            <dd className="text-right tabular-nums text-ink-100">{Math.round((stats.summary.avgWhiteElo + stats.summary.avgBlackElo) / 2) || "—"}</dd>
            <dt className="text-ink-400">Highest rated</dt>
            <dd className="text-right tabular-nums text-ink-100">{stats.summary.topElo || "—"}</dd>
            <dt className="text-ink-400">Average length</dt>
            <dd className="text-right tabular-nums text-ink-100">{stats.summary.avgPly ? Math.round(stats.summary.avgPly / 2) + " moves" : "—"}</dd>
          </dl>
        </div>
      )}

      {stats.topOpenings.length > 0 && (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-500">Most played lines</div>
          <ul className="space-y-1">
            {stats.topOpenings.slice(0, 5).map((o) => (
              <li key={o.line} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-mono text-ink-200">{o.line || "—"}</span>
                <span className="shrink-0 tabular-nums text-ink-500">{o.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.byYear.length > 1 && (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-500">By year</div>
          <div className="flex h-16 items-end gap-0.5">
            {stats.byYear.slice(-20).map((y) => (
              <div key={y.year} className="group relative flex-1" title={`${y.year}: ${y.n}`}>
                <div className="w-full rounded-sm bg-brand-500/50 transition-colors group-hover:bg-brand-400"
                     style={{ height: `${Math.max(3, (y.n / maxYear) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-500">
            <span>{stats.byYear.slice(-20)[0]?.year}</span>
            <span>{stats.byYear.slice(-1)[0]?.year}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** List row, in the reference viewer's shape: the pairing and result on one
 *  line, then date · ECO · event underneath. Reads far better on a phone than
 *  a table, which is why both exist. */
function GameRow({ g, highlight, picked, onPick }: { g: Row; highlight: string; picked: boolean; onPick: () => void }) {
  const hit = (name?: string) =>
    highlight && name && name.toLowerCase().includes(highlight.toLowerCase().split(",")[0]!.trim())
      ? "text-brand-200" : "text-white";
  const sub = [
    g.dateKey ?? g.date,
    g.eco,                       // "—" would be noise; absent is fine
    g.event,
    g.ply ? `${Math.ceil(g.ply / 2)} moves` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 ${picked ? "bg-brand-500/10" : "hover:bg-ink-900/60"}`}>
      <input type="checkbox" checked={picked} onChange={onPick} aria-label="Select game"
             className="mt-1 h-3.5 w-3.5 shrink-0 accent-brand-500" />
      <Link to={`/broadcasts/${g._id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className={`font-semibold ${hit(g.whiteName)}`}>{g.whiteName ?? "?"}</span>
          {g.whiteElo ? <span className="text-[11px] tabular-nums text-ink-500">{g.whiteElo}</span> : null}
          <span className={`font-mono text-xs ${
            g.result === "1-0" ? "text-emerald-300" : g.result === "0-1" ? "text-rose-300" : "text-ink-400"}`}>
            {g.result ?? "*"}
          </span>
          <span className={`font-semibold ${hit(g.blackName)}`}>{g.blackName ?? "?"}</span>
          {g.blackElo ? <span className="text-[11px] tabular-nums text-ink-500">{g.blackElo}</span> : null}
        </div>
        <div className="truncate text-[11px] text-ink-500">
          {sub}
          {g.openingName ? <span className="text-ink-600"> — {g.openingName}</span> : null}
        </div>
      </Link>
      <RowMenu g={g} />
    </div>
  );
}

function buildPgn(m: { moves?: string[]; whiteName?: string; blackName?: string; event?: string; date?: string; result?: string }): string {
  const h = [
    `[Event "${m.event ?? "?"}"]`,
    `[Date "${m.date ?? "????.??.??"}"]`,
    `[White "${m.whiteName ?? "?"}"]`,
    `[Black "${m.blackName ?? "?"}"]`,
    `[Result "${m.result ?? "*"}"]`,
  ].join("\n");
  let body = "";
  (m.moves ?? []).forEach((san, i) => { body += (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + san + " "; });
  return `${h}\n\n${body.trim()} ${m.result ?? "*"}`;
}
