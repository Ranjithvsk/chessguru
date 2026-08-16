// My Games — list + import launcher + weakness summary.
// Route: /my-games

import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { myGamesApi, type GameSummary } from "../lib/my-games-api";

const SOURCE_LABEL: Record<string, string> = {
  pgn: "PGN",
  lichess: "Lichess",
  chesscom: "Chess.com",
  chessguru: "ChessGuru",
};

const STATUS_STYLES: Record<string, string> = {
  queued:    "bg-ink-800 text-ink-400",
  analyzing: "bg-amber-500/20 text-amber-200 animate-pulse",
  done:      "bg-emerald-500/20 text-emerald-200",
  failed:    "bg-rose-500/20 text-rose-200",
};

const TAG_LABEL: Record<string, string> = {
  missed_mate:        "Missed mate",
  hung_piece:         "Hung piece",
  missed_capture:     "Missed capture",
  missed_knight_fork: "Missed knight fork",
  missed_check:       "Missed check",
  missed_promotion:   "Missed promotion",
  opening_deviation:  "Opening deviation",
  positional:         "Positional",
};

function fmt(iso: string) { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch { return ""; } }

export default function MyGamesListPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["my-games"],
    queryFn: () => myGamesApi.list(),
    enabled: !!auth?.loggedIn,
    refetchInterval: (data: any) => data?.items?.some((g: any) => g.status === "queued" || g.status === "analyzing") ? 6000 : false,
  });
  const w = useQuery({
    queryKey: ["my-games-weaknesses"],
    queryFn: () => myGamesApi.weaknesses(),
    enabled: !!auth?.loggedIn,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/my-games" replace />;

  const items = q.data?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl px-3 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-white">My Games</h1>
          <p className="text-sm text-ink-400">Import games from Lichess/Chess.com or paste PGN — we'll analyze them with Stockfish and highlight mistakes.</p>
        </div>
        <Link to="/my-games/import"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 shadow-glow">
          + Import games
        </Link>
      </div>

      {/* Weakness summary — appears once we have data */}
      {w.data && w.data.gamesAnalyzed > 0 && (
        <div className="mb-6 rounded-xl2 border border-brand-500/40 bg-brand-500/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-200">Your weaknesses ({w.data.gamesAnalyzed} game{w.data.gamesAnalyzed === 1 ? "" : "s"} analyzed)</div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <StatBox label="Blunders" value={w.data.totalBlunders} color="rose" />
            <StatBox label="Mistakes" value={w.data.totalMistakes} color="amber" />
            <StatBox label="Inaccuracies" value={w.data.totalInaccuracies} color="ink" />
          </div>
          {Object.keys(w.data.tagCounts).length > 0 && (
            <div className="mt-3">
              <div className="mb-2 text-xs text-ink-400">By type:</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(w.data.tagCounts).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([tag, n]) => (
                  <div key={tag} className="rounded-full bg-ink-800 px-3 py-1 text-xs text-ink-200">
                    {TAG_LABEL[tag] || tag} <span className="ml-1 font-semibold text-white">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {q.isLoading && <div className="text-sm text-ink-400">Loading…</div>}
      {q.error && <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>}

      {!q.isLoading && items.length === 0 && (
        <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center">
          <div className="mb-2 text-4xl">🎮</div>
          <div className="mb-4 text-white">No games imported yet.</div>
          <Link to="/my-games/import" className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
            Import your first game
          </Link>
        </div>
      )}

      <div className="space-y-2">
        {items.map((g) => <GameRow key={g._id} g={g} />)}
      </div>
    </div>
  );
}

function GameRow({ g }: { g: GameSummary }) {
  return (
    <Link to={`/my-games/${encodeURIComponent(g._id)}`}
      className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3 transition hover:border-brand-500/60 hover:shadow-glow">
      <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[g.status]}`}>{g.status}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">
          <b>{g.white}</b> vs <b>{g.black}</b> <span className="text-ink-500">— {g.result}</span>
        </div>
        <div className="text-[11px] text-ink-500">
          {SOURCE_LABEL[g.source]}{g.event ? ` · ${g.event}` : ""}{g.date ? ` · ${g.date}` : ""}{g.ourColor !== "both" ? ` · you = ${g.ourColor}` : ""}
        </div>
      </div>
      <div className="text-xs text-ink-400">{fmt(g.createdAt)}</div>
    </Link>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: "rose" | "amber" | "ink" }) {
  const cls = color === "rose" ? "text-rose-300" : color === "amber" ? "text-amber-300" : "text-ink-200";
  return (
    <div className="rounded-lg bg-ink-800 p-2 text-center">
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-ink-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}
