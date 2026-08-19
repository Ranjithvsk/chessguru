// Head-to-head compare — coach or student picks two academy members and
// sees side-by-side stats + badge counts + 30d activity. Rows highlight
// the "winner" per dimension so it's obvious who's ahead where.
//
// Real-world benefit for coaches: pair-up students with overlapping
// weaknesses for group lessons. For students: rivalry-driven motivation.
//
// Route: /academy/compare?a=X&b=Y
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, get } from "../lib/api";

type Side = {
  _id: string;
  username: string;
  name: string | null;
  currentRating: number;
  blindfoldRating: number | null;
  streak: number;
  longestStreak: number;
  stats30d: {
    puzzles: number;
    wins: number;
    blindfold: number;
    avgMs: number | null;
    accuracy: number;
    themesCount: number;
  };
  badgesUnlocked: number;
  badgesTotal: number;
  unlockedBadges: { id: string; name: string; emoji: string; tier: string }[];
};
type CompareResp = { a: Side; b: Side };

type StudentLite = {
  _id: string;
  username: string;
  name: string | null;
};

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function StudentPicker({ label, value, onChange, students }: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  students: StudentLite[];
}) {
  return (
    <div className="flex-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-brand-300">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-white focus:border-brand-500 focus:outline-none">
        <option value="">— pick a student —</option>
        {students.map((s) => (
          <option key={s._id} value={s._id}>{s.name || s.username} (@{s.username})</option>
        ))}
      </select>
    </div>
  );
}

/** One comparison row — value on each side, winner highlighted.
 *  `winner`: -1 = A, +1 = B, 0 = tie. `higherIsBetter` inverts for
 *  metrics like avg-solve-ms where lower wins. */
function CompareRow({ label, aVal, bVal, formatVal, higherIsBetter = true, note }: {
  label: string;
  aVal: number | null;
  bVal: number | null;
  formatVal: (v: number | null) => string;
  higherIsBetter?: boolean;
  note?: string;
}) {
  let winner: -1 | 0 | 1 = 0;
  if (aVal != null && bVal != null && aVal !== bVal) {
    const aBetter = higherIsBetter ? aVal > bVal : aVal < bVal;
    winner = aBetter ? -1 : 1;
  }
  const aCls = winner === -1 ? "text-emerald-300 font-bold" : "text-ink-200";
  const bCls = winner === 1  ? "text-emerald-300 font-bold" : "text-ink-200";
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-ink-800/80 py-2">
      <div className={`text-right tabular-nums ${aCls}`}>{formatVal(aVal)} {winner === -1 && "🏆"}</div>
      <div className="text-center text-[11px] uppercase tracking-wider text-ink-400" title={note}>{label}</div>
      <div className={`text-left tabular-nums ${bCls}`}>{winner === 1 && "🏆"} {formatVal(bVal)}</div>
    </div>
  );
}

function SideHeader({ side }: { side: Side | undefined }) {
  if (!side) return <div className="text-center text-ink-500">Pick a student</div>;
  return (
    <div className="text-center">
      <Link to={`/academy/students/${encodeURIComponent(side._id)}/performance`}
        className="font-display text-xl text-white hover:text-brand-300">{side.name || side.username}</Link>
      <div className="text-xs text-ink-500">@{side.username}</div>
      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs font-semibold text-brand-200 tabular-nums">{side.currentRating}</span>
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200 tabular-nums">🎖️ {side.badgesUnlocked}/{side.badgesTotal}</span>
      </div>
    </div>
  );
}

export default function LeaderboardComparePage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const [params, setParams] = useSearchParams();
  const [aId, setAId] = useState<string>(params.get("a") || "");
  const [bId, setBId] = useState<string>(params.get("b") || "");

  useEffect(() => {
    const next = new URLSearchParams();
    if (aId) next.set("a", aId);
    if (bId) next.set("b", bId);
    setParams(next, { replace: true });
  }, [aId, bId, setParams]);

  const studentsQ = useQuery({
    queryKey: ["academy-students-lite"],
    queryFn: () => get<any[]>("/api/academy/students"),
    enabled: !!auth?.loggedIn && !!auth?.academyId,
    staleTime: 60_000,
  });
  const compareQ = useQuery({
    queryKey: ["academy-compare", aId, bId],
    queryFn: () => get<CompareResp>(`/api/academy/compare?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`),
    enabled: !!aId && !!bId,
    staleTime: 60_000,
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/academy/compare" replace />;
  if (auth && !auth.academyId) return (
    <div className="mx-auto max-w-lg py-10 text-center text-sm text-ink-400">
      You need to be in an academy to compare students.
    </div>
  );

  const students: StudentLite[] = (studentsQ.data ?? []).map((s: any) => ({ _id: s._id, username: s.username, name: s.name || null }));
  const a = compareQ.data?.a;
  const b = compareQ.data?.b;

  return (
    <div className="relative mx-auto max-w-5xl space-y-6 px-3 py-6">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute top-0 left-1/3 h-72 w-72 rounded-full bg-emerald-500/10 blur-[110px]" />
        <div className="absolute top-40 right-0 h-72 w-72 rounded-full bg-brand-500/10 blur-[110px]" />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Academy · compare</div>
          <h1 className="font-display text-3xl bg-gradient-to-r from-emerald-300 via-brand-300 to-fuchsia-300 bg-clip-text text-transparent">
            ⚔️ Head-to-Head
          </h1>
          <div className="mt-1 text-sm text-ink-400">Side-by-side stats + badges. Winner per row is 🏆-marked.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/academy/leaderboard" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:text-white">← Leaderboard</Link>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
        <StudentPicker label="Student A" value={aId} onChange={setAId} students={students} />
        <div className="text-2xl text-fuchsia-300">vs</div>
        <StudentPicker label="Student B" value={bId} onChange={setBId} students={students.filter((s) => s._id !== aId)} />
      </div>

      {compareQ.isLoading && aId && bId && (
        <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-6 text-center text-sm text-ink-400">Loading comparison…</div>
      )}
      {compareQ.error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {String((compareQ.error as any)?.message || "Could not load comparison.")}
        </div>
      )}

      {a && b && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl2 border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-ink-900/70 p-4">
              <SideHeader side={a} />
            </div>
            <div className="rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-950/40 to-ink-900/70 p-4">
              <SideHeader side={b} />
            </div>
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Ratings & consistency</div>
            <CompareRow label="Puzzle rating" aVal={a.currentRating} bVal={b.currentRating} formatVal={(v) => v?.toString() ?? "—"} />
            <CompareRow label="Blindfold rating" aVal={a.blindfoldRating} bVal={b.blindfoldRating} formatVal={(v) => v?.toString() ?? "—"} />
            <CompareRow label="Current streak" aVal={a.streak} bVal={b.streak} formatVal={(v) => v != null ? `${v}d` : "—"} />
            <CompareRow label="Longest streak" aVal={a.longestStreak} bVal={b.longestStreak} formatVal={(v) => v != null ? `${v}d` : "—"} />

            <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Last 30 days activity</div>
            <CompareRow label="Puzzles solved" aVal={a.stats30d.puzzles} bVal={b.stats30d.puzzles} formatVal={(v) => v?.toString() ?? "0"} />
            <CompareRow label="Blindfold puzzles" aVal={a.stats30d.blindfold} bVal={b.stats30d.blindfold} formatVal={(v) => v?.toString() ?? "0"} />
            <CompareRow label="Accuracy" aVal={a.stats30d.accuracy} bVal={b.stats30d.accuracy} formatVal={(v) => v != null ? `${Math.round(v*100)}%` : "—"} />
            <CompareRow label="Avg solve time" aVal={a.stats30d.avgMs} bVal={b.stats30d.avgMs} formatVal={fmtMs} higherIsBetter={false} note="Lower is better" />
            <CompareRow label="Distinct themes" aVal={a.stats30d.themesCount} bVal={b.stats30d.themesCount} formatVal={(v) => v?.toString() ?? "0"} />

            <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Badges</div>
            <CompareRow label="Achievements unlocked" aVal={a.badgesUnlocked} bVal={b.badgesUnlocked} formatVal={(v) => `${v ?? 0}/${a.badgesTotal}`} />
          </div>

          {/* Badge showcase */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/30 bg-ink-900/50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">{a.name || a.username}'s badges</div>
              {a.unlockedBadges.length === 0 ? (
                <div className="text-xs text-ink-500">No badges yet.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {a.unlockedBadges.map((b) => (
                    <span key={b.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-100" title={b.name}>
                      <span>{b.emoji}</span><span>{b.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-brand-500/30 bg-ink-900/50 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-300">{b.name || b.username}'s badges</div>
              {b.unlockedBadges.length === 0 ? (
                <div className="text-xs text-ink-500">No badges yet.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {b.unlockedBadges.map((bb) => (
                    <span key={bb.id} className="inline-flex items-center gap-1 rounded-full bg-brand-500/20 px-2 py-1 text-xs text-brand-100" title={bb.name}>
                      <span>{bb.emoji}</span><span>{bb.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-ink-500 text-center">
            Coaches: use this to pair students with similar weaknesses for a joint lesson. Students: friendly rivalry drives real improvement.
          </div>
        </>
      )}
    </div>
  );
}
