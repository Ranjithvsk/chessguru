import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "react-router-dom";
import { api, adminUsers, adminUserDetail, adminOverview } from "../lib/api";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }); } catch { return "—"; }
}
function fmtAgo(d?: string | null) {
  if (!d) return "—";
  const t = new Date(d).getTime();
  if (isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 font-display text-2xl text-white">{value}</div>
      {sub && <div className="text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export default function AdminUsersPage() {
  const { data: auth, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const isAdmin = !!auth?.admin;
  const { data: ov } = useQuery({ queryKey: ["admin-overview"], queryFn: adminOverview, enabled: isAdmin });
  const { data: users, isLoading, error } = useQuery({ queryKey: ["admin-users"], queryFn: adminUsers, enabled: isAdmin });
  const [sel, setSel] = useState<string | null>(null);
  const { data: detail } = useQuery({ queryKey: ["admin-user", sel], queryFn: () => adminUserDetail(sel!), enabled: !!sel && isAdmin });

  if (authLoading) return <p className="text-ink-400">Loading…</p>;
  if (auth && !auth.loggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-rose-200">Not authorized — admin only.</div>;

  const maxAct = Math.max(1, ...((ov?.activity14 ?? []).map((d) => d.puzzle + d.study)));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl text-white">Admin</h1>
          <p className="text-sm text-ink-400">ChessGuru — users &amp; activity</p>
        </div>
        {/* Toggle: same data set can be viewed as the styled leaderboard so
            each user gets the ChessGuru Score + achievements + gradients
            treatment. "__all__" is a super-admin sentinel that combines
            every academy + standalone signups. Owner ask 2026-08-27. */}
        <Link
          to="/academy/leaderboard?academy=__all__"
          className="inline-flex items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/15 px-3 py-2 text-sm font-semibold text-brand-100 hover:bg-brand-500/25"
          title="Same users, rendered as the ChessGuru leaderboard — click any user for their full profile card"
        >
          🏆 View as leaderboard →
        </Link>
      </div>

      {/* ── Overview dashboard ── */}
      {ov && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card label="Users" value={ov.users.total} sub={`+${ov.users.newWeek} this week`} />
            <Card label="Active 7d" value={ov.users.active7d} sub={`${ov.users.active30d} in 30d`} />
            <Card label="New today" value={ov.users.newToday} />
            <Card label="Puzzle solves" value={ov.solves.puzzleTotal.toLocaleString()} />
            <Card label="Study solves" value={ov.solves.studyTotal.toLocaleString()} />
            <Card label="Solves today" value={ov.solves.today} sub={`${ov.solves.week} this week`} />
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              Activity — last 14 days <span className="text-ink-500">(■ puzzle ■ study)</span>
            </div>
            <div className="flex items-end gap-1" style={{ height: 72 }}>
              {ov.activity14.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col justify-end" title={`${d.date}: ${d.puzzle} puzzle + ${d.study} study`}>
                  <div className="w-full rounded-t bg-accent-400/70" style={{ height: `${(d.study / maxAct) * 64}px` }} />
                  <div className="w-full bg-brand-600" style={{ height: `${(d.puzzle / maxAct) * 64}px` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-ink-500"><span>{ov.activity14[0]?.date.slice(5)}</span><span>today</span></div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Content &amp; generation</div>
              <div className="text-sm text-ink-300">Puzzle pool: <b className="text-white">{ov.content.puzzlePool.toLocaleString()}</b></div>
              <div className="text-sm text-ink-300">
                Study puzzles: <b className="text-white">{ov.content.studyTotal}</b>
                {ov.content.studyPending ? <span className="text-amber-400"> · {ov.content.studyPending} pending Maia-seed</span> : <span className="text-emerald-400"> · all Maia-seeded</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {ov.content.studyByType.map((t) => <span key={t.type} className="rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300">{t.type}: {t.n}</span>)}
              </div>
            </div>
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Inactive (14+ days)</div>
              {ov.inactive.length === 0 && <p className="text-sm text-ink-400">Everyone&apos;s been active recently 🎉</p>}
              {ov.inactive.map((u) => (
                <div key={u.username} className="flex justify-between border-t border-ink-800/60 py-1 text-sm first:border-0">
                  <span className="text-ink-200">{u.username}</span><span className="text-ink-500">{u.days}d ago</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Users table ── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg text-white">Users <span className="text-sm text-ink-400">({users?.length ?? 0}) · click a row for activity</span></h2>
        {error && <p className="text-rose-300">Failed to load users.</p>}
        <div className="overflow-x-auto rounded-xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-800 text-ink-300">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Academy</th>
                <th className="px-3 py-2">Puzzle</th>
                <th className="px-3 py-2" title="Rating change last 7 days — red = bleeding despite good win%, green = gaining">7d Δ</th>
                <th className="px-3 py-2" title="Wins/solves in the last 7 days">7d W%</th>
                <th className="px-3 py-2" title="Puzzles played in the last 7 days">7d n</th>
                <th className="px-3 py-2">Solves (all-time)</th>
                <th className="px-3 py-2">All-time W%</th>
                <th className="px-3 py-2">Study</th>
                <th className="px-3 py-2">Last active</th>
                <th className="px-3 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => {
                const winRate7d = u.solves7d && u.solves7d > 0 ? Math.round(((u.wins7d ?? 0) / u.solves7d) * 100) : null;
                // Bleeder = winRate ≥ 60% AND net7d < 0 (Lichess-style convergence tax visible)
                const isBleeder = u.net7d != null && u.net7d < 0 && winRate7d != null && winRate7d >= 60;
                const isGainer = u.net7d != null && u.net7d > 0;
                const netColor = u.net7d == null ? "text-ink-500" : u.net7d < 0 ? "text-rose-300 font-bold" : "text-emerald-300";
                return (
                  <tr key={u.username} onClick={() => setSel(u.username)}
                    className={`cursor-pointer border-t border-ink-800 hover:bg-ink-800/60 ${sel === u.username ? "bg-ink-800" : ""} ${isBleeder ? "bg-rose-500/5" : ""}`}>
                    <td className="px-3 py-2 font-medium text-white" title={u.email || ""}>
                      {u.username}
                      {u.role && u.role !== "student" && (() => {
                        // Role badge — makes coaches / owners stand out so ranjith
                        // can eyeball the report and know who's actually a kid vs
                        // a coach with their own high rating. Owner ask 2026-08-27.
                        const label: Record<string, string> = {
                          academy_owner: "OWNER",
                          coach: "COACH",
                          parent: "PARENT",
                        };
                        const cls: Record<string, string> = {
                          academy_owner: "bg-brand-500/25 text-brand-200",
                          coach: "bg-emerald-500/25 text-emerald-200",
                          parent: "bg-amber-500/25 text-amber-200",
                        };
                        return (
                          <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold tracking-wide ${cls[u.role] ?? "bg-ink-700 text-ink-300"}`}>
                            {label[u.role] ?? u.role.toUpperCase()}
                          </span>
                        );
                      })()}
                      {isBleeder && <span className="ml-1 rounded bg-rose-500/25 px-1 text-[10px] font-bold text-rose-200" title="Losing rating despite ≥60% win rate — Lichess-style convergence for overrated user picking easier/obvious puzzles">⚠</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-400">{u.academyId ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-white">{u.puzzleRating ?? "—"}</td>
                    <td className={`px-3 py-2 tabular-nums ${netColor}`}>
                      {u.net7d == null ? "—" : (u.net7d > 0 ? `+${u.net7d}` : String(u.net7d))}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{winRate7d != null ? `${winRate7d}%` : "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-ink-400">{u.solves7d ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums text-ink-400">{u.solves}</td>
                    <td className="px-3 py-2 tabular-nums text-ink-400">{u.solves ? Math.round((u.wins / u.solves) * 100) + "%" : "—"}</td>
                    <td className="px-3 py-2" title={u.studySolves ? Math.round((u.studyWins / u.studySolves) * 100) + "% solved" : ""}>{u.studySolves || "—"}</td>
                    <td className="px-3 py-2 text-ink-400">{fmtAgo(u.lastActive)}</td>
                    <td className="px-3 py-2 text-ink-400">{fmtDate(u.createdAt)}</td>
                  </tr>
                );
              })}
              {isLoading && <tr><td colSpan={11} className="px-3 py-6 text-center text-ink-400">Loading…</td></tr>}
              {!isLoading && (users ?? []).length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-ink-400">No users.</td></tr>}
            </tbody>
          </table>
        </div>
        {/* Aggregate summary — quick pulse for the fleet */}
        {users && users.length > 0 && (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Card label="Active 7d (10+)" value={users.filter(u => (u.solves7d ?? 0) >= 10).length} />
            <Card label="Gaining rating" value={users.filter(u => (u.net7d ?? 0) > 0).length} />
            <Card label="Bleeding (≥60% W% + net<0)" value={users.filter(u => {
              const wr = u.solves7d && u.solves7d > 0 ? ((u.wins7d ?? 0) / u.solves7d) * 100 : 0;
              return (u.net7d ?? 0) < 0 && wr >= 60;
            }).length} sub="Lichess convergence tax — see legend" />
            <Card label="Biggest 7d gain" value={"+" + Math.max(0, ...users.map(u => u.net7d ?? 0))} />
          </div>
        )}
      </section>

      {/* ── User detail ── */}
      {sel && detail && (
        <div className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg text-white">
              {detail.username}{" "}
              <span className="text-sm text-ink-400">· joined {fmtDate(detail.createdAt)} · last login {fmtAgo(detail.lastLogin)}{detail.email ? " · " + detail.email : ""}</span>
            </h2>
            <div className="flex items-center gap-2">
              <Link to={`/dashboard?as=${encodeURIComponent(detail.username)}`}
                className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-100 hover:bg-brand-500/20">
                📊 Performance
              </Link>
              <Link to={`/history?as=${encodeURIComponent(detail.username)}`}
                className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-100 hover:bg-brand-500/20">
                📜 Full history
              </Link>
              <button onClick={() => setSel(null)} className="text-sm text-ink-400 hover:text-white">close</button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-ink-800 px-2.5 py-1 text-ink-200">Today: <b className="text-white">{detail.solvesToday}</b></span>
            <span className="rounded-full bg-ink-800 px-2.5 py-1 text-ink-200">This week: <b className="text-white">{detail.solvesWeek}</b></span>
            <span className="rounded-full bg-ink-800 px-2.5 py-1 text-ink-200">Study: <b className="text-white">{detail.studySolves}</b>{detail.studySolves ? ` (${Math.round((detail.studyWins / detail.studySolves) * 100)}%)` : ""}</span>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(detail.ratings).map(([k, v]) => (
              <span key={k} className="rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-semibold text-brand-300">{k}: {v.r} <span className="text-ink-500">({v.nb})</span></span>
            ))}
            {Object.keys(detail.ratings).length === 0 && <span className="text-sm text-ink-400">No rated activity yet.</span>}
          </div>

          {detail.topThemes.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Top themes</div>
              <div className="mt-1 flex flex-wrap gap-1">{detail.topThemes.map((t) => <span key={t.theme} className="rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300">{t.theme} · {t.n}</span>)}</div>
            </div>
          )}

          {detail.ratingHistory.length > 1 && (
            <div className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Puzzle rating trend</div>
              <div className="mt-1 flex items-end gap-0.5" style={{ height: 32 }}>
                {(() => {
                  const h = detail.ratingHistory, mn = Math.min(...h), mx = Math.max(...h), rng = Math.max(1, mx - mn);
                  return h.map((r, i) => <div key={i} title={String(r)} className="flex-1 rounded-t bg-brand-500/60" style={{ height: `${8 + ((r - mn) / rng) * 24}px` }} />);
                })()}
              </div>
              <div className="text-[10px] text-ink-500">{detail.ratingHistory[0]} → {detail.ratingHistory[detail.ratingHistory.length - 1]}</div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Recent solves ({detail.recent.length})</div>
              <div className="mt-2 max-h-64 overflow-y-auto">
                {detail.recent.length === 0 && <p className="text-sm text-ink-400">No solves yet.</p>}
                {detail.recent.map((r, i) => (
                  <div key={i} className="flex items-center justify-between border-t border-ink-800 py-1.5 text-sm">
                    <span className={r.win ? "text-emerald-400" : "text-rose-400"}>{r.win ? "✓ win" : "✗ miss"}</span>
                    <span className="text-ink-400">{r.rating ?? "—"}{r.ratingDiff != null ? ` (${r.ratingDiff >= 0 ? "+" : ""}${r.ratingDiff})` : ""}</span>
                    <span className="text-ink-500">{fmtAgo(r.at)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">Recent studies ({detail.recentStudy.length})</div>
              <div className="mt-2 max-h-64 overflow-y-auto">
                {detail.recentStudy.length === 0 && <p className="text-sm text-ink-400">No study solves yet.</p>}
                {detail.recentStudy.map((r, i) => (
                  <div key={i} className="flex items-center justify-between border-t border-ink-800 py-1.5 text-sm">
                    <span className={r.win ? "text-emerald-400" : "text-rose-400"}>{r.win ? "✓" : "✗"} {r.type}</span>
                    <span className="text-ink-400">{r.rating ?? "—"}{r.ratingDiff != null ? ` (${r.ratingDiff >= 0 ? "+" : ""}${r.ratingDiff})` : ""}</span>
                    <span className="text-ink-500">{fmtAgo(r.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
