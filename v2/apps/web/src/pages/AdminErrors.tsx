// Owner-facing view of everything the alerting layer has recorded: server
// 5xx, browser crashes, and slow requests. Email only notifies about the first
// occurrence of each distinct fault per hour — this page is the full record.
//
// "Most frequent (24h)" leads because the thing worth fixing is usually the
// one repeating hundreds of times, not the newest one-off.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

type Row = {
  _id: string; at: string; kind: "server" | "client" | "slow"; message: string;
  stack?: string; route?: string; method?: string; status?: number; ms?: number;
  userId?: string; academyId?: string; url?: string; userAgent?: string;
};
type Top = { _id: string; n: number; kind: string; message: string; route?: string; last: string };
type Payload = { rows: Row[]; top: Top[]; counts: { _id: string; n: number }[] };

type KindFilter = "" | "server" | "client" | "slow";

const KIND_STYLE: Record<string, string> = {
  server: "bg-rose-500/20 text-rose-300",
  client: "bg-amber-500/20 text-amber-300",
  slow: "bg-sky-500/20 text-sky-300",
};

export default function AdminErrors() {
  const [kind, setKind] = useState<KindFilter>("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-errors", kind],
    queryFn: () => get<Payload>(`/api/admin/errors${kind ? `?kind=${kind}` : ""}`),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="grid h-64 place-items-center text-ink-400">Loading errors…</div>;
  if (error) return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{String(error)}</div>;

  const rows = data?.rows ?? [];
  const count = (k: string) => data?.counts.find((c) => c._id === k)?.n ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-white">🚨 Error log</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-500">kind:</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}
            className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-white">
            <option value="">all</option>
            <option value="server">server 5xx</option>
            <option value="client">browser crash</option>
            <option value="slow">slow request</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {([["server", "Server 5xx"], ["client", "Browser crashes"], ["slow", "Slow requests"]] as const).map(([k, label]) => {
          const n = count(k);
          return (
            <div key={k} className={`rounded-xl2 border p-4 ${n > 0 ? "border-rose-400/40 bg-rose-400/5" : "border-ink-700 bg-ink-900"}`}>
              <div className="text-xs text-ink-400">{label} · last 24h</div>
              <div className={`mt-1 font-display text-2xl font-bold tabular-nums ${n > 0 ? "text-rose-200" : "text-white"}`}>{n}</div>
            </div>
          );
        })}
      </div>

      {!!data?.top?.length && (
        <div className="overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900">
          <div className="bg-ink-800 px-3 py-2 text-xs uppercase tracking-wide text-ink-400">Most frequent (24h)</div>
          <ul className="divide-y divide-ink-800">
            {data.top.map((t) => (
              <li key={t._id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-rose-300">{t.n}×</span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${KIND_STYLE[t.kind] ?? ""}`}>{t.kind}</span>
                <span className="truncate text-white/90">{t.message}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-ink-500">{t.route}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">What</th>
              <th className="px-3 py-2">Where</th>
              <th className="px-3 py-2">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-500">nothing recorded — that's the good outcome</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r._id} onClick={() => setOpen(open === r._id ? null : r._id)}
                className="cursor-pointer align-top text-white/90 hover:bg-ink-800/60">
                <td className="whitespace-nowrap px-3 py-2 text-ink-400 tabular-nums">
                  {new Date(r.at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${KIND_STYLE[r.kind] ?? ""}`}>
                    {r.kind}{r.status ? ` ${r.status}` : ""}{r.ms ? ` ${(r.ms / 1000).toFixed(1)}s` : ""}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className={open === r._id ? "" : "line-clamp-2"}>{r.message}</div>
                  {open === r._id && r.stack && (
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-2 text-[11px] text-ink-300">{r.stack}</pre>
                  )}
                  {open === r._id && r.userAgent && <div className="mt-1 text-[11px] text-ink-500">{r.userAgent}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-ink-400">
                  <div>{r.method} {r.route}</div>
                  {r.url && r.url !== r.route && <div className="text-ink-600">{r.url}</div>}
                </td>
                <td className="px-3 py-2 text-ink-300">{r.userId || <span className="text-ink-600">signed out</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-500">
        Kept for 30 days, then expired automatically. Email goes to the owner on the first occurrence of each distinct
        fault per hour (max 20/hour) — slow requests are recorded from 5s but only emailed from 15s. Click a row for the stack trace.
      </p>
    </div>
  );
}
