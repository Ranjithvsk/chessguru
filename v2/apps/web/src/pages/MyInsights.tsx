// My Insights — weakness dashboard + prescriptions. Route: /my-insights
// Also renders the coach view when a studentId is passed via prop.

import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { insightsApi, type InsightsSummary, type Weakness } from "../lib/insights-api";

const SEVERITY_STYLES: Record<string, string> = {
  high:   "border-rose-500/50 bg-rose-500/5",
  medium: "border-amber-500/50 bg-amber-500/5",
  low:    "border-ink-700 bg-ink-900",
};
const SEVERITY_BADGE: Record<string, string> = {
  high:   "bg-rose-500/20 text-rose-200",
  medium: "bg-amber-500/20 text-amber-200",
  low:    "bg-ink-800 text-ink-300",
};

export default function MyInsightsPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["insights-me"],
    queryFn: () => insightsApi.mine(),
    enabled: !!auth?.loggedIn,
  });
  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/my-insights" replace />;
  return <InsightsView q={q} title="My Insights" />;
}

export function StudentInsightsPage() {
  const { userId = "" } = useParams<{ userId: string }>();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["insights-student", userId],
    queryFn: () => insightsApi.forStudent(userId),
    enabled: !!auth?.loggedIn && !!userId,
  });
  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/insights/students/${encodeURIComponent(userId)}`} replace />;
  return <InsightsView q={q} title={`Insights: ${userId}`} backTo="/academy" backLabel="← Academy" />;
}

function InsightsView({ q, title, backTo, backLabel }: {
  q: { isLoading: boolean; error: any; data?: InsightsSummary };
  title: string;
  backTo?: string;
  backLabel?: string;
}) {
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Loading…</div>;
  if (q.error) return <div className="mx-auto max-w-4xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>
  </div>;
  if (!q.data) return null;

  const d = q.data;
  const totalMistakes = d.totalBlunders + d.totalMistakes + d.totalInaccuracies;

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      {backTo && <Link to={backTo} className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">{backLabel}</Link>}
      <div className="mb-6">
        <h1 className="font-display text-2xl text-white">{title}</h1>
        <p className="text-sm text-ink-400">Your top weaknesses across analyzed games, plus what to study and drill for each.</p>
      </div>

      {/* Top stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Games analyzed" value={d.gamesAnalyzed} color="ink" />
        <StatBox label="Blunders" value={d.totalBlunders} color="rose" />
        <StatBox label="Mistakes" value={d.totalMistakes} color="amber" />
        <StatBox label="Inaccuracies" value={d.totalInaccuracies} color="ink" />
      </div>

      {d.gamesAnalyzed === 0 ? (
        <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-8 text-center">
          <div className="mb-2 text-4xl">🎮</div>
          <div className="mb-4 text-white">No games analyzed yet.</div>
          <Link to="/my-games/import" className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
            Import your games
          </Link>
        </div>
      ) : totalMistakes === 0 ? (
        <div className="rounded-xl2 border border-emerald-500/40 bg-emerald-500/5 p-6 text-center text-sm text-emerald-100">
          🎉 No classified mistakes yet — either you played clean or Stockfish couldn't tag the errors it saw.
        </div>
      ) : (
        <div className="space-y-4">
          {d.weaknesses.map((w) => <WeaknessCard key={w.tag} w={w} />)}
        </div>
      )}
    </div>
  );
}

function WeaknessCard({ w }: { w: Weakness }) {
  return (
    <div className={`rounded-xl2 border p-4 ${SEVERITY_STYLES[w.severity]}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-2xl">🎯</span>
        <div className="flex-1">
          <div className="font-semibold text-white">{w.label}</div>
          <div className="text-xs text-ink-400">You made this mistake {w.count} time{w.count === 1 ? "" : "s"}.</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_BADGE[w.severity]}`}>{w.severity}</span>
      </div>

      {/* Example games */}
      {w.exampleGames.length > 0 && (
        <div className="mb-3 rounded bg-ink-800/60 p-2 text-xs">
          <div className="mb-1 font-semibold text-ink-300">Examples from your games:</div>
          <ul className="space-y-1">
            {w.exampleGames.map((ex, i) => (
              <li key={i}>
                <Link to={`/my-games/${encodeURIComponent(ex.gameId)}`}
                  className="text-brand-200 hover:underline font-mono">
                  {ex.san}
                </Link>
                {ex.bestSan && <span className="text-ink-400"> — best was <span className="font-mono">{ex.bestSan}</span></span>}
                {ex.explanation && <div className="ml-4 text-ink-500">{ex.explanation}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prescriptions */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Books */}
        {w.prescriptions.books.length > 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">📚 Study</div>
            {w.prescriptions.books.slice(0, 3).map((b) => {
              const doneCh = b.chapters.filter((c) => c.done).length;
              const nextCh = b.chapters.find((c) => !c.done) || b.chapters[0];
              return (
                <Link key={b.bookId} to={`/books/${encodeURIComponent(b.bookId)}`}
                  className="mt-1 block rounded p-2 text-xs hover:bg-ink-800">
                  <div className="font-semibold text-white line-clamp-1">{b.title}</div>
                  <div className="text-ink-500">{b.author}</div>
                  {nextCh && (
                    <div className="mt-1 text-brand-200">
                      Next: Ch {nextCh.number} — {nextCh.title}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-ink-500">{doneCh}/{b.chapters.length} matching chapters read</div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Puzzles */}
        {w.prescriptions.puzzleThemes.length > 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">🧩 Drill</div>
            {w.prescriptions.puzzleThemes.slice(0, 4).map((pt) => (
              <Link key={pt.theme} to={`/puzzles?theme=${encodeURIComponent(pt.theme)}`}
                className="mt-1 block rounded p-2 text-xs hover:bg-ink-800">
                <div className="font-semibold text-white capitalize">{humanTheme(pt.theme)}</div>
                <div className="text-ink-500">{pt.puzzleCount.toLocaleString()} puzzles available</div>
              </Link>
            ))}
          </div>
        )}

        {/* Own studies */}
        {w.prescriptions.studies.length > 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">📓 Your notes</div>
            {w.prescriptions.studies.slice(0, 5).map((s) => (
              <Link key={s.studyId} to={`/studies/${encodeURIComponent(s.studyId)}`}
                className="mt-1 block rounded p-2 text-xs hover:bg-ink-800">
                <div className="font-semibold text-white line-clamp-1">{s.title}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: "rose" | "amber" | "ink" }) {
  const cls = color === "rose" ? "text-rose-300" : color === "amber" ? "text-amber-300" : "text-ink-200";
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-3 text-center">
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
}

function humanTheme(t: string): string {
  return t.replace(/([A-Z])/g, " $1").trim().replace(/^./, (c) => c.toUpperCase());
}
