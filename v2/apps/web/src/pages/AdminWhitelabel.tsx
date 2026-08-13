// Super-admin only page for approving/revoking white-label per academy.
// Server-side gate: /api/academy/admin/list returns 403 unless
// session.username === "ranjith.vsk" (or SUPER_ADMIN_USERNAME env override).

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Row = {
  slug: string;
  name: string;
  ownerId: string;
  createdAt: string;
  approved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  hasLogo: boolean;
  hasCoachInfo: boolean;
  brandName: string;
  brandColor: string;
  tagline: string;
};

async function fetchList(): Promise<{ superAdmin: string; academies: Row[] } | { error: string }> {
  const r = await fetch(`${API_BASE}/api/academy/admin/list`, { credentials: "include" });
  if (r.status === 401 || r.status === 403) return { error: "Super-admin only" };
  if (!r.ok) return { error: await r.text().catch(() => "load failed") };
  return r.json();
}

export default function AdminWhitelabelPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["admin-whitelabel"], queryFn: fetchList });
  const [filter, setFilter] = useState<"all" | "pending" | "approved">("all");

  const approve = useMutation({
    mutationFn: async (slug: string) => {
      const r = await fetch(`${API_BASE}/api/academy/admin/approve/${slug}`, { method: "POST", credentials: "include" });
      return r.ok;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-whitelabel"] }),
  });
  const revoke = useMutation({
    mutationFn: async (slug: string) => {
      const r = await fetch(`${API_BASE}/api/academy/admin/revoke/${slug}`, { method: "POST", credentials: "include" });
      return r.ok;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-whitelabel"] }),
  });

  if (isLoading) return <div className="p-8 text-ink-400">Loading…</div>;
  if (error || (data && "error" in data)) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <div className="rounded-xl2 border border-rose-500/40 bg-rose-500/10 p-6 text-rose-100">
          <h1 className="mb-2 font-display text-xl">Access denied</h1>
          <p className="text-sm">This page is for the ChessGuru super-admin only.</p>
          <Link to="/" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Home</Link>
        </div>
      </div>
    );
  }
  const list = (data as any).academies as Row[];
  const filtered = list.filter((r) => filter === "all" ? true : filter === "approved" ? r.approved : !r.approved);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-display text-2xl text-white">Academy white-labels</h1>
        <span className="text-xs text-ink-500">super-admin: {(data as any).superAdmin}</span>
      </div>
      <div className="mb-4 flex gap-2 text-xs">
        {(["all", "pending", "approved"] as const).map((k) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 font-semibold ${filter === k ? "bg-brand-600 text-white" : "bg-ink-800 text-ink-400 hover:bg-ink-700"}`}>
            {k} ({list.filter((r) => k === "all" ? true : k === "approved" ? r.approved : !r.approved).length})
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.map((r) => (
          <div key={r.slug} className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-lg font-black text-white"
                style={{ background: r.brandColor }}>
                {r.brandName.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold text-white">{r.brandName}</h3>
                  <code className="text-[10px] text-ink-500">/a/{r.slug}</code>
                  {r.approved
                    ? <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">✓ approved</span>
                    : <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">pending</span>}
                </div>
                <div className="text-xs text-ink-400">owner: <code>{r.ownerId}</code> · created: {new Date(r.createdAt).toLocaleDateString()}</div>
                {r.tagline && <div className="mt-1 text-xs text-ink-300 italic">"{r.tagline}"</div>}
                <div className="mt-1 flex gap-3 text-[11px] text-ink-500">
                  {r.hasLogo && <span>logo ✓</span>}
                  {r.hasCoachInfo && <span>coach ✓</span>}
                  {r.approvedBy && <span>by {r.approvedBy} on {new Date(r.approvedAt!).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex flex-shrink-0 flex-col gap-1">
                <Link to={`/a/${r.slug}`} target="_blank"
                  className="rounded border border-ink-600 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">Preview</Link>
                {r.approved ? (
                  <button onClick={() => revoke.mutate(r.slug)} disabled={revoke.isPending}
                    className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-60">
                    Revoke
                  </button>
                ) : (
                  <button onClick={() => approve.mutate(r.slug)} disabled={approve.isPending}
                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                    Approve
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-sm text-ink-500 py-8">No academies match this filter.</p>}
      </div>
    </div>
  );
}
