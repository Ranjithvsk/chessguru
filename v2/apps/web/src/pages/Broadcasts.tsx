// Master broadcast game browser. Route: /broadcasts
//
// Simple list-driven view. Left rail = filters (Elo, result, date, search).
// Right = paginated game rows. Click a row -> /broadcasts/:id for the viewer.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { broadcastList } from "../lib/api";

const ELO_STEPS = [0, 2000, 2200, 2300, 2400, 2500, 2600, 2700, 2750];

export default function BroadcastsPage() {
  const [minElo, setMinElo] = useState<number>(2300);
  const [result, setResult] = useState<"" | "1-0" | "0-1" | "1/2-1/2">("");
  const [q, setQ] = useState("");
  const [qDeferred, setQDeferred] = useState("");
  const [offset, setOffset] = useState(0);

  // Debounce the search input so we're not hammering Mongo on every keystroke.
  useEffect(() => {
    const h = setTimeout(() => { setQDeferred(q); setOffset(0); }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["broadcasts", minElo, result, qDeferred, offset],
    queryFn: () => broadcastList({ minElo, result, q: qDeferred, offset }),
    placeholderData: (prev) => prev,
  });

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="font-display text-2xl text-white">Master broadcast games</h1>
        <p className="text-sm text-ink-400">
          Every tournament game from Lichess broadcasts (2020-present). Filter by rating,
          search event or player, and click any game to review the moves.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl2 border border-ink-700 bg-ink-900 p-3">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink-500">Min Elo (both sides)</label>
          <div className="flex flex-wrap gap-1">
            {ELO_STEPS.map((e) => (
              <button key={e} onClick={() => { setMinElo(e); setOffset(0); }}
                className={`rounded px-2 py-1 text-xs font-semibold ${minElo === e ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
                {e === 0 ? "Any" : `${e}+`}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink-500">Result</label>
          <div className="flex gap-1">
            {[["", "All"], ["1-0", "White won"], ["1/2-1/2", "Draw"], ["0-1", "Black won"]].map(([v, l]) => (
              <button key={v} onClick={() => { setResult(v as any); setOffset(0); }}
                className={`rounded px-2 py-1 text-xs font-semibold ${result === v ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink-500">Search event or player</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Carlsen, Tata Steel, Sinquefield…"
            className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white outline-none focus:border-brand-500" />
        </div>
      </div>

      {/* Count line */}
      <div className="text-xs text-ink-500">
        {isLoading ? "Searching…" : `${total.toLocaleString()} game${total === 1 ? "" : "s"} match`}
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase text-ink-500">
            <tr className="border-b border-ink-800">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Round</th>
              <th className="px-3 py-2">White</th>
              <th className="px-3 py-2 text-right">Elo</th>
              <th className="px-3 py-2 text-center">Result</th>
              <th className="px-3 py-2 text-right">Elo</th>
              <th className="px-3 py-2">Black</th>
              <th className="px-3 py-2 text-right">Ply</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {(data?.items ?? []).map((g) => (
              <tr key={g.id} className="hover:bg-ink-800/60">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-400">{g.date}</td>
                <td className="max-w-[260px] truncate px-3 py-2 text-ink-200" title={g.event}>{g.event}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-400">{g.round}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link to={`/broadcasts/${g.id}`} className="font-semibold text-white hover:underline">
                    {g.white}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-ink-400">{g.whiteElo || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs">
                  {g.result === "1-0" ? <span className="text-emerald-400">1-0</span> :
                   g.result === "0-1" ? <span className="text-rose-400">0-1</span> :
                   <span className="text-ink-400">½-½</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-ink-400">{g.blackElo || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link to={`/broadcasts/${g.id}`} className="font-semibold text-white hover:underline">
                    {g.black}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-ink-500">{g.ply}</td>
              </tr>
            ))}
            {!isLoading && (data?.items?.length ?? 0) === 0 && (
              <tr><td colSpan={9} className="py-10 text-center text-sm text-ink-500">No games match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-sm">
          <button onClick={() => setOffset(Math.max(0, offset - pageSize))} disabled={offset === 0}
            className="rounded border border-ink-700 px-3 py-1 text-ink-300 hover:bg-ink-800 disabled:opacity-30">
            ← Prev
          </button>
          <span className="text-xs text-ink-500">
            {offset + 1}–{Math.min(offset + pageSize, total)} of {total.toLocaleString()}
          </span>
          <button onClick={() => setOffset(offset + pageSize)} disabled={!data?.hasMore}
            className="rounded border border-ink-700 px-3 py-1 text-ink-300 hover:bg-ink-800 disabled:opacity-30">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
