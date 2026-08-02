// Memory Master 500 — progress dashboard. Route: /study/progress.
//
// Sees only what the FSRS card store already contains — no network calls.
// Rendered as pure divs (no chart lib) so the bundle doesn't grow.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { computeProgress } from "../lib/progress";

export default function ProgressPage() {
  const p = useMemo(() => computeProgress(), []);
  const empty = p.totalCards === 0;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Progress</h1>
          <p className="mt-1 text-sm text-gray-500">
            Retention curve, upcoming load, and family mastery — computed from your local FSRS state.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/study/daily" className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-600">
            🔁 review
          </Link>
          <Link to="/study/openings" className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold hover:bg-gray-200">
            + add
          </Link>
        </div>
      </header>

      {empty ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center">
          <p className="text-2xl">📊</p>
          <h2 className="mt-2 text-lg font-bold">No progress yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            Activate an opening from the Openings browser and grade a few cards — this dashboard fills in as you review.
          </p>
          <Link to="/study/openings" className="mt-4 inline-block rounded-full bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800">
            Browse 500 openings
          </Link>
        </div>
      ) : (
        <>
          {/* Top strip: 6 headline metrics */}
          <div className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Metric label="cards" value={p.totalCards} />
            <Metric label="mastered" value={p.masteredCards} accent="text-emerald-600" hint={`${Math.round((p.masteredCards / p.totalCards) * 100)}%`} />
            <Metric label="review" value={p.reviewCards} accent="text-sky-600" />
            <Metric label="new" value={p.newCards} accent="text-indigo-600" />
            <Metric label="retention" value={`${p.retentionPct}%`} accent="text-purple-600" />
            <Metric label="openings" value={p.activeOpenings} />
          </div>

          {/* Streak card */}
          <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🔥</div>
              <div className="flex-1">
                <div className="text-2xl font-bold text-orange-900">
                  {p.streakDays} day{p.streakDays === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-orange-700">
                  current streak · best {p.bestStreakDays} · {p.lapseTotal} lapse{p.lapseTotal === 1 ? "" : "s"} total
                </div>
              </div>
            </div>
          </div>

          {/* Two-column: reviews history + upcoming load */}
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <BarStrip
              title="Reviews · last 30 days"
              accent="bg-emerald-500"
              data={p.reviewsByDay}
              zeroHint="Grade some cards to fill this in"
            />
            <BarStrip
              title="Upcoming · next 30 days"
              accent="bg-sky-500"
              data={p.dueByDay}
              zeroHint="Nothing coming up — add more openings"
            />
          </div>

          {/* Family mastery */}
          <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Mastery by family</div>
            {p.byFamily.length === 0 ? (
              <p className="text-sm text-gray-400">No families activated yet.</p>
            ) : (
              <div className="space-y-2">
                {p.byFamily.map((f) => {
                  const pct = f.cards > 0 ? (f.mastered / f.cards) * 100 : 0;
                  return (
                    <div key={f.familyId}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-semibold" style={{ color: f.colorHex }}>{f.familyName}</span>
                        <span className="text-gray-500">
                          {f.mastered}/{f.cards} mastered · {f.openings} opening{f.openings === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: f.colorHex }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recently studied */}
          {p.recent.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Recently studied</div>
              <ul className="divide-y divide-gray-100">
                {p.recent.map((r) => (
                  <li key={r.slug} className="flex items-center justify-between py-2 text-sm">
                    <Link to={`/study/openings/${r.slug}`} className="font-semibold text-gray-800 hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-gray-500">{humanAgo(r.when)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, accent, hint }: { label: string; value: number | string; accent?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-2.5 text-center">
      <div className={`text-xl font-bold ${accent ?? "text-gray-900"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      {hint && <div className="text-[9px] text-gray-400">{hint}</div>}
    </div>
  );
}

function BarStrip({ title, accent, data, zeroHint }: { title: string; accent: string; data: number[]; zeroHint: string }) {
  const max = Math.max(1, ...data);
  const total = data.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</div>
        <div className="text-xs text-gray-500">total {total}</div>
      </div>
      {total === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">{zeroHint}</p>
      ) : (
        <div className="flex h-24 items-end gap-[2px]">
          {data.map((v, i) => (
            <div key={i} className="flex-1" title={`${v} on day ${i}`}>
              <div
                className={`w-full rounded-t transition-all ${v > 0 ? accent : "bg-gray-100"}`}
                style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function humanAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
