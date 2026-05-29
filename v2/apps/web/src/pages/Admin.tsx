import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { prettify } from "../lib/format";

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-1 font-display text-2xl ${accent ? "text-gradient" : "text-white"}`}>{value}</div>
    </div>
  );
}

const ratingLabel = (b: number | string) => {
  const bands: Record<string, string> = { "0": "<800", "800": "800–1199", "1200": "1200–1599", "1600": "1600–1999", "2000": "2000–2399", "2400": "2400+" };
  return bands[String(b)] ?? String(b);
};

export default function AdminPage() {
  const { data: ov } = useQuery({ queryKey: ["adm-overview"], queryFn: api.adminOverview });
  const { data: dist } = useQuery({ queryKey: ["adm-dist"], queryFn: api.adminDistribution });
  const { data: gen } = useQuery({ queryKey: ["adm-gen"], queryFn: () => api.generatedPuzzles(24) });

  const fmt = (n?: number) => (n ?? 0).toLocaleString();
  const maxTheme = Math.max(1, ...(dist?.themeDist ?? []).map((t) => t.count));
  const maxRating = Math.max(1, ...(dist?.ratingDist ?? []).map((r) => r.count));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-white">Puzzle <span className="text-gradient">Factory</span></h1>
        <p className="text-sm text-ink-400">Live overview of the puzzle database, engine games and pools.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total puzzles" value={fmt(ov?.total)} accent />
        <Stat label="Engine games" value={fmt(ov?.engineGames)} />
        <Stat label="Engine-generated" value={fmt(ov?.engineGenerated)} />
        <Stat label="Users" value={fmt(ov?.users)} />
        <Stat label="bfPools" value={fmt(ov?.pools.bfPools)} />
        <Stat label="piecePools" value={fmt(ov?.pools.piecePools)} />
        <Stat label="paths" value={fmt(ov?.pools.paths)} />
        <Stat label="Verified" value={fmt(ov?.verified)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Theme distribution</h2>
          <p className="mb-3 text-xs text-ink-500">sampled from {fmt(dist?.sampled)} puzzles</p>
          <div className="space-y-1.5">
            {(dist?.themeDist ?? []).map((t) => (
              <div key={t.theme} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 truncate text-ink-300">{prettify(t.theme)}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full bg-brand-gradient" style={{ width: `${(t.count / maxTheme) * 100}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right text-ink-400">{t.count}</span>
              </div>
            ))}
            {!dist && <p className="text-sm text-ink-500">Loading…</p>}
          </div>
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Rating distribution</h2>
          <p className="mb-3 text-xs text-ink-500">sampled from {fmt(dist?.sampled)} puzzles</p>
          <div className="space-y-1.5">
            {(dist?.ratingDist ?? []).map((r) => (
              <div key={String(r.band)} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-ink-300">{ratingLabel(r.band)}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full" style={{ width: `${(r.count / maxRating) * 100}%`, background: "#10b981" }} />
                </div>
                <span className="w-10 shrink-0 text-right text-ink-400">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">Engine-generated review queue</h2>
        {(gen?.puzzles?.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-500">No engine-generated puzzles yet — the engine pipeline hasn’t produced any. (All current puzzles are the imported Lichess set.)</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {gen!.puzzles.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2 text-sm">
                <span className="text-white">#{p.id} · {p.rating}</span>
                <a className="text-brand-300 hover:underline" href={`/v2/board-editor`}>{p.themes.slice(0, 2).join(", ")}</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
