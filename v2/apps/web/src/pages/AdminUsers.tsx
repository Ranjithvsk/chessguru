import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api, adminUsers, adminUserDetail } from "../lib/api";

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

export default function AdminUsersPage() {
  const { data: auth, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const isAdmin = !!auth?.admin;
  const { data: users, isLoading, error } = useQuery({ queryKey: ["admin-users"], queryFn: adminUsers, enabled: isAdmin });
  const [sel, setSel] = useState<string | null>(null);
  const { data: detail } = useQuery({ queryKey: ["admin-user", sel], queryFn: () => adminUserDetail(sel!), enabled: !!sel && isAdmin });

  if (authLoading) return <p className="text-ink-400">Loading…</p>;
  if (auth && !auth.loggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-rose-200">Not authorized — admin only.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-white">Users</h1>
        <p className="text-sm text-ink-400">{users?.length ?? 0} registered · click a row for activity</p>
      </div>
      {error && <p className="text-rose-300">Failed to load users.</p>}
      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-800 text-ink-300">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Joined</th>
              <th className="px-3 py-2">Last login</th>
              <th className="px-3 py-2">Puzzle</th>
              <th className="px-3 py-2">Solves</th>
              <th className="px-3 py-2">Win%</th>
              <th className="px-3 py-2">Last active</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.username} onClick={() => setSel(u.username)}
                className={`cursor-pointer border-t border-ink-800 hover:bg-ink-800/60 ${sel === u.username ? "bg-ink-800" : ""}`}>
                <td className="px-3 py-2 font-medium text-white">{u.username}</td>
                <td className="px-3 py-2 text-ink-300">{u.email || "—"}</td>
                <td className="px-3 py-2 text-ink-400">{fmtDate(u.createdAt)}</td>
                <td className="px-3 py-2 text-ink-400">{fmtAgo(u.lastLogin)}</td>
                <td className="px-3 py-2">{u.puzzleRating ?? "—"}</td>
                <td className="px-3 py-2">{u.solves}</td>
                <td className="px-3 py-2">{u.solves ? Math.round((u.wins / u.solves) * 100) + "%" : "—"}</td>
                <td className="px-3 py-2 text-ink-400">{fmtAgo(u.lastActive)}</td>
              </tr>
            ))}
            {isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-400">Loading…</td></tr>}
            {!isLoading && (users ?? []).length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-400">No users.</td></tr>}
          </tbody>
        </table>
      </div>

      {sel && detail && (
        <div className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">
              {detail.username}{" "}
              <span className="text-sm text-ink-400">· joined {fmtDate(detail.createdAt)} · last login {fmtAgo(detail.lastLogin)}{detail.email ? " · " + detail.email : ""}</span>
            </h2>
            <button onClick={() => setSel(null)} className="text-sm text-ink-400 hover:text-white">close</button>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(detail.ratings).map(([k, v]) => (
              <span key={k} className="rounded-full bg-ink-800 px-2.5 py-1 text-xs text-ink-200">{k}: <b className="text-white">{v.r}</b> <span className="text-ink-500">({v.nb})</span></span>
            ))}
            {Object.keys(detail.ratings).length === 0 && <span className="text-sm text-ink-400">No rated activity yet.</span>}
          </div>
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
      )}
    </div>
  );
}
