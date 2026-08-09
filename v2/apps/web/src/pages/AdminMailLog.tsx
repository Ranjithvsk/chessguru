// Phase 7l: admin view of the transactional-email log for the digest and
// streak-reminder channels. Read-only — the underlying send is stamped by
// the scheduler; this page just visualizes recent activity so we can spot
// a broken dw-otp tunnel, a bad template, or a bounce spike.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { get } from "../lib/api";

type Row = {
  userId: string; channel: "digest" | "streak"; email: string; subject: string;
  status: "sent" | "failed"; messageId: string | null; error: string | null; sentAt: string;
};
type Summary = { _id: { channel: string; status: string; window: "24h" | "7d" }; n: number; users: string[] };
type Payload = { rows: Row[]; summary: Summary[] };

type ChannelFilter = "" | "digest" | "streak";

export default function AdminMailLog() {
  const [channel, setChannel] = useState<ChannelFilter>("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-mail-log", channel],
    queryFn: () => get<Payload>(`/api/admin/mail-log${channel ? `?channel=${channel}` : ""}`),
  });

  const stats = useMemo(() => {
    // Roll the aggregate up into per-channel × window tiles.
    const key = (c: string, w: string) => `${c}:${w}`;
    const buckets: Record<string, { sent: number; failed: number; users: Set<string> }> = {};
    for (const s of data?.summary ?? []) {
      const k = key(s._id.channel, s._id.window);
      if (!buckets[k]) buckets[k] = { sent: 0, failed: 0, users: new Set() };
      if (s._id.status === "sent") buckets[k].sent += s.n;
      if (s._id.status === "failed") buckets[k].failed += s.n;
      for (const u of s.users) buckets[k].users.add(u);
    }
    return buckets;
  }, [data]);

  if (isLoading) return <div className="grid h-64 place-items-center text-ink-400">Loading mail log…</div>;
  if (error) return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{String(error)}</div>;

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-white">📬 Email delivery log</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-500">channel:</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelFilter)}
            className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-white"
          >
            <option value="">all</option>
            <option value="digest">digest</option>
            <option value="streak">streak</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["digest:24h", "digest:7d", "streak:24h", "streak:7d"] as const).map((k) => {
          const [ch, win] = k.split(":") as [string, string];
          const s = stats[k];
          const sent = s?.sent ?? 0;
          const failed = s?.failed ?? 0;
          const users = s?.users.size ?? 0;
          const hot = failed > 0;
          return (
            <div key={k} className={`rounded-xl2 border p-4 ${hot ? "border-rose-400/40 bg-rose-400/5" : "border-ink-700 bg-ink-900"}`}>
              <div className="text-xs text-ink-400 capitalize">{ch} · last {win}</div>
              <div className={`mt-1 font-display text-2xl font-bold tabular-nums ${hot ? "text-rose-200" : "text-white"}`}>
                {sent}
                {failed > 0 && <span className="ml-2 text-sm text-rose-400">/ {failed} failed</span>}
              </div>
              <div className="mt-1 text-[11px] text-ink-500">{users} recipient{users === 1 ? "" : "s"}</div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-500">no entries yet</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="text-white/90">
                <td className="whitespace-nowrap px-3 py-2 text-ink-400 tabular-nums">
                  {new Date(r.sentAt).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${r.channel === "digest" ? "bg-brand-500/20 text-brand-300" : "bg-orange-500/20 text-orange-300"}`}>
                    {r.channel}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-300">
                  <Link className="hover:text-white hover:underline" to={`/admin/users/${encodeURIComponent(r.userId)}`}>{r.userId}</Link>
                </td>
                <td className="px-3 py-2 text-ink-300">{r.email}</td>
                <td className="px-3 py-2">{r.subject}</td>
                <td className="px-3 py-2">
                  {r.status === "sent"
                    ? <span className="text-emerald-400">✓ sent</span>
                    : <span title={r.error ?? ""} className="text-rose-400">✗ {r.error ?? "failed"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-500">
        Log is written by the digest + streak-reminder schedulers on every send attempt. dw-otp acknowledges each message but doesn't yet forward delivery webhooks for these channels — so "sent" means "handed off successfully", not "landed in inbox".
      </p>
    </div>
  );
}
