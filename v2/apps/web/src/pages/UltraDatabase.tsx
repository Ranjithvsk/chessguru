// Ultra Database — search surface over the 1.09M-game broadcast library.
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
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "../lib/api";

type Row = {
  _id: string;
  whiteName?: string; blackName?: string;
  whiteElo?: number; blackElo?: number;
  event?: string; date?: string; result?: string; round?: string; ply?: number;
};
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
const SORTS = [
  { id: "date", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "elo", label: "Strongest" },
  { id: "short", label: "Shortest" },
  { id: "long", label: "Longest" },
];

export default function UltraDatabase() {
  // ── the query ─────────────────────────────────────────────────────
  const [player, setPlayer] = useState("");
  const [colour, setColour] = useState<"any" | "white" | "black">("any");
  const [opponent, setOpponent] = useState("");
  const [text, setText] = useState("");
  const [opening, setOpening] = useState("");
  const [result, setResult] = useState("");
  const [bothElo, setBothElo] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minPly, setMinPly] = useState("");
  const [maxPly, setMaxPly] = useState("");
  const [sort, setSort] = useState("date");
  const [offset, setOffset] = useState(0);

  // Debounced copy — typing a player name should not fire a query per keystroke
  // against a million rows.
  const [live, setLive] = useState({ player: "", opponent: "", text: "", opening: "" });
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
    if (bothElo) p.set("bothElo", String(bothElo));
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (minPly) p.set("minPly", minPly);
    if (maxPly) p.set("maxPly", maxPly);
    p.set("sort", sort);
    return p;
  }, [live, colour, result, bothElo, from, to, minPly, maxPly, sort]);

  const hasQuery = params.toString() !== "sort=date" && [...params.keys()].some((k) => k !== "sort");

  const search = useQuery<SearchResp>({
    queryKey: ["ultradb", params.toString(), offset],
    queryFn: () => get<SearchResp>(`/api/ultra-db/search?${params.toString()}&limit=${PAGE}&offset=${offset}`),
    staleTime: 30_000,
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
    setBothElo(0); setFrom(""); setTo(""); setMinPly(""); setMaxPly(""); setSort("date"); setOffset(0);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold text-white">Ultra Database</h1>
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

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink-400">
              {search.isLoading ? "Searching…"
                : `${search.data?.totalIsCapped ? "10,000+" : total.toLocaleString()} game${total === 1 ? "" : "s"}`}
            </div>
            {/* wraps: five sort chips are wider than a 390px phone column */}
            <div className="flex flex-wrap items-center gap-1">
              {SORTS.map((s) => (
                <button key={s.id} onClick={() => { setSort(s.id); setOffset(0); }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${sort === s.id ? "bg-brand-500/20 text-brand-100" : "text-ink-400 hover:bg-ink-800 hover:text-ink-100"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-ink-800">
            {rows.length === 0 && !search.isLoading ? (
              <div className="p-8 text-center text-sm text-ink-400">
                No games match that. Try widening the rating or clearing the opening moves.
              </div>
            ) : (
              <div className="divide-y divide-ink-800/70">
                {rows.map((g) => <GameRow key={g._id} g={g} highlight={live.player} />)}
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

function GameRow({ g, highlight }: { g: Row; highlight: string }) {
  const [saving, setSaving] = useState<null | "busy" | "done" | "err">(null);
  const hit = (name?: string) =>
    highlight && name && name.toLowerCase().includes(highlight.toLowerCase().split(",")[0]!.trim())
      ? "text-brand-200" : "text-ink-100";

  // Take this game into the user's own studies. The API links it back to this
  // library row rather than copying the game in, so annotations stay personal
  // while the game data has one home.
  const save = async () => {
    setSaving("busy");
    try {
      // /api/broadcasts/:id returns a FLAT game using white/black, not
      // whiteName/blackName as the list rows do.
      const full = await get<{ found: boolean; moves?: string[]; white?: string; black?: string; event?: string; date?: string; result?: string }>(`/api/broadcasts/${g._id}`);
      if (!full?.found) throw new Error("game not found");
      const pgn = buildPgn({ moves: full.moves, whiteName: full.white, blackName: full.black, event: full.event, date: full.date, result: full.result });
      await post("/api/studies/from-pgn", { pgn, topic: "gm-game", lessonName: `${g.whiteName ?? "?"} vs ${g.blackName ?? "?"}` });
      setSaving("done");
    } catch { setSaving("err"); }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-ink-900/60">
      <Link to={`/broadcasts/${g._id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className={`font-semibold ${hit(g.whiteName)}`}>{g.whiteName ?? "?"}</span>
          {g.whiteElo ? <span className="text-[11px] tabular-nums text-ink-500">{g.whiteElo}</span> : null}
          <span className="text-ink-600">vs</span>
          <span className={`font-semibold ${hit(g.blackName)}`}>{g.blackName ?? "?"}</span>
          {g.blackElo ? <span className="text-[11px] tabular-nums text-ink-500">{g.blackElo}</span> : null}
        </div>
        <div className="truncate text-[11px] text-ink-500">
          {[g.event, g.round && `R${g.round}`, g.date, g.ply ? `${Math.ceil(g.ply / 2)} moves` : null].filter(Boolean).join(" · ")}
        </div>
      </Link>
      <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] ${
        g.result === "1-0" ? "bg-emerald-500/15 text-emerald-200"
        : g.result === "0-1" ? "bg-rose-500/15 text-rose-200"
        : "bg-ink-800 text-ink-300"}`}>{g.result ?? "*"}</span>
      <button
        onClick={save}
        disabled={saving === "busy" || saving === "done"}
        title="Save this game into My Studies"
        className="shrink-0 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] font-semibold text-ink-200 hover:bg-ink-800 disabled:opacity-50"
      >
        {saving === "busy" ? "Saving…" : saving === "done" ? "✓ Saved" : saving === "err" ? "Failed" : "Save"}
      </button>
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
