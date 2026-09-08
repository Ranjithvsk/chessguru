// Coach / owner: students whose recent puzzle solving looks assisted —
// flagged solves, implausibly fast wins on 2400+ puzzles, steep climbs.
// Backed by GET /api/academy/suspicious-solves. On the dashboard it is
// `compact` and disappears when there is nothing to show; on the
// Performance page it always renders with an empty state. Owner can reset
// a rating from here (audited in ratingAdjustments).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/api";

interface Fastest { puzzleId: string; pr: number; ms: number; mvMs: number[] | null; at: string }
interface Row {
  userId: string; name: string; ratingNow: number | null; ratingStart: number | null; ratingEnd: number | null; climb: number;
  solves: number; dubious: number; reasons: Record<string, number>;
  hard: { n: number; wins: number; winPct: number | null; medianMs: number | null; fast: number };
  fastest: Fastest[]; score: number; lastReset: { at: string; to: number | null; from: number | null } | null;
}
const REASON_LABEL: Record<string, string> = {
  fast_hard: "2400+ puzzle under 4 s",
  fast_above_level: "300+ above level under 4 s",
  metronome: "even 1–2 s move gaps",
  streak: "run of fast hard wins",
};
const secs = (ms: number) => (ms / 1000).toFixed(1) + "s";

export default function AcademySuspiciousPanel({ isOwner, compact = false }: { isOwner: boolean; compact?: boolean }) {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["academy-suspicious", days],
    queryFn: () => get<{ days: number; students: Row[] }>(`/api/academy/suspicious-solves?days=${days}`),
    staleTime: 60_000,
  });
  const rows = q.data?.students ?? [];
  if (compact && (!q.data || rows.length === 0)) return null;

  const reset = async (r: Row) => {
    const ratingStr = window.prompt(`Reset ${r.name}'s puzzle rating to:`, String(r.lastReset?.to ?? 1700));
    if (ratingStr === null) return;
    const rating = Math.round(Number(ratingStr));
    if (!isFinite(rating) || rating < 400 || rating > 3000) { setToast("Enter a rating between 400 and 3000."); return; }
    const reason = window.prompt("Reason (kept in the audit log):", "Suspicious solving — see the Suspicious solving panel") ?? "";
    if (!window.confirm(`Set ${r.name} to ${rating}? Per-theme ratings above ${rating} are clamped too. This is logged.`)) return;
    setBusy(r.userId);
    try {
      const res = await post<{ ok: boolean; error?: string; before?: { r: number } | null }>(`/api/academy/students/${encodeURIComponent(r.userId)}/reset-puzzle-rating`, { rating, reason });
      if (res.ok) { setToast(`${r.name}: ${res.before?.r ?? "?"} → ${rating}`); void qc.invalidateQueries({ queryKey: ["academy-suspicious"] }); }
      else setToast(res.error || "Could not reset.");
    } catch (e: any) { setToast(e?.message || "Could not reset."); }
    finally { setBusy(null); setTimeout(() => setToast(null), 4000); }
  };

  return (
    <section className="rounded-xl2 border border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-ink-900 to-ink-900 p-4" data-testid="suspicious-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg text-white">🚩 Suspicious solving</h2>
          <p className="text-xs text-ink-400">Solves flagged by the detector, wins on 2400+ puzzles in under 5 s, and steep climbs. Flagged solves no longer move a rating.</p>
        </div>
        <div className="inline-flex rounded-full border border-ink-700 bg-ink-900 p-0.5 text-[11px]">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-full px-2.5 py-0.5 ${days === d ? "bg-ink-700 text-white" : "text-ink-400 hover:text-white"}`}>{d}d</button>
          ))}
        </div>
      </div>
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-ink-800/60" />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">Nothing suspicious in the last {days} days.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.userId} className="rounded-xl border border-ink-700/70 bg-ink-900/70 p-3" data-testid="suspicious-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/insights/students/${encodeURIComponent(r.userId)}`} className="font-semibold text-white hover:underline">{r.name}</Link>
                  <span className="rounded-md bg-ink-800 px-1.5 py-0.5 text-xs text-ink-200">now {r.ratingNow ?? "—"}</span>
                  {r.climb !== 0 && (
                    <span className={`rounded-md px-1.5 py-0.5 text-xs ${r.climb >= 500 ? "bg-rose-500/20 text-rose-200" : "bg-ink-800 text-ink-300"}`}>{r.ratingStart} → {r.ratingEnd} ({r.climb > 0 ? "+" : ""}{r.climb})</span>
                  )}
                  {r.dubious > 0 && <span className="rounded-md bg-rose-500/25 px-1.5 py-0.5 text-xs font-semibold text-rose-100">{r.dubious} flagged</span>}
                  {r.lastReset && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-200" title={new Date(r.lastReset.at).toLocaleString()}>reset {r.lastReset.from ?? "?"} → {r.lastReset.to}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-500">score {r.score}</span>
                  {isOwner && (
                    <button onClick={() => reset(r)} disabled={busy === r.userId} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-50" data-testid="reset-rating">
                      {busy === r.userId ? "…" : "Reset rating…"}
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
                <span>{r.solves} solves</span>
                {r.hard.n > 0 && <span>2400+ puzzles: <b className="text-white">{r.hard.winPct}%</b> of {r.hard.n}{r.hard.medianMs !== null ? <> · median <b className="text-white">{secs(r.hard.medianMs)}</b></> : null}{r.hard.fast > 0 ? <> · <b className="text-rose-200">{r.hard.fast}</b> under 5 s</> : null}</span>}
                {Object.entries(r.reasons).map(([k, n]) => (
                  <span key={k} className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-100">{REASON_LABEL[k] ?? k} × {n}</span>
                ))}
              </div>
              {r.fastest.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.fastest.map((f) => (
                    <Link key={f.puzzleId} to={`/puzzles?review=${encodeURIComponent(f.puzzleId)}`} title={f.mvMs ? `per move: ${f.mvMs.map((m) => (m / 1000).toFixed(1) + "s").join(" · ")}` : undefined}
                      className="rounded-md bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-ink-100 hover:bg-ink-700">
                      {f.pr} in {secs(f.ms)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {toast && <div className="mt-3 rounded-lg bg-ink-800 px-3 py-2 text-sm text-white">{toast}</div>}
    </section>
  );
}
