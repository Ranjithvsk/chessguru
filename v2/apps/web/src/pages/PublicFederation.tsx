// results.chessguru.cc/federation/:code — every public tournament held under
// a given federation (IND, USA, etc.). Landing page for organic search
// ("chennai chess tournaments", "AICF weekend open").

import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

interface Row {
  _id: string; slug: string; name: string; city?: string; federation?: string;
  start_date?: string; end_date?: string; rating_type: string;
  num_rounds: number; num_players: number; num_rounds_played: number;
}

export default function PublicFederation() {
  const code = (useParams().code || "").toUpperCase();
  const { data, isLoading } = useQuery({
    queryKey: ["federation", code],
    queryFn: () => get<{ rows: Row[]; total: number }>(`/api/results/tournaments?federation=${code}&limit=200`),
  });
  const { data: cities } = useQuery({
    queryKey: ["cities", code],
    queryFn: () => get<{ rows: Array<{ city: string; count: number }> }>(`/api/results/cities/${code}`),
  });

  useEffect(() => {
    document.title = `Chess tournaments in ${code} — ChessGuru Results`;
  }, [code]);

  const total = data?.total || 0;
  const totalPlayers = data?.rows.reduce((s, r) => s + (r.num_players || 0), 0) || 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <nav className="mb-4"><Link to="/" className="text-xs text-brand-400 hover:underline">← All tournaments</Link></nav>
      <header className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-brand-400">Federation</div>
        <h1 className="mt-1 font-display text-3xl text-white">♟ Chess tournaments in {code}</h1>
        <div className="mt-1 text-sm text-ink-400">{total} public tournaments · {totalPlayers} player-events</div>
      </header>

      {cities && cities.rows.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Most active cities</div>
          <div className="flex flex-wrap gap-2">
            {cities.rows.slice(0, 12).map((c) => (
              <span key={c.city} className="rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1 text-xs text-white">
                {c.city} <span className="ml-1 text-ink-400">{c.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {isLoading ? <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-12 text-center text-ink-400">Loading…</div>
       : !data?.rows.length ? (
        <div className="rounded-2xl border border-ink-700 bg-ink-900/40 p-12 text-center text-ink-400">No public tournaments yet for {code}.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.rows.map((t) => (
            <Link key={t._id} to={`/t/${t._id}`}
                  className="group rounded-2xl border border-ink-700 bg-ink-900/60 p-4 transition hover:border-brand-500/40 hover:bg-ink-900">
              <div className="font-semibold text-white group-hover:text-brand-300">{t.name}</div>
              <div className="mt-1 text-xs text-ink-400">{t.city || "—"} · {t.rating_type}</div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-ink-500">
                <span>{t.num_players} players</span>
                <span>Round {t.num_rounds_played}/{t.num_rounds}</span>
                <span>{t.start_date || ""}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
