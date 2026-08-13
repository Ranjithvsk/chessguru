// Memory Master 500 — progress dashboard. Route: /study/progress.
//
// Sees only what the FSRS card store already contains — no network calls.
// Rendered as pure divs (no chart lib) so the bundle doesn't grow.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { computeProgress } from "../lib/progress";
import { computeBelt, computeBadges, nextFamilyToMaster, type Badge } from "../lib/badges";

export default function ProgressPage() {
  const p = useMemo(() => computeProgress(), []);
  const belt = useMemo(() => computeBelt(p.masteredCards), [p.masteredCards]);
  const badges = useMemo(() => computeBadges(p), [p]);
  const nextFamily = useMemo(() => nextFamilyToMaster(p), [p]);
  const earnedBadges = badges.filter((b) => b.earned);
  const lockedBadges = badges.filter((b) => !b.earned);
  const empty = p.totalCards === 0;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Progress</h1>
          <p className="mt-1 text-sm text-ink-500">
            Retention curve, upcoming load, and family mastery — computed from your local FSRS state.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/study/daily" className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-600">
            🔁 review
          </Link>
          <Link to="/study/openings" className="rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold hover:bg-ink-800">
            + add
          </Link>
        </div>
      </header>

      {empty ? (
        <div className="rounded-xl border border-dashed border-ink-800 bg-ink-900 p-8 text-center">
          <p className="text-2xl">📊</p>
          <h2 className="mt-2 text-lg font-bold">No progress yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            Activate an opening from the Openings browser and grade a few cards — this dashboard fills in as you review.
          </p>
          <Link to="/study/openings" className="mt-4 inline-block rounded-full bg-ink-100 px-4 py-2 text-sm font-bold text-white hover:bg-ink-200">
            Browse 500 openings
          </Link>
        </div>
      ) : (
        <>
          {/* Belt card */}
          <div className="mb-6 rounded-xl border p-4 shadow-sm"
            style={{
              borderColor: belt.current.colorHex,
              background: `linear-gradient(90deg, ${belt.current.colorHex}22 0%, transparent 60%)`,
            }}>
            <div className="flex items-center gap-4">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-4 ring-white shadow"
                style={{ backgroundColor: belt.current.colorHex }}
              >
                <span className={`text-xl font-black ${belt.current.name === "White" ? "text-ink-600" : "text-white"}`}>
                  {belt.current.name[0]}
                </span>
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-ink-500">Current belt</div>
                <div className="text-2xl font-bold" style={{ color: belt.current.colorHex === "#f8fafc" ? "#111827" : belt.current.colorHex }}>
                  {belt.current.name} belt
                </div>
                {belt.next ? (
                  <div className="mt-1 text-xs text-ink-400">
                    <b>{belt.toNext}</b> more mastered cards to <b style={{ color: belt.next.colorHex }}>{belt.next.name}</b>
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-ink-400">Highest tier — you've mastered chess memory.</div>
                )}
                {belt.next && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-900">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${belt.pct}%`, backgroundColor: belt.next.colorHex }} />
                  </div>
                )}
              </div>
            </div>
          </div>

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
          <div className="mb-6 rounded-xl border border-ink-900 bg-ink-900 p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">Mastery by family</div>
            {p.byFamily.length === 0 ? (
              <p className="text-sm text-ink-600">No families activated yet.</p>
            ) : (
              <div className="space-y-2">
                {p.byFamily.map((f) => {
                  const pct = f.cards > 0 ? (f.mastered / f.cards) * 100 : 0;
                  return (
                    <div key={f.familyId}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-semibold" style={{ color: f.colorHex }}>{f.familyName}</span>
                        <span className="text-ink-500">
                          {f.mastered}/{f.cards} mastered · {f.openings} opening{f.openings === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-900">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: f.colorHex }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="mb-6 rounded-xl border border-ink-900 bg-ink-900 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-500">
                Badges <span className="text-ink-600">— {earnedBadges.length} of {badges.length}</span>
              </div>
              {nextFamily && (
                <div className="text-[11px] text-ink-500">
                  Next crown: <b>{nextFamily.familyName}</b> ({nextFamily.remaining} more)
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {earnedBadges.map((b) => <BadgeTile key={b.id} b={b} />)}
              {lockedBadges.map((b) => <BadgeTile key={b.id} b={b} />)}
            </div>
          </div>

          {/* Recently studied */}
          {p.recent.length > 0 && (
            <div className="rounded-xl border border-ink-900 bg-ink-900 p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Recently studied</div>
              <ul className="divide-y divide-ink-900">
                {p.recent.map((r) => (
                  <li key={r.slug} className="flex items-center justify-between py-2 text-sm">
                    <Link to={`/study/openings/${r.slug}`} className="font-semibold text-ink-200 hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-ink-500">{humanAgo(r.when)}</span>
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
    <div className="rounded-lg border border-ink-900 bg-ink-900 p-2.5 text-center">
      <div className={`text-xl font-bold ${accent ?? "text-ink-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
      {hint && <div className="text-[9px] text-ink-600">{hint}</div>}
    </div>
  );
}

function BarStrip({ title, accent, data, zeroHint }: { title: string; accent: string; data: number[]; zeroHint: string }) {
  const max = Math.max(1, ...data);
  const total = data.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-xl border border-ink-900 bg-ink-900 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-xs font-bold uppercase tracking-wide text-ink-500">{title}</div>
        <div className="text-xs text-ink-500">total {total}</div>
      </div>
      {total === 0 ? (
        <p className="py-6 text-center text-xs text-ink-600">{zeroHint}</p>
      ) : (
        <div className="flex h-24 items-end gap-[2px]">
          {data.map((v, i) => (
            <div key={i} className="flex-1" title={`${v} on day ${i}`}>
              <div
                className={`w-full rounded-t transition-all ${v > 0 ? accent : "bg-ink-900"}`}
                style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgeTile({ b }: { b: Badge }) {
  return (
    <div
      className={`flex flex-col items-center rounded-lg p-2 text-center transition ${
        b.earned
          ? "bg-amber-50 ring-1 ring-amber-200"
          : "bg-ink-950 opacity-60 ring-1 ring-ink-900"
      }`}
      title={b.hint}
    >
      <div className={`text-2xl ${b.earned ? "" : "grayscale"}`}>{b.glyph}</div>
      <div className={`mt-1 text-[10px] font-bold leading-tight ${b.earned ? "text-amber-900" : "text-ink-400"}`}>
        {b.name}
      </div>
      {!b.earned && b.progress && (
        <div className="mt-0.5 text-[9px] text-ink-500">{b.progress}</div>
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
