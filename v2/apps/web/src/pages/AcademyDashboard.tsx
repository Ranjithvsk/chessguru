// Post-signup landing for an academy member. For academy_owner it now also
// carries the coach-management panel (invite + list of pending invites +
// active coaches). This is the P0 of the SaaS Q1 admin surface; more (student
// enrollment, attendance rollup, fees) hangs off this same page.
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  return r.json() as Promise<T>;
}
async function del<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", credentials: "include" });
  return r.json() as Promise<T>;
}

interface Invite { token: string; email: string; displayName?: string; role: string; createdAt: string; expiresAt: string; invitedByName?: string }
interface Coach  { _id: string; username: string; email?: string|null; createdAt?: string; lastLogin?: string|null }

function fmtDate(d?: string|null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default function AcademyDashboardPage() {
  const { data: me, isLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  const isOwner = me?.role === "academy_owner";
  const { data: invites } = useQuery({
    queryKey: ["academy-invites"], queryFn: () => get<Invite[]>("/api/academy/invites"),
    enabled: !!isOwner, refetchInterval: 15_000,
  });
  const { data: coaches } = useQuery({
    queryKey: ["academy-coaches"], queryFn: () => get<Coach[]>("/api/academy/coaches"),
    enabled: !!isOwner, refetchInterval: 30_000,
  });

  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteMsg, setInviteMsg] = useState<{ tone: "ok"|"err"; text: string }|null>(null);

  const inviteMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; invite?: { mail: string } }>("/api/academy/invites", { email, displayName }),
    onSuccess: (r) => {
      if (!r.ok) setInviteMsg({ tone: "err", text: r.error || "Invite failed." });
      else {
        setInviteMsg({ tone: "ok", text: `Invite sent to ${email}${r.invite?.mail === "sent" ? " (email delivered)" : ""}.` });
        setEmail(""); setDisplayName("");
      }
      qc.invalidateQueries({ queryKey: ["academy-invites"] });
      qc.invalidateQueries({ queryKey: ["academy-coaches"] });
    },
  });
  const revokeMut = useMutation({
    mutationFn: (token: string) => del<{ ok: boolean }>(`/api/academy/invites/${encodeURIComponent(token)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["academy-invites"] }),
  });

  if (isLoading) return <div className="py-16 text-center text-ink-400">Loading…</div>;
  if (!me?.loggedIn) return <Navigate to="/login" replace />;
  if (!me.academyId) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
          <div className="mb-2 text-3xl">🏛️</div>
          <h1 className="mb-2 font-display text-xl text-white">No academy yet</h1>
          <p className="mb-5 text-sm text-ink-400">You aren't a member of an academy — create one to get started.</p>
          <Link to="/signup-academy" className="inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-500">
            Create academy →
          </Link>
        </div>
      </div>
    );
  }

  const roleLabel = me.role === "academy_owner" ? "Owner"
                  : me.role === "coach"          ? "Coach"
                  : me.role === "student"        ? "Student"
                  : me.role || "Member";

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <header className="rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-300">🏛️ Academy · {roleLabel}</div>
        <h1 className="font-display text-2xl text-white">{me.academyId}</h1>
        <p className="mt-1 text-sm text-ink-400">Welcome, <b className="text-white">{me.username}</b>. Your academy is live.</p>
      </header>

      {isOwner && (
        <>
          {/* ── Invite coach ── */}
          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="font-display text-lg text-white">🧑‍🏫 Invite a coach</h2>
              <span className="text-xs text-ink-500">They'll get an email with a signup link (valid 7 days)</span>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input type="email" placeholder="coach@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              <input type="text" placeholder="Display name (optional, e.g. Coach Priya)" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              <button disabled={!email || inviteMut.isPending}
                onClick={() => inviteMut.mutate()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {inviteMut.isPending ? "Sending…" : "Send invite"}
              </button>
            </div>
            {inviteMsg && (
              <p className={`mt-2 text-xs ${inviteMsg.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{inviteMsg.text}</p>
            )}
          </section>

          {/* ── Pending invites ── */}
          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 font-display text-lg text-white">✉️ Pending invites <span className="text-xs text-ink-500">({invites?.length ?? 0})</span></h2>
            {(!invites || invites.length === 0) && (
              <p className="text-sm text-ink-400">No pending invites. Invite someone above to get started.</p>
            )}
            {invites && invites.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-ink-700">
                <table className="w-full text-sm">
                  <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Display name</th>
                      <th className="px-3 py-2 text-left">Role</th>
                      <th className="px-3 py-2 text-left">Sent</th>
                      <th className="px-3 py-2 text-left">Expires</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => (
                      <tr key={inv.token} className="border-t border-ink-800">
                        <td className="px-3 py-2 text-white">{inv.email}</td>
                        <td className="px-3 py-2 text-ink-300">{inv.displayName || "—"}</td>
                        <td className="px-3 py-2"><span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-semibold text-brand-100">{inv.role}</span></td>
                        <td className="px-3 py-2 text-ink-400">{fmtDate(inv.createdAt)}</td>
                        <td className="px-3 py-2 text-ink-400">{fmtDate(inv.expiresAt)}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => revokeMut.mutate(inv.token)}
                            className="text-xs text-rose-300 underline hover:text-rose-200">
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Active coaches ── */}
          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-3 font-display text-lg text-white">👥 Coaches <span className="text-xs text-ink-500">({coaches?.length ?? 0})</span></h2>
            {(!coaches || coaches.length === 0) && (
              <p className="text-sm text-ink-400">No coaches yet. They'll appear here once they accept their invite.</p>
            )}
            {coaches && coaches.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-ink-700">
                <table className="w-full text-sm">
                  <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Username</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Joined</th>
                      <th className="px-3 py-2 text-left">Last login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coaches.map((c) => (
                      <tr key={c._id} className="border-t border-ink-800">
                        <td className="px-3 py-2 text-white">{c.username}</td>
                        <td className="px-3 py-2 text-ink-300">{c.email || "—"}</td>
                        <td className="px-3 py-2 text-ink-400">{fmtDate(c.createdAt)}</td>
                        <td className="px-3 py-2 text-ink-400">{fmtDate(c.lastLogin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {!isOwner && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-2 font-display text-lg text-white">Your {roleLabel.toLowerCase()} view</h2>
          <p className="text-sm text-ink-400">
            Coach-specific dashboard (your students · next class · attendance summary) is being built.
            For now you have full access to everything under Puzzles / Play / Learn.
          </p>
        </section>
      )}

      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <h2 className="mb-1 font-display text-lg text-white">🚀 Q1 shipping list</h2>
        <ul className="grid gap-2 text-sm text-ink-200 md:grid-cols-2">
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Multi-tenant signup</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Coach invitations · <span className="text-ink-500">live above</span></li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Student enrollment (coach rosters)</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Attendance rollup per student</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Per-academy class scheduling</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Billing skeleton (Razorpay)</li>
        </ul>
      </section>
    </div>
  );
}
