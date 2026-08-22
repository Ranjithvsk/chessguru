// results.chessguru.cc/player/:fide_id — public player profile.
// Aggregates every tournament the player has appeared in (across all public
// events on ChessGuru Results). Career stats + tournament history.

import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

interface Tournament {
  _id: string; slug: string; name: string; city?: string; federation?: string;
  start_date?: string; end_date?: string; rating_type: string;
  player_rank: number; player_title?: string; player_rating?: number;
  games: number; points: number; points_max: number; num_rounds: number;
}
interface Stats {
  name: string; fide_id: string; tournaments: number;
  games: number; wins: number; losses: number; draws: number;
  points: number; points_pct: number; avg_opp_rating: number | null;
}

export default function PublicPlayer() {
  const id = useParams().fide_id!;
  const { data, isLoading, error } = useQuery({
    queryKey: ["player", id],
    queryFn: () => get<{ stats: Stats; rows: Tournament[] }>(`/api/results/players/${id}`),
  });

  useEffect(() => {
    if (data?.stats.name) {
      document.title = `${data.stats.name} (FIDE ${data.stats.fide_id}) — ChessGuru`;
    }
  }, [data]);

  if (isLoading) return <div className="mx-auto max-w-4xl py-20 text-center text-ink-400">Loading player…</div>;
  if (error || !data?.stats.name) return (
    <div className="mx-auto max-w-2xl py-20 text-center">
      <div className="text-4xl">♟</div>
      <div className="mt-3 font-semibold text-white">Player not found in public tournaments.</div>
      <Link to="/" className="mt-4 inline-block text-brand-400">← Back</Link>
    </div>
  );

  const s = data.stats;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="mb-4"><Link to="/" className="text-xs text-brand-400 hover:underline">← All tournaments</Link></nav>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-white">{s.name}</h1>
        <div className="mt-1 text-sm text-ink-400">FIDE ID {s.fide_id} · Active in {s.tournaments} public tournament{s.tournaments === 1 ? "" : "s"}</div>
      </header>

      <section className="mb-8 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatCard label="Games" value={String(s.games)} color="#7c3aed" />
        <StatCard label="Wins / Draws / Losses" value={`${s.wins} / ${s.draws} / ${s.losses}`} color="#059669" />
        <StatCard label="Score %" value={`${s.points_pct.toFixed(1)}%`} color="#f59e0b" />
        <StatCard label="Avg opp rating" value={s.avg_opp_rating ? String(s.avg_opp_rating) : "—"} color="#0891b2" />
      </section>

      <section>
        <h2 className="mb-2 font-display text-xl text-white">Tournaments</h2>
        <div className="overflow-x-auto rounded-2xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900 text-xs uppercase tracking-wider text-ink-400">
              <tr>{["Date", "Tournament", "City", "Rated", "Rank", "Score"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t._id} className="border-t border-ink-700 hover:bg-ink-900/60">
                  <td className="px-3 py-2 font-mono text-ink-400">{t.start_date || ""}</td>
                  <td className="px-3 py-2 font-semibold text-white">
                    <Link to={`/t/${t._id}`} className="hover:text-brand-300">{t.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-ink-400">{t.city || "—"}</td>
                  <td className="px-3 py-2 text-ink-400">{t.rating_type}</td>
                  <td className="px-3 py-2 font-mono">{t.player_rank}</td>
                  <td className="px-3 py-2 font-mono text-white">{t.points.toFixed(1)} / {t.points_max || t.num_rounds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-10 border-t border-ink-700 pt-6 text-center text-xs text-ink-500">
        Powered by <a href="https://chessguru.cc/" className="text-brand-400 hover:underline">ChessGuru</a>
      </footer>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
    </div>
  );
}
