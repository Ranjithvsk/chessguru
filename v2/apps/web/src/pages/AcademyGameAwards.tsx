// Academy game awards — who finds the tactics in their own games (arena games, My Games imports,
// linked Lichess / Chess.com). The engine tags every critical moment with the motif (fork, pin,
// mate pattern…); found = points, missed = minus half. Route: /academy/game-awards
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { get, post } from "../lib/api";

type Row = { rank: number; studentId: string; username: string; name: string | null; score: number; found: number; missed: number; games: number; lastAt: string; byMotif: Record<string, { found: number; missed: number }>; sources: string[] };
type Board = { period: string; rows: Row[]; labels: Record<string, string>; points: Record<string, number>; pending: number };
type Ev = { gameId: string; ply: number; color: "white" | "black"; fen: string; bestSan: string | null; playedSan: string | null; found: boolean; motifs: string[]; primary: string; points: number; lossCp: number; mateIn: number | null; at: string; source: string; url: string | null; label: string };

const SRC: Record<string, string> = { live: "ChessGuru arena", my: "My Games", lichess: "Lichess", chesscom: "Chess.com" };

export default function AcademyGameAwardsPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [open, setOpen] = useState<string | null>(null);
  const board = useQuery({ queryKey: ["game-awards", period], queryFn: () => get<Board>(`/api/game-motifs/leaderboard?period=${period}`), refetchInterval: 60_000 });
  const events = useQuery({ queryKey: ["game-awards-student", open, period], queryFn: () => get<{ events: Ev[]; labels: Record<string, string> }>(`/api/game-motifs/student/${encodeURIComponent(open!)}?period=${period}`), enabled: !!open });
  const rerun = useMutation({ mutationFn: (gameId: string) => post(`/api/game-motifs/analyze/${encodeURIComponent(gameId)}`, {}), onSuccess: () => { void board.refetch(); void events.refetch(); } });
  const labels = board.data?.labels ?? {};
  const label = (m: string) => labels[m] ?? m;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🎯 Game awards</h1>
          <p className="text-sm text-gray-500">Points for tactics found in real games — forks, pins, skewers, mates and more. A missed tactic costs half its points. Arena games, My Games imports, and linked Lichess / Chess.com accounts all count.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold">
          {(["7d", "30d", "90d", "all"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`rounded-lg px-3 py-1.5 ${period === p ? "bg-white shadow" : "text-gray-500"}`}>{p === "all" ? "All time" : p.replace("d", " days")}</button>
          ))}
        </div>
      </div>
      {board.data && board.data.pending > 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">{board.data.pending} game{board.data.pending === 1 ? "" : "s"} still queued for the engine — the board fills in as they finish (about one game a minute).</div>
      )}
      {board.isLoading && <p className="text-gray-500">Loading…</p>}
      {board.isError && <p className="text-red-600">Could not load: {(board.error as Error).message}</p>}
      {board.data && board.data.rows.length === 0 && <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-gray-500">No scored games yet in this period. Play in the arena, import a PGN under My Games, or link a Lichess / Chess.com account — the engine picks the games up automatically.</p>}
      {board.data && board.data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Student</th><th className="px-3 py-2 text-right">Score</th><th className="px-3 py-2 text-right">Found</th><th className="px-3 py-2 text-right">Missed</th><th className="px-3 py-2 text-right">Games</th><th className="px-3 py-2">Best at</th><th className="px-3 py-2">Where</th></tr>
            </thead>
            <tbody>
              {board.data.rows.map((r) => {
                const top = Object.entries(r.byMotif).sort((a, b) => (b[1].found - b[1].missed) - (a[1].found - a[1].missed)).slice(0, 4);
                const isOpen = open === r.studentId;
                return [
                  <tr key={r.studentId} onClick={() => setOpen(isOpen ? null : r.studentId)} className={`cursor-pointer border-t border-gray-100 hover:bg-amber-50/40 ${isOpen ? "bg-amber-50/60" : ""}`}>
                    <td className="px-3 py-2 font-bold tabular-nums">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
                    <td className="px-3 py-2"><div className="font-semibold">{r.name || r.username}</div><div className="text-xs text-gray-400">{r.username}</div></td>
                    <td className={`px-3 py-2 text-right text-base font-extrabold tabular-nums ${r.score >= 0 ? "text-emerald-700" : "text-red-600"}`}>{r.score > 0 ? "+" : ""}{r.score}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.found}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600">{r.missed}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.games}</td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{top.map(([m, v]) => <span key={m} className={`rounded-full px-2 py-0.5 text-xs ${v.found >= v.missed ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{label(m)} {v.found}/{v.missed}</span>)}</div></td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.sources.map((s) => SRC[s] ?? s).join(", ")}</td>
                  </tr>,
                  isOpen && (
                    <tr key={r.studentId + ":ev"} className="border-t border-amber-100 bg-amber-50/30">
                      <td colSpan={8} className="px-3 py-3">
                        {events.isLoading && <p className="text-gray-500">Loading moments…</p>}
                        {events.data && (
                          <div className="grid gap-1.5">
                            {events.data.events.length === 0 && <p className="text-gray-500">No scored moments in this period.</p>}
                            {events.data.events.map((e) => (
                              <div key={`${e.gameId}:${e.ply}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm">
                                <span className={`w-12 text-center font-extrabold ${e.found ? "text-emerald-700" : "text-red-600"}`}>{e.points > 0 ? "+" : ""}{e.points}</span>
                                <span className="font-semibold">{e.found ? "Found" : "Missed"}</span>
                                <span className="flex flex-wrap gap-1"><span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">{label(e.primary)}</span>{e.motifs.filter((m) => m !== e.primary).slice(0, 2).map((m) => <span key={m} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{label(m)}</span>)}</span>
                                <span className="text-gray-600">move {Math.ceil(e.ply / 2)}{e.color === "black" ? "…" : "."} {e.found ? e.playedSan : <>{e.playedSan} <span className="text-gray-400">(best {e.bestSan}{e.mateIn ? `, mate in ${e.mateIn}` : ""})</span></>}</span>
                                <span className="ml-auto text-xs text-gray-400">{SRC[e.source] ?? e.source} · {e.label} · {new Date(e.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                                {e.url && (e.url.startsWith("http") ? <a href={e.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-600">open ↗</a> : <Link to={e.url} className="text-xs font-semibold text-blue-600">replay</Link>)}
                                <a href={`https://lichess.org/analysis/${e.fen.replace(/ /g, "_")}`} target="_blank" rel="noreferrer" className="text-xs text-gray-500" title="Open this position on Lichess analysis">position ↗</a>
                                <button onClick={() => rerun.mutate(e.gameId)} className="text-xs text-gray-400 hover:text-gray-700" title="Re-run the engine on this game">↻</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {board.data && (
        <details className="mt-4 text-xs text-gray-500"><summary className="cursor-pointer font-semibold">How points work</summary>
          <p className="mt-1">At every move the engine looks at the best line and names the tactic in it — one main motif per moment, the most specific. A tactic counts only when it actually appeared (the opponent just handed over at least 1.2 pawns, or a mate is on). If the student played the engine's move the motif is <b>found</b> and earns its points; if they played something at least 1.5 pawns worse, it is <b>missed</b> and costs half the points. Mate patterns 6–8, deflection / attraction / sacrifice / interference 4, fork / pin / skewer / discovered attack 3, hanging piece / defence 2.</p>
          <p className="mt-1">{Object.entries(board.data.points).sort((a, b) => b[1] - a[1]).map(([m, p]) => `${label(m)} ${p}`).join(" · ")}</p>
        </details>
      )}
    </div>
  );
}
