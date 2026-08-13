// AdminDomains.tsx — superadmin overview + per-row control for the
// custom-domain feature at /admin/domains.
//
// Server-side guard lives in AdminDomainsController.requireAdmin; the
// Navigate("/") below is a UX shortcut only. All hooks above every early
// return (React #310).

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface AcademyRow {
  slug: string;
  academyId: string;
  displayName: string;
  customDomain: string;
  customDomainStatus: string;
  customDomainEnabled: boolean;
  customDomainAddedAt: string | null;
  customDomainActivatedAt: string | null;
  customDomainLastError: string;
}
interface CoachRow {
  username: string;
  userId: string;
  role: string;
  academyId: string | null;
  displayName: string;
  customDomain: string;
  customDomainStatus: string;
  customDomainEnabled: boolean;
  customDomainAddedAt: string | null;
  customDomainActivatedAt: string | null;
  customDomainLastError: string;
}
interface Payload { academies: AcademyRow[]; coaches: CoachRow[] }

async function fetchDomains(): Promise<Payload> {
  const r = await fetch(`${BASE}/api/admin/domains`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET /api/admin/domains → ${r.status}`);
  return r.json();
}
async function post(path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
  return j;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }); } catch { return "—"; }
}
function StatusPill({ s }: { s: string }) {
  if (!s) return <span className="text-xs text-slate-500">—</span>;
  const cls =
    s === "active" ? "bg-emerald-500/20 text-emerald-300"
    : s === "failed" ? "bg-rose-500/20 text-rose-300"
    : s === "pending_dns" ? "bg-amber-500/20 text-amber-300"
    : "bg-cyan-500/20 text-cyan-300";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:opacity-50 ${
        on ? "bg-emerald-500" : "bg-slate-600"
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Per-row set-domain input that toggles between show and hide. */
function SetDomainInline({
  currentDomain,
  onSubmit,
  pending,
}: { currentDomain: string; onSubmit: (d: string) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(currentDomain);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setVal(currentDomain); setOpen(true); }}
        className="text-xs text-cyan-300 hover:text-cyan-200 underline"
      >Set domain</button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value.toLowerCase().trim())}
        placeholder="e.g. site.com"
        className="w-40 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
        maxLength={253}
      />
      <button
        type="button"
        disabled={!val || pending}
        onClick={() => { onSubmit(val); setOpen(false); }}
        className="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-50"
      >{pending ? "…" : "Save"}</button>
      <button
        type="button" onClick={() => setOpen(false)}
        className="text-xs text-slate-400 hover:text-slate-200 px-1"
      >×</button>
    </div>
  );
}

export default function AdminDomainsPage() {
  const qc = useQueryClient();
  const { data: auth, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const isAdmin = !!auth?.admin;
  const { data, isLoading, error, refetch } = useQuery<Payload>({
    queryKey: ["admin-domains"],
    queryFn: fetchDomains,
    enabled: isAdmin,
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashErr, setFlashErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"academies" | "coaches">("academies");

  // All hooks above every early return.
  const doAction = async (key: string, fn: () => Promise<any>, okMsg: string) => {
    setBusyKey(key); setFlash(null); setFlashErr(null);
    try {
      await fn();
      setFlash(okMsg);
      await refetch();
    } catch (e: any) {
      setFlashErr(String(e?.message || e));
    } finally {
      setBusyKey(null);
      setTimeout(() => { setFlash(null); setFlashErr(null); }, 4000);
    }
  };

  if (authLoading) return <p className="text-slate-400 p-6">Loading…</p>;
  if (auth && !auth.loggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  const academies = data?.academies || [];
  const coaches = data?.coaches || [];
  const allRows = [
    ...academies.map((a) => ({ status: a.customDomainStatus, enabled: a.customDomainEnabled })),
    ...coaches.map((c) => ({ status: c.customDomainStatus, enabled: c.customDomainEnabled })),
  ];
  const nActive = allRows.filter((r) => r.status === "active").length;
  const nPending = allRows.filter((r) => r.status === "pending_dns" || r.status === "verifying" || r.status === "provisioning").length;
  const nFailed = allRows.filter((r) => r.status === "failed").length;
  const nDisabled = allRows.filter((r) => r.enabled === false).length;

  const setDomainAcademy = (a: AcademyRow, d: string) =>
    doAction(`aset:${a.academyId}`, () => post(`/api/admin/academy/${encodeURIComponent(a.academyId)}/set-domain`, { domain: d }),
      `Domain set for ${a.slug} (pending DNS)`);
  const verifyAcademy = (a: AcademyRow) =>
    doAction(`averify:${a.academyId}`, () => post(`/api/admin/academy/${encodeURIComponent(a.academyId)}/verify-domain`),
      `Verify triggered for ${a.slug}`);
  const removeAcademy = (a: AcademyRow) =>
    doAction(`arm:${a.academyId}`, () => post(`/api/admin/academy/${encodeURIComponent(a.academyId)}/remove-domain`),
      `Domain removed for ${a.slug}`);
  const enableAcademy = (a: AcademyRow, v: boolean) =>
    doAction(`aen:${a.academyId}`, () => post(`/api/admin/academy/${encodeURIComponent(a.academyId)}/enable-domain`, { enabled: v }),
      `Feature ${v ? "enabled" : "disabled"} for ${a.slug}`);

  const setDomainCoach = (c: CoachRow, d: string) =>
    doAction(`cset:${c.username}`, () => post(`/api/admin/coach/${encodeURIComponent(c.username)}/set-domain`, { domain: d }),
      `Domain set for ${c.username} (pending DNS)`);
  const verifyCoach = (c: CoachRow) =>
    doAction(`cverify:${c.username}`, () => post(`/api/admin/coach/${encodeURIComponent(c.username)}/verify-domain`),
      `Verify triggered for ${c.username}`);
  const removeCoach = (c: CoachRow) =>
    doAction(`crm:${c.username}`, () => post(`/api/admin/coach/${encodeURIComponent(c.username)}/remove-domain`),
      `Domain removed for ${c.username}`);
  const enableCoach = (c: CoachRow, v: boolean) =>
    doAction(`cen:${c.username}`, () => post(`/api/admin/coach/${encodeURIComponent(c.username)}/enable-domain`, { enabled: v }),
      `Feature ${v ? "enabled" : "disabled"} for ${c.username}`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-white">Custom Domains — Platform Overview</h1>
        <p className="text-sm text-ink-400">
          Per-academy and per-coach custom-domain gate + admin-on-behalf controls.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Active" value={nActive} tone="emerald" />
        <Card label="Pending" value={nPending} tone="amber" />
        <Card label="Failed" value={nFailed} tone="rose" />
        <Card label="Feature disabled" value={nDisabled} tone="slate" />
      </div>

      {/* Flash strip */}
      {(flash || flashErr) && (
        <div className={`rounded-lg px-3 py-2 text-sm ${flashErr ? "bg-rose-500/10 text-rose-300 border border-rose-500/30" : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"}`}>
          {flashErr || flash}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-700">
        <button
          type="button" onClick={() => setTab("academies")}
          className={`px-4 py-2 text-sm font-medium ${tab === "academies" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-400 hover:text-slate-200"}`}
        >Academies ({academies.length})</button>
        <button
          type="button" onClick={() => setTab("coaches")}
          className={`px-4 py-2 text-sm font-medium ${tab === "coaches" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-400 hover:text-slate-200"}`}
        >Coaches ({coaches.length})</button>
      </div>

      {isLoading && <p className="text-slate-400">Loading…</p>}
      {error && <p className="text-rose-300 text-sm">Failed to load: {String((error as any)?.message || error)}</p>}

      {tab === "academies" && !isLoading && (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full text-sm text-slate-200">
            <thead className="bg-slate-800/60 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Academy</th>
                <th className="px-3 py-2 text-left">Feature</th>
                <th className="px-3 py-2 text-left">Domain</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Added</th>
                <th className="px-3 py-2 text-left">Activated</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {academies.map((a) => {
                const k = `aen:${a.academyId}`;
                return (
                  <tr key={a.academyId} className={a.customDomainEnabled ? "" : "bg-rose-900/10"}>
                    <td className="px-3 py-2">
                      <div className="text-white">{a.displayName}</div>
                      <div className="text-xs text-slate-500">{a.slug}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Toggle
                        on={a.customDomainEnabled}
                        disabled={busyKey === k}
                        onChange={(v) => enableAcademy(a, v)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {a.customDomain ? (
                        <a href={`https://${a.customDomain}`} target="_blank" rel="noreferrer"
                          className="text-cyan-300 hover:underline text-xs">{a.customDomain}</a>
                      ) : <span className="text-slate-500 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill s={a.customDomainStatus} />
                      {a.customDomainLastError && (
                        <div className="text-[10px] text-rose-400/90 mt-0.5 max-w-xs truncate" title={a.customDomainLastError}>
                          {a.customDomainLastError}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(a.customDomainAddedAt)}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(a.customDomainActivatedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <SetDomainInline
                          currentDomain={a.customDomain}
                          onSubmit={(d) => setDomainAcademy(a, d)}
                          pending={busyKey === `aset:${a.academyId}`}
                        />
                        {a.customDomain && (
                          <>
                            <button
                              type="button" onClick={() => verifyAcademy(a)}
                              disabled={busyKey === `averify:${a.academyId}`}
                              className="text-xs text-cyan-300 hover:text-cyan-200 underline disabled:opacity-50"
                            >Verify</button>
                            <button
                              type="button" onClick={() => removeAcademy(a)}
                              disabled={busyKey === `arm:${a.academyId}`}
                              className="text-xs text-rose-400 hover:text-rose-300 underline disabled:opacity-50"
                            >Remove</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {academies.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No academies.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "coaches" && !isLoading && (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full text-sm text-slate-200">
            <thead className="bg-slate-800/60 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Coach</th>
                <th className="px-3 py-2 text-left">Feature</th>
                <th className="px-3 py-2 text-left">Domain</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Added</th>
                <th className="px-3 py-2 text-left">Activated</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {coaches.map((c) => {
                const k = `cen:${c.username}`;
                return (
                  <tr key={c.username} className={c.customDomainEnabled ? "" : "bg-rose-900/10"}>
                    <td className="px-3 py-2">
                      <div className="text-white">{c.displayName}</div>
                      <div className="text-xs text-slate-500">
                        {c.username} · {c.role}{c.academyId ? ` · ${c.academyId}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Toggle
                        on={c.customDomainEnabled}
                        disabled={busyKey === k}
                        onChange={(v) => enableCoach(c, v)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {c.customDomain ? (
                        <a href={`https://${c.customDomain}`} target="_blank" rel="noreferrer"
                          className="text-cyan-300 hover:underline text-xs">{c.customDomain}</a>
                      ) : <span className="text-slate-500 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill s={c.customDomainStatus} />
                      {c.customDomainLastError && (
                        <div className="text-[10px] text-rose-400/90 mt-0.5 max-w-xs truncate" title={c.customDomainLastError}>
                          {c.customDomainLastError}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(c.customDomainAddedAt)}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtDate(c.customDomainActivatedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <SetDomainInline
                          currentDomain={c.customDomain}
                          onSubmit={(d) => setDomainCoach(c, d)}
                          pending={busyKey === `cset:${c.username}`}
                        />
                        {c.customDomain && (
                          <>
                            <button
                              type="button" onClick={() => verifyCoach(c)}
                              disabled={busyKey === `cverify:${c.username}`}
                              className="text-xs text-cyan-300 hover:text-cyan-200 underline disabled:opacity-50"
                            >Verify</button>
                            <button
                              type="button" onClick={() => removeCoach(c)}
                              disabled={busyKey === `crm:${c.username}`}
                              className="text-xs text-rose-400 hover:text-rose-300 underline disabled:opacity-50"
                            >Remove</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {coaches.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No coaches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" | "slate" }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-300"
    : tone === "amber" ? "text-amber-300"
    : tone === "rose" ? "text-rose-300"
    : "text-slate-300";
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 font-display text-2xl ${toneCls}`}>{value}</div>
    </div>
  );
}
