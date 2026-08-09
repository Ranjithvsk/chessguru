// Academy dashboard — owner + coach both use this page, with role-scoped panels.
//
//   OWNER sees: invite coach + invite student (pick coach), pending invites,
//               all coaches, all students, per-student "view perf" link.
//   COACH sees: invite student (auto-attaches to them), pending invites
//               (their own), their student roster, per-student "view perf".
//   STUDENT sees: thin shell (no management), full ChessGuru access as normal.
//
// All lists auto-refresh so accepted invites turn into real rows without a
// manual reload.
import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
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

interface Invite { token: string; email: string; displayName?: string; role: "coach"|"student"; coachId?: string|null; createdAt: string; expiresAt: string; invitedByName?: string }
interface Coach   { _id: string; username: string; email?: string|null; createdAt?: string; lastLogin?: string|null }
interface Student {
  _id: string; username: string; email?: string|null; coachId?: string|null;
  createdAt?: string; lastLogin?: string|null;
  puzzleRating?: number;
  // Attendance rollup from classAttendance (see AcademyService.listStudents)
  attendedTotal?: number; attendedThisWeek?: number; lastAttendedAt?: string|null;
  // Fees rollup from feeInvoices
  pendingFeesPaise?: number; oldestPendingPeriod?: string|null;
}
interface ClassRow { _id: string; title: string; coach: string; startAt: string; durationMin: number; mine?: boolean; attendedCount?: number; academyId?: string|null }
interface FeesConfig { monthlyFeePaise: number; upiVpa: string; upiPayeeName: string; canEdit: boolean }
interface Invoice { _id: string; academyId: string; studentId: string; studentUsername: string; period: string; amountPaise: number; status: "pending"|"paid"|"waived"; generatedAt: string; paidAt?: string; paymentMethod?: string }
function rupees(paise: number) { return (paise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }); }
function upiIntent(o: { vpa: string; name: string; amountPaise: number; note: string }) {
  const p = new URLSearchParams({
    pa: o.vpa, pn: o.name, am: (o.amountPaise / 100).toFixed(2),
    cu: "INR", tn: o.note,
  });
  return `upi://pay?${p.toString()}`;
}
interface ScheduleResp { live: ClassRow[]; upcoming: ClassRow[] }
function fmtStartAt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function localDatetimeDefault() {
  // Default the scheduler form's startAt to the next quarter-hour, local time.
  const d = new Date();
  d.setMinutes(d.getMinutes() + (15 - d.getMinutes() % 15), 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(d?: string|null) { return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "—"; }
function fmtAgo(d?: string|null) {
  if (!d) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
}

export default function AcademyDashboardPage() {
  const { data: me, isLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const isOwner = me?.role === "academy_owner";
  const isCoach = me?.role === "coach";
  const canManage = isOwner || isCoach;

  const qc = useQueryClient();

  const { data: invites } = useQuery({
    queryKey: ["academy-invites"], queryFn: () => get<Invite[]>("/api/academy/invites"),
    enabled: canManage, refetchInterval: 15_000,
  });
  const { data: coaches } = useQuery({
    queryKey: ["academy-coaches"], queryFn: () => get<Coach[]>("/api/academy/coaches"),
    enabled: !!isOwner, refetchInterval: 30_000,
  });
  const { data: students } = useQuery({
    queryKey: ["academy-students"], queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: canManage, refetchInterval: 30_000,
  });
  const { data: schedule } = useQuery({
    queryKey: ["academy-schedule"], queryFn: () => get<ScheduleResp>("/api/class/schedule"),
    enabled: !!me?.loggedIn, refetchInterval: 30_000,
  });
  const { data: feesConfig } = useQuery({
    queryKey: ["academy-fees-config"], queryFn: () => get<FeesConfig>("/api/academy/fees/config"),
    enabled: canManage,
  });
  const { data: invoices } = useQuery({
    queryKey: ["academy-fees"], queryFn: () => get<Invoice[]>("/api/academy/fees?status=pending"),
    enabled: canManage, refetchInterval: 30_000,
  });

  // Scheduler form
  const [classTitle, setClassTitle] = useState("");
  const [classCoach, setClassCoach] = useState("");
  const [classStartAt, setClassStartAt] = useState(localDatetimeDefault);
  const [classDur, setClassDur] = useState(60);
  const [scheduleMsg, setScheduleMsg] = useState<{ tone: "ok"|"err"; text: string }|null>(null);
  // Fees form + actions
  const [feeRupees, setFeeRupees] = useState<string>("");
  const [feeVpa, setFeeVpa] = useState("");
  const [feePayeeName, setFeePayeeName] = useState("");
  useEffect(() => {
    if (feesConfig) {
      setFeeRupees(feesConfig.monthlyFeePaise ? String(feesConfig.monthlyFeePaise / 100) : "");
      setFeeVpa(feesConfig.upiVpa || "");
      setFeePayeeName(feesConfig.upiPayeeName || "");
    }
  }, [feesConfig]);
  const [feesMsg, setFeesMsg] = useState<{ tone: "ok"|"err"; text: string }|null>(null);
  const saveFeesMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/academy/fees/config`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyFeePaise: Math.round(Number(feeRupees) * 100) || 0,
        upiVpa: feeVpa, upiPayeeName: feePayeeName,
      }),
    }).then((r) => r.json()),
    onSuccess: (r: any) => {
      setFeesMsg(r.ok ? { tone: "ok", text: "Fees config saved." } : { tone: "err", text: r.error || "Save failed." });
      qc.invalidateQueries({ queryKey: ["academy-fees-config"] });
    },
  });
  const generateMut = useMutation({
    mutationFn: () => post<{ ok: boolean; generated?: number; period?: string; pendingCount?: number; error?: string }>("/api/academy/fees/generate"),
    onSuccess: (r) => {
      setFeesMsg(r.ok
        ? { tone: "ok", text: `Generated invoices for ${r.period} — ${r.pendingCount} still pending.` }
        : { tone: "err", text: r.error || "Generate failed." });
      qc.invalidateQueries({ queryKey: ["academy-fees"] });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });
  const markPaidMut = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; error?: string }>(`/api/academy/fees/${encodeURIComponent(id)}/mark-paid`, { paymentMethod: "upi" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["academy-fees"] });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });

  const scheduleMut = useMutation({
    mutationFn: () => post<{ _id: string; title: string }>("/api/class/schedule", {
      title: classTitle, coach: classCoach || (me?.username ?? ""), startAt: new Date(classStartAt).toISOString(), durationMin: classDur,
    }),
    onSuccess: (r: any) => {
      if (r && r._id) {
        setScheduleMsg({ tone: "ok", text: `"${r.title}" scheduled — join link ready.` });
        setClassTitle(""); setClassCoach(""); setClassStartAt(localDatetimeDefault()); setClassDur(60);
      } else {
        setScheduleMsg({ tone: "err", text: (r as any)?.message || "Schedule failed." });
      }
      qc.invalidateQueries({ queryKey: ["academy-schedule"] });
    },
  });

  // Invite forms
  const [coachEmail, setCoachEmail] = useState("");
  const [coachName, setCoachName] = useState("");
  const [studEmail, setStudEmail] = useState("");
  const [studName, setStudName] = useState("");
  const [studCoachId, setStudCoachId] = useState("");
  const [inviteMsg, setInviteMsg] = useState<{ tone: "ok"|"err"; text: string }|null>(null);

  const inviteCoachMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; invite?: { mail: string } }>("/api/academy/invites",
      { email: coachEmail, displayName: coachName, role: "coach" }),
    onSuccess: (r) => {
      if (!r.ok) setInviteMsg({ tone: "err", text: r.error || "Invite failed." });
      else { setInviteMsg({ tone: "ok", text: `Coach invite sent to ${coachEmail}.` }); setCoachEmail(""); setCoachName(""); }
      qc.invalidateQueries({ queryKey: ["academy-invites"] });
    },
  });
  const inviteStudentMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; invite?: { mail: string } }>("/api/academy/invites",
      { email: studEmail, displayName: studName, role: "student", coachId: isOwner ? studCoachId : undefined }),
    onSuccess: (r) => {
      if (!r.ok) setInviteMsg({ tone: "err", text: r.error || "Invite failed." });
      else { setInviteMsg({ tone: "ok", text: `Student invite sent to ${studEmail}.` }); setStudEmail(""); setStudName(""); setStudCoachId(""); }
      qc.invalidateQueries({ queryKey: ["academy-invites"] });
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

  const roleLabel = isOwner ? "Owner" : isCoach ? "Coach" : me.role === "student" ? "Student" : (me.role || "Member");
  const studentsShown = students ?? [];
  const coachById = Object.fromEntries((coaches ?? []).map((c) => [c._id, c.username]));

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <header className="rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-300">🏛️ Academy · {roleLabel}</div>
        <h1 className="font-display text-2xl text-white">{me.academyId}</h1>
        <p className="mt-1 text-sm text-ink-400">Welcome, <b className="text-white">{me.username}</b>.</p>
      </header>

      {/* ── Invite forms ── */}
      {canManage && (
        <section className="space-y-4">
          {isOwner && (
            <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-display text-lg text-white">🧑‍🏫 Invite a coach</h2>
                <span className="text-xs text-ink-500">7-day signup link via email</span>
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <input type="email" placeholder="coach@example.com" value={coachEmail}
                  onChange={(e) => setCoachEmail(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                <input type="text" placeholder="Display name (e.g. Coach Priya)" value={coachName}
                  onChange={(e) => setCoachName(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                <button disabled={!coachEmail || inviteCoachMut.isPending} onClick={() => inviteCoachMut.mutate()}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                  {inviteCoachMut.isPending ? "Sending…" : "Invite coach"}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="font-display text-lg text-white">👦 Invite a student</h2>
              <span className="text-xs text-ink-500">
                {isCoach ? "They'll be assigned to you" : "Pick which coach the student joins"}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input type="email" placeholder="parent@example.com" value={studEmail}
                onChange={(e) => setStudEmail(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              <input type="text" placeholder="Student display name (e.g. Aarav K)" value={studName}
                onChange={(e) => setStudName(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              {isOwner && (
                <select value={studCoachId} onChange={(e) => setStudCoachId(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none md:col-span-2">
                  <option value="">— pick a coach for this student —</option>
                  {(coaches ?? []).map((c) => <option key={c._id} value={c._id}>{c.username}{c.email ? ` (${c.email})` : ""}</option>)}
                </select>
              )}
              <button disabled={!studEmail || (isOwner && !studCoachId) || inviteStudentMut.isPending}
                onClick={() => inviteStudentMut.mutate()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 md:col-span-2">
                {inviteStudentMut.isPending ? "Sending…" : "Invite student"}
              </button>
            </div>
          </div>

          {inviteMsg && (
            <p className={`text-xs ${inviteMsg.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{inviteMsg.text}</p>
          )}
        </section>
      )}

      {/* ── Pending invites ── */}
      {canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-3 font-display text-lg text-white">✉️ Pending invites <span className="text-xs text-ink-500">({invites?.length ?? 0})</span></h2>
          {(!invites || invites.length === 0) && <p className="text-sm text-ink-400">No pending invites.</p>}
          {invites && invites.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">Coach</th>
                    <th className="px-3 py-2 text-left">Sent</th>
                    <th className="px-3 py-2 text-left">Expires</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.token} className="border-t border-ink-800">
                      <td className="px-3 py-2 text-white">{inv.email}<div className="text-[11px] text-ink-500">{inv.displayName || ""}</div></td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${inv.role === "coach" ? "bg-brand-500/15 text-brand-100" : "bg-emerald-500/15 text-emerald-200"}`}>{inv.role}</span></td>
                      <td className="px-3 py-2 text-ink-300">{inv.role === "student" && inv.coachId ? (coachById[inv.coachId] ?? inv.coachId) : "—"}</td>
                      <td className="px-3 py-2 text-ink-400">{fmtDate(inv.createdAt)}</td>
                      <td className="px-3 py-2 text-ink-400">{fmtDate(inv.expiresAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => revokeMut.mutate(inv.token)}
                          className="text-xs text-rose-300 underline hover:text-rose-200">Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Coaches (owner only) ── */}
      {isOwner && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-3 font-display text-lg text-white">👥 Coaches <span className="text-xs text-ink-500">({coaches?.length ?? 0})</span></h2>
          {(!coaches || coaches.length === 0) && <p className="text-sm text-ink-400">No coaches yet.</p>}
          {coaches && coaches.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Username</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Joined</th>
                    <th className="px-3 py-2 text-left">Last login</th>
                    <th className="px-3 py-2 text-left"># students</th>
                  </tr>
                </thead>
                <tbody>
                  {coaches.map((c) => {
                    const n = studentsShown.filter((s) => s.coachId === c._id).length;
                    return (
                      <tr key={c._id} className="border-t border-ink-800">
                        <td className="px-3 py-2 text-white">{c.username}</td>
                        <td className="px-3 py-2 text-ink-300">{c.email || "—"}</td>
                        <td className="px-3 py-2 text-ink-400">{fmtDate(c.createdAt)}</td>
                        <td className="px-3 py-2 text-ink-400">{fmtAgo(c.lastLogin)}</td>
                        <td className="px-3 py-2 text-ink-300 tabular-nums">{n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Students (owner sees all, coach sees theirs) ── */}
      {canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-3 font-display text-lg text-white">
            👦 {isCoach ? "My students" : "Students"} <span className="text-xs text-ink-500">({studentsShown.length})</span>
          </h2>
          {studentsShown.length === 0 && (
            <p className="text-sm text-ink-400">
              No students yet. {isCoach ? "Invite one above." : "Owners invite students and pick which coach they join."}
            </p>
          )}
          {studentsShown.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Username</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    {isOwner && <th className="px-3 py-2 text-left">Coach</th>}
                    <th className="px-3 py-2 text-left">Rating</th>
                    <th className="px-3 py-2 text-left" title="Classes attended (all-time · this week)">Attendance</th>
                    <th className="px-3 py-2 text-left">Fees pending</th>
                    <th className="px-3 py-2 text-left">Last active</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {studentsShown.map((s) => {
                    const att = s.attendedTotal ?? 0;
                    const wk  = s.attendedThisWeek ?? 0;
                    return (
                      <tr key={s._id} className="border-t border-ink-800">
                        <td className="px-3 py-2 text-white">{s.username}</td>
                        <td className="px-3 py-2 text-ink-300">{s.email || "—"}</td>
                        {isOwner && <td className="px-3 py-2 text-ink-300">{s.coachId ? (coachById[s.coachId] ?? s.coachId) : "—"}</td>}
                        <td className="px-3 py-2 text-white tabular-nums">{s.puzzleRating ?? 1500}</td>
                        <td className="px-3 py-2 tabular-nums" title={`Last attended: ${s.lastAttendedAt ? new Date(s.lastAttendedAt).toLocaleString() : "never"}`}>
                          {att === 0 ? (
                            <span className="text-ink-500">—</span>
                          ) : (
                            <span className="text-white">
                              {att}
                              {wk > 0 && <span className="ml-1 text-[10px] text-emerald-300">· {wk} this wk</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums" title={s.oldestPendingPeriod ? `Oldest: ${s.oldestPendingPeriod}` : ""}>
                          {(s.pendingFeesPaise ?? 0) === 0 ? (
                            <span className="text-emerald-300">✓ paid</span>
                          ) : (
                            <span className="text-rose-300">{rupees(s.pendingFeesPaise!)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-400">{fmtAgo(s.lastLogin)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2 text-xs">
                            <Link to={`/dashboard?as=${encodeURIComponent(s.username)}`} className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-brand-100 hover:bg-brand-500/20">📊 Perf</Link>
                            <Link to={`/history?as=${encodeURIComponent(s.username)}`} className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-brand-100 hover:bg-brand-500/20">📜 History</Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Non-management shell (student view) */}
      {!canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-2 font-display text-lg text-white">You're a {roleLabel.toLowerCase()} here</h2>
          <p className="text-sm text-ink-400">
            Head over to <Link to="/" className="text-brand-400 hover:underline">Puzzles</Link>,{" "}
            <Link to="/history" className="text-brand-400 hover:underline">History</Link>, or{" "}
            <Link to="/study" className="text-brand-400 hover:underline">Study</Link> to keep training.
          </p>
        </section>
      )}

      {/* ── Schedule a class (owner + coach) ── */}
      {canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="font-display text-lg text-white">🎥 Schedule a class</h2>
            <span className="text-xs text-ink-500">Only academy members see it (join link is private).</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <input type="text" placeholder="Class title (e.g. Endgame drills)" value={classTitle}
              onChange={(e) => setClassTitle(e.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none md:col-span-2" />
            <input type="text" placeholder={`Coach name (default: ${me?.username || "you"})`} value={classCoach}
              onChange={(e) => setClassCoach(e.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input type="datetime-local" value={classStartAt}
                onChange={(e) => setClassStartAt(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none" />
              <input type="number" min={5} max={600} value={classDur}
                onChange={(e) => setClassDur(Math.max(5, Math.min(600, Number(e.target.value) || 60)))}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none"
                title="Duration (minutes)" />
            </div>
            <button disabled={!classTitle || scheduleMut.isPending} onClick={() => scheduleMut.mutate()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 md:col-span-2">
              {scheduleMut.isPending ? "Scheduling…" : "Schedule class"}
            </button>
          </div>
          {scheduleMsg && <p className={`mt-2 text-xs ${scheduleMsg.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{scheduleMsg.text}</p>}
        </section>
      )}

      {/* ── Upcoming + live classes ── */}
      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <h2 className="mb-3 font-display text-lg text-white">
          📅 Classes
          <span className="ml-2 text-xs text-ink-500">
            {(schedule?.live?.length ?? 0)} live · {(schedule?.upcoming?.length ?? 0)} upcoming
          </span>
        </h2>
        {((schedule?.live?.length ?? 0) + (schedule?.upcoming?.length ?? 0)) === 0 && (
          <p className="text-sm text-ink-400">
            No scheduled classes yet. {canManage ? "Use the form above to schedule one." : "Your coach hasn't scheduled anything yet."}
          </p>
        )}
        {(schedule?.live?.length ?? 0) > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">🟢 Live now</div>
            {schedule!.live.map((c) => (
              <ClassRowUI key={c._id} c={c} live />
            ))}
          </div>
        )}
        {(schedule?.upcoming?.length ?? 0) > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Upcoming</div>
            {schedule!.upcoming.slice(0, 10).map((c) => (
              <ClassRowUI key={c._id} c={c} />
            ))}
          </div>
        )}
      </section>

      {/* ── Fees + billing (owner + coach; read-only for coach) ── */}
      {canManage && (
        <>
          {isOwner && (
            <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-display text-lg text-white">💰 Fees config</h2>
                <span className="text-xs text-ink-500">UPI-only for now (no Razorpay). Parents scan the QR to pay.</span>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">Monthly fee (₹)</label>
                  <input type="number" min="0" value={feeRupees} onChange={(e) => setFeeRupees(e.target.value)}
                    placeholder="e.g. 2500"
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">UPI VPA</label>
                  <input type="text" value={feeVpa} onChange={(e) => setFeeVpa(e.target.value.toLowerCase())}
                    placeholder="academy@ybl"
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">Payee name</label>
                  <input type="text" value={feePayeeName} onChange={(e) => setFeePayeeName(e.target.value)}
                    placeholder="Academy name shown in UPI app"
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                </div>
                <button disabled={saveFeesMut.isPending} onClick={() => saveFeesMut.mutate()}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                  {saveFeesMut.isPending ? "Saving…" : "Save fees config"}
                </button>
                <button disabled={generateMut.isPending || !feesConfig?.monthlyFeePaise}
                  onClick={() => generateMut.mutate()}
                  className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-4 py-2 text-sm font-semibold text-brand-100 hover:bg-brand-500/20 disabled:opacity-50">
                  {generateMut.isPending ? "Generating…" : "🧾 Generate this month's invoices"}
                </button>
              </div>
              {feesMsg && <p className={`mt-2 text-xs ${feesMsg.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{feesMsg.text}</p>}
            </section>
          )}

          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="font-display text-lg text-white">💸 Pending invoices <span className="text-xs text-ink-500">({invoices?.length ?? 0})</span></h2>
              {(invoices?.length ?? 0) > 0 && feesConfig && (
                <span className="text-xs text-ink-500">Parents scan the QR to pay via UPI. You mark it paid after seeing the bank credit.</span>
              )}
            </div>
            {(invoices?.length ?? 0) === 0 && <p className="text-sm text-ink-400">No pending invoices.</p>}
            {(invoices?.length ?? 0) > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {invoices!.map((inv) => (
                  <InvoiceCard key={inv._id} inv={inv} config={feesConfig} isOwner={!!isOwner}
                    onMarkPaid={() => markPaidMut.mutate(inv._id)}
                    markPaidPending={markPaidMut.isPending}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <h2 className="mb-1 font-display text-lg text-white">🚀 Q1 shipping list</h2>
        <ul className="grid gap-2 text-sm text-ink-200 md:grid-cols-2">
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Multi-tenant signup</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Coach invitations</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Student enrollment (coach rosters)</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Owner/coach view student performance</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Attendance rollup per student</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Per-academy class scheduling</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Fees + UPI QR payments</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🚀 Q1 complete — Q2 next</li>
        </ul>
      </section>
    </div>
  );
}

// Invoice card with an inline UPI QR the parent scans. QR is generated
// client-side (no external service). If UPI VPA isn't configured, we say so
// so the owner knows to fill it in on the Fees config panel above.
function InvoiceCard({ inv, config, isOwner, onMarkPaid, markPaidPending }: {
  inv: Invoice; config?: FeesConfig; isOwner: boolean;
  onMarkPaid: () => void; markPaidPending: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpa = config?.upiVpa || "";
  const payee = config?.upiPayeeName || "";
  const upiUrl = vpa ? upiIntent({
    vpa, name: payee || "Academy",
    amountPaise: inv.amountPaise,
    note: `Fees ${inv.period} · ${inv.studentUsername}`,
  }) : "";
  useEffect(() => {
    if (!upiUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, upiUrl, { width: 160, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .catch(() => {});
  }, [upiUrl]);

  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-white">{inv.studentUsername}</span>
        <span className="text-xs text-ink-500">· {inv.period}</span>
        <span className="ml-auto text-lg font-bold tabular-nums text-rose-200">{rupees(inv.amountPaise)}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {upiUrl ? (
          <>
            <canvas ref={canvasRef} width={160} height={160} className="rounded bg-white" />
            <div className="flex-1 text-xs text-ink-300">
              <div className="mb-1">Scan with any UPI app.</div>
              <div className="text-[10px] text-ink-500 break-all">to: <b className="text-ink-300">{vpa}</b></div>
              <a href={upiUrl} className="mt-2 inline-block text-brand-300 underline">Open in UPI app ↗</a>
            </div>
          </>
        ) : (
          <div className="text-xs text-amber-200">Set your UPI VPA in Fees config to render a QR here.</div>
        )}
      </div>
      {isOwner && (
        <div className="mt-2 flex justify-end gap-2">
          <button onClick={onMarkPaid} disabled={markPaidPending}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {markPaidPending ? "…" : "✓ Mark paid"}
          </button>
        </div>
      )}
    </div>
  );
}

// Single-row renderer for a scheduled class. Live rows get a green ring and
// a Join button; upcoming rows just show the start time and a Copy-link.
function ClassRowUI({ c, live }: { c: ClassRow; live?: boolean }) {
  return (
    <div className={`mb-1 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${live ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-800/40"}`}>
      <div className="flex-1 min-w-0">
        <div className="text-white truncate">{c.title}</div>
        <div className="text-[11px] text-ink-400">
          {c.coach}{" · "}{fmtStartAt(c.startAt)}{" · "}{c.durationMin}m
          {typeof c.attendedCount === "number" && c.mine && <span className="ml-2 text-emerald-300">✓ {c.attendedCount} attended</span>}
        </div>
      </div>
      <Link to={`/class/${encodeURIComponent(c._id)}`}
        className={`rounded-lg px-3 py-1 text-xs font-semibold ${live ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-brand-600 text-white hover:bg-brand-500"}`}>
        {live ? "Join now" : "Open class"}
      </Link>
    </div>
  );
}
