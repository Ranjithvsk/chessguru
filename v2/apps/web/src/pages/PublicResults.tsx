// results.chessguru.cc — the public, unauthenticated results portal.
// Head-to-head answer to chess-results.com. Two views:
//   /              (or /results)  — recent tournaments homepage
//   /t/:id         (or /results/:id) — one tournament crosstable + rounds
//
// Client-side rendered (SPA). SEO crawlers get the pre-rendered HTML variant
// served by the Nest ResultsRenderController + nginx User-Agent routing.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import GameViewer from "./GameViewer";

interface RowSummary {
  _id: string; slug: string; name: string; city?: string; federation?: string;
  start_date?: string; end_date?: string; rating_type: string;
  num_rounds: number; num_players: number; num_rounds_played: number;
}

interface Player { rank: number; name: string; title?: string; rating?: number; federation?: string; fide_id?: string; }
interface Pairing { board: number; white_rank: number; black_rank: number; result: string | null; }
interface Round { round_no: number; pairings: Pairing[]; generated_at: string; }
interface Tournament {
  _id: string; slug: string; name: string; city?: string; federation?: string; start_date?: string; end_date?: string;
  time_control?: string; chief_arbiter?: string; num_rounds: number; rating_type: string;
  players: Player[]; rounds: Round[];
  standings: Array<{ place: number; rank: number; name: string; title?: string; rating: number; federation: string; points: number; buchholz: number; sb: number }>;
}

const RESULT_TEXT: Record<string, string> = {
  "1": "1-0", "=": "½-½", "0": "0-1", "+": "+:-", "-": "-:+",
};

// ═══════════════ /  &  /results ═══════════════

export function PublicResultsHome() {
  useEffect(() => {
    document.title = "ChessGuru Results — India chess tournament crosstables";
    setMeta("description", "Live standings, crosstables and round pairings from FIDE / AICF / state chess tournaments across India. Free, mobile-friendly, no login. Powered by JaVaFo pairing engine.");
  }, []);
  const [search, setSearch] = useState("");
  const { data: discover, isLoading } = useQuery({
    queryKey: ["results", "discover"],
    queryFn: () => get<{ running: RowSummary[]; this_month: RowSummary[]; recent: RowSummary[] }>("/api/results/discover"),
  });
  const { data: feds } = useQuery({
    queryKey: ["results", "federations"],
    queryFn: () => get<{ rows: Array<{ federation: string; count: number }> }>("/api/results/federations"),
  });
  const { data: searchRes } = useQuery({
    queryKey: ["results", "search", search],
    queryFn: () => get<{ rows: RowSummary[]; total: number }>(`/api/results/tournaments?search=${encodeURIComponent(search)}&limit=30`),
    enabled: search.trim().length >= 2,
  });

  const empty = discover && discover.recent.length === 0 && discover.running.length === 0 && discover.this_month.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-brand-400">Results</div>
        <h1 className="mt-1 font-display text-4xl">♟ ChessGuru Results</h1>
        <p className="mt-2 max-w-2xl text-ink-400">
          Live standings, crosstables and round pairings from Indian chess tournaments —
          FIDE, AICF and state-rated events. Free, mobile-friendly, no login.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Search tournaments or cities…"
               className="min-w-[240px] flex-1 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-2.5 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
        {feds && feds.rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {feds.rows.slice(0, 8).map((f) => (
              <Link key={f.federation} to={`/federation/${f.federation}`}
                    className="rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1 text-xs text-ink-300 hover:border-brand-500/40 hover:text-white">
                {f.federation} <span className="ml-1 text-ink-500">{f.count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-12 text-center text-ink-400">Loading tournaments…</div>
      ) : search.trim().length >= 2 ? (
        <Section title={`Search results for "${search}"`} count={searchRes?.total || 0} rows={searchRes?.rows || []} />
      ) : empty ? (
        <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-12 text-center">
          <div className="text-4xl mb-3">♟</div>
          <div className="font-semibold text-white">No public tournaments yet.</div>
          <div className="mt-2 text-sm text-ink-400">
            Arbiters using ChessGuru can publish tournaments to this portal from{" "}
            <a href="https://chessguru.cc/arbiter" className="text-brand-400 hover:underline">chessguru.cc/arbiter</a>.
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {discover!.running.length > 0 && <Section title="🔴 Live now" count={discover!.running.length} rows={discover!.running} live />}
          {discover!.this_month.length > 0 && <Section title="This month" count={discover!.this_month.length} rows={discover!.this_month} />}
          <Section title="Recent" count={discover!.recent.length} rows={discover!.recent} />
        </div>
      )}

      <footer className="mt-16 border-t border-ink-700 pt-6 text-center text-xs text-ink-500">
        Powered by <a href="https://chessguru.cc/" className="text-brand-400 hover:underline">ChessGuru</a> ·
        FIDE Dutch Swiss pairings via JaVaFo ·
        <a href="https://chessguru.cc/arbiter" className="ml-1 text-brand-400 hover:underline">Arbiters: run your own tournament →</a>
      </footer>
    </div>
  );
}

// ═══════════════ /t/:id  &  /results/:id ═══════════════

export function PublicResultsDetail() {
  const id = useParams().id!;
  const { data, isLoading, error } = useQuery({
    queryKey: ["results", "one", id],
    queryFn: () => get<Tournament & { error?: string }>(`/api/results/tournaments/${id}`),
    refetchInterval: 30_000,
  });
  const { data: gameIdx } = useQuery({
    queryKey: ["results", "games-idx", id],
    queryFn: () => get<{ rows: Array<{ round_no: number; board: number }> }>(`/api/results/tournaments/${id}/games`),
    refetchInterval: 60_000,
  });
  const hasGame = useMemo(() => {
    const s = new Set<string>();
    for (const g of gameIdx?.rows || []) s.add(`${g.round_no}:${g.board}`);
    return s;
  }, [gameIdx]);
  const [openGame, setOpenGame] = useState<{ round: number; board: number; whiteName: string; blackName: string } | null>(null);
  const nameByRank = useMemo(
    () => data && !(data as any).error ? Object.fromEntries((data as Tournament).players.map((p) => [p.rank, p])) : {},
    [data],
  );

  useEffect(() => {
    if (data && !(data as any).error) {
      const t = data as Tournament;
      document.title = `${t.name} — ChessGuru Results`;
      setMeta("description", `${t.name}. ${t.players.length} players, ${t.num_rounds} rounds. ${t.city ? `Held in ${t.city}. ` : ""}${t.rating_type} rated. Live crosstable, standings and round pairings.`);
    }
  }, [data]);

  if (isLoading) return <div className="mx-auto max-w-4xl py-20 text-center text-ink-400">Loading…</div>;
  if (error || (data as any)?.error) return (
    <div className="mx-auto max-w-2xl py-20 text-center">
      <div className="text-4xl">♟</div>
      <div className="mt-3 font-semibold text-white">Tournament not found or not public.</div>
      <Link to="/" className="mt-4 inline-block text-brand-400">← Back to all tournaments</Link>
    </div>
  );
  const t = data as Tournament;
  const dateRange = t.start_date === t.end_date ? t.start_date : `${t.start_date} → ${t.end_date}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="mb-4"><Link to="/" className="text-xs text-brand-400 hover:underline">← All tournaments</Link></nav>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-white">{t.name}</h1>
        <div className="mt-1 text-sm text-ink-400">
          {t.city || "—"} · {t.federation || "IND"} · {dateRange || ""} · {t.rating_type} ·
          {" "}{t.players.length} players · Round {t.rounds?.length || 0}/{t.num_rounds}
          {t.chief_arbiter && <> · Chief Arbiter: {t.chief_arbiter}</>}
        </div>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 font-display text-xl text-white">Standings</h2>
        <div className="overflow-x-auto rounded-2xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900 text-xs uppercase tracking-wider text-ink-400">
              <tr>{["Place", "Name", "Ttl", "Rtg", "Fed", "Pts", "Bh", "SB"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {t.standings.map((s) => (
                <tr key={s.rank} className={`border-t border-ink-700 ${s.place === 1 ? "bg-amber-500/15" : s.place === 2 ? "bg-slate-400/10" : s.place === 3 ? "bg-orange-600/10" : ""}`}>
                  <td className="px-3 py-2 font-mono text-ink-400">{s.place}</td>
                  <td className="px-3 py-2 font-semibold text-white">{s.name}</td>
                  <td className="px-3 py-2">{s.title || ""}</td>
                  <td className="px-3 py-2 text-ink-400">{s.rating || "—"}</td>
                  <td className="px-3 py-2 text-ink-400">{s.federation}</td>
                  <td className="px-3 py-2 font-mono text-white">{s.points.toFixed(1)}</td>
                  <td className="px-3 py-2 font-mono text-ink-400">{s.buchholz.toFixed(1)}</td>
                  <td className="px-3 py-2 font-mono text-ink-400">{s.sb.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {[...(t.rounds || [])].reverse().map((r) => (
        <section key={r.round_no} className="mb-6">
          <h2 className="mb-2 font-display text-xl text-white">Round {r.round_no}</h2>
          <div className="overflow-x-auto rounded-2xl border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-900 text-xs uppercase tracking-wider text-ink-400">
                <tr><th className="px-3 py-2">Bd</th><th className="px-3 py-2">White</th><th className="px-3 py-2 text-center">Result</th><th className="px-3 py-2">Black</th><th className="px-2 py-2"></th></tr>
              </thead>
              <tbody>
                {r.pairings.map((g) => {
                  const w = (nameByRank as any)[g.white_rank] as Player | undefined;
                  const b = (nameByRank as any)[g.black_rank] as Player | undefined;
                  const gameKey = `${r.round_no}:${g.board}`;
                  return (
                    <tr key={g.board} className="border-t border-ink-700">
                      <td className="px-3 py-2 font-mono text-ink-400">{g.board}</td>
                      <td className="px-3 py-2 font-semibold text-white">
                        {w?.title && <span className="mr-1 text-xs text-amber-400">{w.title}</span>}
                        {w?.fide_id ? <Link to={`/player/${w.fide_id}`} className="hover:text-brand-300">{w.name}</Link> : (w?.name || "?")}
                        {w?.rating ? <span className="ml-2 text-xs text-ink-400">{w.rating}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-center font-mono">
                        {g.black_rank === 0 ? <span className="text-xs text-ink-400">bye</span> : (RESULT_TEXT[g.result || ""] || (g.result ? g.result : "—"))}
                      </td>
                      <td className="px-3 py-2 font-semibold text-white">
                        {b?.title && <span className="mr-1 text-xs text-amber-400">{b.title}</span>}
                        {b?.fide_id ? <Link to={`/player/${b.fide_id}`} className="hover:text-brand-300">{b.name}</Link> : (b?.name || "—")}
                        {b?.rating ? <span className="ml-2 text-xs text-ink-400">{b.rating}</span> : null}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {hasGame.has(gameKey) && b && (
                          <button onClick={() => setOpenGame({ round: r.round_no, board: g.board, whiteName: w?.name || "White", blackName: b?.name || "Black" })}
                                  className="rounded border border-brand-500/50 bg-brand-500/10 px-2 py-0.5 text-xs font-semibold text-brand-300 hover:bg-brand-500/20">
                            ▶ Play
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <footer className="mt-10 border-t border-ink-700 pt-6 text-center text-xs text-ink-500">
        Powered by <a href="https://chessguru.cc/" className="text-brand-400 hover:underline">ChessGuru</a> ·
        <a href="https://chessguru.cc/arbiter" className="ml-1 text-brand-400 hover:underline">Arbiters: run your own tournament →</a>
      </footer>

      {openGame && (
        <GameViewer tournamentId={t._id} round={openGame.round} board={openGame.board}
                    whiteName={openGame.whiteName} blackName={openGame.blackName}
                    onClose={() => setOpenGame(null)} />
      )}
    </div>
  );
}

function Section({ title, count, rows, live }: { title: string; count: number; rows: RowSummary[]; live?: boolean }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-xl text-white">{title} <span className="ml-2 text-sm font-normal text-ink-400">{count}</span></h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((t) => (
          <Link key={t._id} to={`/t/${t._id}`}
                className={`group rounded-2xl border p-4 transition ${live ? "border-emerald-500/40 bg-emerald-950/20 hover:border-emerald-500/70" : "border-ink-700 bg-ink-900/60 hover:border-brand-500/40 hover:bg-ink-900"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-white group-hover:text-brand-300">{t.name}</div>
              {live && <span className="inline-flex flex-none items-center rounded-full bg-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">Live</span>}
            </div>
            <div className="mt-1 text-xs text-ink-400">{t.city || "—"} · {t.federation || "IND"} · {t.rating_type}</div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-500">
              <span>{t.num_players} players</span>
              <span>Round {t.num_rounds_played}/{t.num_rounds}</span>
              <span>{t.start_date || ""}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
  el.setAttribute("content", content);
}
